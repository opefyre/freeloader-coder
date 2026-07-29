import { createHash, randomUUID } from "node:crypto";
import {
  chmod, lstat, mkdir, open, readFile, realpath, rename, stat, unlink, writeFile,
} from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

import {
  localChangeSetPreviewSchema,
  localChangeSetReceiptSchema,
  type LocalChangeSetPreview,
  type LocalChangeSetPreviewRequest,
  type LocalChangeSetReceipt,
  type LocalExecutionAuthority,
  type LocalExecutionRun,
} from "../../../packages/runtime/src/local-requests.js";
import { inspectGitRepository } from "./local-execution.js";

const MAX_FILE_BYTES = 65_536;
const MAX_TOTAL_BYTES = 786_432;

export class LocalChangeSetError extends Error {
  constructor(
    readonly code:
      | "path_denied" | "duplicate_path" | "target_unsupported" | "stale_file"
      | "content_invalid" | "apply_failed" | "rollback_denied" | "reconciliation_required",
    message: string
  ) { super(message); }
}

export async function previewChangeSet(input: {
  workspacePath: string;
  authority: LocalExecutionAuthority;
  run: LocalExecutionRun;
  operations: LocalChangeSetPreviewRequest["operations"];
}): Promise<LocalChangeSetPreview> {
  const sorted = [...input.operations].sort((a, b) => a.path.localeCompare(b.path));
  if (new Set(sorted.map((item) => item.path)).size !== sorted.length) {
    throw new LocalChangeSetError("duplicate_path", "Each change-set path must be unique.");
  }
  const operations = [];
  for (const operation of sorted) {
    const target = await resolveTarget(input.workspacePath, operation.path, input.authority);
    const observed = await observeTarget(target);
    if (operation.type === "create" && observed.exists) {
      throw new LocalChangeSetError("stale_file", "A create target already exists.");
    }
    if (operation.type !== "create" && !observed.exists) {
      throw new LocalChangeSetError("stale_file", "A replace or delete target no longer exists.");
    }
    if (operation.expectedBeforeDigest !== null && operation.expectedBeforeDigest !== observed.digest) {
      throw new LocalChangeSetError("stale_file", "A change-set target changed after selection.");
    }
    const content = operation.type === "delete" ? null : operation.content;
    if (content !== null && (Buffer.byteLength(content, "utf8") > MAX_FILE_BYTES || content.includes("\0"))) {
      throw new LocalChangeSetError("content_invalid", "Change-set text exceeds the per-file UTF-8 bound.");
    }
    operations.push({
      type: operation.type,
      path: operation.path,
      beforeDigest: observed.digest,
      afterDigest: content === null ? null : hash(content),
      beforeBytes: observed.bytes,
      afterBytes: content === null ? 0 : Buffer.byteLength(content, "utf8"),
      beforeMode: observed.mode,
      content,
    });
  }
  const totalBeforeBytes = operations.reduce((sum, item) => sum + item.beforeBytes, 0);
  const totalAfterBytes = operations.reduce((sum, item) => sum + item.afterBytes, 0);
  if (totalBeforeBytes > MAX_TOTAL_BYTES || totalAfterBytes > MAX_TOTAL_BYTES) {
    throw new LocalChangeSetError("content_invalid", "Change set exceeds the aggregate byte bound.");
  }
  const body = {
    schemaVersion: 1 as const,
    provenance: "bounded_local_change_set_preview" as const,
    authorityDigest: input.authority.digest,
    runDigest: input.run.digest,
    operations,
    changedPaths: operations.map((item) => item.path),
    totalBeforeBytes,
    totalAfterBytes,
    previewedAt: Date.now(),
    blockers: [] as const,
    maximumCostUsd: 0 as const,
  };
  return localChangeSetPreviewSchema.parse({ ...body, digest: hash(JSON.stringify(body)) });
}

