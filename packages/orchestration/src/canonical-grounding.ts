import { createHash } from "node:crypto";

import type { PlannedTask } from "./task-planner.js";

export type RuleScope = "global" | "project" | "task" | "provider" | "tool";

export interface OperatingRule {
  readonly id: string;
  readonly scope: RuleScope;
  readonly text: string;
  readonly authority: "system" | "user";
  readonly protected: boolean;
}

export interface GroundingEvidence {
  readonly path: string;
  readonly content: string;
  readonly lineStart: number;
  readonly lineEnd: number;
  readonly relevance: number;
}

export interface CanonicalGroundingPackage {
  readonly schemaVersion: 1;
  readonly taskId: string;
  readonly taskDigest: string;
  readonly citations: readonly {
    readonly path: string;
    readonly lineStart: number;
    readonly lineEnd: number;
    readonly contentDigest: string;
  }[];
  readonly rules: readonly OperatingRule[];
  readonly protectedPaths: readonly string[];
  readonly digest: string;
}

const precedence: Record<RuleScope, number> = {
  global: 500,
  project: 400,
  task: 300,
  provider: 200,
  tool: 100
};

export function buildCanonicalGroundingPackage(input: {
  readonly task: PlannedTask;
  readonly evidence: readonly GroundingEvidence[];
  readonly rules: readonly OperatingRule[];
  readonly protectedPaths: readonly string[];
  readonly maxSources: number;
}): CanonicalGroundingPackage {
  if (input.maxSources < 1 || input.maxSources > 100) {
    throw new Error("Grounding source limit is invalid.");
  }
  const rules = resolveOperatingRules(input.rules);
  const citations = [...input.evidence]
    .map(validateEvidence)
    .sort((left, right) => right.relevance - left.relevance || left.path.localeCompare(right.path))
    .slice(0, input.maxSources)
    .map((source) => ({
      path: source.path,
      lineStart: source.lineStart,
      lineEnd: source.lineEnd,
      contentDigest: digest(source.content)
    }));
  if (citations.length === 0) throw new Error("Canonical grounding requires cited project evidence.");
  const protectedPaths = [...new Set(input.protectedPaths)].sort();
  protectedPaths.forEach(assertRelativePath);
  const taskDigest = digest(JSON.stringify(input.task));
  const body = {
    schemaVersion: 1 as const,
    taskId: input.task.id,
    taskDigest,
    citations,
    rules,
    protectedPaths
  };
  return { ...body, digest: digest(JSON.stringify(body)) };
}

export function resolveOperatingRules(
  rules: readonly OperatingRule[]
): readonly OperatingRule[] {
  const byId = new Map<string, OperatingRule>();
  for (const raw of rules) {
    if (!/^[a-zA-Z0-9._-]{1,120}$/.test(raw.id) || !raw.text.trim()) {
      throw new Error("Operating rule is invalid.");
    }
    if (!["system", "user"].includes(raw.authority)) {
      throw new Error("Project content cannot grant operating authority.");
    }
    const rule = { ...raw, text: raw.text.trim() };
    const current = byId.get(rule.id);
    if (
      !current ||
      Number(rule.protected) > Number(current.protected) ||
      precedence[rule.scope] > precedence[current.scope]
    ) {
      byId.set(rule.id, rule);
    }
  }
  return [...byId.values()].sort((left, right) =>
    Number(right.protected) - Number(left.protected)
    || precedence[right.scope] - precedence[left.scope]
    || left.id.localeCompare(right.id)
  );
}

export function verifyGroundingPackage(input: {
  readonly grounding: CanonicalGroundingPackage;
  readonly task: PlannedTask;
  readonly evidence: readonly GroundingEvidence[];
}): { readonly valid: boolean; readonly stalePaths: readonly string[] } {
  const taskValid = input.grounding.taskDigest === digest(JSON.stringify(input.task));
  const contentByPath = new Map(input.evidence.map((source) => [source.path, source.content]));
  const stalePaths = input.grounding.citations
    .filter((citation) =>
      !contentByPath.has(citation.path) ||
      digest(contentByPath.get(citation.path)!) !== citation.contentDigest
    )
    .map((citation) => citation.path);
  return {
    valid: taskValid && stalePaths.length === 0,
    stalePaths
  };
}

function validateEvidence(source: GroundingEvidence): GroundingEvidence {
  assertRelativePath(source.path);
  if (
    !source.content ||
    source.lineStart < 1 ||
    source.lineEnd < source.lineStart ||
    !Number.isFinite(source.relevance)
  ) {
    throw new Error("Grounding evidence locator is invalid.");
  }
  return source;
}

function assertRelativePath(path: string): void {
  if (!path || path.startsWith("/") || path.split(/[\\/]/).includes("..") || /^[a-zA-Z]:/.test(path)) {
    throw new Error("Grounding path must stay within the project.");
  }
}

function digest(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}
