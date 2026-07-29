import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import {
  applyChangeSet,
  LocalChangeSetError,
  previewChangeSet,
  reconcileChangeSet,
  rollbackChangeSet,
} from "../apps/core/src/local-change-set.js";
import { previewIsolatedCommit } from "../apps/core/src/local-commit.js";
import {
  compileExecutionManifest,
  inspectGitRepository,
  locateIsolatedWorktree,
  prepareIsolatedWorktree,
} from "../apps/core/src/local-execution.js";
import { observeBoundedChanges } from "../apps/core/src/local-validation.js";
import {
  localDraftPlanSchema,
  localExecutionAuthoritySchema,
  type LocalExecutionRun,
} from "../packages/runtime/src/local-requests.js";

const runFile = promisify(execFile);

test("atomic change sets create, replace, delete, commit-preview, reconcile, and roll back exactly", async () => {
  const root = await mkdtemp(join(tmpdir(), "pipeline-change-set-"));
  const repository = join(root, "repository");
  const stateDirectory = join(root, "state");
  try {
    await git(root, ["init", repository]);
    await git(repository, ["config", "user.email", "pipeline@example.invalid"]);
    await git(repository, ["config", "user.name", "Pipeline Test"]);
    await writeFile(join(repository, "README.md"), "before\n", "utf8");
    await writeFile(join(repository, "delete.txt"), "remove me\n", "utf8");
    await git(repository, ["add", "."]);
    await git(repository, ["commit", "-m", "baseline"]);
    const baseline = (await git(repository, ["rev-parse", "HEAD"])).trim();
    const plan = localDraftPlanSchema.parse({
      schemaVersion: 1,
      provenance: "deterministic_local_plan",
      digest: "a".repeat(64), groundingDigest: "b".repeat(64), topologyDigest: "c".repeat(64),
      revision: 1, state: "approved", order: ["task_0123456789ab"],
      approval: { digest: "d".repeat(64), revision: 1, approvedAt: 1, policy: "zero_effect", executionAuthorized: false },
      tasks: [{
        id: "task_0123456789ab", title: "Edit several files", outcome: "Apply one exact change set.",
        scope: ["Use approved paths."], allowedFiles: ["README.md", "created.txt", "delete.txt", "link.txt"],
        citedSources: ["README.md"], dependsOn: [], acceptanceCriteria: ["All states match."],
        exclusions: ["No publication."], checks: ["Review the diff"], risk: "low", estimatedMinutes: 10,
      }],
    });
    const preflight = await inspectGitRepository(repository);
    const manifest = compileExecutionManifest(plan, baseline);
    const authority = localExecutionAuthoritySchema.parse({
      schemaVersion: 1, id: `authority_${"e".repeat(20)}`, digest: "e".repeat(64),
      requestId: "request_0123456789abcdef0123", projectId: "project_0123456789abcdef",
      planDigest: plan.digest, planRevision: 1, planApprovalDigest: plan.approval?.digest,
      groundingDigest: plan.groundingDigest, topologyDigest: plan.topologyDigest,
      preflight, manifest, isolationProfile: "native_bounded_worktree", maximumCostUsd: 0,
      authorizedAt: Date.now(), expiresAt: Date.now() + 60_000,
    });
    const workspace = await prepareIsolatedWorktree({ stateDirectory, canonicalRoot: repository, requestId: authority.requestId, authority });
    const workspacePath = locateIsolatedWorktree({ stateDirectory, requestId: authority.requestId, authority });
    const run: LocalExecutionRun = {
      schemaVersion: 1, id: `execution_${"2".repeat(20)}`, digest: "2".repeat(64), state: "ready",
      authorityDigest: authority.digest, manifestDigest: authority.manifest.digest,
      workspaceRef: workspace.workspaceRef, baseline, maximumCostUsd: 0, startedAt: Date.now(),
      completedAt: null, attempts: [], changes: null,
    };
    const preview = await previewChangeSet({
      workspacePath, authority, run,
      operations: [
        { type: "delete", path: "delete.txt", expectedBeforeDigest: sha256("remove me\n"), content: null },
        { type: "create", path: "created.txt", expectedBeforeDigest: null, content: "new\n" },
        { type: "replace", path: "README.md", expectedBeforeDigest: sha256("before\n"), content: "after\n" },
      ],
    });
    assert.deepEqual(preview.changedPaths, ["created.txt", "delete.txt", "README.md"]);
    assert.equal(await reconcileChangeSet({ workspacePath, authority, preview }), "not_started");
    const recoveryDirectory = join(stateDirectory, "recovery");
    const receipt = await applyChangeSet({ workspacePath, canonicalRoot: repository, recoveryDirectory, authority, preview });
    assert.equal(await reconcileChangeSet({ workspacePath, authority, preview }), "applied");
    assert.equal(await readFile(join(workspacePath, "README.md"), "utf8"), "after\n");
    assert.equal(await readFile(join(workspacePath, "created.txt"), "utf8"), "new\n");
    await assert.rejects(() => readFile(join(workspacePath, "delete.txt")), /ENOENT/);
    assert.equal(await readFile(join(repository, "README.md"), "utf8"), "before\n");
    const changes = await observeBoundedChanges({ workspacePath, canonicalRoot: repository, authority });
    assert.equal(changes.allowed, true);
    assert.deepEqual(changes.changedPaths, [
      { path: "created.txt", state: "untracked" },
      { path: "delete.txt", state: "deleted" },
      { path: "README.md", state: "modified" },
    ]);
    const commitPreview = await previewIsolatedCommit({
      workspacePath, canonicalRoot: repository, authority,
      run: { ...run, state: "passed", changes, completedAt: Date.now() },
      changeSetReceipt: receipt, message: "Apply bounded multi-file update",
    });
    assert.deepEqual(commitPreview.changedPaths, ["created.txt", "delete.txt", "README.md"]);
    assert.equal(commitPreview.changeSetReceiptDigest, receipt.digest);
    await writeFile(join(workspacePath, "README.md"), "operator drift\n", "utf8");
    await assert.rejects(
      () => rollbackChangeSet({ workspacePath, recoveryDirectory, authority, preview, receipt }),
      (error: unknown) => error instanceof LocalChangeSetError && error.code === "rollback_denied"
    );
    assert.equal(await reconcileChangeSet({ workspacePath, authority, preview }), "mixed");
    await writeFile(join(workspacePath, "README.md"), "after\n", "utf8");
    await rollbackChangeSet({ workspacePath, recoveryDirectory, authority, preview, receipt });
    assert.equal(await reconcileChangeSet({ workspacePath, authority, preview }), "not_started");
    assert.equal(await readFile(join(workspacePath, "README.md"), "utf8"), "before\n");
    assert.equal(await readFile(join(workspacePath, "delete.txt"), "utf8"), "remove me\n");
    await assert.rejects(() => readFile(join(workspacePath, "created.txt")), /ENOENT/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("change sets reject duplicate, stale, symlink, and unapproved targets before writes", async () => {
  const root = await mkdtemp(join(tmpdir(), "pipeline-change-set-deny-"));
  const repository = join(root, "repository");
  try {
    await git(root, ["init", repository]);
    await writeFile(join(repository, "README.md"), "safe\n", "utf8");
    await git(repository, ["add", "."]); await git(repository, ["-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-m", "baseline"]);
    const baseline = (await git(repository, ["rev-parse", "HEAD"])).trim();
    const preflight = await inspectGitRepository(repository);
    const plan = localDraftPlanSchema.parse({
      schemaVersion: 1, provenance: "deterministic_local_plan", digest: "1".repeat(64),
      groundingDigest: "3".repeat(64), topologyDigest: "4".repeat(64), revision: 1,
      state: "approved", order: ["task_abcdef012345"],
      approval: { digest: "2".repeat(64), revision: 1, approvedAt: 1, policy: "zero_effect", executionAuthorized: false },
      tasks: [{ id: "task_abcdef012345", title: "Deny unsafe changes", outcome: "Remain bounded.",
        scope: ["Approved files only."], allowedFiles: ["README.md", "link.txt"], citedSources: ["README.md"],
        dependsOn: [], acceptanceCriteria: ["Unsafe operations fail."], exclusions: ["No external effects."],
        checks: ["Review diff"], risk: "low", estimatedMinutes: 10 }],
    });
    const manifest = compileExecutionManifest(plan, baseline);
    const authority = localExecutionAuthoritySchema.parse({
      schemaVersion: 1, id: `authority_${"f".repeat(20)}`, digest: "f".repeat(64), requestId: "request_abcdef0123456789abcd", projectId: "project_abcdef0123456789",
      planDigest: plan.digest, planRevision: 1, planApprovalDigest: plan.approval?.digest, groundingDigest: plan.groundingDigest, topologyDigest: plan.topologyDigest, preflight, manifest,
      isolationProfile: "native_bounded_worktree", maximumCostUsd: 0, authorizedAt: Date.now(), expiresAt: Date.now() + 60_000,
    });
    const run: LocalExecutionRun = { schemaVersion: 1, id: `execution_${"6".repeat(20)}`, digest: "6".repeat(64), state: "ready", authorityDigest: authority.digest, manifestDigest: authority.manifest.digest, workspaceRef: "workspace_ref_abcdef0123456789", baseline, maximumCostUsd: 0, startedAt: Date.now(), completedAt: null, attempts: [], changes: null };
    await assert.rejects(() => previewChangeSet({ workspacePath: repository, authority, run, operations: [
      { type: "replace", path: "README.md", expectedBeforeDigest: null, content: "one\n" },
      { type: "replace", path: "README.md", expectedBeforeDigest: null, content: "two\n" },
    ] }), (error: unknown) => error instanceof LocalChangeSetError && error.code === "duplicate_path");
    await assert.rejects(() => previewChangeSet({ workspacePath: repository, authority, run, operations: [
      { type: "replace", path: "README.md", expectedBeforeDigest: "0".repeat(64), content: "new\n" },
    ] }), (error: unknown) => error instanceof LocalChangeSetError && error.code === "stale_file");
    await symlink(join(root, "outside.txt"), join(repository, "link.txt"));
    await assert.rejects(() => previewChangeSet({ workspacePath: repository, authority, run, operations: [
      { type: "replace", path: "link.txt", expectedBeforeDigest: null, content: "escape\n" },
    ] }), (error: unknown) => error instanceof LocalChangeSetError && error.code === "target_unsupported");
    await assert.rejects(() => previewChangeSet({ workspacePath: repository, authority, run, operations: [
      { type: "create", path: "unapproved.txt", expectedBeforeDigest: null, content: "no\n" },
    ] }), (error: unknown) => error instanceof LocalChangeSetError && error.code === "path_denied");
    assert.equal(await readFile(join(repository, "README.md"), "utf8"), "safe\n");
  } finally { await rm(root, { recursive: true, force: true }); }
});

async function git(cwd: string, args: readonly string[]): Promise<string> {
  const result = await runFile("git", [...args], { cwd, env: { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: process.env.HOME ?? "", GIT_CONFIG_NOSYSTEM: "1", GIT_TERMINAL_PROMPT: "0", LC_ALL: "C" } });
  return result.stdout;
}

function sha256(value: string): string { return createHash("sha256").update(value).digest("hex"); }
