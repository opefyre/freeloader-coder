import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import { LocalProjectRegistry } from "../apps/core/src/local-project-registry.js";
import { ProjectArtifactStore } from "../apps/core/src/project-artifact-store.js";
import { ProjectContextService } from "../apps/core/src/project-context-service.js";

test("context generation is cited, atomic, digest-bound, and preserves accepted decisions", async () => {
  const { root, state, workspace } = await createContextFixture();
  try {
    const projects = new LocalProjectRegistry(state);
    const project = await projects.register({
      schemaVersion: 1,
      path: workspace,
    });
    const attachment = join(root, "brief.txt");
    await writeFile(
      attachment,
      "Family planning brief. api_key=secret-value\n",
      "utf8",
    );
    await projects.addFiles(project.id, {
      schemaVersion: 1,
      paths: [attachment],
    });
    await projects.setResources(project.id, {
      schemaVersion: 1,
      resources: [
        {
          kind: "github_repository",
          connectionId: "github-cli:test",
          resourceId: "R_1",
          label: "owner/sample-product",
          url: "https://github.com/owner/sample-product",
          role: "primary",
        },
      ],
    });
    const service = new ProjectContextService(projects);
    const first = await service.generate(project.id, {
      schemaVersion: 1,
      outcome: "Design and build the complete product MVP",
    });
    assert.equal(first.clarificationPlan.questions.length, 0);
    assert.ok(first.clarificationPlan.assumptions.length > 0);
    const firstContent = await readFile(join(workspace, "CONTEXT.md"), "utf8");
    assert.match(firstContent, /## Facts/);
    assert.match(firstContent, /## Inferences/);
    assert.match(firstContent, /## Assumptions/);
    assert.match(firstContent, /## Unknowns/);
    for (const heading of [
      "Project overview",
      "Product behavior",
      "Architecture and stack",
      "Services and data",
      "Integrations",
      "Infrastructure",
      "Workflows",
      "Constraints and unknowns",
      "Refresh metadata",
    ]) {
      assert.match(firstContent, new RegExp(`## ${heading}`));
    }
    assert.match(firstContent, /## Conflicts/);
    assert.match(firstContent, /Validation and automation scripts: test/);
    assert.match(firstContent, /owner\/sample-product/);
    assert.match(firstContent, /## Owner-provided evidence/);
    assert.match(firstContent, /Family planning brief/);
    assert.match(firstContent, /\[redacted credential\]/);
    assert.match(firstContent, /codkesh-artifact/);
    const firstStored = await new ProjectArtifactStore().read(
      workspace,
      "context",
    );
    assert.equal(firstStored.metadata.bodyDigest, first.digest);
    assert.equal(firstStored.metadata.confidence, "verified");
    assert.equal(
      firstStored.metadata.citations.some(
        (citation) =>
          citation.reference === "local://README.md" &&
          citation.state === "verified",
      ),
      true,
    );
    assert.equal(
      firstStored.metadata.citations.some((citation) =>
        citation.reference.startsWith(
          "https://github.com/owner/sample-product",
        ),
      ),
      true,
    );
    const artifacts = new ProjectArtifactStore();
    const firstArtifact = await artifacts.read(workspace, "context");
    await artifacts.write(workspace, {
      kind: "context",
      body: firstArtifact.body.replace(
        "- None recorded yet.",
        "- Keep the product local-first.",
      ),
      producer: "owner:local-edit",
      expectedDigest: firstArtifact.metadata.bodyDigest,
    });
    const refreshed = await service.generate(project.id, {
      schemaVersion: 1,
      outcome: "Design and build the complete product MVP",
    });
    const refreshedContent = await readFile(
      join(workspace, "CONTEXT.md"),
      "utf8",
    );
    assert.match(refreshedContent, /Keep the product local-first/);
    assert.notEqual(refreshed.digest, first.digest);
    const clarified = await service.applyClarifications(
      project.id,
      [
        {
          id: "question_0123456789abcdef",
          prompt: "Who can sign up?",
          whyItMatters: "Identity changes.",
          options: [
            {
              id: "invite",
              label: "Invite only",
              consequence: "Admins invite.",
            },
            { id: "public", label: "Public", consequence: "Anyone registers." },
          ],
          allowsCustomAnswer: false,
          sourceFindingIds: ["identity"],
        },
      ],
      [
        {
          questionId: "question_0123456789abcdef",
          optionId: "invite",
          customAnswer: null,
          answeredAt: 20,
        },
      ],
    );
    const clarifiedContent = await readFile(
      join(workspace, "CONTEXT.md"),
      "utf8",
    );
    assert.match(clarifiedContent, /Who can sign up\? \*\*Invite only\*\*/);
    const firstDecisions = await artifacts.read(workspace, "decisions");
    assert.match(firstDecisions.body, /Who can sign up\?/);
    assert.match(firstDecisions.body, /Answer: \*\*Invite only\*\*/);
    assert.match(firstDecisions.body, /Supersedes: none/);
    assert.equal(
      (await artifacts.read(workspace, "context")).metadata.bodyDigest,
      clarified.digest,
    );
    const verified = await service.readVerified(project.id);
    assert.equal(verified.digest, clarified.digest);
    assert.doesNotMatch(verified.markdown, /codkesh-artifact/);
    await service.applyClarifications(
      project.id,
      [],
      [
        {
          questionId: "question_0123456789abcdef",
          optionId: "invite",
          customAnswer: null,
          answeredAt: 20,
        },
      ],
    );
    assert.equal(
      (await readFile(join(workspace, "CONTEXT.md"), "utf8")).match(
        /clarification:question_0123456789abcdef/g,
      )?.length,
      1,
    );
    assert.equal(
      (await artifacts.read(workspace, "decisions")).body.match(
        /clarification-decision:question_0123456789abcdef/g,
      )?.length,
      1,
    );
    const designBeforeAnswerChange = await artifacts.read(workspace, "design");
    await artifacts.write(workspace, {
      kind: "design",
      body: designBeforeAnswerChange.body,
      producer: "owner:test",
      expectedDigest: designBeforeAnswerChange.metadata.bodyDigest,
      approvedDigest: designBeforeAnswerChange.metadata.bodyDigest,
      confidence: "verified",
    });
    await service.applyClarifications(
      project.id,
      [{
        id: "question_0123456789abcdef",
        prompt: "Who can sign up?",
        whyItMatters: "Identity changes.",
        options: [
          { id: "invite", label: "Invite only", consequence: "Admins invite." },
          { id: "public", label: "Public", consequence: "Anyone registers." },
        ],
        allowsCustomAnswer: false,
        sourceFindingIds: ["identity"],
        affectedArtifacts: ["CONTEXT.md", "DESIGN.md"],
      }],
      [{ questionId: "question_0123456789abcdef", optionId: "public", customAnswer: null, answeredAt: 21 }],
    );
    const revisedDecisions = await artifacts.read(workspace, "decisions");
    assert.equal(revisedDecisions.body.match(/clarification-decision:question_0123456789abcdef/g)?.length, 2);
    assert.match(revisedDecisions.body, /Supersedes: [a-f0-9]{16}/);
    assert.match((await artifacts.read(workspace, "context")).body, /Who can sign up\? \*\*Public\*\*/);
    const invalidatedDesign = await artifacts.read(workspace, "design");
    assert.equal(invalidatedDesign.metadata.approvedDigest, null);
    assert.equal(invalidatedDesign.metadata.confidence, "unknown");
    assert.equal(refreshed.citations.length > 0, true);
    assert.doesNotMatch(refreshedContent, /api[_-]?key|secret-value/i);
    const current = await readFile(join(workspace, "CONTEXT.md"), "utf8");
    await writeFile(
      join(workspace, "CONTEXT.md"),
      current.replace("**Public**", "**Private**"),
      { encoding: "utf8", mode: 0o600 },
    );
    await assert.rejects(
      () => service.readVerified(project.id),
      /changed outside its recorded revision/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("interrupted context refresh preserves the prior verified artifact and accepted decisions", async () => {
  const { root, state, workspace } = await createContextFixture();
  try {
    const projects = new LocalProjectRegistry(state);
    const project = await projects.register({
      schemaVersion: 1,
      path: workspace,
    });
    const healthy = new ProjectContextService(projects);
    await healthy.generate(project.id, {
      schemaVersion: 1,
      outcome: "Build the complete product",
    });
    await healthy.applyClarifications(
      project.id,
      [
        {
          id: "question_0123456789abcdef",
          prompt: "Which launch?",
          whyItMatters: "Scope.",
          options: [
            {
              id: "private",
              label: "Private beta",
              consequence: "Invite only.",
            },
            { id: "public", label: "Public", consequence: "Open launch." },
          ],
          allowsCustomAnswer: false,
          sourceFindingIds: ["launch"],
        },
      ],
      [
        {
          questionId: "question_0123456789abcdef",
          optionId: "private",
          customAnswer: null,
          answeredAt: 20,
        },
      ],
    );
    const before = await new ProjectArtifactStore().read(workspace, "context");
    const interrupted = new ProjectContextService(
      projects,
      new ProjectArtifactStore({ faultAt: "before_primary_rename" }),
    );
    await assert.rejects(
      () =>
        interrupted.generate(project.id, {
          schemaVersion: 1,
          outcome: "Build the changed product",
        }),
      /Injected artifact write interruption/,
    );
    const restarted = new ProjectArtifactStore();
    await restarted.initialize(workspace);
    const after = await restarted.read(workspace, "context");
    assert.equal(after.metadata.bodyDigest, before.metadata.bodyDigest);
    assert.match(after.body, /Private beta/);
    assert.doesNotMatch(after.body, /Build the changed product/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("context generation rejects invalid input without mutating the initialized artifact", async () => {
  const { root, state, workspace } = await createContextFixture();
  try {
    const projects = new LocalProjectRegistry(state);
    const project = await projects.register({
      schemaVersion: 1,
      path: workspace,
    });
    const service = new ProjectContextService(projects);
    const before = await new ProjectArtifactStore().read(workspace, "context");
    await assert.rejects(() =>
      service.generate(project.id, { schemaVersion: 1, outcome: "" }),
    );
    const after = await new ProjectArtifactStore().read(workspace, "context");
    assert.equal(after.metadata.revision, before.metadata.revision);
    assert.equal(after.metadata.bodyDigest, before.metadata.bodyDigest);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

async function createContextFixture() {
  const root = join(process.cwd(), `.test-context-${crypto.randomUUID()}`);
  const state = join(root, "state");
  const workspace = join(root, "projects", "sample-product");
  await mkdir(join(workspace, ".git"), { recursive: true });
  await writeFile(
    join(workspace, ".git", "HEAD"),
    "ref: refs/heads/main\n",
    "utf8",
  );
  await writeFile(
    join(workspace, "README.md"),
    "# Sample product\n\nA private product workspace.\n",
    "utf8",
  );
  await writeFile(
    join(workspace, "package.json"),
    JSON.stringify({
      packageManager: "npm@10.0.0",
      scripts: { test: "node --test" },
    }),
    "utf8",
  );
  return { root, state, workspace };
}
