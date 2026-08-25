import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { realpath } from "node:fs/promises";
import { promisify } from "node:util";

import {
  localCommitPreviewSchema,
  localCommitReceiptSchema,
  type LocalCommitPreview,
  type LocalCommitReceipt,
  type LocalExecutionAuthority,
  type LocalExecutionRun,
  type LocalPatchReceipt,
  type LocalChangeSetReceipt,
} from "../../../packages/runtime/src/local-requests.js";
import { inspectGitRepository } from "./local-execution.js";

const runFile = promisify(execFile);
const TIMEOUT_MS = 15_000;
const MAX_OUTPUT = 65_536;

export class LocalCommitError extends Error {
  constructor(
    readonly code:
      | "commit_state_invalid"
      | "staged_changes"
      | "path_denied"
      | "commit_failed"
      | "undo_denied",
    message: string
  ) {
    super(message);
  }
}

export async function previewIsolatedCommit(input: {
  workspacePath: string;
  canonicalRoot: string;
  authority: LocalExecutionAuthority;
  run: LocalExecutionRun;
  patchReceipt?: LocalPatchReceipt;
  changeSetReceipt?: LocalChangeSetReceipt;
  message: string;
}): Promise<LocalCommitPreview> {
  if (Boolean(input.patchReceipt) === Boolean(input.changeSetReceipt)) {
    throw new LocalCommitError("commit_state_invalid", "Exactly one verified change receipt is required.");
  }
  const workspacePath = await realpath(input.workspacePath);
  const canonical = await inspectGitRepository(input.canonicalRoot);
  if (canonical.baseline !== input.authority.preflight.baseline) {
    throw new LocalCommitError("commit_state_invalid", "Canonical baseline changed.");
  }
  const parentCommit = (await git(workspacePath, ["rev-parse", "--verify", "HEAD"])).trim();
  if (parentCommit !== input.authority.preflight.baseline) {
    throw new LocalCommitError("commit_state_invalid", "Isolated branch parent changed.");
  }
  const branch = (await git(workspacePath, ["symbolic-ref", "--short", "HEAD"])).trim();
  if (!branch.startsWith("studio/request-")) {
    throw new LocalCommitError("commit_state_invalid", "Isolated branch identity is invalid.");
  }
  const staged = await git(workspacePath, ["diff", "--cached", "--name-only", "-z"]);
  if (staged.length > 0) {
    throw new LocalCommitError("staged_changes", "Unexpected staged changes block preview.");
  }
  const changedPaths = [...new Set([
    ...parseNullPaths(await git(workspacePath, ["diff", "--name-only", "-z", parentCommit, "--"])),
    ...parseNullPaths(await git(workspacePath, ["ls-files", "--others", "--exclude-standard", "-z"])),
  ])].sort((left, right) => left.localeCompare(right));
  const allowed = new Set(input.run.changes?.changedPaths.map((change) => change.path) ?? []);
  if (
    changedPaths.length === 0 ||
    changedPaths.some((path) => !allowed.has(path)) ||
    (input.patchReceipt ? !changedPaths.includes(input.patchReceipt.path) :
      changedPaths.join("\0") !== [...(input.changeSetReceipt?.changedPaths ?? [])].sort((left, right) => left.localeCompare(right)).join("\0"))
  ) {
    throw new LocalCommitError(
      "path_denied",
      "Current isolated changes do not match passed validation evidence."
    );
  }
  const { insertions, deletions } = parseNumstat(
    await git(workspacePath, ["diff", "--numstat", parentCommit, "--", ...changedPaths])
  );
  const previewedAt = Date.now();
  const body = {
    schemaVersion: 1 as const,
    provenance: "bounded_isolated_commit_preview" as const,
    authorityDigest: input.authority.digest,
    runDigest: input.run.digest,
    patchReceiptDigest: input.patchReceipt?.digest ?? null,
    changeSetReceiptDigest: input.changeSetReceipt?.digest ?? null,
    parentCommit,
    branch,
    message: input.message.trim(),
    messageDigest: hash(input.message.trim()),
    changedPaths,
    insertions,
    deletions,
    hooksDisabled: true as const,
    signingDisabled: true as const,
    identity: "Codkesh <codkesh@local.invalid>" as const,
    maximumCostUsd: 0 as const,
    previewedAt,
  };
  return localCommitPreviewSchema.parse({ ...body, digest: hash(JSON.stringify(body)) });
}