export async function applyChangeSet(input: {
  workspacePath: string;
  canonicalRoot: string;
  recoveryDirectory: string;
  authority: LocalExecutionAuthority;
  preview: LocalChangeSetPreview;
}): Promise<LocalChangeSetReceipt> {
  const canonical = await inspectGitRepository(input.canonicalRoot);
  if (canonical.baseline !== input.authority.preflight.baseline) {
    throw new LocalChangeSetError("stale_file", "Canonical baseline changed after preview.");
  }
  await verifyPreviewState(input.workspacePath, input.authority, input.preview, "before");
  const recoveryRoot = resolve(input.recoveryDirectory, input.preview.digest);
  await mkdir(recoveryRoot, { recursive: true, mode: 0o700 });
  await chmod(recoveryRoot, 0o700);
  for (const operation of input.preview.operations) {
    if (operation.beforeDigest !== null) {
      const target = await resolveTarget(input.workspacePath, operation.path, input.authority);
      await writePrivateOnce(resolve(recoveryRoot, hash(operation.path)), await readBoundedText(target));
    }
  }
  const applied: typeof input.preview.operations[number][] = [];
  try {
    for (const operation of input.preview.operations) {
      const target = await resolveTarget(input.workspacePath, operation.path, input.authority);
      if (operation.type === "delete") await unlink(target);
      else await atomicWrite(target, operation.content ?? "", operation.beforeMode ?? 0o644);
      applied.push(operation);
    }
    await verifyPreviewState(input.workspacePath, input.authority, input.preview, "after");
  } catch {
    await restoreApplied(input.workspacePath, input.authority, recoveryRoot, [...applied].reverse());
    await verifyPreviewState(input.workspacePath, input.authority, input.preview, "before").catch(() => {
      throw new LocalChangeSetError("reconciliation_required", "Partial apply could not be restored exactly.");
    });
    throw new LocalChangeSetError("apply_failed", "Change-set apply failed and original state was restored.");
  }
  const appliedAt = Date.now();
  const operations = input.preview.operations.map((item) => ({
    type: item.type, path: item.path, beforeDigest: item.beforeDigest,
    afterDigest: item.afterDigest, observedDigest: item.afterDigest,
  }));
  const body = {
    schemaVersion: 1 as const, previewDigest: input.preview.digest, operations,
    changedPaths: input.preview.changedPaths, appliedAt, canonicalUntouched: true as const,
  };
  return localChangeSetReceiptSchema.parse({ ...body, digest: hash(JSON.stringify(body)) });
}

export async function rollbackChangeSet(input: {
  workspacePath: string;
  recoveryDirectory: string;
  authority: LocalExecutionAuthority;
  preview: LocalChangeSetPreview;
  receipt: LocalChangeSetReceipt;
}): Promise<void> {
  await verifyPreviewState(input.workspacePath, input.authority, input.preview, "after").catch(() => {
    throw new LocalChangeSetError("rollback_denied", "A changed path was edited after apply; rollback was refused.");
  });
  const recoveryRoot = resolve(input.recoveryDirectory, input.preview.digest);
  await restoreApplied(input.workspacePath, input.authority, recoveryRoot, [...input.preview.operations].reverse());
  await verifyPreviewState(input.workspacePath, input.authority, input.preview, "before").catch(() => {
    throw new LocalChangeSetError("rollback_denied", "Restored change-set state failed verification.");
  });
}

export async function reconcileChangeSet(input: {
  workspacePath: string;
  authority: LocalExecutionAuthority;
  preview: LocalChangeSetPreview;
}): Promise<"not_started" | "applied" | "mixed"> {
  if (await stateMatches(input.workspacePath, input.authority, input.preview, "before")) return "not_started";
  if (await stateMatches(input.workspacePath, input.authority, input.preview, "after")) return "applied";
  return "mixed";
}

