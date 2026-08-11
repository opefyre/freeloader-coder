import { z } from "zod";

const section = z.array(z.string().trim().min(3).max(4_000)).min(1).max(100);
const evidenceId = z.string().regex(/^[a-z0-9][a-z0-9._-]{2,79}$/i);
export const researchTopicSchema = z.enum(["market", "competitor_features", "competitor_pricing", "public_reviews", "audience", "problem", "product", "architecture", "data", "integrations", "security", "privacy", "reliability", "delivery"]);
export const researchSourceSchema = z.strictObject({
  sourceId: evidenceId,
  url: z.string().url().max(2_048).refine((value) => ["https:", "http:"].includes(new URL(value).protocol), "Research sources must use HTTP(S)."),
  title: z.string().trim().min(3).max(300),
  retrievedAt: z.string().datetime({ offset: true }),
  excerpt: z.string().trim().min(10).max(8_000),
  excerptDigest: z.string().regex(/^[a-f0-9]{64}$/),
  confidence: z.number().min(0).max(1),
  relevance: z.number().min(0).max(1),
  freshness: z.enum(["current", "stale"]),
});
export const researchClaimSchema = z.strictObject({
  claimId: evidenceId,
  topic: researchTopicSchema,
  statement: z.string().trim().min(10).max(4_000),
  sourceIds: z.array(evidenceId).min(1).max(20),
  confidence: z.number().min(0).max(1),
  relevance: z.number().min(0).max(1),
});
export const researchEvidenceGraphSchema = z.strictObject({
  schemaVersion: z.literal(1),
  discipline: z.enum(["product", "technical"]),
  questions: z.array(z.string().trim().min(3).max(1_000)).min(1).max(50),
  sources: z.array(researchSourceSchema).max(200),
  claims: z.array(researchClaimSchema).max(500),
  contradictions: z.array(z.strictObject({
    claimIds: z.tuple([evidenceId, evidenceId]),
    summary: z.string().trim().min(10).max(2_000),
  })).max(100),
  gaps: z.array(z.strictObject({
    topic: researchTopicSchema,
    question: z.string().trim().min(3).max(1_000),
    reason: z.enum(["browsing_unavailable", "no_reliable_source", "insufficient_evidence"]),
    impact: z.string().trim().min(3).max(2_000),
  })).max(100),
}).superRefine((graph, context) => {
  const sourceIds = new Set(graph.sources.map((source) => source.sourceId));
  const claimIds = new Set(graph.claims.map((claim) => claim.claimId));
  if (sourceIds.size !== graph.sources.length) context.addIssue({ code: "custom", message: "Research source IDs must be unique." });
  if (claimIds.size !== graph.claims.length) context.addIssue({ code: "custom", message: "Research claim IDs must be unique." });
  if (graph.claims.length === 0 && graph.gaps.length === 0) context.addIssue({ code: "custom", message: "Research must contain verified claims or explicit evidence gaps." });
  const requiredTopics = graph.discipline === "product" ? ["market", "competitor_features", "competitor_pricing", "public_reviews", "audience", "problem", "product"] : ["architecture", "data", "integrations", "security", "privacy", "reliability", "delivery"];
  const coveredTopics = new Set([...graph.claims.map((claim) => claim.topic), ...graph.gaps.map((gap) => gap.topic)]);
  for (const topic of requiredTopics) if (!coveredTopics.has(topic as typeof graph.claims[number]["topic"])) context.addIssue({ code: "custom", message: `Research topic ${topic} must have verified evidence or an explicit gap.` });
  for (const claim of graph.claims) for (const sourceId of claim.sourceIds) if (!sourceIds.has(sourceId)) context.addIssue({ code: "custom", message: `Claim ${claim.claimId} references an unknown source.` });
  for (const contradiction of graph.contradictions) for (const claimId of contradiction.claimIds) if (!claimIds.has(claimId)) context.addIssue({ code: "custom", message: "Contradictions must reference known claims." });
});
const reviewSchema = z.strictObject({ reviewerId: z.string().trim().min(3).max(160), discipline: z.enum(["product", "technical"]), verdict: z.literal("pass"), findings: z.array(z.string().trim().min(3).max(1_000)).max(50) });
const alternativeSchema = z.strictObject({
  option: z.string().trim().min(3).max(2_000),
  disposition: z.enum(["selected", "rejected", "deferred"]),
  rationale: z.string().trim().min(3).max(4_000),
});
const blockerSchema = z.strictObject({
  blocker: z.string().trim().min(3).max(2_000),
  impact: z.string().trim().min(3).max(2_000),
  owner: z.string().trim().min(2).max(200),
  resolution: z.string().trim().min(3).max(2_000),
});
export const solutionContentSchema = z.strictObject({
  schemaVersion: z.literal(1), title: z.string().trim().min(3).max(200), summary: z.string().trim().min(20).max(10_000),
  behavior: section, architecture: section, userExperience: section, data: section, integrations: section,
  security: section, privacy: section, reliability: section, rollout: section, metrics: section,
  alternatives: z.array(alternativeSchema).min(2).max(50),
  unresolvedBlockers: z.array(blockerSchema).max(50),
  citations: z.array(z.string().trim().min(1).max(2_048)).min(1).max(500),
}).superRefine((solution, context) => {
  if (!solution.alternatives.some((item) => item.disposition === "selected")) context.addIssue({ code: "custom", message: "Solution alternatives must identify the selected option." });
  if (!solution.alternatives.some((item) => item.disposition === "rejected")) context.addIssue({ code: "custom", message: "Solution alternatives must record at least one rejected option." });
});
export const solutionSectionSchema = z.enum(["title", "summary", "behavior", "architecture", "userExperience", "data", "integrations", "security", "privacy", "reliability", "rollout", "metrics", "alternatives", "unresolvedBlockers"]);
export const solutionRevisionScopeSchema = z.strictObject({
  schemaVersion: z.literal(1),
  sections: z.array(solutionSectionSchema).min(1).max(12),
  rationale: z.string().trim().min(3).max(2_000),
});
export const solutionReviewResultSchema = z.strictObject({
  schemaVersion: z.literal(1), reviewerId: z.string().trim().min(3).max(160),
  discipline: z.enum(["product", "technical"]), verdict: z.enum(["pass", "fail"]),
  findings: z.array(z.string().trim().min(3).max(1_000)).max(50),
});
export const projectEgressPermitSchema = z.strictObject({
  schemaVersion: z.literal(1), projectId: z.string().regex(/^project_[a-f0-9]{16}$/), contextDigest: z.string().regex(/^[a-f0-9]{64}$/),
  dataClass: z.enum(["non_personal_test", "source_code"]), providerIds: z.array(z.string().trim().min(1).max(80)).min(1).max(50),
  approvedAt: z.number().int().nonnegative(), expiresAt: z.number().int().positive(),
});
export const solutionRunSchema = z.strictObject({ schemaVersion: z.literal(1), projectId: z.string().regex(/^project_[a-f0-9]{16}$/), state: z.enum(["queued", "running", "deferred", "needs_user", "completed"]), attempts: z.number().int().nonnegative(), retryAt: z.number().int().nonnegative().nullable(), safeMessage: z.string().min(1).max(2_000), updatedAt: z.number().int().nonnegative() });
export const solutionDraftSchema = z.strictObject({
  schemaVersion: z.literal(1), revision: z.number().int().positive(), title: z.string().trim().min(3).max(200), summary: z.string().trim().min(20).max(10_000),
  behavior: section, architecture: section, userExperience: section, data: section, integrations: section, security: section, privacy: section, reliability: section, rollout: section, metrics: section,
  alternatives: z.array(alternativeSchema).min(2).max(50), unresolvedBlockers: z.array(blockerSchema).max(50),
  citations: z.array(z.string().trim().min(1).max(2_048)).min(1).max(500), reviews: z.array(reviewSchema).length(2),
}).superRefine((solution, context) => {
  if (!solution.alternatives.some((item) => item.disposition === "selected")) context.addIssue({ code: "custom", message: "Solution alternatives must identify the selected option." });
  if (!solution.alternatives.some((item) => item.disposition === "rejected")) context.addIssue({ code: "custom", message: "Solution alternatives must record at least one rejected option." });
});
export const solutionDocumentSchema = z.strictObject({ schemaVersion: z.literal(1), projectId: z.string().regex(/^project_[a-f0-9]{16}$/), projectRelativePath: z.literal(".pipeline/SOLUTION.md"), revision: z.number().int().positive(), digest: z.string().regex(/^[a-f0-9]{64}$/), markdown: z.string().min(1).max(1_000_000) });
export const solutionHistorySchema = z.array(solutionDocumentSchema).max(100);
export type SolutionDocument = z.infer<typeof solutionDocumentSchema>;
export type SolutionContent = z.infer<typeof solutionContentSchema>;
export type SolutionRevisionScope = z.infer<typeof solutionRevisionScopeSchema>;
export type SolutionReviewResult = z.infer<typeof solutionReviewResultSchema>;
export type ResearchEvidenceGraph = z.infer<typeof researchEvidenceGraphSchema>;
export type ProjectEgressPermit = z.infer<typeof projectEgressPermitSchema>;
export type SolutionRun = z.infer<typeof solutionRunSchema>;
