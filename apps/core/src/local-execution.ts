import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, lstat, mkdir, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";

import {
  localExecutionManifestSchema,
  localExecutionWorkspaceSchema,
  localRepositoryPreflightSchema,
  type LocalDraftPlan,
  type LocalExecutionAuthority,
  type LocalExecutionManifest,
  type LocalExecutionWorkspace,
  type LocalRepositoryPreflight,
} from "../../../packages/runtime/src/local-requests.js";

const runFile = promisify(execFile);
const MAX_GIT_OUTPUT = 64 * 1024;
const GIT_TIMEOUT_MS = 10_000;

export class LocalExecutionError extends Error {
  constructor(
    readonly code:
      | "git_unavailable"
      | "repository_mismatch"
      | "repository_dirty"
      | "git_failed"
      | "workspace_conflict"
      | "workspace_escape",
    message: string
  ) {
    super(message);
  }
}

export async function inspectGitRepository(
  canonicalRoot: string
): Promise<LocalRepositoryPreflight> {
  const root = await realpath(canonicalRoot);
  if (!isAbsolute(root)) {
    throw new LocalExecutionError("repository_mismatch", "Repository root is invalid.");
  }
  const topLevel = await git(root, ["rev-parse", "--show-toplevel"]);
  let observedRoot: string;
  try {
    observedRoot = await realpath(topLevel.trim());
  } catch {
    throw new LocalExecutionError(
      "repository_mismatch",
      "Git reported an unavailable repository root."
    );
  }
  if (observedRoot !== root) {
    throw new LocalExecutionError(
      "repository_mismatch",
      "Registered project is not the canonical Git worktree root."
    );
  }
  const baseline = (await git(root, ["rev-parse", "--verify", "HEAD"])).trim();
  if (!/^[a-f0-9]{40,64}$/.test(baseline)) {
    throw new LocalExecutionError("git_failed", "Git returned an invalid baseline commit.");
  }
  const status = await git(root, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]);
  if (status.length > 0) {
    throw new LocalExecutionError(
      "repository_dirty",
      "Commit or stash canonical-worktree changes before authorizing execution."
    );
  }
  let branch: string | null = null;
  try {
    const value = (await git(root, ["symbolic-ref", "--quiet", "--short", "HEAD"])).trim();
    branch = value.length > 0 ? value.slice(0, 200) : null;
  } catch (error) {
    if (!(error instanceof LocalExecutionError) || error.code !== "git_failed") throw error;
  }
  const observedAt = Date.now();
  const body = {
    baseline,
    branch,
    clean: true,
    repositoryRootMatched: true,
    gitAvailable: true,
  } as const;
  return localRepositoryPreflightSchema.parse({
    schemaVersion: 1,
    provenance: "bounded_git_observation",
    digest: hash(JSON.stringify(body)),
    observedAt,
    ...body,
    limitations: [
      "Only fixed read-only Git commands were executed with argument arrays.",
      "Remotes, source contents, environment values, credentials, and absolute paths are not exposed.",
      "This increment blocks dirty canonical worktrees instead of attempting automatic stashing.",
    ],
  });
}

export function compileExecutionManifest(
  plan: LocalDraftPlan,
  baseline: string
): LocalExecutionManifest {
  if (plan.state !== "approved" || !plan.approval) {
    throw new LocalExecutionError("git_failed", "Approve and freeze the plan first.");
  }
  const tasks = plan.order.map((taskId) => {
    const task = plan.tasks.find((candidate) => candidate.id === taskId);
    if (!task) {
      throw new LocalExecutionError("git_failed", "Approved plan order is invalid.");
    }
    return {
      id: task.id,
      title: task.title,
      allowedFiles: [...task.allowedFiles],
      dependsOn: [...task.dependsOn],
      checks: [...task.checks],
    };
  });
  const body = {
    schemaVersion: 1 as const,
    planDigest: plan.digest,
    baseline,
    order: [...plan.order],
    tasks,
    allowedEffects: ["create_isolated_worktree"] as const,
    excludedEffects: [
      "canonical_worktree_write",
      "network",
      "provider",
      "credential",
      "paid_usage",
      "publish",
      "deploy",
    ] as const,
    maximumCostUsd: 0 as const,
  };
  return localExecutionManifestSchema.parse({
    ...body,
    digest: hash(JSON.stringify(body)),
  });
}

