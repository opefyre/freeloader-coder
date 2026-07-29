import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { realpath } from "node:fs/promises";
import { relative, sep } from "node:path";
import { promisify } from "node:util";

import {
  localChangeObservationSchema,
  localValidationAttemptSchema,
  type LocalChangeObservation,
  type LocalExecutionAuthority,
  type LocalValidationAttempt,
} from "../../../packages/runtime/src/local-requests.js";
import { inspectGitRepository, LocalExecutionError } from "./local-execution.js";

const runFile = promisify(execFile);
const MAX_OUTPUT = 65_536;
const TIMEOUT_MS = 10_000;

export class LocalValidationError extends Error {
  constructor(
    readonly code:
      | "workspace_mismatch"
      | "command_failed"
      | "command_timed_out"
      | "change_policy_denied",
    message: string
  ) {
    super(message);
  }
}

export async function runBoundedValidation(input: {
  workspacePath: string;
  authority: LocalExecutionAuthority;
  attemptId: string;
  startedAt?: number;
}): Promise<LocalValidationAttempt> {
  const workspacePath = await realpath(input.workspacePath);
  const baseline = (await git(workspacePath, ["rev-parse", "--verify", "HEAD"])).trim();
  if (baseline !== input.authority.preflight.baseline) {
    throw new LocalValidationError(
      "workspace_mismatch",
      "Workspace baseline no longer matches execution authority."
    );
  }
  const startedAt = input.startedAt ?? Date.now();
  let state: LocalValidationAttempt["state"] = "passed";
  let exitCode: number | null = 0;
  let output = "";
  try {
    output = await git(workspacePath, ["diff", "--check"]);
  } catch (error) {
    state =
      error instanceof LocalValidationError && error.code === "command_timed_out"
        ? "timed_out"
        : "failed";
    exitCode = state === "timed_out" ? null : 1;
    output = error instanceof Error ? error.message.slice(0, MAX_OUTPUT) : "Validation failed.";
  }
  const completedAt = Date.now();
  return localValidationAttemptSchema.parse({
    schemaVersion: 1,
    id: input.attemptId,
    command: {
      executable: "git",
      arguments: ["diff", "--check"],
      timeoutMs: TIMEOUT_MS,
      maximumOutputBytes: MAX_OUTPUT,
    },
    state,
    startedAt,
    completedAt,
    exitCode,
    output,
    outputDigest: hash(output),
    truncated: false,
  });
}

export async function observeBoundedChanges(input: {
  workspacePath: string;
  canonicalRoot: string;
  authority: LocalExecutionAuthority;
}): Promise<LocalChangeObservation> {
  const workspacePath = await realpath(input.workspacePath);
  const canonical = await inspectGitRepository(input.canonicalRoot);
  if (canonical.baseline !== input.authority.preflight.baseline) {
    throw new LocalValidationError(
      "workspace_mismatch",
      "Canonical baseline changed after execution authorization."
    );
  }
  const workspaceBaseline = (
    await git(workspacePath, ["rev-parse", "--verify", "HEAD"])
  ).trim();
  if (workspaceBaseline !== input.authority.preflight.baseline) {
    throw new LocalValidationError(
      "workspace_mismatch",
      "Workspace baseline changed after execution authorization."
    );
  }
  const status = await git(workspacePath, [
    "status",
    "--porcelain=v1",
    "-z",
    "--untracked-files=all",
  ]);
  const allowedPaths = new Set(
    input.authority.manifest.tasks.flatMap((task) => task.allowedFiles)
  );
  const blockers: string[] = [];
  const changedPaths = parseStatus(status).map((change) => {
    if (!allowedPaths.has(change.path)) {
      blockers.push(`Changed path is outside the approved manifest: ${change.path}`);
    }
    return change;
  });
  const body = {
    schemaVersion: 1 as const,
    provenance: "bounded_git_change_observation" as const,
    observedAt: Date.now(),
    changedPaths,
    canonicalBaseline: canonical.baseline,
    workspaceBaseline,
    canonicalClean: true as const,
    allowed: blockers.length === 0,
    blockers,
    limitations: [
      "Only fixed read-only Git status and baseline commands were executed.",
      "Raw file contents, remotes, credentials, environment values, and absolute paths are omitted.",
      "This observation does not stage, commit, merge, push, publish, or deploy changes.",
    ],
  };
  return localChangeObservationSchema.parse({
    ...body,
    digest: hash(JSON.stringify(body)),
  });
}

function parseStatus(status: string): Array<{
  path: string;
  state: "added" | "modified" | "deleted" | "renamed" | "untracked";
}> {
  if (!status) return [];
  const entries = status.split("\0").filter(Boolean);
  const changes: Array<{
    path: string;
    state: "added" | "modified" | "deleted" | "renamed" | "untracked";
  }> = [];
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index] ?? "";
    const code = entry.slice(0, 2);
    let path = entry.slice(3);
    let state: "added" | "modified" | "deleted" | "renamed" | "untracked" =
      code === "??"
        ? "untracked"
        : code.includes("D")
          ? "deleted"
          : code.includes("R")
            ? "renamed"
            : code.includes("A")
              ? "added"
              : "modified";
    if (state === "renamed") {
      path = entries[index + 1] ?? path;
      index += 1;
    }
    assertRelativePath(path);
    changes.push({ path, state });
  }
  return changes.sort((left, right) => left.path.localeCompare(right.path));
}

function assertRelativePath(path: string): void {
  if (
    !path ||
    path.startsWith("/") ||
    path.startsWith("\\") ||
    path.split(/[\\/]/).includes("..") ||
    relative(".", path).startsWith(`..${sep}`)
  ) {
    throw new LocalValidationError("change_policy_denied", "Git returned an unsafe path.");
  }
}

async function git(cwd: string, args: readonly string[]): Promise<string> {
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
        LC_ALL: "C",
      },
    });
    return result.stdout;
  } catch (error) {
    if ((error as { killed?: boolean }).killed) {
      throw new LocalValidationError("command_timed_out", "Validation timed out.");
    }
    if (error instanceof LocalExecutionError) throw error;
    throw new LocalValidationError("command_failed", "Bounded Git validation failed.");
  }
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
