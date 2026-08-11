import assert from "node:assert/strict";
import test from "node:test";

import { DeliveryPlanReviewDissentError, ProjectDeliveryPlanOrchestrator } from "../apps/core/src/project-delivery-plan-orchestrator.js";
import type { RoutedSolutionModel } from "../apps/core/src/project-solution-orchestrator.js";
import { completeDeliveryPlan } from "./delivery-plan-fixture.js";

const projectId = "project_0123456789abcdef";
const contextDigest = "a".repeat(64);
const solutionDigest = "b".repeat(64);
const lifecycle = { schemaVersion: 1 as const, projectId, stage: "backlog_design" as const, revision: 6, mission: "Build the complete product.", assessment: { classification: "new_product" as const, rationale: ["New product."], affectedDomains: ["product"], estimatedDeveloperHours: 80, requiresArchitectureDecision: true, confidence: 0.95 }, questions: [], answers: [], artifacts: [], designApproval: { artifactDigest: solutionDigest, decision: "approved" as const, decidedAt: 10 }, designFeedback: [], jiraEpicId: null, blockedReason: null, updatedAt: 10 };
const permit = { schemaVersion: 1 as const, projectId, contextDigest, dataClass: "non_personal_test" as const, providerIds: ["groq"], approvedAt: 1, expiresAt: 100_000 };

test("approved major solution becomes an independently reviewed backlog artifact", async () => {
  const calls: string[] = [];
  const model: RoutedSolutionModel = { run: async (input) => {
    calls.push(input.role);
    if (input.role === "delivery_planning") return { providerId: "groq", modelId: "planner", response: completeDeliveryPlan() };
    return { providerId: input.role === "delivery_review" ? "groq" : "gemini", modelId: input.role, response: { schemaVersion: 1, reviewerId: input.role, discipline: input.role === "delivery_review" ? "delivery" : "technical", verdict: "pass", findings: [] } };
  } };
  let published: unknown;
  const orchestrator = new ProjectDeliveryPlanOrchestrator(
    { get: async () => lifecycle, eligibility: async () => ({ schemaVersion: 1, projectId, requestId: "request_0123456789abcdef0123", eligible: true, assessment: lifecycle.assessment, evidence: ["New product."], alternatives: [], override: null, decidedAt: 1 }), publishBacklog: async (_id, artifact) => { published = artifact; return { ...lifecycle, stage: "backlog_qa", revision: 7 }; } },
    { read: async () => { throw Object.assign(new Error("missing"), { code: "ENOENT" }); }, publish: async (_id, draft) => ({ kind: "backlog", projectRelativePath: ".pipeline/BACKLOG.md", digest: "c".repeat(64), revision: (draft as { revision: number }).revision, createdAt: 20, citations: ["local://CONTEXT.md"], reviewerIds: (draft as { reviews: Array<{ reviewerId: string }> }).reviews.map((review) => review.reviewerId), qaPassed: true }) },
    { readVerified: async () => ({ digest: contextDigest, markdown: "# Context\n\nVerified." }) },
    { read: async () => ({ schemaVersion: 1, projectId, projectRelativePath: ".pipeline/SOLUTION.md", revision: 1, digest: solutionDigest, markdown: "# Solution\n\nApproved." }) },
    { authorize: async () => permit }, model, () => 20
  );
  const result = await orchestrator.run(projectId);
  assert.equal(result.stage, "backlog_qa");
  assert.deepEqual(calls, ["delivery_planning", "delivery_review", "technical_delivery_review"]);
  assert.equal((published as { qaPassed: boolean }).qaPassed, true);
});

test("backlog planning fails closed on reviewer dissent, planner self-review, and evidence mismatch", async () => {
  const run = async (mismatch: boolean, dissent: boolean, selfReview = false) => new ProjectDeliveryPlanOrchestrator(
    { get: async () => lifecycle, eligibility: async () => ({ schemaVersion: 1, projectId, requestId: "request_0123456789abcdef0123", eligible: true, assessment: lifecycle.assessment, evidence: ["New product."], alternatives: [], override: null, decidedAt: 1 }), publishBacklog: async () => { throw new Error("must not publish"); } },
    { read: async () => { throw Object.assign(new Error("missing"), { code: "ENOENT" }); }, publish: async () => { throw new Error("must not publish"); } },
    { readVerified: async () => ({ digest: contextDigest, markdown: "context" }) },
    { read: async () => ({ schemaVersion: 1, projectId, projectRelativePath: ".pipeline/SOLUTION.md", revision: 1, digest: solutionDigest, markdown: "solution" }) },
    { authorize: async () => permit },
    { run: async (input) => input.role === "delivery_planning" ? { providerId: "groq", modelId: "planner", response: { ...completeDeliveryPlan(), ...(mismatch ? { solutionDigest: "d".repeat(64) } : {}) } } : { providerId: selfReview && input.role === "delivery_review" ? "groq" : input.role, modelId: selfReview && input.role === "delivery_review" ? "planner" : "reviewer", response: { schemaVersion: 1, reviewerId: input.role, discipline: input.role === "delivery_review" ? "delivery" : "technical", verdict: dissent && input.role === "delivery_review" ? "fail" : "pass", findings: dissent ? ["Missing recovery detail."] : [] } } },
  ).run(projectId);
  await assert.rejects(() => run(true, false), /not bound/);
  await assert.rejects(() => run(false, true), DeliveryPlanReviewDissentError);
  await assert.rejects(() => run(false, false, true), /planner and two independent reviewer identities/);
});
