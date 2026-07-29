import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import {
  LocalExecutionError,
  compileExecutionManifest,
  inspectGitRepository,
  prepareIsolatedWorktree,
  preserveWorkspace,
} from "../apps/core/src/local-execution.js";
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
