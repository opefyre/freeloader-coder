import { z } from "zod";

const projectId = z.string().regex(/^project_[a-f0-9]{16}$/);
const requestId = z.string().regex(/^request_[a-f0-9]{20}$/);
const boundedOutcome = z.string().trim().min(3).max(20_000);

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
    path: z.string().trim().min(1).max(240).refine(
      (value) =>
        !value.startsWith("/") &&
        !value.startsWith("\\") &&
        !value.split(/[\\/]/).includes(".."),
      "Grounding source must be project-relative."
    ),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    bytes: z.number().int().nonnegative().max(65_536),
    classification: z.enum(["guidance", "manifest", "documentation"]),
    excerpt: z.string().max(2_000),
  })).min(1).max(12),
  limitations: z.array(z.string().trim().min(1).max(300)).min(1).max(10),
});

export const localDraftPlanSchema = z.strictObject({
  schemaVersion: z.literal(1),
  provenance: z.literal("deterministic_local_plan"),
  digest: z.string().regex(/^[a-f0-9]{64}$/),
  groundingDigest: z.string().regex(/^[a-f0-9]{64}$/),
  state: z.literal("draft"),
  tasks: z.array(z.strictObject({
    id: z.string().regex(/^task_[a-f0-9]{12}$/),
    title: z.string().trim().min(1).max(160),
    outcome: boundedOutcome,
    allowedFiles: z.array(z.string().trim().min(1).max(240)).min(1).max(12),
    acceptanceCriteria: z.array(z.string().trim().min(1).max(300)).min(1).max(10),
    exclusions: z.array(z.string().trim().min(1).max(300)).min(1).max(10),
    checks: z.array(z.string().trim().min(1).max(160)).min(1).max(10),
    risk: z.enum(["low", "medium", "high"]),
  })).min(1).max(6),
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
export type LocalDraftPlan = z.infer<typeof localDraftPlanSchema>;

export function validateLocalRequestCollection(input: unknown): LocalRequestCollection {
  const collection = localRequestCollectionSchema.parse(input);
  const identities = collection.requests.map((request) => request.id);
  if (new Set(identities).size !== identities.length) {
    throw new Error("Local request collection contains duplicate identities.");
  }
  for (const request of collection.requests) {
    if (request.plan || request.grounding) {
      if (
        !request.plan ||
        !request.grounding ||
        request.grounding.projectId !== request.projectId ||
        request.plan.groundingDigest !== request.grounding.digest
      ) {
        throw new Error("Local plan does not match its grounding snapshot.");
      }
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
