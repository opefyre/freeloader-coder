import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { access, chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import {
  LocalExecutionError,
  compileExecutionManifest,
  inspectGitRepository,
  locateIsolatedWorktree,
  prepareIsolatedWorktree,
  preserveWorkspace,
} from "../apps/core/src/local-execution.js";
import {
  observeBoundedChanges,
  runBoundedValidation,
} from "../apps/core/src/local-validation.js";
import {
  applyReplacement,
  LocalPatchError,
  previewReplacement,
  rollbackReplacement,
} from "../apps/core/src/local-patch.js";
import {
  createIsolatedCommit,
  previewIsolatedCommit,
  undoIsolatedCommit,
} from "../apps/core/src/local-commit.js";
import {
  localDraftPlanSchema,
  localExecutionAuthoritySchema,
} from "../packages/runtime/src/local-requests.js";

const runFile = promisify(execFile);

test("clean Git preflight and isolated worktree preserve the canonical worktree", async () => {
  const root = await mkdtemp(join(tmpdir(), "pipeline-execution-"));
  const repository = join(root, "repository");
  const state = join(root, "state");
  try {
    await git(root, ["init", repository]);
    await git(repository, ["config", "user.email", "pipeline@example.invalid"]);
    await git(repository, ["config", "user.name", "Pipeline Test"]);
    await writeFile(join(repository, "README.md"), "# Test\n", "utf8");
    await git(repository, ["add", "README.md"]);
    await git(repository, ["commit", "-m", "baseline"]);
    const beforeHead = (await git(repository, ["rev-parse", "HEAD"])).trim();
    const beforeStatus = await git(repository, ["status", "--porcelain=v1", "-z"]);

    const preflight = await inspectGitRepository(repository);
    assert.equal(preflight.baseline, beforeHead);
    assert.equal(preflight.clean, true);
    assert.equal(preflight.repositoryRootMatched, true);
    assert.doesNotMatch(JSON.stringify(preflight), new RegExp(repository));

    const plan = localDraftPlanSchema.parse({
      schemaVersion: 1,
      provenance: "deterministic_local_plan",
      digest: "a".repeat(64),
      groundingDigest: "b".repeat(64),
      topologyDigest: "c".repeat(64),
      revision: 1,
      state: "approved",
      order: ["task_0123456789ab"],
      approval: {
        digest: "d".repeat(64),
        revision: 1,
        approvedAt: 1,
        policy: "zero_effect",
        executionAuthorized: false,
      },
      tasks: [{
        id: "task_0123456789ab",
        title: "Update the test readme",
        outcome: "Update the test readme.",
        scope: ["Use the existing file."],
        allowedFiles: ["README.md"],
        citedSources: ["README.md"],
        dependsOn: [],
        acceptanceCriteria: ["README remains valid."],
        exclusions: ["No publication."],
        checks: ["Review the diff"],
        risk: "low",
        estimatedMinutes: 10,
      }],
    });
    const manifest = compileExecutionManifest(plan, preflight.baseline);
    assert.deepEqual(manifest.allowedEffects, ["create_isolated_worktree"]);
    assert.equal(manifest.maximumCostUsd, 0);
    const authority = localExecutionAuthoritySchema.parse({
      schemaVersion: 1,
      id: `authority_${"e".repeat(20)}`,
      digest: "e".repeat(64),
      requestId: "request_0123456789abcdef0123",
      projectId: "project_0123456789abcdef",
      planDigest: plan.digest,
      planRevision: plan.revision,
      planApprovalDigest: plan.approval?.digest,
      groundingDigest: plan.groundingDigest,
      topologyDigest: plan.topologyDigest,
      preflight,
      manifest,
      isolationProfile: "native_bounded_worktree",
      maximumCostUsd: 0,
      authorizedAt: Date.now(),
      expiresAt: Date.now() + 60_000,
    });
    const workspace = await prepareIsolatedWorktree({
      stateDirectory: state,
      canonicalRoot: repository,
      requestId: authority.requestId,
      authority,
    });
    assert.equal(workspace.baseline, beforeHead);
    assert.equal(workspace.state, "ready");
    assert.match(workspace.branch, /^studio\/request-/);
    assert.deepEqual(
      await prepareIsolatedWorktree({
        stateDirectory: state,
        canonicalRoot: repository,
        requestId: authority.requestId,
        authority,
      }),
      workspace
    );
    const workspacePath = locateIsolatedWorktree({
      stateDirectory: state,
      requestId: authority.requestId,
      authority,
    });
    const cleanAttempt = await runBoundedValidation({
      workspacePath,
      authority,
      attemptId: `attempt_${"1".repeat(20)}`,
    });
    assert.equal(cleanAttempt.state, "passed");
    assert.deepEqual(cleanAttempt.command.arguments, ["diff", "--check"]);
    assert.equal(cleanAttempt.outputDigest.length, 64);
    const patchRun = {
      schemaVersion: 1 as const,
      id: `execution_${"2".repeat(20)}`,
      digest: "2".repeat(64),
      state: "ready" as const,
      authorityDigest: authority.digest,
      manifestDigest: authority.manifest.digest,
      workspaceRef: workspace.workspaceRef,
      baseline: workspace.baseline,
      maximumCostUsd: 0 as const,
      startedAt: Date.now(),
      completedAt: null,
      attempts: [],
      changes: null,
    };
    const preview = await previewReplacement({
      workspacePath,
      authority,
      run: patchRun,
      path: "README.md",
      expectedBeforeDigest: sha256("# Test\n"),
      replacementContent: "# Isolated change\n",
    });
    assert.equal(preview.beforeBytes, 7);
    assert.equal(preview.afterDigest, sha256("# Isolated change\n"));
    assert.equal(await readFile(join(workspacePath, "README.md"), "utf8"), "# Test\n");
    const receipt = await applyReplacement({
      workspacePath,
      canonicalRoot: repository,
      recoveryDirectory: join(state, "recovery"),
      authority,
      preview,
    });
    assert.equal(receipt.observedDigest, preview.afterDigest);
    const changes = await observeBoundedChanges({
      workspacePath,
      canonicalRoot: repository,
      authority,
    });
    assert.equal(changes.allowed, true);
    assert.deepEqual(changes.changedPaths, [{ path: "README.md", state: "modified" }]);
    assert.doesNotMatch(JSON.stringify(changes), new RegExp(repository));
    const passedRun = {
      ...patchRun,
      state: "passed" as const,
      completedAt: Date.now(),
      changes,
    };
    const commitPreview = await previewIsolatedCommit({
      workspacePath,
      canonicalRoot: repository,
      authority,
      run: passedRun,
      patchReceipt: receipt,
      message: "Update the isolated readme",
    });
    assert.deepEqual(commitPreview.changedPaths, ["README.md"]);
    assert.equal(commitPreview.hooksDisabled, true);
    const hookMarker = join(root, "hook-ran");
    const hookDirectory = join(repository, ".git", "hooks");
    await mkdir(hookDirectory, { recursive: true });
    const hookPath = join(hookDirectory, "pre-commit");
    await writeFile(hookPath, `#!/bin/sh\ntouch '${hookMarker}'\nexit 1\n`, "utf8");
    await chmod(hookPath, 0o755);
    const commitReceipt = await createIsolatedCommit({
      workspacePath,
      canonicalRoot: repository,
      authority,
      preview: commitPreview,
    });
    assert.equal(commitReceipt.parentCommit, beforeHead);
    assert.equal(commitReceipt.pushed, false);
    await assert.rejects(() => access(hookMarker));
    assert.equal((await git(workspacePath, ["rev-parse", "HEAD"])).trim(), commitReceipt.commit);
    await undoIsolatedCommit({
      workspacePath,
      canonicalRoot: repository,
      receipt: commitReceipt,
    });
    assert.equal((await git(workspacePath, ["rev-parse", "HEAD"])).trim(), beforeHead);
    assert.equal(await readFile(join(workspacePath, "README.md"), "utf8"), "# Isolated change\n");
    await assert.rejects(
      () =>
        previewReplacement({
          workspacePath,
          authority,
          run: patchRun,
          path: "../README.md",
          expectedBeforeDigest: null,
          replacementContent: "escape",
        }),
      (error: unknown) => error instanceof LocalPatchError && error.code === "path_denied"
    );
    await writeFile(join(workspacePath, "README.md"), "# Changed after apply\n", "utf8");
    await assert.rejects(
      () =>
        rollbackReplacement({
          workspacePath,
          recoveryDirectory: join(state, "recovery"),
          authority,
          preview,
          receipt,
        }),
      (error: unknown) =>
        error instanceof LocalPatchError && error.code === "rollback_denied"
    );
    await writeFile(join(workspacePath, "README.md"), "# Isolated change\n", "utf8");
    await rollbackReplacement({
      workspacePath,
      recoveryDirectory: join(state, "recovery"),
      authority,
      preview,
      receipt,
    });
    assert.equal(await readFile(join(workspacePath, "README.md"), "utf8"), "# Test\n");
    await writeFile(join(workspacePath, "outside.txt"), "not approved\n", "utf8");
    const denied = await observeBoundedChanges({
      workspacePath,
      canonicalRoot: repository,
      authority,
    });
    assert.equal(denied.allowed, false);
    assert.match(denied.blockers[0] ?? "", /outside the approved manifest/);
    assert.equal((await git(repository, ["rev-parse", "HEAD"])).trim(), beforeHead);
    assert.equal(await git(repository, ["status", "--porcelain=v1", "-z"]), beforeStatus);
    assert.equal(preserveWorkspace(workspace, "preserved").state, "preserved");
    assert.equal(await readFile(join(repository, "README.md"), "utf8"), "# Test\n");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("preflight blocks dirty and nested repositories without changing them", async () => {
  const root = await mkdtemp(join(tmpdir(), "pipeline-execution-"));
  const repository = join(root, "repository");
  try {
    await git(root, ["init", repository]);
    await git(repository, ["config", "user.email", "pipeline@example.invalid"]);
    await git(repository, ["config", "user.name", "Pipeline Test"]);
    await writeFile(join(repository, "README.md"), "# Test\n", "utf8");
    await git(repository, ["add", "README.md"]);
    await git(repository, ["commit", "-m", "baseline"]);
    await writeFile(join(repository, "README.md"), "# Dirty\n", "utf8");
    await assert.rejects(
      () => inspectGitRepository(repository),
      (error: unknown) =>
        error instanceof LocalExecutionError && error.code === "repository_dirty"
    );
    await assert.rejects(
      () => inspectGitRepository(join(repository, "subdirectory")),
      /ENOENT/
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

async function git(cwd: string, args: readonly string[]): Promise<string> {
  const result = await runFile("git", [...args], {
    cwd,
    env: {
      PATH: process.env.PATH ?? "/usr/bin:/bin",
      HOME: process.env.HOME ?? "",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_TERMINAL_PROMPT: "0",
      LC_ALL: "C",
    },
  });
  return result.stdout;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
