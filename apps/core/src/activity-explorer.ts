import { createHash } from "node:crypto";

import {
  activityQuerySchema,
  activitySnapshotSchema,
  type ActivityEvent,
  type ActivityQuery,
  type ActivitySeverity,
  type ActivitySnapshot,
} from "../../../packages/runtime/src/activity.js";
import type { AutonomySnapshot } from "../../../packages/runtime/src/autonomy.js";
import type { LiveOperationsSnapshot } from "../../../packages/runtime/src/live-operations.js";

export function buildActivitySnapshot(input: {
  live: LiveOperationsSnapshot;
  autonomy: AutonomySnapshot;
  query?: Partial<ActivityQuery>;
  now?: number;
}): ActivitySnapshot {
  const observedAt = input.now ?? Date.now();
  const query = activityQuerySchema.parse(input.query ?? {});
  const canonical = deduplicate([
    ...input.live.recentEvents.map((event) => fromLiveEvent(event)),
    ...input.autonomy.recommendations.map((item) => activity({
      seed: `autonomy:recommendation:${item.requestId}:${item.expectedUpdatedAt}:${item.classification}`,
      kind: "autonomy",
      severity: item.classification === "terminal" ? "success" : item.classification === "attention" ? "failure" : item.classification === "approval" ? "attention" : "progress",
      source: "autonomy_recommendation",
      sourceRecordId: item.requestId,
      state: item.classification,
      title: item.title,
      detail: item.reason,
      observedAt: item.expectedUpdatedAt,
      projectId: item.projectId,
      requestId: item.requestId,
      providerId: null,
      reference: workReference(item.requestId),
    })),
    ...input.autonomy.leases.map((lease) => activity({
      seed: `autonomy:lease:${lease.requestId}:${lease.acquiredAt}:${lease.expiresAt}`,
      kind: "autonomy",
      severity: lease.expiresAt <= observedAt ? "attention" : "progress",
      source: "autonomy_lease",
      sourceRecordId: lease.requestId,
      state: lease.expiresAt <= observedAt ? "expired" : "active",
      title: lease.expiresAt <= observedAt ? "Coordinator lease expired" : "Coordinator safe step active",
      detail: lease.expiresAt <= observedAt ? "The lease requires canonical reconciliation before another step." : "A single local coordinator owns the bounded safe step.",
      observedAt: lease.acquiredAt,
      projectId: null,
      requestId: lease.requestId,
      providerId: null,
      reference: workReference(lease.requestId),
    })),
    ...input.autonomy.receipts.map((receipt) => activity({
      seed: `autonomy:receipt:${receipt.id}:${receipt.completedAt}`,
      kind: "autonomy",
      severity: receipt.outcome === "completed" ? recoverySeverity(receipt.action) : receipt.outcome === "failed" ? "failure" : receipt.outcome === "blocked" ? "attention" : "progress",
      source: "autonomy_receipt",
      sourceRecordId: receipt.id,
      state: receipt.outcome,
      title: `${readable(receipt.action)} ${receipt.outcome}`,
      detail: receipt.detail,
      observedAt: receipt.completedAt,
      projectId: receipt.projectId,
      requestId: receipt.requestId,
      providerId: null,
      reference: workReference(receipt.requestId),
    })),
  ]);
  const ordered = canonical.sort((left, right) => right.observedAt - left.observedAt || left.id.localeCompare(right.id)).slice(0, 250);
  const ranged = ordered.filter((event) => inRange(event.observedAt, query.range, observedAt));
  const facets = {
    kinds: facet(ranged, (item) => item.kind),
    severities: facet(ranged, (item) => item.severity),
    projects: facet(ranged.filter((item) => item.projectId), (item) => item.projectId ?? ""),
    providers: facet(ranged.filter((item) => item.providerId), (item) => item.providerId ?? ""),
  };
  const needle = normalize(query.search);
  const events = ranged.filter((event) =>
    (query.kinds.length === 0 || query.kinds.includes(event.kind)) &&
    (query.severities.length === 0 || query.severities.includes(event.severity)) &&
    (!query.projectId || event.projectId === query.projectId) &&
    (!query.providerId || event.providerId === query.providerId) &&
    (!needle || normalize(`${event.title} ${event.detail} ${event.state} ${event.providerId ?? ""}`).includes(needle))
  );
  return activitySnapshotSchema.parse({
    schemaVersion: 1,
    provenance: "local_activity_explorer",
    observedAt,
    validForMs: 15_000,
    automaticSpendLimitUsd: 0,
    query,
    summary: {
      observed: events.length,
      active: events.filter((event) => event.severity === "progress").length,
      decisions: events.filter((event) => event.severity === "attention" && ["approval", "needs_input", "blocked"].some((state) => event.state.includes(state))).length,
      failures: events.filter((event) => event.severity === "failure").length,
      recoveries: events.filter((event) => isRecovery(event)).length,
      providers: new Set(events.map((event) => event.providerId).filter(Boolean)).size,
      lastActivityAt: events[0]?.observedAt ?? null,
    },
    facets,
    retention: {
      bounded: true,
      maximumEvents: 250,
      completeness: "bounded_current_state",
      earliestObservedAt: ordered.at(-1)?.observedAt ?? null,
    },
    events,
  });
}

