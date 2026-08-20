import assert from "node:assert/strict";
import test from "node:test";

import { DeliveryPlanReviewDissentError, ProjectDeliveryPlanOrchestrator } from "../apps/core/src/project-delivery-plan-orchestrator.js";
import type { RoutedSolutionModel } from "../apps/core/src/project-solution-orchestrator.js";
import { completeDeliveryPlan } from "./delivery-plan-fixture.js";
import { FreeProviderSolutionUnavailableError } from "../apps/core/src/free-provider-solution-model.js";

const projectId = "project_0123456789abcdef";
const contextDigest = "a".repeat(64);
const solutionDigest = "b".repeat(64);
const lifecycle = { schemaVersion: 1 as const, projectId, stage: "backlog_design" as const, revision: 6, mission: "Build the complete product.", assessment: { classification: "new_product" as const, rationale: ["New product."], affectedDomains: ["product"], estimatedDeveloperHours: 80, requiresArchitectureDecision: true, confidence: 0.95 }, questions: [], answers: [], artifacts: [], designApproval: { artifactDigest: solutionDigest, decision: "approved" as const, decidedAt: 10 }, designFeedback: [], jiraEpicId: null, blockedReason: null, updatedAt: 10 };
const featureLifecycle = { ...lifecycle, assessment: { ...lifecycle.assessment, classification: "major_feature" as const } };
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
    { get: async () => featureLifecycle, eligibility: async () => ({ schemaVersion: 1, projectId, requestId: "request_0123456789abcdef0123", eligible: true, assessment: featureLifecycle.assessment, evidence: ["Major feature."], alternatives: [], override: null, decidedAt: 1 }), publishBacklog: async (_id, artifact) => { published = artifact; return { ...featureLifecycle, stage: "backlog_qa", revision: 7 }; } },
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
    { get: async () => featureLifecycle, eligibility: async () => ({ schemaVersion: 1, projectId, requestId: "request_0123456789abcdef0123", eligible: true, assessment: featureLifecycle.assessment, evidence: ["Major feature."], alternatives: [], override: null, decidedAt: 1 }), publishBacklog: async () => { throw new Error("must not publish"); } },
    { read: async () => { throw Object.assign(new Error("missing"), { code: "ENOENT" }); }, publish: async () => { throw new Error("must not publish"); } },
    { readVerified: async () => ({ digest: contextDigest, markdown: "context" }) },
    { read: async () => ({ schemaVersion: 1, projectId, projectRelativePath: ".pipeline/SOLUTION.md", revision: 1, digest: solutionDigest, markdown: "solution" }) },
    { authorize: async () => permit },
    { run: async (input) => input.role === "delivery_planning" ? { providerId: "groq", modelId: "planner", response: { ...completeDeliveryPlan(), ...(mismatch ? { solutionDigest: "d".repeat(64) } : {}) } } : { providerId: selfReview && input.role === "delivery_review" ? "groq" : input.role, modelId: selfReview && input.role === "delivery_review" ? "planner" : "reviewer", response: { schemaVersion: 1, reviewerId: input.role, discipline: input.role === "delivery_review" ? "delivery" : "technical", verdict: dissent && input.role === "delivery_review" ? "fail" : "pass", findings: dissent ? ["Missing recovery detail."] : [] } } },
    () => 20,
  ).run(projectId);
  await assert.rejects(() => run(true, false), /not bound/);
  await assert.rejects(() => run(false, true), DeliveryPlanReviewDissentError);
  await assert.rejects(() => run(false, false, true), /planner and two independent reviewer identities/);
});

test("free-provider planning exhaustion falls back to a complete local plan and still requires two independent AI reviews", async () => {
  const calls: string[] = [];
  let draft: any;
  const solutionContent = { schemaVersion: 1 as const, title: "Local decision journal", summary: "Build the approved local-first decision journal with encrypted storage, owner-controlled AI assistance, backup, and review workflows.", behavior: ["Capture structured decisions and review outcomes."], architecture: ["Run as a local client-side application."], userExperience: ["Provide a minimal owner dashboard."], data: ["Persist encrypted records in IndexedDB."], integrations: ["Use only approved free AI routes."], security: ["Encrypt local records using Web Crypto."], privacy: ["Keep journal data on the owner device."], reliability: ["Provide verified backup and restore workflows."], rollout: ["Require owner approval before implementation."], metrics: ["Track local decision and backup completion."], alternatives: [{ option: "Local-first web app", disposition: "selected" as const, rationale: "It satisfies the approved constraints." }, { option: "Cloud SaaS", disposition: "rejected" as const, rationale: "It violates local-first constraints." }], unresolvedBlockers: [], citations: ["local://CONTEXT.md", "local://RESEARCH.md"] };
  const orchestrator = new ProjectDeliveryPlanOrchestrator(
    { get: async () => lifecycle, eligibility: async () => ({ schemaVersion: 1, projectId, requestId: "request_0123456789abcdef0123", eligible: true, assessment: lifecycle.assessment, evidence: ["New product."], alternatives: [], override: null, decidedAt: 1 }), publishBacklog: async () => ({ ...lifecycle, stage: "backlog_qa", revision: 7 }) },
    { read: async () => { throw Object.assign(new Error("missing"), { code: "ENOENT" }); }, publish: async (_id: string, candidate: any) => { draft = candidate; return { kind: "backlog", projectRelativePath: ".pipeline/BACKLOG.md", digest: "c".repeat(64), revision: candidate.revision, createdAt: 20, citations: candidate.citations, reviewerIds: candidate.reviews.map((review: any) => review.reviewerId), qaPassed: true }; } } as any,
    { readVerified: async () => ({ digest: contextDigest, markdown: "# Context\n\nVerified." }) },
    { read: async () => ({ schemaVersion: 1, projectId, projectRelativePath: ".pipeline/SOLUTION.md", revision: 1, digest: solutionDigest, markdown: "# Solution\n\nApproved." }), readContent: async () => solutionContent },
    { authorize: async () => permit },
    { run: async (input) => { calls.push(input.role); if (input.role === "delivery_planning") throw new FreeProviderSolutionUnavailableError(1_000, "Free planner unavailable."); return { providerId: "gemini", modelId: "gemini-reviewer", response: { schemaVersion: 1, reviewerId: `${input.role}-reviewer`, discipline: input.role === "delivery_review" ? "delivery" : "technical", verdict: "pass", findings: [] } }; } },
    () => 20,
  );
  const result = await orchestrator.run(projectId);
  assert.equal(result.stage, "backlog_qa");
  assert.deepEqual(calls, ["delivery_planning", "delivery_review", "technical_delivery_review"]);
  assert.equal(draft.items.length, 34);
  const subtasks = draft.items.filter((item: any) => item.type === "subtask");
  assert.equal(subtasks.length, 11);
  const scaffold = subtasks.find((item: any) => item.allowedFiles.includes("package.json"));
  assert.ok(scaffold);
  assert.deepEqual(scaffold.dependencies, []);
  assert.ok(subtasks.filter((item: any) => item.id !== scaffold.id).every((item: any) => item.dependencies.includes(scaffold.id)));
  assert.equal(draft.coverage.length, 10);
  assert.equal(JSON.stringify(draft).includes("local://SOLUTION.md"), false);
  assert.ok(draft.citations.includes("local://DESIGN.md"));
  assert.ok(draft.reviews.every((review: any) => review.verdict === "pass"));
  assert.match(draft.reviews[1].reviewerId, /codkesh-local\/deterministic-technical-validator-v1/);
});
