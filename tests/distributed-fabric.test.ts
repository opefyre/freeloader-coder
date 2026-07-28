import assert from "node:assert/strict";
import test from "node:test";

import {
  LeaseAuthority,
  PairingAuthority,
  classifyDeviceActivity,
  planWorkerUpdate,
  redactDeviceSupportExport,
  safeDeviceAction,
  scheduleTask,
  signCapabilityReport,
  verifyCapabilityReport,
  workerDisposition,
  type WorkerCandidate,
  type WorkerCapabilityReport
} from "../packages/distributed/src/index.js";

const controllerFingerprint = `sha256:${"a".repeat(64)}`;
const deviceFingerprint = `sha256:${"b".repeat(64)}`;
const signingKey = "synthetic-device-signing-key-32-bytes";

test("pairing is short-lived, mutually confirmed, single use, and revocable", () => {
  const authority = new PairingAuthority();
  const issued = authority.issue({
    controllerFingerprint,
    now: 1_000,
    ttlMs: 60_000,
    code: "A1B2C3D4"
  });
  const device = authority.confirm({
    requestId: issued.request.id,
    code: issued.code,
    now: 2_000,
    deviceName: "Spare Mac",
    owner: "Local owner",
    deviceFingerprint,
    observedControllerFingerprint: controllerFingerprint,
    networkPath: "private_network",
    permissions: ["models", "execution", "validation"],
    controllerConfirmed: true
  });
  assert.equal(authority.canLease(device.id), true);
  assert.throws(
    () => authority.confirm({
      requestId: issued.request.id,
      code: issued.code,
      now: 3_000,
      deviceName: "Replay",
      owner: "Unknown",
      deviceFingerprint,
      observedControllerFingerprint: controllerFingerprint,
      networkPath: "lan",
      permissions: ["execution"],
      controllerConfirmed: true
    }),
    /replay/
  );
  const revoked = authority.revoke(device.id, 4_000);
  assert.equal(revoked.credentialVersion, 2);
  assert.equal(authority.canLease(device.id), false);
});

test("expired or unconfirmed pairing never creates trust", () => {
  const authority = new PairingAuthority();
  const issued = authority.issue({
    controllerFingerprint,
    now: 1_000,
    ttlMs: 30_000,
    code: "11223344"
  });
  assert.throws(
    () => authority.confirm({
      requestId: issued.request.id,
      code: issued.code,
      now: 31_001,
      deviceName: "Late worker",
      owner: "Local owner",
      deviceFingerprint,
      observedControllerFingerprint: controllerFingerprint,
      networkPath: "lan",
      permissions: ["execution"],
      controllerConfirmed: true
    }),
    /expired/
  );
});

function report(input: {
  readonly deviceId: string;
  readonly memoryMb: number;
  readonly sourceModel?: string;
  readonly sleeping?: boolean;
  readonly thermal?: WorkerCapabilityReport["thermal"];
}): WorkerCapabilityReport {
  return signCapabilityReport({
    schemaVersion: 1,
    deviceId: input.deviceId,
    agentVersion: "1.0.0",
    platform: "darwin-arm64",
    cpuCores: 8,
    memoryMb: input.memoryMb,
    freeDiskMb: 200_000,
    runtimes: ["node-22", "docker"],
    localModels: input.sourceModel ? [input.sourceModel] : [],
    toolProfiles: ["models", "execution", "validation", "review"],
    containerRuntime: "docker",
    validatorIds: ["typescript", "node-test"],
    battery: { percent: 100, charging: true, minimumPercent: 30 },
    thermal: input.thermal ?? "nominal",
    sleeping: input.sleeping ?? false,
    observedAt: 1_000
  }, signingKey);
}

test("signed capability reports cannot overclaim observed hardware or tools", () => {
  const signed = report({ deviceId: "device_aaaaaaaaaaaaaaaa", memoryMb: 8_192, sourceModel: "qwen3" });
  const verified = verifyCapabilityReport({
    report: signed,
    deviceSigningKey: signingKey,
    observed: {
      cpuCores: 8,
      memoryMb: 8_192,
      freeDiskMb: 200_000,
      runtimes: ["node-22", "docker"],
      localModels: ["qwen3"],
      containerRuntime: "docker",
      validatorIds: ["typescript", "node-test"]
    }
  });
  assert.equal(workerDisposition(verified), "ready");
  assert.throws(
    () => verifyCapabilityReport({
      report: signed,
      deviceSigningKey: signingKey,
      observed: {
        cpuCores: 8,
        memoryMb: 4_096,
        freeDiskMb: 200_000,
        runtimes: ["node-22", "docker"],
        localModels: ["qwen3"],
        containerRuntime: "docker",
        validatorIds: ["typescript", "node-test"]
      }
    }),
    /unvalidated/
  );
});

