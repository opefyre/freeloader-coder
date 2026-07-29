import { z } from "zod";

const projectId = z.string().regex(/^project_[a-f0-9]{16}$/);
const requestId = z.string().regex(/^request_[a-f0-9]{20}$/);
const boundedOutcome = z.string().trim().min(3).max(20_000);
const relativePath = z.string().trim().min(1).max(240).refine(
  (value) =>
    !value.startsWith("/") &&
    !value.startsWith("\\") &&
    !value.split(/[\\/]/).includes(".."),
  "Path must be project-relative."
);

export const localRequestCreationSchema = z.strictObject({
  schemaVersion: z.literal(1),
  projectId,
  outcome: boundedOutcome,
});

export const localReadinessFindingSchema = z.strictObject({
  code: z.enum(["outcome_required", "sensitive_material", "implementation_assumption"]),
  severity: z.enum(["blocking", "assumption"]),
  title: z.string().trim().min(1).max(160),
  detail: z.string().trim().min(1).max(500),
});

export const localWorkPreviewSchema = z.strictObject({
  provenance: z.literal("deterministic_local_preview"),
  title: z.string().trim().min(1).max(160),
  outcome: boundedOutcome,
  assumptions: z.array(z.string().trim().min(1).max(500)).max(10),
  exclusions: z.array(z.string().trim().min(1).max(500)).max(10),
  checks: z.array(z.string().trim().min(1).max(160)).min(1).max(10),
  estimatedMinutes: z.number().int().min(1).max(480),
});

export const localExecutionContractSchema = z.strictObject({
  schemaVersion: z.literal(1),
  id: z.string().regex(/^contract_[a-f0-9]{20}$/),
  digest: z.string().regex(/^[a-f0-9]{64}$/),
  requestId,
  projectId,
  outcome: boundedOutcome,
  policy: z.literal("zero_effect"),
  allowedEffects: z.tuple([]),
  maximumCostUsd: z.literal(0),
  checks: z.array(z.string().trim().min(1).max(160)).min(1).max(10),
  approvedAt: z.number().int().nonnegative(),
});

export const localRunEventSchema = z.strictObject({
  sequence: z.number().int().positive(),
  type: z.enum([
    "contract_approved",
    "lease_claimed",
    "checkpoint_observed",
    "lease_released",
    "lease_expired",
    "grounding_created",
    "plan_updated",
    "plan_approved",
  ]),
  observedAt: z.number().int().nonnegative(),
  detail: z.string().trim().min(1).max(300),
});

export const localGroundingSchema = z.strictObject({
  schemaVersion: z.literal(1),
  projectId,
  provenance: z.literal("bounded_local_files"),
  digest: z.string().regex(/^[a-f0-9]{64}$/),
  observedAt: z.number().int().nonnegative(),
  sources: z.array(z.strictObject({
    path: relativePath,
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    bytes: z.number().int().nonnegative().max(65_536),
    classification: z.enum(["guidance", "manifest", "documentation"]),
    excerpt: z.string().max(2_000),
  })).min(1).max(12),
  limitations: z.array(z.string().trim().min(1).max(300)).min(1).max(10),
});

export const localTopologySchema = z.strictObject({
  schemaVersion: z.literal(1),
  projectId,
  provenance: z.literal("bounded_path_inventory"),
  digest: z.string().regex(/^[a-f0-9]{64}$/),
  observedAt: z.number().int().nonnegative(),
  entries: z.array(z.strictObject({
    path: relativePath,
    kind: z.enum(["source", "test", "config", "documentation", "asset", "other"]),
    extension: z.string().regex(/^\.[a-zA-Z0-9]{1,12}$/).nullable(),
    bytes: z.number().int().nonnegative().max(2_000_000),
  })).min(1).max(800),
  truncated: z.boolean(),
  excludedDirectories: z.array(z.string().trim().min(1).max(80)).min(1).max(30),
  limitations: z.array(z.string().trim().min(1).max(300)).min(1).max(10),
});

