import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import {
  localIntegrationPreviewSchema,
  localIntegrationReceiptSchema,
  type LocalCommitReceipt,
  type LocalExecutionAuthority,
  type LocalIntegrationPreview,
  type LocalIntegrationReceipt,
} from "../../../packages/runtime/src/local-requests.js";
import { inspectGitRepository } from "./local-execution.js";

const runFile = promisify(execFile);
const TIMEOUT_MS = 20_000;
const MAX_OUTPUT = 65_536;

export class LocalIntegrationError extends Error {
  constructor(
    readonly code: "integration_state_invalid" | "integration_conflict" | "integration_failed" | "undo_denied",
    message: string
  ) {
    super(message);
  }
}

export async function previewLocalIntegration(input: {
  canonicalRoot: string;
  authority: LocalExecutionAuthority;
  commitReceipt: LocalCommitReceipt;
}): Promise<LocalIntegrationPreview> {
  const canonical = await inspectGitRepository(input.canonicalRoot);
  if (!canonical.branch || canonical.branch !== input.authority.preflight.branch) {
    throw new LocalIntegrationError("integration_state_invalid", "Canonical branch changed.");
  }
  const sourceParent = (await git(input.canonicalRoot, ["rev-parse", `${input.commitReceipt.commit}^`])).trim();
  const sourcePaths = parsePaths(await git(input.canonicalRoot, [
    "diff-tree", "--no-commit-id", "--name-only", "-r", "-z", input.commitReceipt.commit,
  ]));
  if (
    sourceParent !== input.commitReceipt.parentCommit ||
    sourcePaths.join("\0") !== input.commitReceipt.changedPaths.join("\0")
  ) {
    throw new LocalIntegrationError("integration_state_invalid", "Source commit no longer matches its receipt.");
  }
  await probeCherryPick(input.canonicalRoot, canonical.baseline, input.commitReceipt.commit);
  const previewedAt = Date.now();
  const body = {
    schemaVersion: 1 as const,
    provenance: "bounded_local_integration_preview" as const,
    commitReceiptDigest: input.commitReceipt.digest,
    sourceCommit: input.commitReceipt.commit,
    sourceParent,
    targetBranch: canonical.branch,
    targetHead: canonical.baseline,
    changedPaths: sourcePaths,
    strategy: "cherry_pick_one_commit" as const,
    conflictProbe: "passed" as const,
    hooksDisabled: true as const,
    signingDisabled: true as const,
    pushed: false as const,
    maximumCostUsd: 0 as const,
    previewedAt,
  };
  return localIntegrationPreviewSchema.parse({ ...body, digest: hash(JSON.stringify(body)) });
}

export async function createLocalIntegration(input: {
  canonicalRoot: string;
  preview: LocalIntegrationPreview;
}): Promise<LocalIntegrationReceipt> {
  const canonical = await inspectGitRepository(input.canonicalRoot);
  if (canonical.branch !== input.preview.targetBranch || canonical.baseline !== input.preview.targetHead) {
    throw new LocalIntegrationError("integration_state_invalid", "Canonical target changed after approval.");
  }
  try {
    await git(input.canonicalRoot, [
      "-c", "core.hooksPath=/dev/null", "-c", "commit.gpgSign=false",
      "cherry-pick", "--no-gpg-sign", input.preview.sourceCommit,
    ], identityEnv());
  } catch (error) {
    await gitBestEffort(input.canonicalRoot, ["cherry-pick", "--abort"]);
    const restored = await inspectGitRepository(input.canonicalRoot);
    if (restored.baseline !== input.preview.targetHead) {
      throw new LocalIntegrationError("integration_failed", "Integration failed and canonical recovery needs review.");
    }
    throw error;
  }
  const after = await inspectGitRepository(input.canonicalRoot);
  const parent = (await git(input.canonicalRoot, ["rev-parse", "HEAD^"])).trim();
  const paths = parsePaths(await git(input.canonicalRoot, [
    "diff-tree", "--no-commit-id", "--name-only", "-r", "-z", after.baseline,
  ]));
  if (
    parent !== input.preview.targetHead ||
    paths.join("\0") !== input.preview.changedPaths.join("\0") ||
    after.branch !== input.preview.targetBranch
  ) {
    throw new LocalIntegrationError("integration_failed", "Integrated commit failed postcondition verification.");
  }
  const createdAt = Date.now();
  const body = {
    schemaVersion: 1 as const,
    previewDigest: input.preview.digest,
    sourceCommit: input.preview.sourceCommit,
    previousHead: input.preview.targetHead,
    resultingHead: after.baseline,
    targetBranch: input.preview.targetBranch,
    changedPaths: paths,
    createdAt,
    hooksDisabled: true as const,
    signingDisabled: true as const,
    pushed: false as const,
  };
  return localIntegrationReceiptSchema.parse({ ...body, digest: hash(JSON.stringify(body)) });
}

export async function undoLocalIntegration(input: {
  canonicalRoot: string;
  receipt: LocalIntegrationReceipt;
}): Promise<void> {
  const canonical = await inspectGitRepository(input.canonicalRoot);
  if (canonical.branch !== input.receipt.targetBranch || canonical.baseline !== input.receipt.resultingHead) {
    throw new LocalIntegrationError("undo_denied", "Canonical branch advanced or changed; undo was refused.");
  }
  await git(input.canonicalRoot, ["reset", "--hard", input.receipt.previousHead]);
  const restored = await inspectGitRepository(input.canonicalRoot);
  if (restored.baseline !== input.receipt.previousHead || restored.branch !== input.receipt.targetBranch) {
    throw new LocalIntegrationError("undo_denied", "Canonical undo failed verification.");
  }
}

async function probeCherryPick(root: string, head: string, commit: string): Promise<void> {
  const probe = await mkdtemp(join(tmpdir(), "pipeline-studio-integration-"));
  let attached = false;
  try {
    await git(root, ["worktree", "add", "--detach", probe, head]);
    attached = true;
    await git(probe, ["-c", "core.hooksPath=/dev/null", "cherry-pick", "--no-commit", commit], identityEnv());
  } catch {
    throw new LocalIntegrationError("integration_conflict", "The source commit conflicts with the current canonical HEAD.");
  } finally {
    if (attached) await gitBestEffort(root, ["worktree", "remove", "--force", probe]);
    await rm(probe, { recursive: true, force: true });
  }
}

function parsePaths(value: string): string[] {
  return value.split("\0").filter(Boolean).sort();
}

function identityEnv(): NodeJS.ProcessEnv {
  return {
    GIT_AUTHOR_NAME: "Pipeline Studio", GIT_AUTHOR_EMAIL: "pipeline-studio@local.invalid",
    GIT_COMMITTER_NAME: "Pipeline Studio", GIT_COMMITTER_EMAIL: "pipeline-studio@local.invalid",
  };
}

async function git(root: string, args: readonly string[], extraEnv: NodeJS.ProcessEnv = {}): Promise<string> {
  try {
    const result = await runFile("git", [...args], {
      cwd: root, timeout: TIMEOUT_MS, maxBuffer: MAX_OUTPUT, windowsHide: true,
      env: { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: process.env.HOME ?? "",
        GIT_CONFIG_NOSYSTEM: "1", GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0",
        GIT_EDITOR: "false", LC_ALL: "C", ...extraEnv },
    });
    return result.stdout;
  } catch {
    throw new LocalIntegrationError("integration_failed", "Bounded local integration action failed.");
  }
}

async function gitBestEffort(root: string, args: readonly string[]): Promise<void> {
  try { await git(root, args); } catch { /* reconciliation reports remaining drift */ }
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
