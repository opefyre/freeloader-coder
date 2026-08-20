import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, lstat, mkdir, open, readFile, realpath, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";

import type { ExecutionTask } from "../../../packages/orchestration/src/project-execution.js";

const runFile = promisify(execFile);
const MAX_OUTPUT = 256 * 1024;
const GIT_TIMEOUT_MS = 30_000;
const VALIDATION_TIMEOUT_MS = 10 * 60_000;
const scripts = { format: "format:check", lint: "lint", typecheck: "typecheck", unit: "test", integration: "test:integration", build: "build", visual: "test:visual" } as const;

export type WorkspaceOperation = { type: "create" | "replace"; path: string; content: string; expectedBeforeDigest: string | null };
export type WorkspaceValidation = { profile: ExecutionTask["validationProfiles"][number]; passed: boolean; exitCode: number; evidenceDigest: string; output: string };
export type PreparedTaskWorkspace = { projectId: string; taskId: string; root: string; branch: string; baseline: string; authorityDigest: string };

export class ProjectTaskWorkspaceService {
  constructor(private readonly stateDirectory: string) {}

  async prepare(projectId: string, canonicalRoot: string, task: ExecutionTask): Promise<PreparedTaskWorkspace> {
    const root = await realpath(canonicalRoot);
    await assertRepository(root);
    const baseline = await ensureBaseline(root);
    if ((await git(root, ["status", "--porcelain=v1", "-z", "--untracked-files=all"])).length > 0) throw new ProjectTaskWorkspaceError("canonical_dirty", "Commit or stash canonical changes before autonomous implementation.");
    const authorityDigest = hash(JSON.stringify({ projectId, taskId: task.id, baseline, allowedFiles: [...task.allowedFiles].sort(), validationProfiles: [...task.validationProfiles].sort() }));
    const workspaceRoot = resolve(this.stateDirectory, "project-task-worktrees");
    await mkdir(workspaceRoot, { recursive: true, mode: 0o700 });
    const folder = `${projectId.slice(8)}-${task.id.slice(5)}-${authorityDigest.slice(0, 10)}`;
    const workspace = resolve(workspaceRoot, folder);
    assertWithin(workspaceRoot, workspace);
    const branch = `studio/${projectId.slice(8, 16)}/${task.id.slice(5, 13)}-${authorityDigest.slice(0, 8)}`;
    try {
      const info = await lstat(workspace);
      if (!info.isDirectory() || info.isSymbolicLink()) throw new ProjectTaskWorkspaceError("workspace_conflict", "Existing task workspace is unsafe.");
      const observed = (await git(workspace, ["rev-parse", "--verify", "HEAD"])).trim();
      if (observed !== baseline) throw new ProjectTaskWorkspaceError("workspace_conflict", "Existing task workspace baseline changed.");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      await git(root, ["worktree", "add", "--no-track", "-b", branch, workspace, baseline]);
    }
    return { projectId, taskId: task.id, root: workspace, branch, baseline, authorityDigest };
  }

