import { z } from "zod";

const issueKey = z.string().trim().regex(/^[A-Z][A-Z0-9]+-\d+$/);
const digest = z.string().regex(/^[a-f0-9]{40,64}$/);
const evidenceReference = z.string().trim().min(3).max(2_048).refine((value) => {
  if (/^(local|jira|git|validation|review|implementation|deterministic_test|independent_review|live_journey|commit):\/\//.test(value)) return true;
  try { return new URL(value).protocol === "https:"; } catch { return false; }
}, "Closure evidence requires a safe resolvable reference.");

export const closureEvidenceSchema = z.strictObject({
  criterionId: z.string().trim().min(1).max(120),
  kind: z.enum(["implementation", "deterministic_test", "independent_review", "live_journey", "commit"]),
  reference: evidenceReference,
  digest: digest,
  observedAt: z.number().int().nonnegative(),
  provenance: z.enum(["observed", "fixture", "synthetic"]),
  resolved: z.boolean(),
});

export const jiraClosureCandidateSchema = z.strictObject({
  issueKey,
  kind: z.enum(["work_item", "parent"]),
  acceptanceCriteria: z.array(z.strictObject({ id: z.string().trim().min(1).max(120), text: z.string().trim().min(3).max(1_000) })).min(1).max(100),
  evidence: z.array(closureEvidenceSchema).max(500),
  requiredValidationProfiles: z.array(z.string().trim().min(1).max(100)).min(1).max(30),
  passedValidationProfiles: z.array(z.string().trim().min(1).max(100)).max(30),
  reviewerIds: z.array(z.string().trim().min(3).max(160)).max(20),
  implementerId: z.string().trim().min(3).max(160),
  commitDigest: digest.nullable(),
  liveJourneyRequired: z.boolean(),
  closureComment: z.string().trim().min(20).max(10_000).nullable(),
  children: z.array(z.strictObject({ issueKey, done: z.boolean(), proofComplete: z.boolean() })).max(2_000),
  priorTransitions: z.array(z.strictObject({ from: z.string().trim().min(1).max(100), to: z.string().trim().min(1).max(100), occurredAt: z.number().int().nonnegative(), evidenceDigest: digest })).max(1_000),
});

export type JiraClosureCandidate = z.infer<typeof jiraClosureCandidateSchema>;
export type JiraClosureDecision = { eligible: boolean; blockers: readonly string[]; preservedHistory: JiraClosureCandidate["priorTransitions"] };

export function evaluateJiraClosure(input: unknown): JiraClosureDecision {
  const candidate = jiraClosureCandidateSchema.parse(input);
  const blockers: string[] = [];
  const realEvidence = candidate.evidence.filter((item) => item.provenance === "observed" && item.resolved);
  const covered = new Set(realEvidence.map((item) => item.criterionId));
  for (const criterion of candidate.acceptanceCriteria) {
    if (!covered.has(criterion.id)) blockers.push(`Acceptance criterion ${criterion.id} has no resolved observed evidence.`);
  }
  const passed = new Set(candidate.passedValidationProfiles);
  for (const profile of candidate.requiredValidationProfiles) {
    if (!passed.has(profile)) blockers.push(`Required deterministic validation ${profile} has not passed.`);
  }
  const independentReviewers = new Set(candidate.reviewerIds.filter((reviewerId) => reviewerId !== candidate.implementerId));
  if (independentReviewers.size < 2) blockers.push("Two independent reviewers are required.");
  if (!candidate.commitDigest || !realEvidence.some((item) => item.kind === "commit" && item.digest === candidate.commitDigest)) blockers.push("A resolved observed commit reference is required.");
  if (candidate.liveJourneyRequired && !realEvidence.some((item) => item.kind === "live_journey")) blockers.push("A resolved observed live journey is required.");
  if (!candidate.closureComment || !/acceptance|evidence|validation/i.test(candidate.closureComment)) blockers.push("A closure comment mapping acceptance, evidence, and validation is required.");
  for (const child of candidate.children) {
    if (!child.done || !child.proofComplete) blockers.push(`${child.issueKey} is not Done with complete proof.`);
  }
  if (candidate.evidence.length > 0 && realEvidence.length === 0) blockers.push("Fixture-only or synthetic evidence cannot close Jira work.");
  return { eligible: blockers.length === 0, blockers: [...new Set(blockers)], preservedHistory: [...candidate.priorTransitions] };
}

export function assertJiraClosureEligible(input: unknown): JiraClosureCandidate {
  const candidate = jiraClosureCandidateSchema.parse(input);
  const decision = evaluateJiraClosure(candidate);
  if (!decision.eligible) throw new JiraClosurePolicyError(decision.blockers);
  return candidate;
}

export class JiraClosurePolicyError extends Error {
  constructor(readonly blockers: readonly string[]) {
    super(`Jira closure blocked: ${blockers.join(" ")}`);
  }
}
