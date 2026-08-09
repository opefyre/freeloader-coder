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
  await assert.rejects(() => service.answer(projectId, { ...request, expectedRevision: begun.revision }, "answer-stale-1"), /Questions changed/);
  const answered = await service.answer(projectId, request, "answer-valid-1");
  const replay = await service.answer(projectId, request, "answer-valid-1");
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
});
