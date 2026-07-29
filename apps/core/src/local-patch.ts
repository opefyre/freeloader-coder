import { createHash, randomUUID } from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  open,
  readFile,
  realpath,
  rename,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

import {
  localPatchPreviewSchema,
  localPatchReceiptSchema,
  type LocalExecutionAuthority,
  type LocalExecutionRun,
  type LocalPatchPreview,
  type LocalPatchReceipt,
} from "../../../packages/runtime/src/local-requests.js";
import { inspectGitRepository } from "./local-execution.js";

const MAX_BYTES = 65_536;

export class LocalPatchError extends Error {
  constructor(
    readonly code:
      | "path_denied"
      | "target_unsupported"
      | "stale_file"
      | "content_invalid"
      | "write_failed"
      | "rollback_denied",
    message: string
  ) {
    super(message);
  }
}

export async function previewReplacement(input: {
  workspacePath: string;
  authority: LocalExecutionAuthority;
  run: LocalExecutionRun;
  path: string;
  expectedBeforeDigest: string | null;
  replacementContent: string;
}): Promise<LocalPatchPreview> {
  const target = await resolveTarget(input.workspacePath, input.path, input.authority);
  const before = await readBoundedText(target);
  const beforeDigest = hash(before);
  if (input.expectedBeforeDigest !== null && beforeDigest !== input.expectedBeforeDigest) {
    throw new LocalPatchError("stale_file", "The target changed since it was selected.");
  }
  const afterBytes = Buffer.byteLength(input.replacementContent, "utf8");
  if (afterBytes > MAX_BYTES || input.replacementContent.includes("\0")) {
    throw new LocalPatchError("content_invalid", "Replacement text exceeds the safe UTF-8 bound.");
  }
  const body = {
    schemaVersion: 1 as const,
    provenance: "bounded_local_replacement_preview" as const,
    authorityDigest: input.authority.digest,
    runDigest: input.run.digest,
    path: input.path,
    beforeDigest,
    afterDigest: hash(input.replacementContent),
    beforeBytes: Buffer.byteLength(before, "utf8"),
    afterBytes,
    beforeLines: countLines(before),
    afterLines: countLines(input.replacementContent),
    replacementContent: input.replacementContent,
    previewedAt: Date.now(),
    blockers: [] as const,
    maximumCostUsd: 0 as const,
  };
  return localPatchPreviewSchema.parse({ ...body, digest: hash(JSON.stringify(body)) });
}

export async function applyReplacement(input: {
  workspacePath: string;
  canonicalRoot: string;
  recoveryDirectory: string;
  authority: LocalExecutionAuthority;
  preview: LocalPatchPreview;
}): Promise<LocalPatchReceipt> {
  const canonical = await inspectGitRepository(input.canonicalRoot);
  if (canonical.baseline !== input.authority.preflight.baseline) {
    throw new LocalPatchError("stale_file", "Canonical baseline changed after preview.");
  }
  const target = await resolveTarget(input.workspacePath, input.preview.path, input.authority);
  const before = await readBoundedText(target);
  if (hash(before) !== input.preview.beforeDigest) {
    throw new LocalPatchError("stale_file", "The target changed after preview.");
  }
  await mkdir(input.recoveryDirectory, { recursive: true, mode: 0o700 });
  await chmod(input.recoveryDirectory, 0o700);
  const recoveryPath = resolve(input.recoveryDirectory, `${input.preview.digest}.before`);
  await writePrivateOnce(recoveryPath, before);
  const mode = (await stat(target)).mode & 0o777;
  await atomicReplace(target, input.preview.replacementContent, mode);
  const observedDigest = hash(await readBoundedText(target));
  if (observedDigest !== input.preview.afterDigest) {
    throw new LocalPatchError("write_failed", "Applied bytes failed digest verification.");
  }
  const appliedAt = Date.now();
  const body = {
    schemaVersion: 1 as const,
    previewDigest: input.preview.digest,
    path: input.preview.path,
    beforeDigest: input.preview.beforeDigest,
    afterDigest: input.preview.afterDigest,
    observedDigest,
    appliedAt,
    canonicalUntouched: true as const,
  };
  return localPatchReceiptSchema.parse({ ...body, digest: hash(JSON.stringify(body)) });
}