export async function prepareIsolatedWorktree(input: {
  readonly stateDirectory: string;
  readonly canonicalRoot: string;
  readonly requestId: string;
  readonly authority: LocalExecutionAuthority;
}): Promise<LocalExecutionWorkspace> {
  const canonicalRoot = await realpath(input.canonicalRoot);
  const worktreesRoot = resolve(input.stateDirectory, "worktrees");
  await mkdir(worktreesRoot, { recursive: true, mode: 0o700 });
  await chmod(worktreesRoot, 0o700);
  const suffix = hash(input.authority.digest).slice(0, 10);
  const requestSuffix = input.requestId.slice("request_".length, "request_".length + 12);
  const workspaceName = `${requestSuffix}-${suffix}`;
  const workspacePath = resolve(worktreesRoot, workspaceName);
  const relation = relative(worktreesRoot, workspacePath);
  if (
    relation.length === 0 ||
    relation.startsWith(`..${sep}`) ||
    relation === ".." ||
    isAbsolute(relation)
  ) {
    throw new LocalExecutionError("workspace_escape", "Workspace escaped its private root.");
  }
  const branch = `studio/request-${requestSuffix}-${suffix}`;
  try {
    const info = await lstat(workspacePath);
    if (!info.isDirectory() || info.isSymbolicLink()) {
      throw new LocalExecutionError(
        "workspace_conflict",
        "Existing workspace path is not a safe directory."
      );
    }
    const observed = (await git(workspacePath, ["rev-parse", "--verify", "HEAD"])).trim();
    if (observed !== input.authority.preflight.baseline) {
      throw new LocalExecutionError(
        "workspace_conflict",
        "Existing workspace baseline does not match the authorization."
      );
    }
    return workspace(input.authority, branch);
  } catch (error) {
    if (
      error instanceof LocalExecutionError &&
      error.code !== "git_failed"
    ) {
      throw error;
    }
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      if (error instanceof LocalExecutionError) throw error;
    }
  }
  try {
    await git(canonicalRoot, [
      "worktree",
      "add",
      "--no-track",
      "-b",
      branch,
      workspacePath,
      input.authority.preflight.baseline,
    ]);
  } catch (error) {
    throw new LocalExecutionError(
      "workspace_conflict",
      error instanceof Error
        ? `Isolated workspace could not be created: ${error.message}`
        : "Isolated workspace could not be created."
    );
  }
  const observed = (await git(workspacePath, ["rev-parse", "--verify", "HEAD"])).trim();
  if (observed !== input.authority.preflight.baseline) {
    throw new LocalExecutionError(
      "workspace_conflict",
      "Prepared workspace failed baseline verification."
    );
  }
  const dirty = await git(workspacePath, ["status", "--porcelain=v1", "-z"]);
  if (dirty.length > 0) {
    throw new LocalExecutionError(
      "workspace_conflict",
      "Prepared workspace was not clean."
    );
  }
  return workspace(input.authority, branch);
}

export function locateIsolatedWorktree(input: {
  readonly stateDirectory: string;
  readonly requestId: string;
  readonly authority: LocalExecutionAuthority;
}): string {
  const worktreesRoot = resolve(input.stateDirectory, "worktrees");
  const suffix = hash(input.authority.digest).slice(0, 10);
  const requestSuffix = input.requestId.slice("request_".length, "request_".length + 12);
  const workspacePath = resolve(worktreesRoot, `${requestSuffix}-${suffix}`);
  const relation = relative(worktreesRoot, workspacePath);
  if (
    relation.length === 0 ||
    relation.startsWith(`..${sep}`) ||
    relation === ".." ||
    isAbsolute(relation)
  ) {
    throw new LocalExecutionError("workspace_escape", "Workspace escaped its private root.");
  }
  return workspacePath;
}

export function preserveWorkspace(
  current: LocalExecutionWorkspace,
  state: "preserved" | "interrupted"
): LocalExecutionWorkspace {
  const body = { ...current, state };
  return localExecutionWorkspaceSchema.parse({
    ...body,
    stateDigest: hash(JSON.stringify({ ...body, stateDigest: undefined })),
  });
}

function workspace(
  authority: LocalExecutionAuthority,
  branch: string
): LocalExecutionWorkspace {
  const createdAt = authority.authorizedAt;
  const body = {
    schemaVersion: 1 as const,
    workspaceRef: `workspace_${hash(authority.digest).slice(0, 20)}`,
    branch,
    baseline: authority.preflight.baseline,
    state: "ready" as const,
    createdAt,
  };
  return localExecutionWorkspaceSchema.parse({
    ...body,
    stateDigest: hash(JSON.stringify(body)),
  });
}

async function git(cwd: string, args: readonly string[]): Promise<string> {
  try {
    const result = await runFile("git", [...args], {
      cwd,
      timeout: GIT_TIMEOUT_MS,
      maxBuffer: MAX_GIT_OUTPUT,
      windowsHide: true,
      env: {
        PATH: process.env.PATH ?? "/usr/bin:/bin",
        HOME: process.env.HOME ?? "",
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_TERMINAL_PROMPT: "0",
        GIT_OPTIONAL_LOCKS: "0",
        LC_ALL: "C",
      },
    });
    return result.stdout;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new LocalExecutionError("git_unavailable", "Git is not installed or available.");
    }
    const message =
      error instanceof Error && error.message.length <= 240
        ? error.message.replaceAll(cwd, "<repository>")
        : "Git command failed.";
    throw new LocalExecutionError("git_failed", message);
  }
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
