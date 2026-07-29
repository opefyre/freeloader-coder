import { createHash } from "node:crypto";

import {
  searchQuerySchema,
  universalSearchSnapshotSchema,
  type SearchQuery,
  type SearchResult,
  type SearchScope,
  type UniversalSearchSnapshot,
} from "../../../packages/runtime/src/universal-search.js";
import type { ActivitySnapshot } from "../../../packages/runtime/src/activity.js";
import type { DecisionSnapshot } from "../../../packages/runtime/src/decisions.js";
import type { LiveOperationsSnapshot } from "../../../packages/runtime/src/live-operations.js";
import type { AttentionSnapshot } from "../../../packages/runtime/src/attention.js";

type Candidate = Omit<SearchResult, "id" | "score" | "matchReason" | "highlights"> & { seed: string; keywords: string };
type IndexedCandidate = Omit<Candidate, "seed"> & { id: string };

const destinations: readonly Candidate[] = [
  destination("overview", "Your local pipeline", "Pipeline health, requests, and free-provider readiness.", "/", "Open overview", "health status home"),
  destination("projects", "Projects", "Add, understand, and safely prepare repositories.", "/projects", "Open projects", "repository onboarding grounding"),
  destination("conversation", "Conversation", "Ask, clarify, and guide grounded project work.", "/conversation", "Open conversation", "chat prompt request"),
  destination("work", "Work", "Inspect active, queued, and verified requests.", "/work", "Open work", "tasks queue execution"),
  destination("decisions", "Decision inbox", "Review approvals, blockers, waits, and recovery choices.", "/decisions", "Open decisions", "approval input failure recovery"),
  destination("attention", "Attention Center", "Triage durable alerts, snoozes, and quiet hours.", "/attention", "Open Attention Center", "notifications alerts attention acknowledge snooze quiet hours"),
  destination("activity", "Activity explorer", "Search canonical local operational history.", "/activity", "Open activity", "events timeline validation"),
  destination("providers", "Providers", "Inspect free models, routes, health, and availability.", "/providers", "Open providers", "models quota free tier"),
  destination("integrations", "Connect", "Review GitHub, Jira, and tool connections.", "/integrations", "Open connections", "github jira integrations"),
  destination("evidence", "Evidence", "Review validations, checks, sources, and proof.", "/evidence", "Open evidence", "tests qa validation proof"),
  destination("help", "Help", "Find product-aware guidance and safe recovery steps.", "/help", "Open help", "docs support guidance"),
  destination("launch", "Launch", "Inspect launch positioning, gates, and learning evidence.", "/launch", "Open launch", "gtm adoption"),
  destination("releases", "Releases", "Inspect artifacts, compatibility, rollout, and rollback.", "/releases", "Open releases", "version update rollback"),
  destination("trust", "Trust", "Inspect governance, supply chain, privacy, and responsible AI.", "/trust", "Open trust", "security governance privacy"),
  destination("accessibility", "Accessibility", "Inspect release-blocking accessibility evidence.", "/accessibility", "Open accessibility", "wcag keyboard contrast"),
  destination("settings", "Settings", "Control connections, privacy, resilience, and safeguards.", "/settings", "Open settings", "configuration preferences"),
];