export async function rollbackReplacement(input: {
  workspacePath: string;
  recoveryDirectory: string;
  authority: LocalExecutionAuthority;
  preview: LocalPatchPreview;
  receipt: LocalPatchReceipt;
}): Promise<void> {
  const target = await resolveTarget(input.workspacePath, input.preview.path, input.authority);
  if (hash(await readBoundedText(target)) !== input.receipt.afterDigest) {
    throw new LocalPatchError(
      "rollback_denied",
      "The isolated file changed after application; automatic rollback was refused."
    );
  }
  const recoveryPath = resolve(input.recoveryDirectory, `${input.preview.digest}.before`);
  const before = await readBoundedText(recoveryPath);
  if (hash(before) !== input.receipt.beforeDigest) {
    throw new LocalPatchError("rollback_denied", "Rollback evidence failed digest verification.");
  }
  const mode = (await stat(target)).mode & 0o777;
  await atomicReplace(target, before, mode);
  if (hash(await readBoundedText(target)) !== input.receipt.beforeDigest) {
    throw new LocalPatchError("rollback_denied", "Restored bytes failed digest verification.");
  }
}

async function resolveTarget(
  workspacePath: string,
  path: string,
  authority: LocalExecutionAuthority
): Promise<string> {
  const root = await realpath(workspacePath);
  if (isAbsolute(path) || path.split(/[\\/]/).includes("..")) {
    throw new LocalPatchError("path_denied", "Patch target must be project-relative.");
  }
  const allowed = new Set(authority.manifest.tasks.flatMap((task) => task.allowedFiles));
  if (!allowed.has(path)) {
    throw new LocalPatchError("path_denied", "Patch target is outside the approved manifest.");
  }
  const target = resolve(root, path);
  const relation = relative(root, target);
  if (!relation || relation === ".." || relation.startsWith(`..${sep}`) || isAbsolute(relation)) {
    throw new LocalPatchError("path_denied", "Patch target escaped the isolated workspace.");
  }
  const info = await lstat(target);
  if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_BYTES) {
    throw new LocalPatchError("target_unsupported", "Patch target must be a small regular file.");
  }
  const parent = await realpath(dirname(target));
  if (parent !== root && !parent.startsWith(`${root}${sep}`)) {
    throw new LocalPatchError("path_denied", "Patch target parent escaped the workspace.");
  }
  return target;
}

async function readBoundedText(path: string): Promise<string> {
  const bytes = await readFile(path);
  if (bytes.length > MAX_BYTES || bytes.includes(0)) {
    throw new LocalPatchError("content_invalid", "File is binary or exceeds the safe bound.");
  }
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  return text;
}

async function atomicReplace(path: string, content: string, mode: number): Promise<void> {
  const temporary = resolve(dirname(path), `.${randomUUID()}.pipeline-patch.tmp`);
  try {
    await writeFile(temporary, content, { encoding: "utf8", mode, flag: "wx" });
    const file = await open(temporary, "r");
    await file.sync();
    await file.close();
    await rename(temporary, path);
    await chmod(path, mode);
  } finally {
    await unlink(temporary).catch(() => undefined);
  }
}

async function writePrivateOnce(path: string, content: string): Promise<void> {
  try {
    await writeFile(path, content, { encoding: "utf8", mode: 0o600, flag: "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    if (hash(await readBoundedText(path)) !== hash(content)) {
      throw new LocalPatchError("write_failed", "Conflicting rollback evidence exists.");
    }
  }
}

function countLines(value: string): number {
  return value.length === 0 ? 0 : value.split("\n").length;
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
