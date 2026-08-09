import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import { LocalProjectRegistry } from "../apps/core/src/local-project-registry.js";
import { ProjectSolutionService } from "../apps/core/src/project-solution-service.js";

const draft = {
  schemaVersion: 1 as const, revision: 1, title: "Team operations product", summary: "A complete local-first product for planning and coordinating team operations.",
  behavior: ["Owners create projects and approve material plans."], architecture: ["A local control plane coordinates durable project lifecycles."],
  userExperience: ["Build remains conversation-first with picker-based resources."], data: ["Project state is versioned, private, and restart-safe."],
  integrations: ["Jira and GitHub are selected per project from app-level connections."], security: ["Credentials remain in the operating-system vault."],
  privacy: ["Personal paths and secrets never enter browser responses."], reliability: ["Idempotent transitions and atomic writes preserve recoverability."],
  rollout: ["Ship behind an owner-only local MVP gate before wider use."], metrics: ["Measure verified completion, recovery, and owner interruption rates."],
  citations: ["local://CONTEXT.md", "https://example.com/primary-source"],
  reviews: [{ reviewerId: "product-reviewer", discipline: "product" as const, verdict: "pass" as const, findings: ["Product scope is coherent."] }, { reviewerId: "technical-reviewer", discipline: "technical" as const, verdict: "pass" as const, findings: ["Architecture boundaries are implementable."] }],
};

test("solution publication is complete, cited, independently reviewed, atomic, and revisioned", async () => {
  const root = join(process.cwd(), `.test-solution-${crypto.randomUUID()}`);
  const workspace = join(root, "product");
  try {
    await mkdir(join(workspace, ".git"), { recursive: true });
    await writeFile(join(workspace, ".git", "HEAD"), "ref: refs/heads/main\n", "utf8");
    await writeFile(join(workspace, "README.md"), "# Product\n", "utf8");
    const registry = new LocalProjectRegistry(join(root, "state"));
    const project = await registry.register({ schemaVersion: 1, path: workspace });
    const service = new ProjectSolutionService(registry);
    const first = await service.publish(project.id, draft, 10);
    const content = await readFile(join(workspace, ".pipeline", "SOLUTION.md"), "utf8");
    for (const heading of ["Product behavior", "Architecture", "User experience", "Data", "Integrations", "Security", "Privacy", "Reliability", "Rollout", "Success metrics", "Sources", "Independent review"]) assert.match(content, new RegExp(`## ${heading}`));
    assert.match(content, new RegExp(`solution-revision:1;digest:${first.digest}`));
    assert.deepEqual(first.reviewerIds, ["product-reviewer", "technical-reviewer"]);
    await assert.rejects(() => service.publish(project.id, draft), /revision must be 2/);
    const second = await service.publish(project.id, { ...draft, revision: 2, summary: `${draft.summary} The revision includes owner feedback.` }, 20);
    assert.equal(second.revision, 2);
    const secondContent = await readFile(join(workspace, ".pipeline", "SOLUTION.md"), "utf8");
    await writeFile(join(workspace, ".pipeline", "SOLUTION.md"), secondContent.replace("owner feedback", "unverified mutation"), { encoding: "utf8", mode: 0o600 });
    await assert.rejects(() => service.read(project.id), /digest does not match/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("solution publication fails closed without independent passing reviews", async () => {
  const root = join(process.cwd(), `.test-solution-invalid-${crypto.randomUUID()}`);
  const workspace = join(root, "product");
  try {
    await mkdir(join(workspace, ".git"), { recursive: true });
    await writeFile(join(workspace, ".git", "HEAD"), "ref: refs/heads/main\n", "utf8");
    await writeFile(join(workspace, "README.md"), "# Product\n", "utf8");
    const registry = new LocalProjectRegistry(join(root, "state"));
    const project = await registry.register({ schemaVersion: 1, path: workspace });
    const service = new ProjectSolutionService(registry);
    await assert.rejects(() => service.publish(project.id, { ...draft, reviews: [draft.reviews[0], { ...draft.reviews[1], reviewerId: "product-reviewer" }] }), /independent product and technical reviews/);
    await assert.rejects(() => readFile(join(workspace, ".pipeline", "SOLUTION.md"), "utf8"));
  } finally { await rm(root, { recursive: true, force: true }); }
});
