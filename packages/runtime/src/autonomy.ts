import { z } from "zod";

const timestamp = z.number().int().nonnegative();
const projectId = z.string().regex(/^project_[a-f0-9]{16}$/);
const requestId = z.string().regex(/^request_[a-f0-9]{20}$/);

export const autonomyModeSchema = z.enum(["guided", "balanced", "autonomous"]);
export const coordinatorActionSchema = z.enum([
  "ground_request",
  "claim_lease",
  "checkpoint_lease",
  "release_lease",
  "prepare_execution",
  "start_execution",
  "validate_execution",
  "reconcile_execution",
  "reconcile_expired_lease",
]);
export const coordinatorBoundarySchema = z.enum([
  "approve_request",
  "provide_input",
  "approve_plan",
  "authorize_execution",
  "request_proposal",
  "accept_proposal",
  "approve_change",
  "approve_commit",
  "approve_integration",
  "review_failure",
  "none",
]);

export const autonomyRecommendationSchema = z.strictObject({
  requestId,
  projectId,
  expectedUpdatedAt: timestamp,
  classification: z.enum(["safe_action", "approval", "waiting", "attention", "terminal"]),
  action: coordinatorActionSchema.nullable(),
  boundary: coordinatorBoundarySchema,
  title: z.string().trim().min(1).max(160),
  reason: z.string().trim().min(1).max(500),
  effect: z.enum(["none", "local_read", "authorized_local_write", "provider_request"]),
  maximumCostUsd: z.literal(0),
  automaticAllowed: z.boolean(),
  retryAt: timestamp.nullable(),
  evidence: z.array(z.string().trim().min(1).max(240)).min(1).max(12),
});

export const autonomyPreferenceSchema = z.strictObject({
  projectId,
  mode: autonomyModeSchema,
  paused: z.boolean(),
  updatedAt: timestamp,
});

export const requestAutonomyOverrideSchema = z.strictObject({
  requestId,
  projectId,
  mode: autonomyModeSchema,
  updatedAt: timestamp,
});

export const coordinatorReceiptSchema = z.strictObject({
  id: z.string().regex(/^receipt_[a-f0-9]{16}$/),
  requestId,
  projectId,
  action: coordinatorActionSchema,
  outcome: z.enum(["completed", "deferred", "blocked", "failed"]),
  detail: z.string().trim().min(1).max(500),
  startedAt: timestamp,
  completedAt: timestamp,
  expectedUpdatedAt: timestamp,
  resultingUpdatedAt: timestamp.nullable(),
});

export const coordinatorLeaseSchema = z.strictObject({
  requestId,
  owner: z.literal("local_safe_step_coordinator"),
  acquiredAt: timestamp,
  expiresAt: timestamp,
});

export const autonomySnapshotSchema = z.strictObject({
  schemaVersion: z.literal(1),
  provenance: z.literal("local_autonomy_coordinator"),
  observedAt: timestamp,
  validForMs: z.number().int().min(1_000).max(60_000),
  automaticSpendLimitUsd: z.literal(0),
  health: z.enum(["stopped", "idle", "active", "waiting", "attention", "degraded"]),
  running: z.boolean(),
  preferences: z.array(autonomyPreferenceSchema).max(100),
  overrides: z.array(requestAutonomyOverrideSchema).max(500),
  recommendations: z.array(autonomyRecommendationSchema).max(500),
  leases: z.array(coordinatorLeaseSchema).max(100),
  receipts: z.array(coordinatorReceiptSchema).max(100),
  nextWakeAt: timestamp.nullable(),
});

export const autonomyModeChangeSchema = z.strictObject({
  schemaVersion: z.literal(1),
  mode: autonomyModeSchema,
  confirmBroaderAutomation: z.boolean(),
});

export const autonomyPauseChangeSchema = z.strictObject({
  schemaVersion: z.literal(1),
  paused: z.boolean(),
});

export const autonomyAdvanceRequestSchema = z.strictObject({
  schemaVersion: z.literal(1),
  expectedUpdatedAt: timestamp,
});

export const autonomyMutationResponseSchema = z.strictObject({
  schemaVersion: z.literal(1),
  outcome: z.enum(["mode_changed", "pause_changed", "advanced", "reconciled", "no_action"]),
  snapshot: autonomySnapshotSchema,
  receipt: coordinatorReceiptSchema.nullable(),
});

export type AutonomyMode = z.infer<typeof autonomyModeSchema>;
export type AutonomyRecommendation = z.infer<typeof autonomyRecommendationSchema>;
export type AutonomyPreference = z.infer<typeof autonomyPreferenceSchema>;
export type RequestAutonomyOverride = z.infer<typeof requestAutonomyOverrideSchema>;
export type CoordinatorAction = z.infer<typeof coordinatorActionSchema>;
export type CoordinatorReceipt = z.infer<typeof coordinatorReceiptSchema>;
export type CoordinatorLease = z.infer<typeof coordinatorLeaseSchema>;
export type AutonomySnapshot = z.infer<typeof autonomySnapshotSchema>;
export type AutonomyMutationResponse = z.infer<typeof autonomyMutationResponseSchema>;

export function validateAutonomySnapshot(input: unknown): AutonomySnapshot {
  return autonomySnapshotSchema.parse(input);
}