export const localDraftPlanSchema = z.strictObject({
  schemaVersion: z.literal(1),
  provenance: z.literal("deterministic_local_plan"),
  digest: z.string().regex(/^[a-f0-9]{64}$/),
  groundingDigest: z.string().regex(/^[a-f0-9]{64}$/),
  topologyDigest: z.string().regex(/^[a-f0-9]{64}$/),
  revision: z.number().int().positive().max(100),
  state: z.enum(["draft", "approved"]),
  order: z.array(z.string().regex(/^task_[a-f0-9]{12}$/)).min(1).max(8),
  approval: z.strictObject({
    digest: z.string().regex(/^[a-f0-9]{64}$/),
    revision: z.number().int().positive().max(100),
    approvedAt: z.number().int().nonnegative(),
    policy: z.literal("zero_effect"),
    executionAuthorized: z.literal(false),
  }).nullable(),
  tasks: z.array(z.strictObject({
    id: z.string().regex(/^task_[a-f0-9]{12}$/),
    title: z.string().trim().min(1).max(160),
    outcome: boundedOutcome,
    scope: z.array(z.string().trim().min(1).max(300)).min(1).max(10),
    allowedFiles: z.array(z.string().trim().min(1).max(240)).min(1).max(12),
    citedSources: z.array(relativePath).min(1).max(12),
    dependsOn: z.array(z.string().regex(/^task_[a-f0-9]{12}$/)).max(7),
    acceptanceCriteria: z.array(z.string().trim().min(1).max(300)).min(1).max(10),
    exclusions: z.array(z.string().trim().min(1).max(300)).min(1).max(10),
    checks: z.array(z.string().trim().min(1).max(160)).min(1).max(10),
    risk: z.enum(["low", "medium", "high"]),
    estimatedMinutes: z.number().int().min(5).max(480),
  })).min(1).max(8),
});

export const localPlanEditSchema = z.discriminatedUnion("type", [
  z.strictObject({
    schemaVersion: z.literal(1),
    type: z.literal("edit_task"),
    expectedRevision: z.number().int().positive().max(100),
    taskId: z.string().regex(/^task_[a-f0-9]{12}$/),
    title: z.string().trim().min(1).max(160),
    estimatedMinutes: z.number().int().min(5).max(480),
  }),
  z.strictObject({
    schemaVersion: z.literal(1),
    type: z.literal("reorder"),
    expectedRevision: z.number().int().positive().max(100),
    order: z.array(z.string().regex(/^task_[a-f0-9]{12}$/)).min(1).max(8),
  }),
]);

export const localPlanApprovalSchema = z.strictObject({
  schemaVersion: z.literal(1),
  expectedRevision: z.number().int().positive().max(100),
});

export const localPlanningSnapshotSchema = z.strictObject({
  schemaVersion: z.literal(1),
  grounding: localGroundingSchema,
  topology: localTopologySchema,
});

export const localRunSchema = z.strictObject({
  state: z.enum(["approved", "claimed", "checkpointed", "completed", "interrupted"]),
  contract: localExecutionContractSchema,
  lease: z.strictObject({
    id: z.string().regex(/^lease_[a-f0-9]{20}$/),
    owner: z.literal("local_zero_effect_coordinator"),
    expiresAt: z.number().int().nonnegative(),
  }).nullable(),
  events: z.array(localRunEventSchema).max(100),
});

export const localRequestSchema = z.strictObject({
  schemaVersion: z.literal(1),
  id: requestId,
  projectId,
  outcome: boundedOutcome,
  readiness: z.enum(["ready", "needs_input"]),
  state: z.enum([
    "queued",
    "needs_input",
    "approved",
    "claimed",
    "checkpointed",
    "completed",
    "interrupted",
    "cancelled",
  ]),
  provenance: z.literal("local_request"),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
  findings: z.array(localReadinessFindingSchema).max(20),
  workPreview: localWorkPreviewSchema.nullable(),
  run: localRunSchema.nullable(),
  grounding: localGroundingSchema.optional(),
  topology: localTopologySchema.optional(),
  plan: localDraftPlanSchema.optional(),
});

export const localRequestCollectionSchema = z.strictObject({
  schemaVersion: z.literal(1),
  provenance: z.literal("local_observation"),
  observedAt: z.number().int().nonnegative(),
  requests: z.array(localRequestSchema).max(500),
});

export const localRequestMutationResponseSchema = z.strictObject({
  schemaVersion: z.literal(1),
  outcome: z.enum([
    "created",
    "approved",
    "claimed",
    "checkpointed",
    "released",
    "reconciled",
    "grounded",
    "plan_updated",
    "plan_approved",
    "cancelled",
    "archived",
  ]),
  request: localRequestSchema.nullable(),
});