async function restoreApplied(
  workspacePath: string,
  authority: LocalExecutionAuthority,
  recoveryRoot: string,
  operations: readonly LocalChangeSetPreview["operations"][number][]
): Promise<void> {
  for (const operation of operations) {
    const target = await resolveTarget(workspacePath, operation.path, authority);
    if (operation.beforeDigest === null) await unlink(target).catch(() => undefined);
    else {
      const before = await readBoundedText(resolve(recoveryRoot, hash(operation.path)));
      if (hash(before) !== operation.beforeDigest) {
        throw new LocalChangeSetError("rollback_denied", "Recovery evidence failed digest verification.");
      }
      await atomicWrite(target, before, operation.beforeMode ?? 0o644);
    }
  }
}

async function verifyPreviewState(
  workspacePath: string,
  authority: LocalExecutionAuthority,
  preview: LocalChangeSetPreview,
  side: "before" | "after"
): Promise<void> {
  for (const operation of preview.operations) {
    const target = await resolveTarget(workspacePath, operation.path, authority);
    const observed = await observeTarget(target);
    const expected = side === "before" ? operation.beforeDigest : operation.afterDigest;
    if (observed.digest !== expected) throw new LocalChangeSetError("stale_file", `Change-set ${side} state does not match preview.`);
  }
}

async function stateMatches(
  workspacePath: string, authority: LocalExecutionAuthority,
  preview: LocalChangeSetPreview, side: "before" | "after"
): Promise<boolean> {
  try { await verifyPreviewState(workspacePath, authority, preview, side); return true; }
  catch { return false; }
}

async function resolveTarget(workspacePath: string, path: string, authority: LocalExecutionAuthority): Promise<string> {
  const root = await realpath(workspacePath);
  if (isAbsolute(path) || path.split(/[\\/]/).includes("..")) throw new LocalChangeSetError("path_denied", "Target must be project-relative.");
  const allowed = new Set(authority.manifest.tasks.flatMap((task) => task.allowedFiles));
  if (!allowed.has(path)) throw new LocalChangeSetError("path_denied", "Target is outside the approved manifest.");
  const target = resolve(root, path);
  const relation = relative(root, target);
  if (!relation || relation === ".." || relation.startsWith(`..${sep}`) || isAbsolute(relation)) throw new LocalChangeSetError("path_denied", "Target escaped the isolated workspace.");
  const parent = await realpath(dirname(target));
  if (parent !== root && !parent.startsWith(`${root}${sep}`)) throw new LocalChangeSetError("path_denied", "Target parent escaped the workspace.");
  try {
    const info = await lstat(target);
    if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_FILE_BYTES) throw new LocalChangeSetError("target_unsupported", "Target must be a small regular file.");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  return target;
}

async function observeTarget(path: string): Promise<{ exists: boolean; digest: string | null; bytes: number; mode: number | null }> {
  try {
    const info = await stat(path);
    const content = await readBoundedText(path);
    return { exists: true, digest: hash(content), bytes: Buffer.byteLength(content, "utf8"), mode: info.mode & 0o777 };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { exists: false, digest: null, bytes: 0, mode: null };
    throw error;
  }
}

async function readBoundedText(path: string): Promise<string> {
  const bytes = await readFile(path);
  if (bytes.length > MAX_FILE_BYTES || bytes.includes(0)) throw new LocalChangeSetError("content_invalid", "File is binary or oversized.");
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

async function atomicWrite(path: string, content: string, mode: number): Promise<void> {
  const temporary = resolve(dirname(path), `.${randomUUID()}.pipeline-change-set.tmp`);
  try {
    await writeFile(temporary, content, { encoding: "utf8", mode, flag: "wx" });
    const file = await open(temporary, "r"); await file.sync(); await file.close();
    await rename(temporary, path); await chmod(path, mode);
  } finally { await unlink(temporary).catch(() => undefined); }
}

async function writePrivateOnce(path: string, content: string): Promise<void> {
  try { await writeFile(path, content, { encoding: "utf8", mode: 0o600, flag: "wx" }); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    if (hash(await readBoundedText(path)) !== hash(content)) throw new LocalChangeSetError("apply_failed", "Conflicting recovery evidence exists.");
  }
}

function hash(value: string): string { return createHash("sha256").update(value).digest("hex"); }
