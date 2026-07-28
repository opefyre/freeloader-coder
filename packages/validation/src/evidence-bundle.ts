import { createHash } from "node:crypto";

export type EvidenceKind =
  | "diff"
  | "validation"
  | "review"
  | "command"
  | "log"
  | "build"
  | "commit"
  | "visual"
  | "limitation";

export interface EvidenceItem {
  readonly id: string;
  readonly kind: EvidenceKind;
  readonly label: string;
  readonly state: "passed" | "warning" | "failed" | "skipped" | "unavailable" | "waived";
  readonly artifactRef: string | null;
  readonly sourceDigest: string;
  readonly required: boolean;
}

export interface EvidenceBundle {
  readonly schemaVersion: 1;
  readonly taskId: string;
  readonly uiChanged: boolean;
  readonly ready: boolean;
  readonly items: readonly EvidenceItem[];
  readonly digest: string;
}

export function buildEvidenceBundle(input: {
  readonly taskId: string;
  readonly changedPaths: readonly string[];
  readonly items: readonly EvidenceItem[];
}): EvidenceBundle {
  if (!/^[a-zA-Z0-9._-]{1,120}$/.test(input.taskId)) throw new Error("Task identity is invalid.");
  const uiChanged = input.changedPaths.some((path) =>
    /\.(css|html|tsx|jsx|vue|svelte)$/.test(path) && !path.includes(".test.")
  );
  const items = [...input.items].sort((left, right) =>
    left.kind.localeCompare(right.kind) || left.id.localeCompare(right.id)
  );
  if (new Set(items.map((item) => item.id)).size !== items.length) {
    throw new Error("Evidence identities must be unique.");
  }
  for (const item of items) {
    if (!item.label.trim() || !/^[a-f0-9]{64}$/.test(item.sourceDigest)) {
      throw new Error("Evidence item is invalid.");
    }
  }
  const hasDiff = items.some((item) => item.kind === "diff" && item.artifactRef);
  const hasValidation = items.some((item) => item.kind === "validation" && item.artifactRef);
  if (!hasDiff || !hasValidation) throw new Error("Changed code requires diff and validation evidence.");
  const visualFailure = items.some((item) =>
    item.kind === "visual" && ["failed", "unavailable"].includes(item.state)
  );
  const requiredFailure = items.some((item) =>
    item.required && ["failed", "unavailable", "skipped"].includes(item.state)
  );
  const ready = !requiredFailure && !(uiChanged && visualFailure);
  const body = { schemaVersion: 1 as const, taskId: input.taskId, uiChanged, ready, items };
  return { ...body, digest: createHash("sha256").update(JSON.stringify(body)).digest("hex") };
}
