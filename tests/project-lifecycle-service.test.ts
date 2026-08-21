import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { ProjectLifecycleService } from "../apps/core/src/project-lifecycle-service.js";

test("project clarification lifecycle persists, rejects stale answers, and replays idempotently", async () => {
  const root = await mkdtemp(join(tmpdir(), "pipeline-lifecycle-"));
  const service = new ProjectLifecycleService(root);
  const projectId = "project_0123456789abcdef";
  const begun = await service.begin({ projectId, mission: "Build a customer portal.", now: 1 });
  const published = await service.publishQuestions({
    projectId,
    now: 2,
    artifact: { kind: "context", projectRelativePath: ".pipeline/CONTEXT.md", digest: "a".repeat(64), revision: 1, createdAt: 2, citations: ["local://README.md"], reviewerIds: ["context-reviewer"], qaPassed: true },
    questions: [{
      id: "question_0123456789abcdef",
      prompt: "Who can create accounts?",
      whyItMatters: "This changes identity architecture.",
      options: [{ id: "invite", label: "Invite only", consequence: "Admins control access." }, { id: "public", label: "Public", consequence: "Anyone can register." }],
      allowsCustomAnswer: false,
      sourceFindingIds: ["identity-gap"],
    }],
  });
  const request = { schemaVersion: 1 as const, expectedRevision: published.revision, answers: [{ questionId: "question_0123456789abcdef", optionId: "invite", customAnswer: null, answeredAt: 3 }] };
  const otherProjectId = "project_fedcba9876543210";
  const other = await service.begin({ projectId: otherProjectId, mission: "Build another product.", now: 3 });
  await assert.rejects(
    () => service.answer(otherProjectId, { ...request, expectedRevision: other.revision }, "answer-cross-project-1"),
    /clarification|context_review/,
  );
  await assert.rejects(() => service.answer(projectId, { ...request, expectedRevision: begun.revision }, "answer-stale-1"), /Questions changed/);
  await assert.rejects(
    () => service.answer(projectId, request, "answer-artifact-failure-1", async () => { throw new Error("injected decision persistence failure"); }),
    /injected decision persistence failure/,
  );
  assert.equal((await service.get(projectId))?.stage, "clarification");
  let persisted = 0;
  const answered = await service.answer(projectId, request, "answer-valid-1", async () => { persisted += 1; });
  const replay = await service.answer(projectId, request, "answer-valid-1", async () => { persisted += 1; });
  assert.equal(persisted, 1);
  assert.deepEqual(replay, answered);
  assert.deepEqual((await new ProjectLifecycleService(root).get(projectId))?.answers, request.answers);
  assert.doesNotMatch(await readFile(join(root, "project-lifecycles.json"), "utf8"), /\/Users\//);
});

test("eligibility decisions persist and gate lifecycle progression", async () => {
  const root = await mkdtemp(join(tmpdir(), "pipeline-eligibility-"));
  const service = new ProjectLifecycleService(root);
  const projectId = "project_0123456789abcdef";
  const lifecycle = await service.begin({ projectId, mission: "Build a complete operations product.", now: 1 });
  const result = await service.assess(projectId, { schemaVersion: 1, expectedRevision: lifecycle.revision, requestId: "request_0123456789abcdef0123", projectKind: "new_product", affectedDomains: ["frontend", "backend"], deliveryStages: ["product", "frontend", "backend", "qa"], estimatedDeveloperHours: 400, requiresArchitectureDecision: true, evidence: ["New product workspace and multi-stage outcome."], confidence: 0.95 }, "eligibility-new-001");
  assert.equal(result.decision.eligible, true);
  assert.equal(result.lifecycle.stage, "solution_design");
  assert.deepEqual(await new ProjectLifecycleService(root).eligibility(projectId), result.decision);
  await assert.rejects(() => service.assess(projectId, { schemaVersion: 1, expectedRevision: lifecycle.revision, requestId: "request_0123456789abcdef0123", projectKind: "new_product", affectedDomains: [], deliveryStages: [], estimatedDeveloperHours: 1, requiresArchitectureDecision: false, evidence: ["Changed evidence."], confidence: 0.9 }, "eligibility-new-002"), /Project context changed/);
});

test("uncertain eligibility becomes a durable selectable owner question", async () => {
  const root = await mkdtemp(join(tmpdir(), "pipeline-eligibility-unclear-"));
  const service = new ProjectLifecycleService(root);
  const projectId = "project_0123456789abcdef";
  const lifecycle = await service.begin({ projectId, mission: "Improve the product experience.", now: 1 });
  const result = await service.assess(projectId, { schemaVersion: 1, expectedRevision: lifecycle.revision, requestId: "request_abcdef01234567890123", projectKind: "unknown", affectedDomains: [], deliveryStages: [], estimatedDeveloperHours: 0, requiresArchitectureDecision: false, evidence: ["The requested scope is not specific enough."], confidence: 0.4 }, "eligibility-unclear-001");
  assert.equal(result.lifecycle.stage, "clarification");
  assert.equal(result.lifecycle.questions.length, 1);
  assert.deepEqual(result.lifecycle.questions[0]?.options.map((option) => option.id), ["new_product", "major_feature", "small_change"]);
  assert.equal(result.lifecycle.questions[0]?.allowsCustomAnswer, false);
  const resolved = await service.answer(projectId, { schemaVersion: 1, expectedRevision: result.lifecycle.revision, answers: [{ questionId: result.lifecycle.questions[0]!.id, optionId: "major_feature", customAnswer: null, answeredAt: 6 }] }, "eligibility-answer-001");
  assert.equal(resolved.stage, "solution_design");
  assert.equal(resolved.assessment?.classification, "major_feature");
  assert.equal((await service.eligibility(projectId))?.eligible, true);
});

test("owner eligibility override is revision-bound, request-bound, durable, and idempotent", async () => {
  const root = await mkdtemp(join(tmpdir(), "pipeline-eligibility-override-"));
  const service = new ProjectLifecycleService(root);
  const projectId = "project_0123456789abcdef";
  const begun = await service.begin({ projectId, mission: "Improve the experience.", now: 1 });
  const assessed = await service.assess(projectId, { schemaVersion: 1, expectedRevision: begun.revision, requestId: "request_abcdef01234567890123", projectKind: "unknown", affectedDomains: [], deliveryStages: [], estimatedDeveloperHours: 0, requiresArchitectureDecision: false, evidence: ["Scope is ambiguous."], confidence: 0.4 }, "eligibility-override-assess-001");
  await assert.rejects(() => service.override(projectId, { schemaVersion: 1, expectedRevision: begun.revision, requestId: assessed.decision.requestId, rationale: "Owner confirms this is a major launch capability." }, "eligibility-override-stale-001"), /scope changed/i);
  await assert.rejects(() => service.override(projectId, { schemaVersion: 1, expectedRevision: assessed.lifecycle.revision, requestId: "request_0123456789abcdef0123", rationale: "Owner confirms this is a major launch capability." }, "eligibility-override-wrong-request-001"), /superseded/i);
  const input = { schemaVersion: 1 as const, expectedRevision: assessed.lifecycle.revision, requestId: assessed.decision.requestId, rationale: "Owner confirms this belongs to the approved major launch capability." };
  const overridden = await service.override(projectId, input, "eligibility-override-valid-001");
  const replay = await service.override(projectId, input, "eligibility-override-valid-001");
  assert.equal(overridden.lifecycle.stage, "solution_design");
  assert.equal(overridden.decision.override?.authorizedBy, "owner");
  assert.equal(overridden.decision.assessment.classification, "major_feature");
  assert.deepEqual(replay, overridden);
  assert.deepEqual(await new ProjectLifecycleService(root).eligibility(projectId), overridden.decision);
});

test("direct planning publication cannot bypass missing or rejected eligibility", async () => {
  const root = await mkdtemp(join(tmpdir(), "pipeline-eligibility-direct-gate-"));
  const service = new ProjectLifecycleService(root);
  const projectId = "project_0123456789abcdef";
  await service.begin({ projectId, mission: "Change one label.", now: 1 });
  const solution = { kind: "solution" as const, projectRelativePath: ".pipeline/SOLUTION.md" as const, digest: "b".repeat(64), revision: 1, createdAt: 3, citations: ["local://CONTEXT.md"], reviewerIds: ["product-reviewer", "technical-reviewer"], qaPassed: true as const };
  await assert.rejects(() => service.publishSolution(projectId, solution), /eligibility/i);
  const current = await service.get(projectId);
  const rejected = await service.assess(projectId, { schemaVersion: 1, expectedRevision: current!.revision, requestId: "request_0123456789abcdef0123", projectKind: "existing_product", affectedDomains: ["frontend"], deliveryStages: ["frontend"], estimatedDeveloperHours: 1, requiresArchitectureDecision: false, evidence: ["One isolated label change."], confidence: 1 }, "eligibility-direct-reject-001");
  assert.equal(rejected.lifecycle.stage, "cancelled");
  await assert.rejects(() => service.publishSolution(projectId, solution), /blocked|eligibility|major-work/i);
});

test("solution decisions are digest-bound, revision-bound, and idempotent", async () => {
  const root = await mkdtemp(join(tmpdir(), "pipeline-solution-decision-"));
  const service = new ProjectLifecycleService(root);
  const projectId = "project_0123456789abcdef";
  const context = await service.begin({ projectId, mission: "Build a complete product.", now: 1 });
  const eligible = await service.assess(projectId, { schemaVersion: 1, expectedRevision: context.revision, requestId: "request_0123456789abcdef0123", projectKind: "new_product", affectedDomains: ["frontend", "backend"], deliveryStages: ["product", "frontend", "backend", "qa"], estimatedDeveloperHours: 80, requiresArchitectureDecision: true, evidence: ["A complete product is requested."], confidence: 0.95 }, "solution-eligibility-001");
  const artifact = { kind: "solution" as const, projectRelativePath: ".pipeline/SOLUTION.md" as const, digest: "b".repeat(64), revision: 1, createdAt: 3, citations: ["local://CONTEXT.md"], reviewerIds: ["product-reviewer", "technical-reviewer"], qaPassed: true as const };
  const awaiting = await service.publishSolution(projectId, artifact);
  assert.equal(awaiting.stage, "awaiting_design_approval");
  await assert.rejects(() => service.decideSolution(projectId, { schemaVersion: 1, expectedRevision: eligible.lifecycle.revision, artifactDigest: artifact.digest, decision: "approved", feedback: null }, "solution-stale-001"), /solution changed/i);
  const revised = await service.decideSolution(projectId, { schemaVersion: 1, expectedRevision: awaiting.revision, artifactDigest: artifact.digest, decision: "revision_requested", feedback: "Clarify rollback and data migration boundaries." }, "solution-revise-001");
  const replay = await service.decideSolution(projectId, { schemaVersion: 1, expectedRevision: awaiting.revision, artifactDigest: artifact.digest, decision: "revision_requested", feedback: "Clarify rollback and data migration boundaries." }, "solution-revise-001");
  assert.deepEqual(replay, revised);
  assert.equal(revised.stage, "solution_design");
});

test("solution decision persistence failure leaves lifecycle approval unchanged", async () => {
  const root = await mkdtemp(join(tmpdir(), "pipeline-solution-atomic-"));
  const service = new ProjectLifecycleService(root);
  const projectId = "project_0123456789abcdef";
  const begun = await service.begin({ projectId, mission: "Build a complete product.", now: 1 });
  await service.assess(projectId, { schemaVersion: 1, expectedRevision: begun.revision, requestId: "request_0123456789abcdef0123", projectKind: "new_product", affectedDomains: ["frontend", "backend"], deliveryStages: ["product", "frontend", "backend", "qa"], estimatedDeveloperHours: 80, requiresArchitectureDecision: true, evidence: ["A complete product is requested."], confidence: 0.95 }, "atomic-eligibility-001");
  const solution = { kind: "solution" as const, projectRelativePath: ".pipeline/SOLUTION.md" as const, digest: "b".repeat(64), revision: 1, createdAt: 3, citations: ["local://CONTEXT.md"], reviewerIds: ["product-reviewer", "technical-reviewer"], qaPassed: true as const };
  const awaiting = await service.publishSolution(projectId, solution);
  await assert.rejects(() => service.decideSolution(projectId, { schemaVersion: 1, expectedRevision: awaiting.revision, artifactDigest: solution.digest, decision: "approved", feedback: null }, "atomic-approval-001", async () => { throw new Error("injected artifact failure"); }), /injected artifact failure/);
  const unchanged = await service.get(projectId);
  assert.equal(unchanged?.stage, "awaiting_design_approval");
  assert.equal(unchanged?.designApproval, null);
});

test("declined solution reaches a terminal state and cannot create delivery work", async () => {
  const root = await mkdtemp(join(tmpdir(), "pipeline-solution-decline-"));
  const service = new ProjectLifecycleService(root);
  const projectId = "project_0123456789abcdef";
  const begun = await service.begin({ projectId, mission: "Build a complete product.", now: 1 });
  await service.assess(projectId, { schemaVersion: 1, expectedRevision: begun.revision, requestId: "request_0123456789abcdef0123", projectKind: "new_product", affectedDomains: ["frontend", "backend"], deliveryStages: ["product", "frontend", "backend", "qa"], estimatedDeveloperHours: 80, requiresArchitectureDecision: true, evidence: ["A complete product is requested."], confidence: 0.95 }, "decline-eligibility-001");
  const solution = { kind: "solution" as const, projectRelativePath: ".pipeline/SOLUTION.md" as const, digest: "b".repeat(64), revision: 1, createdAt: 3, citations: ["local://CONTEXT.md"], reviewerIds: ["product-reviewer", "technical-reviewer"], qaPassed: true as const };
  const awaiting = await service.publishSolution(projectId, solution);
  const declined = await service.decideSolution(projectId, { schemaVersion: 1, expectedRevision: awaiting.revision, artifactDigest: solution.digest, decision: "declined", feedback: null }, "decline-solution-001");
  assert.equal(declined.stage, "cancelled");
  const backlog = { kind: "backlog" as const, projectRelativePath: ".pipeline/BACKLOG.md" as const, digest: "c".repeat(64), revision: 1, createdAt: 4, citations: ["local://SOLUTION.md"], reviewerIds: ["delivery-reviewer", "technical-reviewer"], qaPassed: true as const };
  await assert.rejects(() => service.publishBacklog(projectId, backlog), /cancelled|backlog/i);
  assert.equal((await service.get(projectId))?.artifacts.some((artifact) => artifact.kind === "backlog"), false);
});

test("delivery completion is durable and idempotent", async () => {
  const root = await mkdtemp(join(tmpdir(), "pipeline-delivery-complete-"));
  const service = new ProjectLifecycleService(root);
  const projectId = "project_0123456789abcdef";
  const begun = await service.begin({ projectId, mission: "Build a complete product.", now: 1 });
  const eligible = await service.assess(projectId, { schemaVersion: 1, expectedRevision: begun.revision, requestId: "request_0123456789abcdef0123", projectKind: "new_product", affectedDomains: ["frontend", "backend"], deliveryStages: ["product", "frontend", "backend", "qa"], estimatedDeveloperHours: 80, requiresArchitectureDecision: true, evidence: ["A complete product is requested."], confidence: 0.95 }, "delivery-eligibility-001");
  const solution = { kind: "solution" as const, projectRelativePath: ".pipeline/SOLUTION.md" as const, digest: "b".repeat(64), revision: 1, createdAt: 3, citations: ["local://CONTEXT.md"], reviewerIds: ["product-reviewer", "technical-reviewer"], qaPassed: true as const };
  const awaiting = await service.publishSolution(projectId, solution);
  await service.decideSolution(projectId, { schemaVersion: 1, expectedRevision: awaiting.revision, artifactDigest: solution.digest, decision: "approved", feedback: null }, "delivery-approve-001");
  const backlog = { kind: "backlog" as const, projectRelativePath: ".pipeline/BACKLOG.md" as const, digest: "c".repeat(64), revision: 1, createdAt: 4, citations: ["local://SOLUTION.md"], reviewerIds: ["delivery-reviewer", "technical-reviewer"], qaPassed: true as const };
  await service.publishBacklog(projectId, backlog);
  const activated = await service.activateDelivery(projectId, backlog.digest, "PIPE-1");
  const activationReplay = await new ProjectLifecycleService(root).activateDelivery(projectId, backlog.digest, "PIPE-1");
  assert.deepEqual(activationReplay, activated);
  await assert.rejects(() => service.activateDelivery(projectId, "d".repeat(64), "PIPE-1"), /evidence changed/i);
  await assert.rejects(() => service.activateDelivery(projectId, backlog.digest, "PIPE-2"), /evidence changed/i);
  const completed = await service.completeDelivery(projectId);
  const replay = await service.completeDelivery(projectId);
  assert.equal(completed.stage, "complete");
  assert.deepEqual(replay, completed);
  assert.equal((await new ProjectLifecycleService(root).get(projectId))?.stage, "complete");
  assert.equal(eligible.decision.eligible, true);
});

test("terminal projects reopen only through an explicit revision-bound request", async () => {
  const root = await mkdtemp(join(tmpdir(), "pipeline-explicit-reopen-"));
  const service = new ProjectLifecycleService(root);
  const projectId = "project_0123456789abcdef";
  const begun = await service.begin({ projectId, mission: "Build a complete product.", now: 1 });
  const cancelled = await service.assess(projectId, { schemaVersion: 1, expectedRevision: begun.revision, requestId: "request_0123456789abcdef0123", projectKind: "existing_product", affectedDomains: [], deliveryStages: ["frontend"], estimatedDeveloperHours: 1, requiresArchitectureDecision: false, evidence: ["A small isolated change."], confidence: 1 }, "cancel-small-001");
  assert.equal(cancelled.lifecycle.stage, "cancelled");
  await assert.rejects(() => service.reopen(projectId, { schemaVersion: 1, expectedRevision: begun.revision, mission: "Build a larger product capability.", reason: "Owner expanded the outcome." }, "reopen-stale-001"), /project changed/i);
  const request = { schemaVersion: 1 as const, expectedRevision: cancelled.lifecycle.revision, mission: "Build a larger product capability.", reason: "Owner explicitly expanded the outcome." };
  const reopened = await service.reopen(projectId, request, "reopen-valid-001");
  const replay = await service.reopen(projectId, request, "reopen-valid-001");
  assert.equal(reopened.stage, "context_review");
  assert.equal(reopened.assessment, null);
  assert.deepEqual(replay, reopened);
  await assert.rejects(() => service.reopen(projectId, { ...request, expectedRevision: reopened.revision }, "reopen-again-001"), /terminal project/);
});
