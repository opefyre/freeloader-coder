import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";

import { LocalProjectError, LocalProjectRegistry } from "../apps/core/src/local-project-registry.js";
import { projectResourceSelectionSchema } from "../packages/runtime/src/local-projects.js";

const exec = promisify(execFile);

test("project resource bindings are revisioned, restart-safe, and report removals", async () => {
  const root = await mkdtemp(join(process.cwd(), ".test-resource-bindings-"));
  const state = join(root, "state");
  const workspace = join(root, "projects", "sample", "workspace");
  try {
    await mkdir(state); await mkdir(workspace, { recursive: true });
    await writeFile(join(workspace, "README.md"), "# Resource binding proof\n", "utf8");
    await exec("git", ["init", "--initial-branch=main", workspace]);
    const registry = new LocalProjectRegistry(state);
    const project = await registry.register({ schemaVersion: 1, path: workspace });
    const selected = await registry.setResources(project.id, { schemaVersion: 1, expectedRevision: 0, resources: [
      { kind: "jira_project", connectionId: "jira-main", resourceId: "10000", label: "PIPE", url: null, role: "primary" },
      { kind: "github_repository", connectionId: "github-main", resourceId: "R1", label: "owner/repo", url: null, role: "primary" },
      { kind: "github_repository", connectionId: "github-main", resourceId: "R2", label: "owner/second", url: null, role: "additional" },
    ] });
    assert.equal(selected.resourceRevision, 1);
    assert.equal(selected.resourceChange?.addedBindingIds.length, 3);
    const restarted = new LocalProjectRegistry(state);
    assert.equal((await restarted.list()).projects[0]?.resources?.length, 3);
    await assert.rejects(() => restarted.setResources(project.id, { schemaVersion: 1, expectedRevision: 0, resources: [] }),
      (error: unknown) => error instanceof LocalProjectError && error.code === "conflict");
    const retained = selected.resources!.filter((resource) => resource.kind !== "github_repository" || resource.resourceId === "R1")
      .map(({ id: _id, selectedAt: _selectedAt, ...resource }) => resource);
    const changed = await restarted.setResources(project.id, { schemaVersion: 1, expectedRevision: 1, resources: retained });
    assert.equal(changed.resourceRevision, 2);
    assert.equal(changed.resourceChange?.removedBindingIds.length, 1);
    assert.equal(changed.resources?.some((resource) => resource.resourceId === "R2"), false);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("project binding contract allows one Jira project, multiple repositories, and no duplicates", () => {
  const base = { schemaVersion: 1 as const, expectedRevision: 0 };
  const resource = { connectionId: "connection", url: null, role: "primary" as const };
  assert.equal(projectResourceSelectionSchema.safeParse({ ...base, resources: [
    { ...resource, kind: "jira_project", resourceId: "J1", label: "PIPE" },
    { ...resource, kind: "github_repository", resourceId: "R1", label: "owner/one" },
    { ...resource, kind: "github_repository", resourceId: "R2", label: "owner/two", role: "additional" },
  ] }).success, true);
  assert.match(projectResourceSelectionSchema.safeParse({ ...base, resources: [
    { ...resource, kind: "jira_project", resourceId: "J1", label: "PIPE" },
    { ...resource, kind: "jira_project", resourceId: "J2", label: "OTHER" },
  ] }).error?.message ?? "", /only one Jira project/);
  assert.match(projectResourceSelectionSchema.safeParse({ ...base, resources: [
    { ...resource, kind: "github_repository", resourceId: "R1", label: "owner/one" },
    { ...resource, kind: "github_repository", resourceId: "R1", label: "owner/one" },
  ] }).error?.message ?? "", /only once/);
});
