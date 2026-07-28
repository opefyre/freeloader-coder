import type { WorkerCapabilityReport } from "./worker.js";

export interface DistributedTask {
  readonly id: string;
  readonly workType: "planning" | "model" | "implementation" | "validation" | "review";
  readonly requiredProfiles: readonly ("models" | "execution" | "validation" | "review")[];
  readonly requiredRuntimes: readonly string[];
  readonly requiredModels: readonly string[];
  readonly privacy: "external_allowed" | "trusted_devices" | "controller_only";
  readonly sourceDeviceId: string;
  readonly expectedMemoryMb: number;
  readonly diversityKey: string | null;
}

export interface WorkerCandidate {
  readonly report: WorkerCapabilityReport;
  readonly trusted: boolean;
  readonly revoked: boolean;
  readonly activeWorkloads: number;
  readonly controller: boolean;
}

export interface SchedulingDecision {
  readonly taskId: string;
  readonly deviceId: string | null;
  readonly reason: string;
  readonly excluded: Readonly<Record<string, readonly string[]>>;
  readonly score: number | null;
}

export function scheduleTask(input: {
  readonly task: DistributedTask;
  readonly candidates: readonly WorkerCandidate[];
  readonly preferRemoteCompute: boolean;
}): SchedulingDecision {
  const excluded: Record<string, string[]> = {};
  const eligible = input.candidates.flatMap((candidate) => {
    const reasons: string[] = [];
    const report = candidate.report;
    if (!candidate.trusted || candidate.revoked) reasons.push("device is not trusted");
    if (workerDisposition(report) !== "ready") reasons.push(`device is ${workerDisposition(report)}`);
    if (input.task.privacy === "controller_only" && !candidate.controller) {
      reasons.push("data is controller-only");
    }
    if (input.task.requiredProfiles.some((profile) => !report.toolProfiles.includes(profile))) {
      reasons.push("required work profile is unavailable");
    }
    if (input.task.requiredRuntimes.some((runtime) => !report.runtimes.includes(runtime))) {
      reasons.push("required runtime is unavailable");
    }
    if (input.task.requiredModels.some((model) => !report.localModels.includes(model))) {
      reasons.push("required local model is unavailable");
    }
    if (report.memoryMb < input.task.expectedMemoryMb) reasons.push("insufficient memory");
    if (reasons.length > 0) {
      excluded[report.deviceId] = reasons;
      return [];
    }
    let score = 100 - candidate.activeWorkloads * 18;
    if (report.deviceId === input.task.sourceDeviceId) score += 25;
    if (input.preferRemoteCompute && !candidate.controller) score += 30;
    if (candidate.controller && input.preferRemoteCompute) score -= 40;
    if (report.containerRuntime !== "none") score += 8;
    return [{ candidate, score }];
  }).sort((left, right) =>
    right.score - left.score
    || left.candidate.report.deviceId.localeCompare(right.candidate.report.deviceId)
  );
  const selected = eligible[0];
  if (!selected) {
    return {
      taskId: input.task.id,
      deviceId: null,
      reason: "No trusted device satisfies capability, privacy, locality, and resource policy.",
      excluded,
      score: null
    };
  }
  return {
    taskId: input.task.id,
    deviceId: selected.candidate.report.deviceId,
    reason: selected.candidate.controller
      ? "Controller selected because policy or source locality requires it."
      : "Paired worker selected to preserve controller responsiveness while satisfying policy.",
    excluded,
    score: selected.score
  };
}

export interface DistributedLease {
  readonly taskId: string;
  readonly leaseId: string;
  readonly deviceId: string;
  readonly idempotencyKey: string;
  readonly acquiredAt: number;
  readonly expiresAt: number;
  readonly effectReconciled: boolean;
}

export class LeaseAuthority {
  readonly #leases = new Map<string, DistributedLease>();

  claim(input: Omit<DistributedLease, "effectReconciled"> & { readonly now: number }): DistributedLease {
    const current = this.#leases.get(input.taskId);
    if (current && current.expiresAt > input.now) {
      throw new Error("Task already has an active authoritative lease.");
    }
    if (current && !current.effectReconciled) {
      throw new Error("Expired work must reconcile effects before requeue.");
    }
    const lease = {
      taskId: input.taskId,
      leaseId: input.leaseId,
      deviceId: input.deviceId,
      idempotencyKey: input.idempotencyKey,
      acquiredAt: input.acquiredAt,
      expiresAt: input.expiresAt,
      effectReconciled: false
    };
    this.#leases.set(input.taskId, lease);
    return lease;
  }

  reconcile(taskId: string, leaseId: string): DistributedLease {
    const current = this.#leases.get(taskId);
    if (!current || current.leaseId !== leaseId) throw new Error("Lease is stale.");
    const reconciled = { ...current, effectReconciled: true };
    this.#leases.set(taskId, reconciled);
    return reconciled;
  }
}

function workerDisposition(report: WorkerCapabilityReport):
  | "ready"
  | "drain"
  | "sleeping"
  | "low_disk" {
  if (report.sleeping) return "sleeping";
  if (report.freeDiskMb < 10_240) return "low_disk";
  if (
    report.thermal === "serious"
    || report.thermal === "critical"
    || (
      report.battery.percent !== null
      && !report.battery.charging
      && report.battery.percent < report.battery.minimumPercent
    )
  ) {
    return "drain";
  }
  return "ready";
}
