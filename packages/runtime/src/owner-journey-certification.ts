import { z } from "zod";

export const ownerJourneyStageSchema = z.enum([
  "plain_language_intake",
  "workspace_and_resources",
  "governed_artifacts",
  "context_and_eligibility",
  "solution_approval",
  "jira_backlog",
  "isolated_implementation",
  "deterministic_validation",
  "independent_review",
  "integration",
  "durable_completion",
]);

const digest = z.string().regex(/^[a-f0-9]{64}$/);
const timestamp = z.string().datetime({ offset: true });

export const ownerJourneyCertificationReceiptSchema = z.strictObject({
  schemaVersion: z.literal(1),
  certificationId: digest,
  mode: z.literal("synthetic_zero_cost"),
  outcome: z.literal("passed"),
  startedAt: timestamp,
  completedAt: timestamp,
  durationMs: z.number().int().nonnegative().max(3_600_000),
  suites: z
    .array(
      z.strictObject({
        id: z.enum(["owner_mvp", "new_product", "existing_product"]),
        outcome: z.literal("passed"),
        evidenceDigest: digest,
      }),
    )
    .length(3),
  stages: z
    .array(
      z.strictObject({
        name: ownerJourneyStageSchema,
        outcome: z.literal("passed"),
        evidenceDigest: digest,
      }),
    )
    .length(11),
  paidCalls: z.literal(0),
  externalEffects: z.literal(0),
  privacy: z.strictObject({
    prompts: z.literal(false),
    sourceCode: z.literal(false),
    attachments: z.literal(false),
    credentials: z.literal(false),
    absolutePaths: z.literal(false),
    personalIdentifiers: z.literal(false),
    privateJiraContent: z.literal(false),
  }),
  limitations: z.array(z.string().trim().min(1).max(240)).min(1).max(8),
  nextAction: z.string().trim().min(1).max(200),
});

export const ownerJourneyCertificationSnapshotSchema = z.strictObject({
  schemaVersion: z.literal(1),
  provenance: z.literal("local_owner_journey_certification"),
  observedAt: z.number().int().nonnegative(),
  validForMs: z.number().int().min(1_000).max(60_000),
  automaticSpendLimitUsd: z.literal(0),
  state: z.enum(["not_run", "running", "passed", "failed"]),
  runId: z
    .string()
    .regex(/^cert_run_[a-f0-9]{20}$/)
    .nullable(),
  message: z.string().trim().min(1).max(240),
  receipt: ownerJourneyCertificationReceiptSchema.nullable(),
  lastPassedReceipt: ownerJourneyCertificationReceiptSchema.nullable(),
  historyCount: z.number().int().nonnegative().max(50),
});

export const ownerJourneyCertificationPreviewSchema = z.strictObject({
  schemaVersion: z.literal(1),
  previewId: z.string().regex(/^cert_preview_[a-f0-9]{20}$/),
  effect: z.literal("local_validation_only"),
  maximumCostUsd: z.literal(0),
  externalEffects: z.literal(0),
  estimatedMaximumMinutes: z.literal(10),
  preservesPriorPassingEvidence: z.literal(true),
});

export const ownerJourneyCertificationRunResponseSchema = z.strictObject({
  schemaVersion: z.literal(1),
  outcome: z.enum(["started", "replayed"]),
  snapshot: ownerJourneyCertificationSnapshotSchema,
});

export const externalLearningScenarioSchema = z.enum([
  "new_product",
  "existing_product",
  "major_feature",
]);
export const externalLearningFrictionSchema = z.enum([
  "setup",
  "navigation",
  "trust",
  "clarity",
  "speed",
  "approval",
  "none",
]);
export const externalLearningSessionSchema = z.strictObject({
  schemaVersion: z.literal(1),
  id: z.string().regex(/^learning_[a-f0-9]{20}$/),
  revision: z.number().int().positive(),
  status: z.enum(["draft", "completed", "withdrawn"]),
  participantAlias: z.string().regex(/^participant-[a-z0-9-]{3,32}$/),
  consentedAt: z.number().int().nonnegative(),
  scenario: externalLearningScenarioSchema,
  startedAt: z.number().int().nonnegative(),
  completedAt: z.number().int().nonnegative().nullable(),
  timeToPreviewSeconds: z.number().int().min(1).max(86_400).nullable(),
  trustRating: z.number().int().min(1).max(5).nullable(),
  frictions: z.array(externalLearningFrictionSchema).max(6),
  note: z.string().trim().max(400),
  evidenceDigest: digest,
  synthetic: z.literal(false),
});
export const externalLearningCollectionSchema = z.strictObject({
  schemaVersion: z.literal(1),
  provenance: z.literal("local_consented_owner_learning"),
  automaticSpendLimitUsd: z.literal(0),
  sessions: z.array(externalLearningSessionSchema).max(50),
});
export const externalLearningCreateSchema = z.strictObject({
  participantAlias: z.string().regex(/^participant-[a-z0-9-]{3,32}$/),
  scenario: externalLearningScenarioSchema,
  consent: z.literal(true),
  startedAt: z.number().int().nonnegative(),
});
export const externalLearningCompleteSchema = z.strictObject({
  expectedRevision: z.number().int().positive(),
  completedAt: z.number().int().nonnegative(),
  timeToPreviewSeconds: z.number().int().min(1).max(86_400),
  trustRating: z.number().int().min(1).max(5),
  frictions: z.array(externalLearningFrictionSchema).max(6),
  note: z.string().trim().max(400).default(""),
});