export type LocalRequestCreation = z.infer<typeof localRequestCreationSchema>;
export type LocalRequest = z.infer<typeof localRequestSchema>;
export type LocalRequestCollection = z.infer<typeof localRequestCollectionSchema>;
export type LocalRequestMutationResponse = z.infer<typeof localRequestMutationResponseSchema>;
export type LocalGrounding = z.infer<typeof localGroundingSchema>;
export type LocalTopology = z.infer<typeof localTopologySchema>;
export type LocalDraftPlan = z.infer<typeof localDraftPlanSchema>;
export type LocalPlanEdit = z.infer<typeof localPlanEditSchema>;
export type LocalPlanningSnapshot = z.infer<typeof localPlanningSnapshotSchema>;

export function validateLocalRequestCollection(input: unknown): LocalRequestCollection {
  const collection = localRequestCollectionSchema.parse(input);
  const identities = collection.requests.map((request) => request.id);
  if (new Set(identities).size !== identities.length) {
    throw new Error("Local request collection contains duplicate identities.");
  }
  for (const request of collection.requests) {
    if (request.plan || request.grounding || request.topology) {
      if (
        !request.plan ||
        !request.grounding ||
        !request.topology ||
        request.grounding.projectId !== request.projectId ||
        request.topology.projectId !== request.projectId ||
        request.plan.groundingDigest !== request.grounding.digest ||
        request.plan.topologyDigest !== request.topology.digest
      ) {
        throw new Error("Local plan does not match its grounding snapshot.");
      }
      validatePlan(request.plan, request.grounding, request.topology);
    }
    if (request.run) {
      if (
        request.run.contract.requestId !== request.id ||
        request.run.contract.projectId !== request.projectId ||
        request.run.contract.outcome !== request.outcome ||
        request.run.state !== request.state
      ) {
        throw new Error("Local run does not match its immutable request contract.");
      }
      request.run.events.forEach((event, index) => {
        if (event.sequence !== index + 1) {
          throw new Error("Local run event sequence is not contiguous.");
        }
      });
    } else if (
      ["approved", "claimed", "checkpointed", "completed", "interrupted"].includes(
        request.state
      )
    ) {
      throw new Error("Local run state requires an execution contract.");
    }
  }
  return collection;
}

function validatePlan(
  plan: LocalDraftPlan,
  grounding: LocalGrounding,
  topology: LocalTopology
): void {
  const ids = plan.tasks.map((task) => task.id);
  if (
    new Set(ids).size !== ids.length ||
    plan.order.length !== ids.length ||
    new Set(plan.order).size !== ids.length ||
    plan.order.some((id) => !ids.includes(id))
  ) {
    throw new Error("Local plan task identities or order are invalid.");
  }
  const positions = new Map(plan.order.map((id, index) => [id, index]));
  const sourcePaths = new Set(grounding.sources.map((source) => source.path));
  const topologyPaths = new Set(topology.entries.map((entry) => entry.path));
  const fileOwner = new Map<string, string>();
  for (const task of plan.tasks) {
    if (
      task.citedSources.some((path) => !sourcePaths.has(path)) ||
      task.allowedFiles.some((path) => !topologyPaths.has(path)) ||
      task.dependsOn.some((id) => !ids.includes(id) || id === task.id)
    ) {
      throw new Error("Local plan contains an ungrounded source, target, or dependency.");
    }
    for (const dependency of task.dependsOn) {
      if ((positions.get(dependency) ?? Infinity) >= (positions.get(task.id) ?? -1)) {
        throw new Error("Local plan dependency order is invalid.");
      }
    }
    for (const path of task.allowedFiles) {
      const owner = fileOwner.get(path);
      if (
        owner &&
        !task.dependsOn.includes(owner) &&
        !plan.tasks.find((candidate) => candidate.id === owner)?.dependsOn.includes(task.id)
      ) {
        throw new Error("Local plan contains unordered overlapping file scope.");
      }
      fileOwner.set(path, task.id);
    }
  }
  if (
    (plan.state === "approved") !== Boolean(plan.approval) ||
    (plan.approval && plan.approval.revision !== plan.revision)
  ) {
    throw new Error("Local plan approval does not match its immutable revision.");
  }
}
