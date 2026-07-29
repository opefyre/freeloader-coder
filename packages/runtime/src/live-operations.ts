import { z } from "zod";

const timestamp = z.number().int().nonnegative();

export const liveOperationsStageSchema = z.enum([
  "needs_input",
  "queued",
  "approved",
  "claimed",
  "checkpointed",
  "completed",
  "interrupted",
  "cancelled",
]);

export const liveOperationsEventSchema = z.strictObject({
  id: z.string().regex(/^event_[a-f0-9]{16}$/),
  kind: z.enum(["request", "project", "provider", "system"]),
  state: z.string().trim().min(1).max(80),
  title: z.string().trim().min(1).max(160),
  detail: z.string().trim().min(1).max(300),
  observedAt: timestamp,
  projectId: z.string().regex(/^project_[a-f0-9]{16}$/).nullable(),
  requestId: z.string().regex(/^request_[a-f0-9]{20}$/).nullable(),
  providerId: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,159}$/).nullable(),
});

export const liveOperationsSnapshotSchema = z.strictObject({
  schemaVersion: z.literal(1),
  provenance: z.literal("local_operational_aggregation"),
  observedAt: timestamp,
  validForMs: z.number().int().min(1_000).max(60_000),
  automaticSpendLimitUsd: z.literal(0),
  health: z.enum(["healthy", "idle", "attention"]),
  totals: z.strictObject({
    projects: z.number().int().nonnegative().max(100),
    requests: z.number().int().nonnegative().max(500),
    active: z.number().int().nonnegative().max(500),
    completed: z.number().int().nonnegative().max(500),
    needsAttention: z.number().int().nonnegative().max(500),
    providers: z.number().int().nonnegative().max(100),
    readyProviders: z.number().int().nonnegative().max(100),
  }),
  stages: z.array(z.strictObject({
    stage: liveOperationsStageSchema,
    count: z.number().int().nonnegative().max(500),
  })).length(8),
  providers: z.array(z.strictObject({
    id: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,119}$/),
    providerId: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,159}$/),
    label: z.string().trim().min(1).max(120),
    modelId: z.string().trim().min(1).max(240),
    state: z.enum(["ready", "limited", "stale", "revoked"]),
    admitted: z.boolean(),
    zeroCost: z.boolean(),
    updatedAt: timestamp,
  })).max(100),
  recentEvents: z.array(liveOperationsEventSchema).max(60),
});

export type LiveOperationsSnapshot = z.infer<typeof liveOperationsSnapshotSchema>;
export type LiveOperationsEvent = z.infer<typeof liveOperationsEventSchema>;

export function validateLiveOperationsSnapshot(input: unknown): LiveOperationsSnapshot {
  return liveOperationsSnapshotSchema.parse(input);
}
