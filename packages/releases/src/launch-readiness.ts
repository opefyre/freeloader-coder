import { z } from "zod";

const version = z.literal(1);
const identifier = z.string().regex(/^[a-z0-9][a-z0-9._-]+$/);

export const positioningClaimSchema = z.strictObject({
  schemaVersion: version,
  id: identifier,
  audience: z.string().min(10).max(240),
  category: z.string().min(5).max(120),
  promise: z.string().min(10).max(300),
  proof: z.array(z.string().min(5).max(300)).min(1).max(20),
  sourceUrls: z.array(z.string().url()).min(1).max(20),
  prohibitedClaims: z.array(z.string().min(5).max(240)).min(1).max(20),
  validatedAt: z.string().datetime(),
  reviewAfter: z.string().datetime(),
});
export type PositioningClaim = z.infer<typeof positioningClaimSchema>;

export const launchGateSchema = z.strictObject({
  schemaVersion: version,
  id: identifier,
  label: z.string().min(3).max(120),
  owner: z.string().min(2).max(80),
  state: z.enum(["passed", "blocked", "needs_user", "not_run"]),
  evidenceRef: z.string().min(3).max(240).nullable(),
  stopCondition: z.string().min(5).max(300),
  recovery: z.string().min(5).max(300),
});
export type LaunchGate = z.infer<typeof launchGateSchema>;

export const launchReadinessSchema = z.strictObject({
  schemaVersion: version,
  releaseId: z.string().regex(/^release-[a-z0-9.-]+$/),
  positioning: positioningClaimSchema,
  gates: z.array(launchGateSchema).min(5).max(50),
  channels: z.array(
    z.strictObject({
      id: identifier,
      label: z.string().min(2).max(80),
      state: z.enum(["draft", "ready", "published", "paused"]),
      owner: z.string().min(2).max(80),
      rollback: z.string().min(5).max(300),
    })
  ).min(1).max(30),
  incidentOwner: z.string().min(2).max(80),
  supportCapacityPerDay: z.number().int().nonnegative(),
  plannedLaunchAt: z.string().datetime().nullable(),
});
export type LaunchReadiness = z.infer<typeof launchReadinessSchema>;

export interface LaunchDecision {
  readonly ready: boolean;
  readonly blockers: readonly LaunchGate[];
  readonly needsUser: readonly LaunchGate[];
  readonly message: string;
}

export function assessLaunchReadiness(
  raw: unknown,
  now: string
): LaunchDecision {
  const plan = launchReadinessSchema.parse(raw);
  const stale = plan.positioning.reviewAfter <= now;
  const blockers = plan.gates.filter(
    (gate) => gate.state === "blocked" || gate.state === "not_run"
  );
  const needsUser = plan.gates.filter((gate) => gate.state === "needs_user");
  const ready =
    !stale &&
    blockers.length === 0 &&
    needsUser.length === 0 &&
    plan.supportCapacityPerDay > 0 &&
    plan.channels.some((channel) => channel.state === "ready");
  return {
    ready,
    blockers,
    needsUser,
    message: stale
      ? "Positioning evidence is stale; refresh it before launch."
      : ready
        ? "Every required gate has current evidence and a staffed recovery path."
        : "Launch remains local until blockers and owner decisions are resolved.",
  };
}

export const outcomeMetricSchema = z.strictObject({
  schemaVersion: version,
  id: identifier,
  label: z.string().min(3).max(120),
  unit: z.enum(["percent", "minutes", "count", "rate"]),
  baseline: z.number().finite().nullable(),
  target: z.number().finite(),
  current: z.number().finite().nullable(),
  owner: z.string().min(2).max(80),
  cohort: z.string().min(3).max(160),
  source: z.enum(["local_event", "opt_in_telemetry", "support", "interview"]),
  containsPromptContent: z.literal(false),
  containsSourceCode: z.literal(false),
  reviewCadence: z.enum(["weekly", "monthly", "release"]),
});
export type OutcomeMetric = z.infer<typeof outcomeMetricSchema>;

export const learningReviewSchema = z.strictObject({
  schemaVersion: version,
  reviewId: identifier,
  reviewedAt: z.string().datetime(),
  metrics: z.array(outcomeMetricSchema).min(4).max(50),
  decision: z.enum(["keep", "change", "retire", "insufficient_evidence"]),
  rationale: z.string().min(10).max(800),
  ownedExperiments: z.array(
    z.strictObject({
      id: identifier,
      owner: z.string().min(2).max(80),
      hypothesis: z.string().min(10).max(400),
      successSignal: z.string().min(5).max(240),
      reviewAt: z.string().datetime(),
    })
  ).max(20),
});
export type LearningReview = z.infer<typeof learningReviewSchema>;

export function assessLearningReview(raw: unknown): {
  readonly actionable: boolean;
  readonly missingBaselines: readonly string[];
  readonly missingCurrentValues: readonly string[];
  readonly privacySafe: true;
} {
  const review = learningReviewSchema.parse(raw);
  const missingBaselines = review.metrics
    .filter((metric) => metric.baseline === null)
    .map((metric) => metric.id);
  const missingCurrentValues = review.metrics
    .filter((metric) => metric.current === null)
    .map((metric) => metric.id);
  const actionable =
    missingBaselines.length === 0 &&
    missingCurrentValues.length === 0 &&
    (review.decision === "keep" ||
      review.ownedExperiments.length > 0);
  return {
    actionable,
    missingBaselines,
    missingCurrentValues,
    privacySafe: true,
  };
}

