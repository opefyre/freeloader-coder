import { createHash } from "node:crypto";
import type { ProjectContextAnalyzerResult, ProjectContextFinding } from "./project-context-analyzers.js";

export type ContextClaimClass = "fact" | "inference" | "assumption" | "unknown" | "decision";
export type ContextClaim = {
  key: string;
  value: string;
  classification: ContextClaimClass;
  source: string;
  sourceDigest: string | null;
  authority: number;
  provenance: "analyzer" | "project_observation" | "owner_decision";
};
export type OwnerContextDecision = { key: string; value: string; source: string };
export type CanonicalContextModel = {
  schemaVersion: 1;
  version: number;
  digest: string;
  claims: ContextClaim[];
  conflicts: { key: string; selected: ContextClaim; alternatives: ContextClaim[]; resolution: "owner_decision" | "source_rank" | "unresolved_tie" }[];
  excluded: { value: string; reason: string }[];
  invalidated: { key: string; source: string; reason: string }[];
};

export function reconcileProjectContext(input: {
  analyzerResults: readonly ProjectContextAnalyzerResult[];
  seedClaims?: readonly Omit<ContextClaim, "sourceDigest">[];
  ownerDecisions?: readonly OwnerContextDecision[];
  sourceDigests?: Readonly<Record<string, string>>;
  previous?: CanonicalContextModel | null;
}): CanonicalContextModel {
  const sourceDigests = input.sourceDigests ?? {};
  const excluded: CanonicalContextModel["excluded"] = [];
  const candidates: ContextClaim[] = [];
  for (const result of input.analyzerResults) {
    collect(result.facts, "fact", result, candidates, excluded, sourceDigests);
    collect(result.inferences, "inference", result, candidates, excluded, sourceDigests);
    collect(result.assumptions, "assumption", result, candidates, excluded, sourceDigests);
    collect(result.unknowns, "unknown", result, candidates, excluded, sourceDigests);
  }
  for (const claim of input.seedClaims ?? []) candidates.push({ ...claim, sourceDigest: sourceDigests[claim.source] ?? null });
  for (const decision of input.ownerDecisions ?? []) {
    candidates.push({ key: normalizeKey(decision.key), value: decision.value.trim(), classification: "decision", source: decision.source, sourceDigest: sourceDigests[decision.source] ?? null, authority: 100, provenance: "owner_decision" });
  }
  const invalidated = (input.previous?.claims ?? []).flatMap((claim) => claim.sourceDigest && sourceDigests[claim.source] && sourceDigests[claim.source] !== claim.sourceDigest ? [{ key: claim.key, source: claim.source, reason: "The cited source digest changed." }] : []);
  const grouped = new Map<string, ContextClaim[]>();
  for (const candidate of candidates) {
    const identity = `${candidate.key}:${candidate.value.trim().toLocaleLowerCase()}:${candidate.classification}:${candidate.source}`;
    const group = grouped.get(candidate.key) ?? [];
    if (!group.some((claim) => `${claim.key}:${claim.value.trim().toLocaleLowerCase()}:${claim.classification}:${claim.source}` === identity)) group.push(candidate);
    grouped.set(candidate.key, group);
  }
  const claims: ContextClaim[] = [];
  const conflicts: CanonicalContextModel["conflicts"] = [];
  for (const [key, group] of [...grouped].sort(([left], [right]) => left.localeCompare(right))) {
    const ranked = [...group].sort(compareClaims);
    const selected = ranked[0]!;
    claims.push(selected);
    const alternatives = ranked.filter((claim) => claim.value.trim().toLocaleLowerCase() !== selected.value.trim().toLocaleLowerCase());
    if (alternatives.length) conflicts.push({ key, selected, alternatives, resolution: selected.provenance === "owner_decision" ? "owner_decision" : alternatives[0]?.authority === selected.authority ? "unresolved_tie" : "source_rank" });
  }
  const content = { claims, conflicts, excluded: excluded.sort((a, b) => a.value.localeCompare(b.value)), invalidated: invalidated.sort((a, b) => `${a.key}:${a.source}`.localeCompare(`${b.key}:${b.source}`)) };
  const digest = createHash("sha256").update(stableJson(content)).digest("hex");
  return { schemaVersion: 1, version: input.previous ? input.previous.digest === digest ? input.previous.version : input.previous.version + 1 : 1, digest, ...content };
}

function collect(findings: readonly ProjectContextFinding[], classification: Exclude<ContextClaimClass, "decision">, result: ProjectContextAnalyzerResult, claims: ContextClaim[], excluded: CanonicalContextModel["excluded"], sourceDigests: Readonly<Record<string, string>>) {
  for (const finding of findings) {
    if (!isSupported(finding.source, result.sources)) { excluded.push({ value: finding.statement, reason: `Unsupported source ${finding.source}.` }); continue; }
    claims.push({ key: normalizeKey(finding.key ?? finding.statement), value: finding.statement, classification, source: finding.source, sourceDigest: sourceDigests[finding.source] ?? null, authority: sourceRank(finding.source, classification), provenance: "analyzer" });
  }
}
function isSupported(source: string, declared: readonly string[]) { return declared.includes(source) || declared.includes(source.split("#")[0] ?? source) || /^(owner|policy|topology|project|filesystem|attachments|documentation|manifest|resource|analyzer):/.test(source); }
function sourceRank(source: string, classification: ContextClaimClass) { if (source.startsWith("owner:")) return 90; if (source === "package.json" || source.startsWith("manifest:")) return 80; if (source.startsWith("project:")) return 70; if (classification === "fact") return 60; if (classification === "inference") return 40; return 20; }
function compareClaims(left: ContextClaim, right: ContextClaim) { return right.authority - left.authority || right.provenance.localeCompare(left.provenance) || left.value.localeCompare(right.value) || left.source.localeCompare(right.source); }
function normalizeKey(value: string) { return value.trim().toLocaleLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 160) || "claim"; }
function stableJson(value: unknown): string { if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`; if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`; return JSON.stringify(value); }