export const certificationFreshnessSchema = z.strictObject({
  schemaVersion: z.literal(1),
  provenance: z.literal("local_certification_freshness"),
  state: z.enum(["current", "due", "overdue", "running", "failed", "not_run"]),
  observedAt: z.number().int().nonnegative(),
  lastPassedAt: z.number().int().nonnegative().nullable(),
  nextCheckAt: z.number().int().nonnegative(),
  dueAt: z.number().int().nonnegative().nullable(),
  retryAt: z.number().int().nonnegative().nullable(),
  cadenceMs: z.number().int().min(86_400_000).max(30 * 86_400_000),
  automaticSpendLimitUsd: z.literal(0),
  message: z.string().trim().min(1).max(240),
});

export const externalLearningAggregateSchema = z.strictObject({
  schemaVersion: z.literal(1),
  provenance: z.literal("privacy_safe_external_learning_aggregate"),
  observedAt: z.number().int().nonnegative(),
  completedSessions: z.number().int().nonnegative().max(50),
  eligibleForDecision: z.boolean(),
  minimumSampleSize: z.literal(3),
  completionRatePercent: z.number().int().min(0).max(100).nullable(),
  medianTimeToPreviewSeconds: z.number().int().min(1).max(86_400).nullable(),
  averageTrustRating: z.number().min(1).max(5).nullable(),
  trustAtLeastFourPercent: z.number().int().min(0).max(100).nullable(),
  frictionCounts: z.record(externalLearningFrictionSchema, z.number().int().nonnegative().max(50)),
  excludedDrafts: z.number().int().nonnegative().max(50),
  excludedWithdrawn: z.number().int().nonnegative().max(50),
  automaticSpendLimitUsd: z.literal(0),
  limitations: z.array(z.string().trim().min(1).max(200)).min(1).max(6),
});

export const pilotReadinessSchema = z.strictObject({
  schemaVersion: z.literal(1),
  provenance: z.literal("local_pilot_readiness_policy"),
  observedAt: z.number().int().nonnegative(),
  state: z.enum(["certification_needed", "learning_needed", "review_ready", "thresholds_not_met"]),
  title: z.string().trim().min(1).max(100),
  reason: z.string().trim().min(1).max(240),
  nextAction: z.string().trim().min(1).max(160),
  reasons: z.array(z.string().trim().min(1).max(160)).max(6),
  automaticSpendLimitUsd: z.literal(0),
});

export const ownerJourneyTrustSnapshotSchema = z.strictObject({
  schemaVersion: z.literal(1),
  provenance: z.literal("local_owner_journey_trust"),
  observedAt: z.number().int().nonnegative(),
  validForMs: z.number().int().min(1_000).max(60_000),
  freshness: certificationFreshnessSchema,
  learning: externalLearningAggregateSchema,
  readiness: pilotReadinessSchema,
  automaticSpendLimitUsd: z.literal(0),
});

export type OwnerJourneyCertificationReceipt = z.infer<
  typeof ownerJourneyCertificationReceiptSchema
>;
export type OwnerJourneyCertificationSnapshot = z.infer<
  typeof ownerJourneyCertificationSnapshotSchema
>;
export type OwnerJourneyCertificationPreview = z.infer<
  typeof ownerJourneyCertificationPreviewSchema
>;
export type OwnerJourneyCertificationRunResponse = z.infer<
  typeof ownerJourneyCertificationRunResponseSchema
>;
export type ExternalLearningSession = z.infer<
  typeof externalLearningSessionSchema
>;
export type ExternalLearningCollection = z.infer<
  typeof externalLearningCollectionSchema
>;
export type CertificationFreshness = z.infer<typeof certificationFreshnessSchema>;
export type ExternalLearningAggregate = z.infer<typeof externalLearningAggregateSchema>;
export type PilotReadiness = z.infer<typeof pilotReadinessSchema>;
export type OwnerJourneyTrustSnapshot = z.infer<typeof ownerJourneyTrustSnapshotSchema>;
