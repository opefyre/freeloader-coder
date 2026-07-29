import { z } from "zod";

export const controlPlaneServiceSchema = z.strictObject({
  id: z.enum(["control_plane", "studio", "worker", "validator", "provider_gateway"]),
  state: z.enum(["available", "starting", "stopped", "degraded", "unknown"]),
  required: z.boolean(),
  observedAt: z.number().int().nonnegative(),
});

export const controlPlaneHealthSchema = z.strictObject({
  schemaVersion: z.literal(1),
  instanceId: z.string().uuid(),
  status: z.enum(["ready", "needs_attention"]),
  observedAt: z.number().int().nonnegative(),
  uptimeSeconds: z.number().int().nonnegative(),
});

export const controlPlaneSnapshotSchema = z.strictObject({
  schemaVersion: z.literal(1),
  instanceId: z.string().uuid(),
  provenance: z.literal("local_observation"),
  featureDataMode: z.literal("synthetic_fixture"),
  observedAt: z.number().int().nonnegative(),
  validForMs: z.number().int().min(1_000).max(60_000),
  setup: z.strictObject({
    state: z.enum(["ready", "needs_action", "unknown"]),
    requiredChecksReady: z.number().int().nonnegative(),
    requiredChecksTotal: z.number().int().nonnegative(),
  }),
  services: z.array(controlPlaneServiceSchema).min(1).max(10),
});

export type ControlPlaneHealth = z.infer<typeof controlPlaneHealthSchema>;
export type ControlPlaneSnapshot = z.infer<typeof controlPlaneSnapshotSchema>;

export type SnapshotFreshness = "current" | "stale" | "invalid";

export function assessSnapshotFreshness(
  snapshot: ControlPlaneSnapshot,
  now: number
): SnapshotFreshness {
  if (now < snapshot.observedAt) return "invalid";
  return now - snapshot.observedAt <= snapshot.validForMs ? "current" : "stale";
}

export function validateControlPlaneSnapshot(
  input: unknown
): ControlPlaneSnapshot {
  const snapshot = controlPlaneSnapshotSchema.parse(input);
  const serviceIds = snapshot.services.map((service) => service.id);
  if (new Set(serviceIds).size !== serviceIds.length) {
    throw new Error("Control-plane snapshot contains duplicate services.");
  }
  if (snapshot.setup.requiredChecksReady > snapshot.setup.requiredChecksTotal) {
    throw new Error("Ready setup checks cannot exceed total checks.");
  }
  return snapshot;
}
