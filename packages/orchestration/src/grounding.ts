import { createHash } from "node:crypto";

export interface GroundingSource {
  readonly path: string;
  readonly content: string;
}

export interface GroundingContract {
  readonly version: 1;
  readonly sources: readonly (GroundingSource & { readonly sha256: string })[];
  readonly rules: readonly string[];
  readonly sha256: string;
}

export function buildGroundingContract(input: {
  readonly sources: readonly GroundingSource[];
  readonly rules: readonly string[];
  readonly maxSourceBytes: number;
}): GroundingContract {
  const sources = [...input.sources]
    .sort((left, right) => left.path.localeCompare(right.path))
    .map((source) => {
      assertRelativePath(source.path);
      const bytes = Buffer.byteLength(source.content, "utf8");
      if (bytes > input.maxSourceBytes) throw new Error("Grounding source exceeds byte limit.");
      return { ...source, sha256: digest(source.content) };
    });
  if (new Set(sources.map((source) => source.path)).size !== sources.length) {
    throw new Error("Grounding source paths must be unique.");
  }
  const rules = [...new Set(input.rules.map((rule) => rule.trim()).filter(Boolean))];
  if (rules.length === 0) throw new Error("Grounding requires at least one invariant rule.");
  const body = JSON.stringify({ version: 1, sources, rules });
  return { version: 1, sources, rules, sha256: digest(body) };
}

function assertRelativePath(path: string): void {
  if (!path || path.startsWith("/") || path.split(/[\\/]/).includes("..") || /^[a-zA-Z]:/.test(path)) {
    throw new Error("Grounding path must stay within the project.");
  }
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