function fromLiveEvent(event: LiveOperationsSnapshot["recentEvents"][number]): ActivityEvent {
  const requestSummaryStates = new Set(["needs_input", "queued", "approved", "claimed", "checkpointed", "completed", "interrupted", "cancelled"]);
  const source = event.kind === "request" ? (requestSummaryStates.has(event.state) ? "request_summary" : "request_run") : event.kind === "project" ? "project_observation" : event.kind === "provider" ? "provider_connection" : "system_observation";
  const reference = event.kind === "request" && event.requestId ? workReference(event.requestId) : event.kind === "project" ? { surface: "projects" as const, path: `/projects${event.projectId ? `?project=${encodeURIComponent(event.projectId)}` : ""}`, label: "Open project" } : event.kind === "provider" ? { surface: "providers" as const, path: `/providers${event.providerId ? `?provider=${encodeURIComponent(event.providerId)}` : ""}`, label: "Open provider" } : { surface: "activity" as const, path: "/activity", label: "Open activity" };
  return activity({
    seed: `live:${event.id}:${event.observedAt}`,
    kind: event.kind,
    severity: severityForState(event.state),
    source,
    sourceRecordId: event.id,
    state: event.state,
    title: event.title,
    detail: event.detail,
    observedAt: event.observedAt,
    projectId: event.projectId,
    requestId: event.requestId,
    providerId: event.providerId,
    reference,
  });
}

function activity(input: Omit<ActivityEvent, "id"> & { seed: string }): ActivityEvent {
  const { seed, ...event } = input;
  return {
    id: `activity_${createHash("sha256").update(seed).digest("hex").slice(0, 20)}`,
    ...event,
    title: safeText(event.title, 160),
    detail: safeText(event.detail, 300),
  };
}

function severityForState(state: string): ActivitySeverity {
  if (/(failed|error|interrupted|rejected|revoked|cancelled|corrupt)/.test(state)) return "failure";
  if (/(needs_input|needs_attention|blocked|expired|stale|limited|approval|warning)/.test(state)) return "attention";
  if (/(completed|passed|ready|created|applied|approved|accepted|released)/.test(state)) return "success";
  if (/(claimed|working|preparing|generating|validating|creating|applying|active|checkpoint)/.test(state)) return "progress";
  return "neutral";
}

function recoverySeverity(action: string): ActivitySeverity {
  return /(reconcile|release)/.test(action) ? "success" : "progress";
}

function isRecovery(event: ActivityEvent): boolean {
  return /(reconcile|rollback|rolled_back|undo|undone|restored|released)/.test(`${event.state} ${event.title}`.toLowerCase());
}

function workReference(requestId: string) {
  return { surface: "work" as const, path: `/work?request=${encodeURIComponent(requestId)}`, label: "Open work" };
}

function deduplicate(events: ActivityEvent[]): ActivityEvent[] {
  const byId = new Map<string, ActivityEvent>();
  for (const event of events) {
    const existing = byId.get(event.id);
    if (existing && JSON.stringify(existing) !== JSON.stringify(event)) throw new Error("Conflicting activity identity.");
    byId.set(event.id, event);
  }
  return [...byId.values()];
}

function facet(events: ActivityEvent[], value: (event: ActivityEvent) => string) {
  const counts = new Map<string, number>();
  for (const event of events) counts.set(value(event), (counts.get(value(event)) ?? 0) + 1);
  return [...counts].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0])).map(([item, count]) => ({ value: item, count }));
}

function inRange(value: number, range: ActivityQuery["range"], now: number): boolean {
  if (range === "all") return true;
  const duration = range === "1h" ? 3_600_000 : range === "24h" ? 86_400_000 : 604_800_000;
  return value >= now - duration && value <= now;
}

function normalize(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase().replace(/\s+/g, " ").trim();
}

function readable(value: string): string {
  return value.replaceAll("_", " ");
}

function safeText(value: string, maximum: number): string {
  const safe = value
    .replace(/\b(?:sk|gsk|AIza|ghp|github_pat)_[A-Za-z0-9_-]{8,}\b/g, "[redacted]")
    .replace(/\b(api[_-]?key|token|secret|password)\s*[:=]\s*\S+/gi, "$1=[redacted]")
    .replace(/\/Users\/[^/\s]+/g, "/Users/[user]")
    .replace(/[A-Z]:\\Users\\[^\\\s]+/gi, "C:\\Users\\[user]")
    .replace(/\s+/g, " ")
    .trim();
  const bounded = safe || "Activity detail unavailable.";
  return bounded.length <= maximum ? bounded : `${bounded.slice(0, maximum - 1)}…`;
}
