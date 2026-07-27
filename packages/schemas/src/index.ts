import { z } from "zod";

export const schemaVersion = 1 as const;
const id = z.string().min(1).max(160);
const timestamp = z.iso.datetime({ offset: true });
const version = z.literal(schemaVersion);
const extensions = z.record(
  z.string().regex(/^[a-z0-9]+(?:[.-][a-z0-9]+)+$/),
  z.unknown()
).default({});

export const taskStatusSchema = z.enum([
  "draft",
  "ready",
  "working",
  "validating",
  "review",
  "blocked",
  "needs_user",
  "quarantined",
  "done",
  "failed"
]);

export const taskSchema = z.strictObject({
  schemaVersion: version,
  id,
  title: z.string().min(1).max(500),
  status: taskStatusSchema,
  revision: z.number().int().nonnegative(),
  extensions
});

export const legacyTaskV0Schema = z.strictObject({
  id,
  summary: z.string().min(1).max(500),
  state: z.enum(["queued", "active", "complete"])
});

export function migrateTaskV0(input: unknown): Task {
  const legacy = legacyTaskV0Schema.parse(input);
  const status = {
    queued: "ready",
    active: "working",
    complete: "done"
  }[legacy.state] as Task["status"];
  return taskSchema.parse({
    schemaVersion,
    id: legacy.id,
    title: legacy.summary,
    status,
    revision: 0,
    extensions: { "studio.migration.source": "task-v0" }
  });
}

export const dependencySchema = z.strictObject({
  schemaVersion: version,
  taskId: id,
  dependsOnTaskId: id,
  requiredStatus: z.literal("done")
}).refine((value) => value.taskId !== value.dependsOnTaskId, "Self-dependency is invalid.");

export const leaseSchema = z.strictObject({
  schemaVersion: version,
  taskId: id,
  leaseId: id,
  ownerId: id,
  acquiredAt: timestamp,
  expiresAt: timestamp
}).refine((value) => Date.parse(value.expiresAt) > Date.parse(value.acquiredAt), "Lease expiry must be later.");

const callBase = {
  schemaVersion: version,
  id,
  taskId: id,
  status: z.enum(["requested", "running", "succeeded", "failed", "cancelled"]),
  idempotencyKey: id
};

export const modelCallSchema = z.strictObject({
  ...callBase,
  provider: id,
  model: id,
  privacyClass: z.enum(["public_test", "non_personal_test", "sensitive_local"]),
  verified: z.literal(false)
});

export const toolCallSchema = z.strictObject({
  ...callBase,
  tool: id,
  effect: z.enum(["read", "reversible_write", "irreversible_write"]),
  approvalId: id.nullable()
});

export const approvalSchema = z.strictObject({
  schemaVersion: version,
  id,
  taskId: id,
  actionDigest: z.string().regex(/^[a-f0-9]{64}$/),
  status: z.enum(["requested", "approved", "denied", "expired"]),
  decidedBy: id.nullable(),
  expiresAt: timestamp.nullable()
});

export const artifactSchema = z.strictObject({
  schemaVersion: version,
  id,
  taskId: id,
  mediaType: z.string().min(1),
  digest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  sizeBytes: z.number().int().nonnegative()
});

export const validationSchema = z.strictObject({
  schemaVersion: version,
  id,
  taskId: id,
  validator: id,
  outcome: z.enum(["passed", "failed", "skipped"]),
  evidenceArtifactIds: z.array(id)
});

export const reviewSchema = z.strictObject({
  schemaVersion: version,
  id,
  taskId: id,
  reviewer: id,
  outcome: z.enum(["approved", "changes_requested", "abstained"]),
  findingCount: z.number().int().nonnegative()
});

export const recoverySchema = z.strictObject({
  schemaVersion: version,
  id,
  taskId: id,
  cause: z.enum(["interrupted", "lease_expired", "provider", "validation", "effect_unknown"]),
  action: z.enum(["retry", "fallback", "rollback", "quarantine", "needs_user"]),
  attempt: z.number().int().positive()
});

export const externalEffectSchema = z.strictObject({
  schemaVersion: version,
  id,
  taskId: id,
  connector: id,
  operation: id,
  idempotencyKey: id,
  reversibility: z.enum(["reversible", "compensatable", "irreversible"]),
  postcondition: z.enum(["unknown", "observed", "not_observed"])
});

export const commandSchema = z.strictObject({
  schemaVersion: version,
  commandId: id,
  idempotencyKey: id,
  issuedAt: timestamp,
  type: z.enum(["task.create", "task.change_status", "lease.grant", "lease.release"]),
  payload: z.record(z.string(), z.unknown())
});

export const eventSchema = z.discriminatedUnion("type", [
  z.strictObject({ schemaVersion: version, sequence: z.number().int().positive(), eventId: id, occurredAt: timestamp, type: z.literal("task.created"), payload: taskSchema }),
  z.strictObject({ schemaVersion: version, sequence: z.number().int().positive(), eventId: id, occurredAt: timestamp, type: z.literal("task.status_changed"), payload: z.strictObject({ taskId: id, status: taskStatusSchema, revision: z.number().int().positive() }) }),
  z.strictObject({ schemaVersion: version, sequence: z.number().int().positive(), eventId: id, occurredAt: timestamp, type: z.literal("lease.granted"), payload: leaseSchema }),
  z.strictObject({ schemaVersion: version, sequence: z.number().int().positive(), eventId: id, occurredAt: timestamp, type: z.literal("lease.released"), payload: z.strictObject({ taskId: id, leaseId: id }) })
]);

export const safeErrorSchema = z.strictObject({
  schemaVersion: version,
  code: z.enum(["INVALID_INPUT", "PERMISSION_DENIED", "QUOTA_EXHAUSTED", "DEPENDENCY_BLOCKED", "PROVIDER_UNAVAILABLE", "VALIDATION_FAILED", "EFFECT_UNKNOWN", "INTERNAL"]),
  owner: z.enum(["user", "project", "provider", "connector", "worker", "platform"]),
  safeMessage: z.string().min(1).max(500),
  nextAction: z.string().min(1).max(500),
  retryable: z.boolean(),
  diagnosticId: id
});

export const localDiagnosticSchema = z.strictObject({
  diagnosticId: id,
  code: safeErrorSchema.shape.code,
  owner: safeErrorSchema.shape.owner,
  safeMessage: safeErrorSchema.shape.safeMessage,
  nextAction: safeErrorSchema.shape.nextAction,
  retryable: z.boolean(),
  localDetail: z.string().max(10_000),
  cause: z.unknown().optional()
});

export function toSafeError(input: unknown): SafeError {
  const diagnostic = localDiagnosticSchema.parse(input);
  return safeErrorSchema.parse({
    schemaVersion,
    code: diagnostic.code,
    owner: diagnostic.owner,
    safeMessage: diagnostic.safeMessage,
    nextAction: diagnostic.nextAction,
    retryable: diagnostic.retryable,
    diagnosticId: diagnostic.diagnosticId
  });
}

export type Task = z.infer<typeof taskSchema>;
export type DomainEvent = z.infer<typeof eventSchema>;
export type SafeError = z.infer<typeof safeErrorSchema>;
