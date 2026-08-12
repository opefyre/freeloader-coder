import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import { LocalProjectRegistry } from "../apps/core/src/local-project-registry.js";
import { ProjectContextService } from "../apps/core/src/project-context-service.js";
import { ProjectLifecycleService } from "../apps/core/src/project-lifecycle-service.js";
import type { OwnerQuestion } from "../packages/orchestration/src/project-lifecycle.js";

test("owner answer persists governed decisions and resumes the same project after restart", async () => {
  const root = join(process.cwd(), `.test-clarification-${crypto.randomUUID()}`);
  const state = join(root, "state");
  const workspace = join(root, "projects", "product");
  try {
    await mkdir(join(workspace, ".git"), { recursive: true });
    await writeFile(join(workspace, ".git", "HEAD"), "ref: refs/heads/main\n", "utf8");
    await writeFile(join(workspace, "README.md"), "# Product\n\nA product workspace.\n", "utf8");
    await writeFile(join(workspace, "package.json"), '{"scripts":{"test":"node --test"}}\n', "utf8");

    const projects = new LocalProjectRegistry(state);
    const project = await projects.register({ schemaVersion: 1, path: workspace });
    const contexts = new ProjectContextService(projects);
    const context = await contexts.generate(project.id, {
      schemaVersion: 1,
      outcome: "Build the complete product experience.",
    });
    const lifecycles = new ProjectLifecycleService(state);
    await lifecycles.begin({ projectId: project.id, mission: "Build the complete product experience." });
    const question: OwnerQuestion = {
      id: "question_abcdef0123456789",
      prompt: "Which launch access should Codkesh design?",
      whyItMatters: "Access changes product, design, and infrastructure decisions.",
      options: [
        { id: "private", label: "Private beta", consequence: "Only invited users can enter." },
        { id: "public", label: "Public launch", consequence: "Anyone can register." },
      ],
      allowsCustomAnswer: true,
      sourceFindingIds: ["launch-access"],
      affectedArtifacts: ["CONTEXT.md", "PRODUCT.md", "DESIGN.md", "INFRA.md"],
    };
    const pending = await lifecycles.publishQuestions({
      projectId: project.id,
      artifact: {
        kind: "context",
        projectRelativePath: "CONTEXT.md",
        digest: context.digest,
        revision: 1,
        createdAt: Date.now(),
        citations: ["local://README.md"],
        reviewerIds: ["context-reviewer"],
        qaPassed: true,
      },
      questions: [question],
    });

    const answered = await lifecycles.answer(
      project.id,
      {
        schemaVersion: 1,
        expectedRevision: pending.revision,
        answers: [{ questionId: question.id, optionId: "private", customAnswer: null, answeredAt: Date.now() }],
      },
      "journey-answer-001",
      (questions, answers) => contexts.applyClarifications(project.id, questions, answers).then(() => undefined),
    );
    assert.equal(answered.stage, "context_review");
    assert.match(await readFile(join(workspace, "CONTEXT.md"), "utf8"), /Private beta/);
    assert.match(await readFile(join(workspace, "DECISIONS.md"), "utf8"), /Supersedes: none/);

    const restarted = new ProjectLifecycleService(state);
    assert.deepEqual((await restarted.get(project.id))?.answers, answered.answers);
    assert.equal((await restarted.get(project.id))?.stage, "context_review");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