  async sources(workspace: PreparedTaskWorkspace, task: ExecutionTask) {
    const sources: Array<{ path: string; content: string; digest: string }> = [];
    let total = 0;
    for (const path of task.allowedFiles) {
      const target = await approvedTarget(workspace.root, path, false);
      try {
        const info = await lstat(target);
        if (!info.isFile() || info.isSymbolicLink() || info.size > 128 * 1024) throw new ProjectTaskWorkspaceError("source_unsupported", `${path} is not a supported text source.`);
        const content = await readFile(target, "utf8");
        if (content.includes("\0")) throw new ProjectTaskWorkspaceError("source_unsupported", `${path} is not UTF-8 text.`);
        total += Buffer.byteLength(content);
        if (total > 768 * 1024) throw new ProjectTaskWorkspaceError("source_unsupported", "Bounded task sources exceed 768 KiB.");
        sources.push({ path, content, digest: hash(content) });
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    }
    return sources;
  }

  async apply(workspace: PreparedTaskWorkspace, task: ExecutionTask, operations: readonly WorkspaceOperation[]) {
    if (operations.length === 0 || operations.length > task.allowedFiles.length) throw new ProjectTaskWorkspaceError("operation_denied", "Implementation must contain bounded file operations.");
    if (new Set(operations.map((operation) => operation.path)).size !== operations.length) throw new ProjectTaskWorkspaceError("operation_denied", "Implementation contains duplicate file operations.");
    const allowed = new Set(task.allowedFiles);
    const planned: Array<{ operation: WorkspaceOperation; target: string; before: string | null; mode: number }> = [];
    for (const operation of operations) {
      if (!allowed.has(operation.path) || Buffer.byteLength(operation.content) > 128 * 1024 || operation.content.includes("\0")) throw new ProjectTaskWorkspaceError("operation_denied", "Implementation exceeded exact file authority.");
      const target = await approvedTarget(workspace.root, operation.path, operation.type === "create");
      let before: string | null = null;
      let mode = 0o644;
      try { const info = await lstat(target); if (!info.isFile() || info.isSymbolicLink()) throw new ProjectTaskWorkspaceError("operation_denied", "Target is not a safe regular file."); before = await readFile(target, "utf8"); mode = info.mode & 0o777; }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
      if (operation.type === "create" && before !== null) throw new ProjectTaskWorkspaceError("stale_source", "Create target already exists.");
      if (operation.type === "replace" && (before === null || hash(before) !== operation.expectedBeforeDigest)) throw new ProjectTaskWorkspaceError("stale_source", "Replace target changed after grounding.");
      planned.push({ operation, target, before, mode });
    }
    const applied: typeof planned = [];
    try {
      for (const entry of planned) {
        await atomicWrite(entry.target, entry.operation.content, entry.mode);
        applied.push(entry);
      }
    } catch {
      for (const entry of [...applied].reverse()) {
        if (entry.before === null) await unlink(entry.target).catch(() => undefined);
        else await atomicWrite(entry.target, entry.before, entry.mode);
      }
      throw new ProjectTaskWorkspaceError("operation_denied", "Implementation apply failed and prior file states were restored.");
    }
    const changed = parseChanged(await git(workspace.root, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]));
    if (changed.some((path) => !allowed.has(path))) throw new ProjectTaskWorkspaceError("operation_denied", "Observed changes escaped exact file authority.");
    return { changedFiles: changed, evidenceDigest: hash(JSON.stringify({ authorityDigest: workspace.authorityDigest, operations, changed })) };
  }

  async validate(root: string, task: ExecutionTask): Promise<WorkspaceValidation[]> {
    const manifest = JSON.parse(await readFile(resolve(root, "package.json"), "utf8")) as { scripts?: Record<string, string> };
    const results: WorkspaceValidation[] = [];
    for (const profile of task.validationProfiles) {
      const script = scripts[profile];
      if (!manifest.scripts?.[script]) throw new ProjectTaskWorkspaceError("validation_unavailable", `Validation profile ${profile} is not configured by the project.`);
      if (isNoOpValidationScript(manifest.scripts[script])) {
        throw new ProjectTaskWorkspaceError("validation_unavailable", `Validation profile ${profile} is configured with a no-op command and cannot produce trustworthy evidence.`);
      }
      try {
        const result = await run("npm", ["run", script], root, VALIDATION_TIMEOUT_MS);
        const output = bounded(`${result.stdout}\n${result.stderr}`);
        results.push({ profile, passed: true, exitCode: 0, output, evidenceDigest: hash(`${profile}:0:${output}`) });
      } catch (error) {
        const failure = error as Error & { code?: number | string; stdout?: string; stderr?: string };
        const output = bounded(`${failure.stdout ?? ""}\n${failure.stderr ?? ""}\n${failure.message}`);
        results.push({ profile, passed: false, exitCode: typeof failure.code === "number" ? failure.code : 1, output, evidenceDigest: hash(`${profile}:1:${output}`) });
        break;
      }
    }
    return results;
  }

