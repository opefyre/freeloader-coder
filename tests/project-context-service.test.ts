import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import { LocalProjectRegistry } from "../apps/core/src/local-project-registry.js";
import { ProjectContextService } from "../apps/core/src/project-context-service.js";

test("context generation is cited, atomic, digest-bound, and preserves accepted decisions", async () => {
  const { root, state, workspace } = await createContextFixture();
  try {
    const projects = new LocalProjectRegistry(state);
    const project = await projects.register({ schemaVersion: 1, path: workspace });
    await projects.setResources(project.id, { schemaVersion: 1, resources: [{ kind: "github_repository", connectionId: "github-cli:test", resourceId: "R_1", label: "owner/sample-product", url: "https://github.com/owner/sample-product", role: "primary" }] });
    const service = new ProjectContextService(projects);
    const first = await service.generate(project.id, { schemaVersion: 1, outcome: "Design and build the complete product MVP" });
    const firstContent = await readFile(join(workspace, "CONTEXT.md"), "utf8");
    assert.match(firstContent, /## Facts/);
    assert.match(firstContent, /## Inferences/);
    assert.match(firstContent, /## Assumptions/);
    assert.match(firstContent, /## Unknowns/);
    assert.match(firstContent, /## Stack and infrastructure/);
    assert.match(firstContent, /## Features and workflows observed/);
    assert.match(firstContent, /## Conflicts/);
    assert.match(firstContent, /Validation and automation scripts: test/);
    assert.match(firstContent, /owner\/sample-product/);
    assert.match(firstContent, new RegExp(`context-digest:${first.digest}`));
    const edited = firstContent.replace("- None recorded yet.", "- Keep the product local-first.");
    await writeFile(join(workspace, "CONTEXT.md"), edited, { encoding: "utf8", mode: 0o600 });
    const refreshed = await service.generate(project.id, { schemaVersion: 1, outcome: "Design and build the complete product MVP" });
    const refreshedContent = await readFile(join(workspace, "CONTEXT.md"), "utf8");
    assert.match(refreshedContent, /Keep the product local-first/);
    assert.notEqual(refreshed.digest, first.digest);
    const clarified = await service.applyClarifications(project.id, [{
      id: "question_0123456789abcdef", prompt: "Who can sign up?", whyItMatters: "Identity changes.",
      options: [{ id: "invite", label: "Invite only", consequence: "Admins invite." }, { id: "public", label: "Public", consequence: "Anyone registers." }],
      allowsCustomAnswer: false, sourceFindingIds: ["identity"],
    }], [{ questionId: "question_0123456789abcdef", optionId: "invite", customAnswer: null, answeredAt: 20 }]);
    const clarifiedContent = await readFile(join(workspace, "CONTEXT.md"), "utf8");
    assert.match(clarifiedContent, /Who can sign up\? \*\*Invite only\*\*/);
    assert.match(clarifiedContent, new RegExp(`context-digest:${clarified.digest}`));
    const verified = await service.readVerified(project.id);
    assert.equal(verified.digest, clarified.digest);
    assert.doesNotMatch(verified.markdown, /context-digest:/);
    await service.applyClarifications(project.id, [], [{ questionId: "question_0123456789abcdef", optionId: "invite", customAnswer: null, answeredAt: 20 }]);
    assert.equal((await readFile(join(workspace, "CONTEXT.md"), "utf8")).match(/clarification:question_0123456789abcdef/g)?.length, 1);
    assert.equal(refreshed.citations.length > 0, true);
    assert.doesNotMatch(refreshedContent, /api[_-]?key|secret-value/i);
    const current = await readFile(join(workspace, "CONTEXT.md"), "utf8");
    await writeFile(join(workspace, "CONTEXT.md"), current.replace("Invite only", "Public"), { encoding: "utf8", mode: 0o600 });
    await assert.rejects(() => service.readVerified(project.id), /digest does not match/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("context generation rejects invalid input without creating an artifact", async () => {
  const { root, state, workspace } = await createContextFixture();
  try {
    const projects = new LocalProjectRegistry(state);
    const project = await projects.register({ schemaVersion: 1, path: workspace });
    const service = new ProjectContextService(projects);
    await assert.rejects(() => service.generate(project.id, { schemaVersion: 1, outcome: "" }));
    await assert.rejects(() => readFile(join(workspace, "CONTEXT.md"), "utf8"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

async function createContextFixture() {
  const root = join(process.cwd(), `.test-context-${crypto.randomUUID()}`);
  const state = join(root, "state");
  const workspace = join(root, "projects", "sample-product");
  await mkdir(join(workspace, ".git"), { recursive: true });
  await writeFile(join(workspace, ".git", "HEAD"), "ref: refs/heads/main\n", "utf8");
  await writeFile(join(workspace, "README.md"), "# Sample product\n\nA private product workspace.\n", "utf8");
  await writeFile(join(workspace, "package.json"), JSON.stringify({ packageManager: "npm@10.0.0", scripts: { test: "node --test" } }), "utf8");
  return { root, state, workspace };
}
