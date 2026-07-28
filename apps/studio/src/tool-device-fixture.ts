import {
  scheduleTask,
  type DistributedTask,
  type WorkerCandidate
} from "../../../packages/distributed/src/scheduler.js";
import type { WorkerCapabilityReport } from "../../../packages/distributed/src/worker.js";

function worker(input: {
  readonly deviceId: string;
  readonly memoryMb: number;
  readonly freeDiskMb: number;
  readonly models: readonly string[];
  readonly controller: boolean;
}): WorkerCandidate {
  const report: WorkerCapabilityReport = {
    schemaVersion: 1,
    deviceId: input.deviceId,
    agentVersion: "1.0.0",
    platform: "darwin-arm64",
    cpuCores: input.controller ? 10 : 8,
    memoryMb: input.memoryMb,
    freeDiskMb: input.freeDiskMb,
    runtimes: ["node-22", "docker", "git"],
    localModels: [...input.models],
    toolProfiles: input.controller
      ? ["models", "review"]
      : ["models", "execution", "validation", "review"],
    containerRuntime: "docker",
    validatorIds: ["typescript", "node-test", "playwright"],
    battery: { percent: 100, charging: true, minimumPercent: 30 },
    thermal: "nominal",
    sleeping: false,
    observedAt: 1_800_000_000_000,
    signature: `hmac-sha256:${"d".repeat(64)}`
  };
  return {
    report,
    trusted: true,
    revoked: false,
    activeWorkloads: input.controller ? 0 : 1,
    controller: input.controller
  };
}

export const fabricWorkers = [
  worker({
    deviceId: "device_aaaaaaaaaaaaaaaa",
    memoryMb: 24_576,
    freeDiskMb: 300_000,
    models: [],
    controller: true
  }),
  worker({
    deviceId: "device_bbbbbbbbbbbbbbbb",
    memoryMb: 8_192,
    freeDiskMb: 431_000,
    models: ["qwen3:8b", "deepseek-coder:6.7b"],
    controller: false
  })
] as const;

export const fabricTasks: readonly DistributedTask[] = [
  {
    id: "PIPE-86",
    workType: "implementation",
    requiredProfiles: ["execution"],
    requiredRuntimes: ["node-22", "docker"],
    requiredModels: [],
    privacy: "trusted_devices",
    sourceDeviceId: "device_bbbbbbbbbbbbbbbb",
    expectedMemoryMb: 4_096,
    diversityKey: null
  },
  {
    id: "PIPE-161",
    workType: "validation",
    requiredProfiles: ["validation"],
    requiredRuntimes: ["node-22"],
    requiredModels: [],
    privacy: "trusted_devices",
    sourceDeviceId: "device_bbbbbbbbbbbbbbbb",
    expectedMemoryMb: 2_048,
    diversityKey: "functional-review"
  },
  {
    id: "PIPE-82",
    workType: "planning",
    requiredProfiles: ["models"],
    requiredRuntimes: [],
    requiredModels: [],
    privacy: "controller_only",
    sourceDeviceId: "device_aaaaaaaaaaaaaaaa",
    expectedMemoryMb: 1_024,
    diversityKey: null
  }
];

export function buildFabricSchedule(mode: "healthy" | "thermal" | "sleeping") {
  const candidates = fabricWorkers.map((candidate, index) => {
    if (index === 0 || mode === "healthy") return candidate;
    const report: WorkerCapabilityReport = {
      ...candidate.report,
      thermal: mode === "thermal" ? "critical" : candidate.report.thermal,
      sleeping: mode === "sleeping"
    };
    return { ...candidate, report };
  });
  return fabricTasks.map((task) => scheduleTask({
    task,
    candidates,
    preferRemoteCompute: true
  }));
}
