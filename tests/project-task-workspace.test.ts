import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";

import { ProjectTaskWorkspaceError, ProjectTaskWorkspaceService } from "../apps/core/src/project-task-workspace.js";
import type { ExecutionTask } from "../packages/orchestration/src/project-execution.js";

const run = promisify(execFile);

test("isolated workspace enforces authority, validates, commits, and fast-forward integrates", async () => {
  const root = await mkdtemp(join(tmpdir(), "project-task-workspace-"));
  const repository = join(root, "repo");
  try {
    await mkdir(join(repository, "src"), { recursive: true });
    await mkdir(join(repository, "tests"), { recursive: true });
    await writeFile(join(repository, "src", "feature.js"), "export const value = 1;\n");
    await writeFile(join(repository, "package.json"), JSON.stringify({ scripts: { typecheck: "node -e \"process.exit(0)\"", test: "node -e \"process.exit(0)\"" } }));
    await git(repository, ["init", "-b", "main"]);
    await git(repository, ["add", "."]);
    await git(repository, ["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "initial"]);
    const service = new ProjectTaskWorkspaceService(join(root, "state"));
    const workspace = await service.prepare("project_abcdef0123456789", repository, task());
    const sources = await service.sources(workspace, task());
    const before = sources.find((source) => source.path === "src/feature.js")!;
    const applied = await service.apply(workspace, task(), [
      { type: "replace", path: "src/feature.js", expectedBeforeDigest: before.digest, content: "export const value = 2;\n" },
      { type: "create", path: "tests/feature.test.js", expectedBeforeDigest: null, content: "export const verified = true;\n" },
    ]);
    assert.deepEqual(applied.changedFiles, ["src/feature.js", "tests/feature.test.js"]);
    assert.equal((await service.validate(workspace.root, task())).every((item) => item.passed), true);
    const committed = await service.commit(workspace, task());
    assert.match(committed.commitDigest, /^[a-f0-9]{40,64}$/);
    const integrated = await service.integrate(repository, workspace, committed.commitDigest);
    assert.match(integrated.integrationDigest, /^[a-f0-9]{64}$/);
    assert.equal(await readFile(join(repository, "src", "feature.js"), "utf8"), "export const value = 2;\n");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("isolated workspace rejects unauthorized paths and stale replacement evidence", async () => {
  const root = await mkdtemp(join(tmpdir(), "project-task-denial-"));
  const repository = join(root, "repo");
  try {
    await mkdir(join(repository, "src"), { recursive: true });
    await writeFile(join(repository, "src", "feature.js"), "safe\n");
    await writeFile(join(repository, "package.json"), JSON.stringify({ scripts: { typecheck: "node -e \"process.exit(0)\"", test: "node -e \"process.exit(0)\"" } }));
    await git(repository, ["init", "-b", "main"]); await git(repository, ["add", "."]); await git(repository, ["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "initial"]);
    const service = new ProjectTaskWorkspaceService(join(root, "state"));
    const workspace = await service.prepare("project_abcdef0123456789", repository, task());
    await assert.rejects(() => service.apply(workspace, task(), [{ type: "replace", path: "package.json", expectedBeforeDigest: "a".repeat(64), content: "{}" }]), (error: unknown) => error instanceof ProjectTaskWorkspaceError && error.code === "operation_denied");
    await assert.rejects(() => service.apply(workspace, task(), [{ type: "replace", path: "src/feature.js", expectedBeforeDigest: "a".repeat(64), content: "changed\n" }]), (error: unknown) => error instanceof ProjectTaskWorkspaceError && error.code === "stale_source");
  } finally { await rm(root, { recursive: true, force: true }); }
});

function task(): ExecutionTask { return { id: "plan_1111111111111111", jiraIssueKey: "PIPE-1", title: "Implement bounded feature", dependsOn: [], allowedFiles: ["src/feature.js", "tests/feature.test.js"], validationProfiles: ["typecheck", "unit"], uiChanged: false, requiredCapabilities: ["chat", "structured_output"], privacyClass: "source_code", status: "queued", revision: 0, attempt: 0, assignment: null, lease: null, implementationEvidence: [], validations: [], reviews: [], commitDigest: null, integrationDigest: null, failureClass: null, safeMessage: "Queued.", updatedAt: 1 }; }
async function git(cwd: string, args: readonly string[]) { await run("git", [...args], { cwd }); }
