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