  async commit(workspace: PreparedTaskWorkspace, task: ExecutionTask) {
    const changed = parseChanged(await git(workspace.root, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]));
    if (changed.length === 0 || changed.some((path) => !task.allowedFiles.includes(path))) throw new ProjectTaskWorkspaceError("operation_denied", "Commit changes do not match exact file authority.");
    await git(workspace.root, ["add", "--", ...changed]);
    await git(workspace.root, ["-c", "user.name=Pipeline Studio", "-c", "user.email=pipeline-studio@localhost", "commit", "--no-verify", "-m", `${task.jiraIssueKey}: ${task.title}`]);
    const commitDigest = (await git(workspace.root, ["rev-parse", "--verify", "HEAD"])).trim();
    return { commitDigest, evidenceDigest: hash(JSON.stringify({ commitDigest, changed, authorityDigest: workspace.authorityDigest })) };
  }

  async integrate(canonicalRoot: string, workspace: PreparedTaskWorkspace, commitDigest: string) {
    const root = await realpath(canonicalRoot);
    if ((await git(root, ["status", "--porcelain=v1", "-z", "--untracked-files=all"])).length > 0) throw new ProjectTaskWorkspaceError("canonical_dirty", "Canonical project changed before integration.");
    if ((await git(root, ["rev-parse", "--verify", "HEAD"])).trim() !== workspace.baseline) throw new ProjectTaskWorkspaceError("integration_conflict", "Canonical baseline changed before integration.");
    await git(root, ["merge", "--ff-only", commitDigest]);
    const observed = (await git(root, ["rev-parse", "--verify", "HEAD"])).trim();
    if (observed !== commitDigest) throw new ProjectTaskWorkspaceError("integration_conflict", "Integrated commit could not be verified.");
    return { integrationDigest: hash(JSON.stringify({ baseline: workspace.baseline, commitDigest, observed })) };
  }

  async revertIntegration(canonicalRoot: string, workspace: PreparedTaskWorkspace, commitDigest: string) {
    const root = await realpath(canonicalRoot);
    if ((await git(root, ["status", "--porcelain=v1", "-z", "--untracked-files=all"])).length > 0 || (await git(root, ["rev-parse", "--verify", "HEAD"])).trim() !== commitDigest) throw new ProjectTaskWorkspaceError("integration_conflict", "Automatic integration restore was refused because canonical Git changed.");
    await git(root, ["-c", "user.name=Pipeline Studio", "-c", "user.email=pipeline-studio@localhost", "revert", "--no-edit", commitDigest]);
    await git(root, ["diff", "--quiet", workspace.baseline, "HEAD"]);
    return { restoreDigest: hash(JSON.stringify({ baseline: workspace.baseline, failedCommit: commitDigest, restoredHead: (await git(root, ["rev-parse", "--verify", "HEAD"])).trim() })) };
  }
}

