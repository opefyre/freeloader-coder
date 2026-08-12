import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import { ProjectContextService } from "../apps/core/src/project-context-service.js";
import { ProjectIntakeCoordinator, classifyProjectKind, deriveScopeEvidence, parseProjectIntake } from "../apps/core/src/project-intake-coordinator.js";
import type { LocalProjectSnapshot } from "../packages/runtime/src/local-projects.js";
import { ProjectLifecycleService } from "../apps/core/src/project-lifecycle-service.js";
import { LocalProjectRegistry } from "../apps/core/src/local-project-registry.js";

test("new project intake verifies CONTEXT.md and reaches solution design without a hidden API step", async () => {
  const root = join(process.cwd(), `.test-intake-${crypto.randomUUID()}`);
  const state = join(root, "state");
  const workspace = join(root, "new-product");
  try {
    await mkdir(join(workspace, ".git"), { recursive: true });
    await writeFile(join(workspace, "README.md"), "# New product\n", "utf8");
    const projects = new LocalProjectRegistry(state);
    const project = await projects.register({ schemaVersion: 1, path: workspace });
    const lifecycles = new ProjectLifecycleService(state);
    const coordinator = new ProjectIntakeCoordinator(new ProjectContextService(projects), lifecycles);
    const context = await coordinator.generate(project.id, {
      schemaVersion: 1,
      outcome: "Design and build a complete team operations product.",
      requestId: "request_0123456789abcdef0123",
      projectKind: "new_product",
    });
    const lifecycle = await lifecycles.get(project.id);
    assert.equal(lifecycle?.stage, "solution_design");
    assert.equal(lifecycle?.assessment?.classification, "new_product");
    assert.equal(lifecycle?.artifacts[0]?.projectRelativePath, "CONTEXT.md");
    assert.equal(lifecycle?.artifacts[0]?.digest, context.digest);
    assert.equal(lifecycle?.artifacts[0]?.qaPassed, true);
    assert.deepEqual(lifecycle?.artifacts[0]?.reviewerIds, ["context-grounding", "context-integrity"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("vague existing-product intake asks a selectable scope question instead of guessing", async () => {
  const evidence = deriveScopeEvidence("Make it better", "existing_product");
  assert.equal(evidence.confidence < 0.75, true);
  assert.equal(evidence.estimatedDeveloperHours, 0);
  assert.throws(() => parseProjectIntake({ outcome: "Build a product", requestId: "bad", projectKind: "new_product" }), /request identity/);
});

test("workspace preflight classifies clear projects and asks when owner intent conflicts", () => {
  const snapshot = (overrides: Partial<LocalProjectSnapshot>): LocalProjectSnapshot => ({ schemaVersion: 1, id: "project_0123456789abcdef", displayName: "Example", workspaceLabel: "example", lifecycleStage: "intake", resources: [], latestUpdate: null, progress: null, state: "ready", observedAt: 1, validForMs: 60_000, facts: [
    { label: "Repository", value: "Git worktree observed", evidence: ".git directory" },
    { label: "Branch", value: "main", evidence: ".git/HEAD" },
    { label: "Languages", value: "None observed", evidence: "1 bounded entries" },
    { label: "Manifests", value: "None observed", evidence: "File names only" },
  ], inferences: [], decisions: [], warnings: [], ...overrides });
  assert.equal(classifyProjectKind(snapshot({}), "new_product").kind, "new_product");
  assert.equal(classifyProjectKind(snapshot({ facts: [
    { label: "Languages", value: "TypeScript", evidence: "10 bounded entries" },
    { label: "Manifests", value: "package.json", evidence: "File names only" },
  ] }), "existing_product").kind, "existing_product");
  const conflict = classifyProjectKind(snapshot({ facts: [{ label: "Languages", value: "TypeScript", evidence: "10 bounded entries" }] }), "new_product");
  assert.equal(conflict.kind, "unknown");
  assert.equal(conflict.confidence < 0.75, true);
  assert.equal(classifyProjectKind(snapshot({}), "existing_product").kind, "unknown");
  assert.equal(classifyProjectKind(snapshot({ resources: [{ id: "binding_0123456789abcdef", kind: "jira_project", connectionId: "jira", resourceId: "PIPE", label: "PIPE", url: null, role: "primary", selectedAt: 1 }] }), "existing_product").kind, "existing_product");
});