test("scheduler keeps heavy work off controller while honoring privacy and locality", () => {
  const controller = report({ deviceId: "device_aaaaaaaaaaaaaaaa", memoryMb: 24_576 });
  const worker = report({ deviceId: "device_bbbbbbbbbbbbbbbb", memoryMb: 8_192, sourceModel: "qwen3" });
  const candidates: WorkerCandidate[] = [
    { report: controller, trusted: true, revoked: false, activeWorkloads: 0, controller: true },
    { report: worker, trusted: true, revoked: false, activeWorkloads: 0, controller: false }
  ];
  const remote = scheduleTask({
    task: {
      id: "PIPE-86",
      workType: "implementation",
      requiredProfiles: ["execution"],
      requiredRuntimes: ["node-22"],
      requiredModels: [],
      privacy: "trusted_devices",
      sourceDeviceId: worker.deviceId,
      expectedMemoryMb: 4_096,
      diversityKey: null
    },
    candidates,
    preferRemoteCompute: true
  });
  assert.equal(remote.deviceId, worker.deviceId);
  const localOnly = scheduleTask({
    task: {
      id: "PIPE-private",
      workType: "planning",
      requiredProfiles: ["models"],
      requiredRuntimes: [],
      requiredModels: [],
      privacy: "controller_only",
      sourceDeviceId: controller.deviceId,
      expectedMemoryMb: 2_048,
      diversityKey: null
    },
    candidates,
    preferRemoteCompute: true
  });
  assert.equal(localOnly.deviceId, controller.deviceId);
});

test("authoritative leases prevent duplicate work until expiry and reconciliation", () => {
  const leases = new LeaseAuthority();
  leases.claim({
    taskId: "PIPE-86",
    leaseId: "lease-1",
    deviceId: "device_bbbbbbbbbbbbbbbb",
    idempotencyKey: "PIPE-86.implementation",
    acquiredAt: 1_000,
    expiresAt: 2_000,
    now: 1_000
  });
  assert.throws(
    () => leases.claim({
      taskId: "PIPE-86",
      leaseId: "lease-2",
      deviceId: "device_aaaaaaaaaaaaaaaa",
      idempotencyKey: "PIPE-86.implementation",
      acquiredAt: 1_500,
      expiresAt: 3_000,
      now: 1_500
    }),
    /active authoritative/
  );
  assert.throws(
    () => leases.claim({
      taskId: "PIPE-86",
      leaseId: "lease-2",
      deviceId: "device_aaaaaaaaaaaaaaaa",
      idempotencyKey: "PIPE-86.implementation",
      acquiredAt: 2_100,
      expiresAt: 3_000,
      now: 2_100
    }),
    /reconcile/
  );
  leases.reconcile("PIPE-86", "lease-1");
  assert.equal(leases.claim({
    taskId: "PIPE-86",
    leaseId: "lease-2",
    deviceId: "device_aaaaaaaaaaaaaaaa",
    idempotencyKey: "PIPE-86.implementation",
    acquiredAt: 2_100,
    expiresAt: 3_000,
    now: 2_100
  }).deviceId, "device_aaaaaaaaaaaaaaaa");
});

test("slow active work remains healthy and unsafe repair or revoke is blocked", () => {
  const activity = {
    deviceId: "device_bbbbbbbbbbbbbbbb",
    state: "busy" as const,
    taskId: "PIPE-86",
    stage: "validation",
    activeRequest: false,
    validationActive: true,
    lastActivityAt: 1_000,
    leaseExpiresAt: 20_000,
    resourcePressure: "normal" as const
  };
  assert.equal(classifyDeviceActivity({
    activity,
    now: 6_000,
    slowAfterMs: 2_000,
    stoppedAfterMs: 10_000
  }), "slow_active");
  assert.equal(safeDeviceAction({ action: "repair", activity }).allowed, false);
  assert.equal(safeDeviceAction({ action: "revoke", activity }).allowed, false);
  const exported = redactDeviceSupportExport(activity);
  assert.equal(Object.hasOwn(exported, "deviceId"), false);
  assert.match(String(exported.deviceRef), /^device:/);
});

test("worker updates require signatures, rollback, and safe draining", () => {
  assert.equal(planWorkerUpdate({
    currentVersion: "1.0.0",
    targetVersion: "1.1.0",
    packageSignatureValid: true,
    rollbackVersion: "1.0.0",
    activeLease: true
  }).action, "drain_then_install");
  assert.equal(planWorkerUpdate({
    currentVersion: "1.0.0",
    targetVersion: "1.1.0",
    packageSignatureValid: false,
    rollbackVersion: "1.0.0",
    activeLease: false
  }).action, "reject");
});