function isNoOpValidationScript(command: string) {
  const normalized = command.trim().replace(/\s+/g, " ").toLowerCase();
  if (!normalized) return true;
  return /^(?:echo|printf)(?:\s|$)/.test(normalized)
    || /^(?:true|:)$/.test(normalized)
    || /process\.exit\s*\(\s*0\s*\)/.test(normalized)
    || /console\.log\s*\(/.test(normalized) && !/[;&|]\s*(?:node|npm|npx|tsc|eslint|prettier|vitest|jest)\b/.test(normalized);
}

export class ProjectTaskWorkspaceError extends Error { constructor(readonly code: "repository_invalid" | "canonical_dirty" | "workspace_conflict" | "source_unsupported" | "operation_denied" | "stale_source" | "validation_unavailable" | "integration_conflict", message: string) { super(message); } }

async function assertRepository(root: string) { const top = await realpath((await git(root, ["rev-parse", "--show-toplevel"])).trim()); if (top !== root) throw new ProjectTaskWorkspaceError("repository_invalid", "Selected folder is not the canonical Git repository root."); }
async function ensureBaseline(root: string) {
  const existing = await optionalHead(root);
  if (existing) return existing;
  const changed = parseChanged(await git(root, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]));
  if (changed.length === 0) throw new ProjectTaskWorkspaceError("repository_invalid", "The new project has no approved files for its first Git checkpoint.");
  if (changed.some((path) => !isCodkeshOwnedBaselinePath(path))) {
    throw new ProjectTaskWorkspaceError("canonical_dirty", "The commitless project contains files Codkesh does not own. Review and checkpoint them before autonomous implementation.");
  }
  await git(root, ["add", "--", ...changed]);
  await git(root, ["-c", "user.name=Codkesh", "-c", "user.email=codkesh@localhost", "commit", "--no-verify", "-m", "chore: save approved Codkesh baseline"]);
  const baseline = await optionalHead(root);
  if (!baseline || (await git(root, ["status", "--porcelain=v1", "-z", "--untracked-files=all"])).length > 0) {
    throw new ProjectTaskWorkspaceError("repository_invalid", "Codkesh could not verify the new project's first Git checkpoint.");
  }
  return baseline;
}
async function optionalHead(root: string) {
  try { return (await run("git", ["rev-parse", "--verify", "HEAD"], root, GIT_TIMEOUT_MS)).stdout.trim() || null; }
  catch { return null; }
}
function isCodkeshOwnedBaselinePath(path: string) {
  const artifacts = new Set(["CONTEXT.md", "DECISIONS.md", "DELIVERY-PLAN.md", "DESIGN.md", "INFRA.md", "MEMORY.md", "OPS-RULES.md", "PRODUCT.md", "RESEARCH.md", "SECURITY.md", "STATUS.md"]);
  return artifacts.has(path) || path.startsWith(".pipeline/") || path.startsWith(".codkesh/artifacts/");
}
async function approvedTarget(rootValue: string, path: string, creating: boolean) {
  if (!path || isAbsolute(path) || path.split(/[\\/]/).includes("..")) throw new ProjectTaskWorkspaceError("operation_denied", "Task path is unsafe.");
  const root = await realpath(rootValue);
  const target = resolve(root, path);
  assertWithin(root, target);
  const parentRelation = relative(root, dirname(target));
  let cursor = root;
  for (const component of parentRelation.split(sep).filter(Boolean)) {
    cursor = resolve(cursor, component);
    assertWithin(root, cursor, true);
    try {
      const info = await lstat(cursor);
      if (!info.isDirectory() || info.isSymbolicLink()) throw new ProjectTaskWorkspaceError("operation_denied", "Task parent contains an unsafe path component.");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      if (!creating) return target;
      await mkdir(cursor, { mode: 0o700 });
    }
  }
  return target;
}
function assertWithin(root: string, target: string, allowRoot = false) { const relation = relative(root, target); if ((!allowRoot && !relation) || relation === ".." || relation.startsWith(`..${sep}`) || isAbsolute(relation)) throw new ProjectTaskWorkspaceError("operation_denied", "Path escaped the isolated workspace."); }
function parseChanged(status: string) { if (!status) return []; const entries = status.split("\0").filter(Boolean); const paths: string[] = []; for (let index = 0; index < entries.length; index += 1) { const code = entries[index]!.slice(0, 2); let path = entries[index]!.slice(3); if (code.includes("R")) { path = entries[index + 1] ?? path; index += 1; } if (!path || isAbsolute(path) || path.split(/[\\/]/).includes("..")) throw new ProjectTaskWorkspaceError("operation_denied", "Git returned an unsafe changed path."); paths.push(path); } return [...new Set(paths)].sort(); }
async function git(cwd: string, args: readonly string[]) { try { return (await run("git", args, cwd, GIT_TIMEOUT_MS)).stdout; } catch (error) { throw new ProjectTaskWorkspaceError("repository_invalid", error instanceof Error ? error.message.replaceAll(cwd, "<repository>").slice(0, 300) : "Git operation failed."); } }
async function run(command: string, args: readonly string[], cwd: string, timeout: number) { return runFile(command, [...args], { cwd, timeout, maxBuffer: MAX_OUTPUT, windowsHide: true, env: { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: process.env.HOME ?? "", GIT_CONFIG_NOSYSTEM: "1", GIT_TERMINAL_PROMPT: "0", LC_ALL: "C" } }); }
function bounded(value: string) { return value.length <= MAX_OUTPUT ? value : `${value.slice(0, MAX_OUTPUT)}\n[truncated]`; }
function hash(value: string) { return createHash("sha256").update(value).digest("hex"); }
async function atomicWrite(path: string, content: string, mode: number) { const temporary = `${path}.${process.pid}.${hash(path).slice(0, 8)}.studio.tmp`; try { await writeFile(temporary, content, { encoding: "utf8", mode, flag: "wx" }); const handle = await open(temporary, "r"); await handle.sync(); await handle.close(); await rename(temporary, path); await chmod(path, mode); } finally { await unlink(temporary).catch(() => undefined); } }
