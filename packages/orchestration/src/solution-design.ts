import { z } from "zod";

const section = z.array(z.string().trim().min(3).max(4_000)).min(1).max(100);
const reviewSchema = z.strictObject({ reviewerId: z.string().trim().min(3).max(160), discipline: z.enum(["product", "technical"]), verdict: z.literal("pass"), findings: z.array(z.string().trim().min(3).max(1_000)).max(50) });
export const solutionContentSchema = z.strictObject({
  schemaVersion: z.literal(1), title: z.string().trim().min(3).max(200), summary: z.string().trim().min(20).max(10_000),
  behavior: section, architecture: section, userExperience: section, data: section, integrations: section,
  security: section, privacy: section, reliability: section, rollout: section, metrics: section,
  citations: z.array(z.string().trim().min(1).max(2_048)).min(1).max(500),
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
  citations: z.array(z.string().trim().min(1).max(2_048)).min(1).max(500), reviews: z.array(reviewSchema).length(2),
});
export const solutionDocumentSchema = z.strictObject({ schemaVersion: z.literal(1), projectId: z.string().regex(/^project_[a-f0-9]{16}$/), projectRelativePath: z.literal(".pipeline/SOLUTION.md"), revision: z.number().int().positive(), digest: z.string().regex(/^[a-f0-9]{64}$/), markdown: z.string().min(1).max(1_000_000) });
export type SolutionDocument = z.infer<typeof solutionDocumentSchema>;
export type SolutionContent = z.infer<typeof solutionContentSchema>;
export type SolutionReviewResult = z.infer<typeof solutionReviewResultSchema>;
export type ProjectEgressPermit = z.infer<typeof projectEgressPermitSchema>;
export type SolutionRun = z.infer<typeof solutionRunSchema>;
