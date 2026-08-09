import { z } from "zod";

import { majorWorkAssessmentSchema, type MajorWorkAssessment } from "./project-lifecycle.js";

const evidenceSchema = z.strictObject({
  projectId: z.string().regex(/^project_[a-f0-9]{16}$/),
  requestId: z.string().regex(/^request_[a-f0-9]{20}$/),
  projectKind: z.enum(["new_product", "existing_product", "unknown"]),
  affectedDomains: z.array(z.string().trim().min(1).max(160)).max(50),
  deliveryStages: z.array(z.enum(["research", "product", "design", "frontend", "backend", "data", "infrastructure", "qa", "launch"])).max(9),
  estimatedDeveloperHours: z.number().min(0).max(100_000),
  requiresArchitectureDecision: z.boolean(),
  evidence: z.array(z.string().trim().min(1).max(500)).min(1).max(30),
  confidence: z.number().min(0).max(1),
});

export type EligibilityEvidence = z.infer<typeof evidenceSchema>;
export const eligibilityDecisionSchema = z.strictObject({
  schemaVersion: z.literal(1), projectId: z.string().regex(/^project_[a-f0-9]{16}$/), requestId: z.string().regex(/^request_[a-f0-9]{20}$/),
  eligible: z.boolean(), assessment: majorWorkAssessmentSchema, evidence: z.array(z.string().trim().min(1).max(500)).min(1).max(30),
  alternatives: z.array(z.string().trim().min(1).max(500)).max(10),
  override: z.strictObject({ authorizedBy: z.literal("owner"), rationale: z.string().trim().min(10).max(2_000), at: z.number().int().nonnegative() }).nullable(),
  decidedAt: z.number().int().nonnegative(),
});
export type EligibilityDecision = z.infer<typeof eligibilityDecisionSchema>;

export function assessEligibility(raw: EligibilityEvidence, now = Date.now()): EligibilityDecision {
  const input = evidenceSchema.parse(raw);
  const domains = [...new Set(input.affectedDomains)].sort();
  const stages = [...new Set(input.deliveryStages)];
  let classification: MajorWorkAssessment["classification"];
  const rationale: string[] = [];
  if (input.confidence < 0.75 || input.projectKind === "unknown") {
    classification = "unclear";
    rationale.push("Evidence is insufficient for a major-work decision.");
  } else if (input.projectKind === "new_product") {
    classification = "new_product";
    rationale.push("The request creates a new software product.");
  } else if (input.requiresArchitectureDecision || (domains.length >= 2 && input.estimatedDeveloperHours >= 8) || (stages.length >= 3 && input.estimatedDeveloperHours >= 8)) {
    classification = "major_feature";
    rationale.push(input.requiresArchitectureDecision ? "An architecture decision is required." : `${domains.length} domains and ${stages.length} delivery stages are affected.`);
  } else {
    classification = "small_change";
    rationale.push("The request is bounded to a small implementation change.");
  }
  const assessment = majorWorkAssessmentSchema.parse({ classification, rationale, affectedDomains: domains, estimatedDeveloperHours: input.estimatedDeveloperHours, requiresArchitectureDecision: input.requiresArchitectureDecision, confidence: input.confidence });
  return eligibilityDecisionSchema.parse({
    schemaVersion: 1, projectId: input.projectId, requestId: input.requestId,
    eligible: classification === "new_product" || classification === "major_feature",
    assessment, evidence: input.evidence, override: null, decidedAt: now,
    alternatives: classification === "small_change" ? ["Handle this as a normal coding task outside the autonomous product lifecycle.", "Combine it with related work into a substantial feature request."] : classification === "unclear" ? ["Answer the blocking scope questions, then reassess."] : [],
  });
}

export function authorizeEligibilityOverride(decision: EligibilityDecision, input: { authorizedBy: "owner"; rationale: string; at: number }): EligibilityDecision {
  if (decision.eligible) throw new Error("Eligible work does not require an override.");
  if (input.authorizedBy !== "owner" || input.rationale.trim().length < 10) throw new Error("Eligibility override requires an owner and a specific rationale.");
  return eligibilityDecisionSchema.parse({ ...decision, eligible: true, override: { authorizedBy: "owner", rationale: input.rationale.trim(), at: input.at } });
}

export function assertDeliveryPlanningEligible(decision: EligibilityDecision) {
  if (!decision.eligible) throw new Error("Jira delivery planning and execution are blocked until major-work eligibility passes.");
}