export async function createIsolatedCommit(input: {
  workspacePath: string;
  canonicalRoot: string;
  authority: LocalExecutionAuthority;
  preview: LocalCommitPreview;
}): Promise<LocalCommitReceipt> {
  const workspacePath = await realpath(input.workspacePath);
  const refreshed = await inspectGitRepository(input.canonicalRoot);
  if (refreshed.baseline !== input.preview.parentCommit) {
    throw new LocalCommitError("commit_state_invalid", "Canonical baseline changed after preview.");
  }
  const currentHead = (await git(workspacePath, ["rev-parse", "HEAD"])).trim();
  if (currentHead !== input.preview.parentCommit) {
    throw new LocalCommitError("commit_state_invalid", "Isolated HEAD changed after preview.");
  }
  const staged = await git(workspacePath, ["diff", "--cached", "--name-only", "-z"]);
  if (staged.length > 0) {
    throw new LocalCommitError("staged_changes", "Unexpected staged changes block commit.");
  }
  await git(workspacePath, ["add", "--", ...input.preview.changedPaths], commitEnv());
  const stagedPaths = parseNullPaths(
    await git(workspacePath, ["diff", "--cached", "--name-only", "-z"])
  );
  if (stagedPaths.join("\0") !== input.preview.changedPaths.join("\0")) {
    throw new LocalCommitError("path_denied", "Staged paths differ from the approved preview.");
  }
  await git(
    workspacePath,
    [
      "-c",
      "core.hooksPath=/dev/null",
      "-c",
      "commit.gpgSign=false",
      "commit",
      "--no-verify",
      "--no-gpg-sign",
      "-m",
      input.preview.message,
    ],
    commitEnv()
  );
  const commit = (await git(workspacePath, ["rev-parse", "HEAD"])).trim();
  const parent = (await git(workspacePath, ["rev-parse", "HEAD^"])).trim();
  const changedPaths = parseNullPaths(
    await git(workspacePath, ["diff-tree", "--no-commit-id", "--name-only", "-r", "-z", commit])
  );
  if (
    parent !== input.preview.parentCommit ||
    changedPaths.join("\0") !== input.preview.changedPaths.join("\0")
  ) {
    throw new LocalCommitError("commit_failed", "Created commit failed parent or path verification.");
  }
  const canonicalAfter = await inspectGitRepository(input.canonicalRoot);
  if (canonicalAfter.baseline !== input.preview.parentCommit) {
    throw new LocalCommitError("commit_failed", "Canonical checkout changed during commit.");
  }
  const createdAt = Date.now();
  const body = {
    schemaVersion: 1 as const,
    previewDigest: input.preview.digest,
    commit,
    parentCommit: parent,
    branch: input.preview.branch,
    changedPaths,
    createdAt,
    canonicalUntouched: true as const,
    hooksDisabled: true as const,
    signingDisabled: true as const,
    pushed: false as const,
  };
  return localCommitReceiptSchema.parse({ ...body, digest: hash(JSON.stringify(body)) });
}

export async function undoIsolatedCommit(input: {
  workspacePath: string;
  canonicalRoot: string;
  receipt: LocalCommitReceipt;
}): Promise<void> {
  const workspacePath = await realpath(input.workspacePath);
  const currentHead = (await git(workspacePath, ["rev-parse", "HEAD"])).trim();
  if (currentHead !== input.receipt.commit) {
    throw new LocalCommitError(
      "undo_denied",
      "Isolated branch advanced after commit; automatic undo was refused."
    );
  }
  const dirty = await git(workspacePath, ["status", "--porcelain=v1", "-z"]);
  if (dirty.length > 0) {
    throw new LocalCommitError(
      "undo_denied",
      "Uncommitted isolated changes block automatic commit undo."
    );
  }
  await git(workspacePath, ["reset", "--mixed", input.receipt.parentCommit], commitEnv());
  if ((await git(workspacePath, ["rev-parse", "HEAD"])).trim() !== input.receipt.parentCommit) {
    throw new LocalCommitError("undo_denied", "Commit undo failed parent verification.");
  }
  const changedPaths = parseNullPaths(
    await git(workspacePath, ["diff", "--name-only", "-z", input.receipt.parentCommit, "--"])
  );
  if (changedPaths.join("\0") !== input.receipt.changedPaths.join("\0")) {
    throw new LocalCommitError("undo_denied", "Commit undo did not restore the approved patch.");
  }
  await inspectGitRepository(input.canonicalRoot);
}

function parseNullPaths(value: string): string[] {
  return value.split("\0").filter(Boolean).sort();
}

function parseNumstat(value: string): { insertions: number; deletions: number } {
  let insertions = 0;
  let deletions = 0;
  for (const line of value.split("\n").filter(Boolean)) {
    const [added, removed] = line.split("\t");
    if (added === "-" || removed === "-") {
      throw new LocalCommitError("path_denied", "Binary changes cannot be committed.");
    }
    insertions += Number.parseInt(added ?? "0", 10);
    deletions += Number.parseInt(removed ?? "0", 10);
  }
  return { insertions, deletions };
}

function commitEnv(): NodeJS.ProcessEnv {
  return {
    GIT_AUTHOR_NAME: "Codkesh",
    GIT_AUTHOR_EMAIL: "codkesh@local.invalid",
    GIT_COMMITTER_NAME: "Codkesh",
    GIT_COMMITTER_EMAIL: "codkesh@local.invalid",
  };
}

async function git(
  cwd: string,
  args: readonly string[],
  extraEnv: NodeJS.ProcessEnv = {}
): Promise<string> {
  try {
    const result = await runFile("git", [...args], {
      cwd,
      timeout: TIMEOUT_MS,
      maxBuffer: MAX_OUTPUT,
      windowsHide: true,
      env: {
        PATH: process.env.PATH ?? "/usr/bin:/bin",
        HOME: process.env.HOME ?? "",
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_TERMINAL_PROMPT: "0",
        GIT_OPTIONAL_LOCKS: "0",
        GIT_EDITOR: "false",
        LC_ALL: "C",
        ...extraEnv,
      },
    });
    return result.stdout;
  } catch {
    throw new LocalCommitError("commit_failed", "Bounded isolated Git commit action failed.");
  }
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