export function buildUniversalSearchSnapshot(input: {
  live: LiveOperationsSnapshot;
  activity: ActivitySnapshot;
  decisions: DecisionSnapshot;
  attention?: AttentionSnapshot;
  query?: Partial<SearchQuery>;
  now?: number;
}): UniversalSearchSnapshot {
  const now = input.now ?? Date.now();
  const query = searchQuerySchema.parse(input.query ?? {});
  const candidates = deduplicate([
    ...destinations,
    ...input.live.recentEvents.flatMap((event) => {
      if (!event.requestId) return [];
      return [candidate({
        seed: `request:${event.requestId}:${event.id}`,
        scope: "request",
        title: event.title,
        subtitle: event.detail,
        state: event.state,
        observedAt: event.observedAt,
        sourceRecordId: event.requestId,
        reference: { surface: "work", path: `/work?request=${encodeURIComponent(event.requestId)}`, label: "Open work" },
        keywords: `${event.kind} ${event.state} ${event.projectId ?? ""} ${event.providerId ?? ""}`,
      })];
    }),
    ...input.decisions.items.map((item) => candidate({
      seed: `decision:${item.id}`,
      scope: "decision",
      title: item.title,
      subtitle: item.reason,
      state: `${item.priority}_${item.category}`,
      observedAt: item.observedAt,
      sourceRecordId: item.id,
      reference: item.reference,
      keywords: `${item.category} ${item.priority} ${item.owner} ${item.nextAction} ${item.providerId ?? ""}`,
    })),
    ...(input.attention?.items ?? []).map((item) => candidate({
      seed: `attention:${item.id}:${item.revision}`,
      scope: "attention",
      title: item.title,
      subtitle: item.reason,
      state: `${item.severity}_${item.disposition}`,
      observedAt: item.observedAt,
      sourceRecordId: item.id,
      reference: item.reference,
      keywords: `${item.category} ${item.severity} ${item.disposition} ${item.nextAction} ${item.providerId ?? ""}`,
    })),
    ...input.activity.events.map((event) => candidate({
      seed: `activity:${event.id}`,
      scope: "activity",
      title: event.title,
      subtitle: event.detail,
      state: event.state,
      observedAt: event.observedAt,
      sourceRecordId: event.id,
      reference: event.reference,
      keywords: `${event.kind} ${event.severity} ${event.source} ${event.providerId ?? ""}`,
    })),
    ...input.live.recentEvents.filter((event) => event.kind === "project").map((event) => candidate({
      seed: `project:${event.id}`,
      scope: "project",
      title: event.title,
      subtitle: event.detail,
      state: event.state,
      observedAt: event.observedAt,
      sourceRecordId: event.projectId ?? event.id,
      reference: { surface: "projects", path: `/projects${event.projectId ? `?project=${encodeURIComponent(event.projectId)}` : ""}`, label: "Open project" },
      keywords: `project repository ${event.state}`,
    })),
    ...input.live.providers.map((provider) => candidate({
      seed: `provider:${provider.id}`,
      scope: "provider",
      title: provider.label,
      subtitle: `${provider.modelId} · ${provider.zeroCost ? "$0 route" : "not admitted for free routing"} · ${provider.state}`,
      state: provider.state,
      observedAt: provider.updatedAt,
      sourceRecordId: provider.id,
      reference: { surface: "providers", path: `/providers?provider=${encodeURIComponent(provider.providerId)}`, label: "Open provider" },
      keywords: `${provider.providerId} ${provider.modelId} model free tier ${provider.state}`,
    })),
  ]);
  const allowed = query.scopes.length === 0 ? candidates : candidates.filter((item) => query.scopes.includes(item.scope));
  const normalizedQuery = normalize(query.query);
  const ranked = normalizedQuery
    ? allowed.flatMap((item) => {
        const relevance = score(item, normalizedQuery, now);
        return relevance ? [{ ...item, ...relevance }] : [];
      })
    : allowed.filter((item) => item.scope === "workspace" || item.scope === "evidence" || item.scope === "settings").map((item, index) => ({
        ...item,
        score: 100 - index,
        matchReason: "suggested" as const,
        highlights: [],
      }));
  ranked.sort((left, right) => right.score - left.score || (right.observedAt ?? 0) - (left.observedAt ?? 0) || left.id.localeCompare(right.id));
  const groupedCounts = facet(ranked);
  const results = ranked.slice(0, query.limit).map(publicResult);
  return universalSearchSnapshotSchema.parse({
    schemaVersion: 1,
    provenance: "local_universal_search",
    observedAt: now,
    validForMs: 15_000,
    automaticSpendLimitUsd: 0,
    query,
    summary: {
      queryLength: query.query.length,
      matched: ranked.length,
      returned: results.length,
      truncated: ranked.length > results.length,
      scopes: groupedCounts,
    },
    completeness: "bounded_current_state",
    results,
  });
}

function publicResult(item: IndexedCandidate & Pick<SearchResult, "score" | "matchReason" | "highlights">): SearchResult {
  const { keywords: _rankingKeywords, ...result } = item;
  return result;
}

function candidate(input: Candidate): Candidate {
  return {
    ...input,
    title: safeText(input.title, 160),
    subtitle: safeText(input.subtitle, 300),
    keywords: safeText(input.keywords, 500),
  };
}

