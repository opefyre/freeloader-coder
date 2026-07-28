import { createHmac, timingSafeEqual } from "node:crypto";

import { z } from "zod";

export const workerCapabilityReportSchema = z.strictObject({
  schemaVersion: z.literal(1),
  deviceId: z.string().regex(/^device_[a-f0-9]{16}$/),
  agentVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
  platform: z.enum(["darwin-arm64", "darwin-x64", "linux-arm64", "linux-x64"]),
  cpuCores: z.number().int().positive().max(512),
  memoryMb: z.number().int().positive().max(1_048_576),
  freeDiskMb: z.number().int().nonnegative(),
  runtimes: z.array(z.string().trim().min(1).max(80)).max(50),
  localModels: z.array(z.string().trim().min(1).max(120)).max(100),
  toolProfiles: z.array(z.enum(["models", "execution", "validation", "review"])).min(1),
  containerRuntime: z.enum(["docker", "podman", "none"]),
  validatorIds: z.array(z.string().regex(/^[a-z][a-z0-9._-]+$/)).max(50),
  battery: z.strictObject({
    percent: z.number().int().min(0).max(100).nullable(),
    charging: z.boolean().nullable(),
    minimumPercent: z.number().int().min(5).max(100)
  }),
  thermal: z.enum(["nominal", "fair", "serious", "critical"]),
  sleeping: z.boolean(),
  observedAt: z.number().int().nonnegative(),
  signature: z.string().regex(/^hmac-sha256:[a-f0-9]{64}$/)
});

export type WorkerCapabilityReport = z.infer<typeof workerCapabilityReportSchema>;

type UnsignedReport = Omit<WorkerCapabilityReport, "signature">;

export function signCapabilityReport(
  report: UnsignedReport,
  deviceSigningKey: string
): WorkerCapabilityReport {
  if (deviceSigningKey.length < 32) throw new Error("Device signing key is too short.");
  return workerCapabilityReportSchema.parse({
    ...report,
    signature: `hmac-sha256:${signature(report, deviceSigningKey)}`
  });
}

export function verifyCapabilityReport(input: {
  readonly report: unknown;
  readonly deviceSigningKey: string;
  readonly observed: {
    readonly cpuCores: number;
    readonly memoryMb: number;
    readonly freeDiskMb: number;
    readonly runtimes: readonly string[];
    readonly localModels: readonly string[];
    readonly containerRuntime: WorkerCapabilityReport["containerRuntime"];
    readonly validatorIds: readonly string[];
  };
}): WorkerCapabilityReport {
  const report = workerCapabilityReportSchema.parse(input.report);
  const unsigned = withoutSignature(report);
  const expected = Buffer.from(signature(unsigned, input.deviceSigningKey), "hex");
  const actual = Buffer.from(report.signature.slice("hmac-sha256:".length), "hex");
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    throw new Error("Worker capability signature is invalid.");
  }
  if (
    report.cpuCores > input.observed.cpuCores
    || report.memoryMb > input.observed.memoryMb
    || report.freeDiskMb > input.observed.freeDiskMb
    || report.runtimes.some((runtime) => !input.observed.runtimes.includes(runtime))
    || report.localModels.some((model) => !input.observed.localModels.includes(model))
    || report.containerRuntime !== input.observed.containerRuntime
    || report.validatorIds.some((validator) => !input.observed.validatorIds.includes(validator))
  ) {
    throw new Error("Worker claimed an unvalidated capability.");
  }
  return report;
}

export function workerDisposition(report: WorkerCapabilityReport):
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

export function planWorkerUpdate(input: {
  readonly currentVersion: string;
  readonly targetVersion: string;
  readonly packageSignatureValid: boolean;
  readonly rollbackVersion: string | null;
  readonly activeLease: boolean;
}): {
  readonly action: "install" | "drain_then_install" | "reject";
  readonly rollbackVersion: string | null;
} {
  if (!input.packageSignatureValid || input.rollbackVersion === null) {
    return { action: "reject", rollbackVersion: input.rollbackVersion };
  }
  if (input.currentVersion === input.targetVersion) {
    return { action: "reject", rollbackVersion: input.rollbackVersion };
  }
  return {
    action: input.activeLease ? "drain_then_install" : "install",
    rollbackVersion: input.rollbackVersion
  };
}

function withoutSignature(report: WorkerCapabilityReport): UnsignedReport {
  const { signature: _signature, ...unsigned } = report;
  return unsigned;
}

function signature(report: UnsignedReport, key: string): string {
  return createHmac("sha256", key).update(JSON.stringify(report)).digest("hex");
}
