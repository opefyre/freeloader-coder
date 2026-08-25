import { createHash } from "node:crypto";

import {
  computeProfileSchema,
  resourceSnapshotSchema,
  type ComputeProfile,
  type ResourceSnapshot
} from "./contracts.js";

export const computeProfiles: readonly ComputeProfile[] = [
  computeProfileSchema.parse({
    schemaVersion: 1,
    id: "lightweight",
    label: "Lightweight",
    maxConcurrency: 1,
    workerMemoryMb: 1_536,
    cpuPercent: 45,
    localModelsAllowed: false,
    minFreeDiskMb: 5_120,
    batteryFloorPercent: 30
  }),
  computeProfileSchema.parse({
    schemaVersion: 1,
    id: "standard",
    label: "Standard",
    maxConcurrency: 2,
    workerMemoryMb: 3_072,
    cpuPercent: 70,
    localModelsAllowed: true,
    minFreeDiskMb: 10_240,
    batteryFloorPercent: 40
  }),
  computeProfileSchema.parse({
    schemaVersion: 1,
    id: "distributed",
    label: "Distributed",
    maxConcurrency: 4,
    workerMemoryMb: 4_096,
    cpuPercent: 75,
    localModelsAllowed: true,
    minFreeDiskMb: 10_240,
    batteryFloorPercent: 40
  })
];

export function recommendComputeProfile(snapshotInput: unknown): ComputeProfile {
  const snapshot = resourceSnapshotSchema.parse(snapshotInput);
  if (
    snapshot.memoryMb <= 8_192
    || snapshot.availableMemoryMb < 3_072
    || snapshot.concurrentWorkloads > 1
    || snapshot.batteryPercent !== null && snapshot.batteryPercent < 50 && !snapshot.charging
  ) {
    return computeProfiles[0]!;
  }
  return computeProfiles[1]!;
}

export function evaluateResourcePolicy(input: {
  readonly snapshot: unknown;
  readonly profile: unknown;
  readonly activeState: unknown;
}): {
  readonly decision: "run" | "reduce" | "pause";
  readonly concurrency: number;
  readonly plainLanguage: string;
  readonly limits: readonly string[];
  readonly resumeToken: string | null;
  readonly stateDigest: string;
} {
  const snapshot: ResourceSnapshot = resourceSnapshotSchema.parse(input.snapshot);
  const profile = computeProfileSchema.parse(input.profile);
  const stateDigest = hash(JSON.stringify(input.activeState));
  const limits = [
    `${profile.workerMemoryMb} MB worker memory`,
    `${profile.cpuPercent}% CPU ceiling`,
    `${profile.maxConcurrency} concurrent task${profile.maxConcurrency === 1 ? "" : "s"}`,
    `${Math.round(profile.minFreeDiskMb / 1_024)} GB free-disk floor`
  ];
  const pauseReason =
    snapshot.sleeping
      ? "The computer is sleeping."
      : snapshot.thermal === "critical" || snapshot.thermal === "serious"
        ? "The computer is too warm for safe background work."
        : snapshot.freeDiskMb < profile.minFreeDiskMb
          ? "Free disk space is below the safe floor."
          : snapshot.batteryPercent !== null
            && snapshot.charging === false
            && snapshot.batteryPercent < profile.batteryFloorPercent
            ? "Battery is below the selected profile floor."
            : snapshot.availableMemoryMb < Math.min(profile.workerMemoryMb, 1_024)
              ? "Available memory is too low to start another safe step."
              : null;
  if (pauseReason) {
    return {
      decision: "pause",
      concurrency: 0,
      plainLanguage: `${pauseReason} Active work is checkpointed and can resume safely.`,
      limits,
      resumeToken: `resume:${hash(`${stateDigest}:${pauseReason}`).slice(0, 16)}`,
      stateDigest
    };
  }
  if (
    snapshot.availableMemoryMb < profile.workerMemoryMb * 2
    || snapshot.thermal === "fair"
    || snapshot.concurrentWorkloads >= profile.maxConcurrency
  ) {
    return {
      decision: "reduce",
      concurrency: 1,
      plainLanguage: "The computer is busy, so Codkesh reduced work to one safe task.",
      limits,
      resumeToken: null,
      stateDigest
    };
  }
  return {
    decision: "run",
    concurrency: profile.maxConcurrency,
    plainLanguage: "Resources are within the selected safe limits.",
    limits,
    resumeToken: null,
    stateDigest
  };
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