function destination(surface: SearchResult["reference"]["surface"], title: string, subtitle: string, path: string, label: string, keywords: string): Candidate {
  const scope: SearchScope = surface === "settings" ? "settings" : ["evidence", "trust", "accessibility", "releases"].includes(surface) ? "evidence" : "workspace";
  return candidate({
    seed: `destination:${surface}`,
    scope,
    title,
    subtitle,
    state: "available",
    observedAt: null,
    sourceRecordId: `workspace_${surface}`,
    reference: { surface, path, label },
    keywords,
  });
}

function score(item: IndexedCandidate, query: string, now: number): Pick<SearchResult, "score" | "matchReason" | "highlights"> | null {
  const title = normalize(item.title);
  const subtitle = normalize(item.subtitle);
  const haystack = normalize(`${item.title} ${item.subtitle} ${item.state} ${item.keywords}`);
  const tokens = query.split(" ").filter(Boolean).slice(0, 8);
  let base = 0;
  let matchReason: SearchResult["matchReason"] = "contains";
  if (title === query) { base = 1_000; matchReason = "exact"; }
  else if (title.startsWith(query)) { base = 850; matchReason = "prefix"; }
  else if (title.includes(query) || subtitle.includes(query)) { base = 700; matchReason = "phrase"; }
  else if (tokens.length > 0 && tokens.every((token) => haystack.includes(token))) { base = 550; matchReason = "tokens"; }
  else if (tokens.some((token) => haystack.includes(token))) { base = 350; matchReason = "contains"; }
  else return null;
  const scopeBoost = item.scope === "workspace" || item.scope === "decision" || item.scope === "request" ? 80 : 40;
  const recency = item.observedAt === null ? 0 : Math.max(0, 60 - Math.floor(Math.max(0, now - item.observedAt) / 3_600_000));
  return { score: Math.min(10_000, base + scopeBoost + recency), matchReason, highlights: highlights(item, query, tokens) };
}

function highlights(item: Pick<Candidate, "title" | "subtitle">, phrase: string, tokens: string[]): SearchResult["highlights"] {
  const values = [["title", item.title], ["subtitle", item.subtitle]] as const;
  const result: SearchResult["highlights"] = [];
  for (const [field, value] of values) {
    const lower = value.toLocaleLowerCase();
    const terms = [phrase, ...tokens].filter((term, index, all) => term && all.indexOf(term) === index);
    for (const term of terms) {
      const start = lower.indexOf(term.toLocaleLowerCase());
      if (start >= 0) result.push({ field, start, end: start + term.length });
      if (result.length >= 8) return result;
    }
  }
  return result;
}

function deduplicate(items: Candidate[]): IndexedCandidate[] {
  const byId = new Map<string, IndexedCandidate>();
  for (const item of items) {
    const { seed, ...value } = item;
    const current = { id: `search_${createHash("sha256").update(seed).digest("hex").slice(0, 20)}`, ...value };
    const existing = byId.get(current.id);
    if (existing && JSON.stringify(existing) !== JSON.stringify(current)) throw new Error("Conflicting search identity.");
    byId.set(current.id, current);
  }
  return [...byId.values()];
}

function facet(items: readonly SearchResult[]) {
  const counts = new Map<SearchScope, number>();
  for (const item of items) counts.set(item.scope, (counts.get(item.scope) ?? 0) + 1);
  return [...counts].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0])).map(([value, count]) => ({ value, count }));
}

function normalize(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase().replace(/\s+/g, " ").trim();
}

function safeText(value: string, maximum: number): string {
  const safe = value
    .replace(/\b(?:sk|gsk|AIza|ghp|github_pat)_[A-Za-z0-9_-]{8,}\b/g, "[redacted]")
    .replace(/\b(api[_-]?key|token|secret|password)\s*[:=]\s*\S+/gi, "$1=[redacted]")
    .replace(/\/Users\/[^/\s]+/g, "/Users/[user]")
    .replace(/[A-Z]:\\Users\\[^\\\s]+/gi, "C:\\Users\\[user]")
    .replace(/\s+/g, " ")
    .trim();
  const bounded = safe || "Search detail unavailable.";
  return bounded.length <= maximum ? bounded : `${bounded.slice(0, maximum - 1)}…`;
}
