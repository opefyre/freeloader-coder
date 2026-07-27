import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

export interface TextEdit {
  readonly path: string;
  readonly expectedSha256: string | null;
  readonly content: string;
}

export interface EditEvidence {
  readonly path: string;
  readonly beforeSha256: string | null;
  readonly afterSha256: string;
  readonly bytes: number;
}

export interface WorktreeGitAdapter {
  addWorktree(input: {
    readonly repositoryRoot: string;
    readonly worktreePath: string;
    readonly branch: string;
    readonly baseline: string;
  }): Promise<void>;
  inspectWorktree(worktreePath: string): Promise<{
    readonly branch: string;
    readonly head: string;
  }>;
}

export interface PreparedWorktree {
  readonly path: string;
  readonly branch: string;
  readonly baseline: string;
}

export class LocalWorkspace {
  readonly #root: string;
  readonly #allowedPaths: ReadonlySet<string>;
  readonly #maxFileBytes: number;

  private constructor(root: string, allowedPaths: readonly string[], maxFileBytes: number) {
    this.#root = root;
    this.#allowedPaths = new Set(allowedPaths);
    this.#maxFileBytes = maxFileBytes;
  }

  static async open(input: {
    readonly root: string;
    readonly allowedPaths: readonly string[];
    readonly maxFileBytes: number;
  }): Promise<LocalWorkspace> {
    if (!Number.isSafeInteger(input.maxFileBytes) || input.maxFileBytes < 1) {
      throw new Error("Workspace file limit is invalid.");
    }
    const root = await realpath(input.root);
    for (const path of input.allowedPaths) assertProjectRelativePath(path);
    return new LocalWorkspace(root, input.allowedPaths, input.maxFileBytes);
  }

  async readText(path: string): Promise<string> {
    const absolute = await this.#resolveExisting(path);
    return await readFile(absolute, "utf8");
  }

  async applyTextEdits(edits: readonly TextEdit[]): Promise<readonly EditEvidence[]> {
    if (edits.length < 1) throw new Error("At least one edit is required.");
    if (new Set(edits.map((edit) => edit.path)).size !== edits.length) {
      throw new Error("Each file may be edited only once per operation.");
    }

    const prepared = [];
    for (const edit of edits) {
      assertProjectRelativePath(edit.path);
      if (!this.#allowedPaths.has(edit.path)) throw new Error("Edit path is outside the declared scope.");
      const bytes = Buffer.byteLength(edit.content, "utf8");
      if (bytes > this.#maxFileBytes) throw new Error("Edited file exceeds the byte limit.");
      const absolute = await this.#resolveForWrite(edit.path);
      const before = await readFile(absolute, "utf8").catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return null;
        throw error;
      });
      const beforeSha256 = before === null ? null : sha256(before);
      if (beforeSha256 !== edit.expectedSha256) throw new Error("Edit input is stale.");
      prepared.push({ edit, absolute, beforeSha256, bytes });
    }

    const evidence: EditEvidence[] = [];
    for (const item of prepared) {
      await mkdir(dirname(item.absolute), { recursive: true, mode: 0o700 });
      await writeFile(item.absolute, item.edit.content, { encoding: "utf8", mode: 0o600 });
      evidence.push({
        path: item.edit.path,
        beforeSha256: item.beforeSha256,
        afterSha256: sha256(item.edit.content),
        bytes: item.bytes
      });
    }
    return evidence;
  }

  async #resolveExisting(path: string): Promise<string> {
    assertProjectRelativePath(path);
    const candidate = resolve(this.#root, path);
    this.#assertContained(candidate);
    const info = await lstat(candidate);
    if (info.isSymbolicLink() || !info.isFile()) throw new Error("Workspace path is not a regular file.");
    const canonical = await realpath(candidate);
    this.#assertContained(canonical);
    return canonical;
  }

  async #resolveForWrite(path: string): Promise<string> {
    const candidate = resolve(this.#root, path);
    this.#assertContained(candidate);
    const parent = await nearestExistingParent(dirname(candidate));
    const canonicalParent = await realpath(parent);
    this.#assertContained(canonicalParent);
    const existing = await lstat(candidate).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (existing?.isSymbolicLink()) throw new Error("Symbolic-link edits are not allowed.");
    return candidate;
  }

  #assertContained(path: string): void {
    const fromRoot = relative(this.#root, path);
    if (fromRoot === ".." || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
      throw new Error("Workspace path escapes the project.");
    }
  }
}

export function assertProjectRelativePath(path: string): void {
  if (
    path.length === 0
    || path.includes("\0")
    || isAbsolute(path)
    || path.split(/[\\/]/).includes("..")
    || /^[a-zA-Z]:/.test(path)
  ) {
    throw new Error("Path must be project-relative.");
  }
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export async function prepareWorktree(input: {
  readonly repositoryRoot: string;
  readonly worktreeRoot: string;
  readonly taskId: string;
  readonly runId: string;
  readonly baseline: string;
  readonly git: WorktreeGitAdapter;
}): Promise<PreparedWorktree> {
  const repositoryRoot = await realpath(input.repositoryRoot);
  await mkdir(input.worktreeRoot, { recursive: true, mode: 0o700 });
  const worktreeRoot = await realpath(input.worktreeRoot);
  const suffix = sha256(input.runId).slice(0, 10);
  const slug = input.taskId.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  if (!slug) throw new Error("Task ID cannot produce a safe branch name.");
  if (!/^[a-f0-9]{7,64}$/.test(input.baseline)) throw new Error("Baseline commit is invalid.");
  const branch = `studio/${slug}-${suffix}`;
  const path = resolve(worktreeRoot, `${slug}-${suffix}`);
  const fromRoot = relative(worktreeRoot, path);
  if (fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) throw new Error("Worktree path escapes its root.");

  await input.git.addWorktree({
    repositoryRoot,
    worktreePath: path,
    branch,
    baseline: input.baseline
  });
  const observed = await input.git.inspectWorktree(path);
  if (observed.branch !== branch || observed.head !== input.baseline) {
    throw new Error("Worktree postcondition was not observed.");
  }
  return { path, branch, baseline: input.baseline };
}

async function nearestExistingParent(start: string): Promise<string> {
  let current = start;
  while (true) {
    try {
      const info = await lstat(current);
      if (!info.isDirectory() || info.isSymbolicLink()) {
        throw new Error("Workspace parent is not a regular directory.");
      }
      return current;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      const parent = dirname(current);
      if (parent === current) throw new Error("No existing workspace parent.");
      current = parent;
    }
  }
}
