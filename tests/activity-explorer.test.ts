import assert from "node:assert/strict";
import test from "node:test";

import { buildActivitySnapshot } from "../apps/core/src/activity-explorer.js";
import type { AutonomySnapshot } from "../packages/runtime/src/autonomy.js";
import type { LiveOperationsSnapshot } from "../packages/runtime/src/live-operations.js";

const now = 1_800_000_000_000;
const projectId = "project_0123456789abcdef";
const requestId = "request_0123456789abcdef0123";
const live: LiveOperationsSnapshot = {
  schemaVersion: 1,
  provenance: "local_operational_aggregation",
  observedAt: now,
  validForMs: 15_000,
  automaticSpendLimitUsd: 0,
  health: "attention",
  totals: { projects: 1, requests: 1, active: 1, completed: 0, needsAttention: 1, providers: 1, readyProviders: 1 },
  stages: ["needs_input", "queued", "approved", "claimed", "checkpointed", "completed", "interrupted", "cancelled"].map((stage) => ({ stage: stage as LiveOperationsSnapshot["stages"][number]["stage"], count: stage === "approved" ? 1 : 0 })),
  providers: [{ id: "connection_groq", providerId: "groq", label: "Groq", modelId: "model-free", state: "ready", admitted: true, zeroCost: true, updatedAt: now - 500 }],
  recentEvents: [
    { id: "event_0123456789abcdef", kind: "request", state: "validation_failed", title: "Validate local change", detail: "token=super-secret /Users/private/project failed.", observedAt: now - 100, projectId, requestId, providerId: "groq" },
    { id: "event_1123456789abcdef", kind: "project", state: "ready", title: "Example project", detail: "Project observation is ready.", observedAt: now - 200, projectId, requestId: null, providerId: null },
    { id: "event_2123456789abcdef", kind: "provider", state: "ready", title: "Groq", detail: "Free model admitted.", observedAt: now - 300, projectId: null, requestId: null, providerId: "groq" },
    { id: "event_3123456789abcdef", kind: "system", state: "future_unknown", title: "Unknown observation", detail: "Future state retained without guessing.", observedAt: now - 400, projectId: null, requestId: null, providerId: null },
    { id: "event_4123456789abcdef", kind: "project", state: "warning", title: "Project warning", detail: "Bounded observation needs attention.", observedAt: now - 450, projectId, requestId: null, providerId: null },
  ],
};
const autonomy: AutonomySnapshot = {
  schemaVersion: 1,
  provenance: "local_autonomy_coordinator",
  observedAt: now,
  validForMs: 15_000,
  automaticSpendLimitUsd: 0,
  health: "attention",
  running: true,
  preferences: [],
  overrides: [],
  recommendations: [{
    requestId, projectId, expectedUpdatedAt: now - 50, classification: "approval", action: null,
    boundary: "approve_plan", title: "Approve the grounded plan", reason: "Human authority is required.",
    effect: "none", maximumCostUsd: 0, automaticAllowed: false, retryAt: null, evidence: ["Canonical request revision"],
  }],
  leases: [],
  receipts: [{
    id: "receipt_0123456789abcdef", requestId, projectId, action: "reconcile_execution", outcome: "completed",
    detail: "Preserved execution reconciled.", startedAt: now - 80, completedAt: now - 60, expectedUpdatedAt: now - 90, resultingUpdatedAt: now - 60,
  }],
  nextWakeAt: null,
};

test("activity aggregation maps every source, orders stably, and computes facets and summaries", () => {
  const snapshot = buildActivitySnapshot({ live, autonomy, query: { range: "24h" }, now });
  assert.deepEqual([...new Set(snapshot.events.map((event) => event.kind))].sort(), ["autonomy", "project", "provider", "request", "system"]);
  assert.equal(snapshot.events[0]?.state, "approval");
  assert.equal(snapshot.events.every((event, index) => index === 0 || (snapshot.events[index - 1]?.observedAt ?? 0) >= event.observedAt), true);
  assert.equal(snapshot.summary.failures, 1);
  assert.equal(snapshot.summary.decisions, 1);
  assert.equal(snapshot.summary.recoveries, 1);
  assert.equal(snapshot.summary.providers, 1);
  assert.ok(snapshot.facets.kinds.some((facet) => facet.value === "autonomy"));
  assert.deepEqual(snapshot.events.map((event) => event.id), buildActivitySnapshot({ live, autonomy, query: { range: "24h" }, now }).events.map((event) => event.id));
});

test("activity filters are conjunctive, ranges are bounded, and unknown states remain neutral", () => {
  const filtered = buildActivitySnapshot({ live, autonomy, query: { range: "1h", kinds: ["request"], severities: ["failure"], search: "validate" }, now });
  assert.equal(filtered.events.length, 1);
  assert.equal(filtered.events[0]?.kind, "request");
  assert.equal(filtered.events[0]?.severity, "failure");
  const noMatch = buildActivitySnapshot({ live, autonomy, query: { range: "1h", search: "not present" }, now });
  assert.equal(noMatch.events.length, 0);
  const unknown = buildActivitySnapshot({ live, autonomy, query: { range: "all", kinds: ["system"] }, now });
  assert.equal(unknown.events[0]?.severity, "neutral");
  const warning = buildActivitySnapshot({ live, autonomy, query: { range: "all", kinds: ["project"], severities: ["attention"] }, now });
  assert.equal(warning.events[0]?.state, "warning");
});

test("activity redacts secrets and personal paths while preserving safe canonical references", () => {
  const snapshot = buildActivitySnapshot({ live, autonomy, query: { range: "all" }, now });
  const serialized = JSON.stringify(snapshot);
  assert.doesNotMatch(serialized, /super-secret|\/Users\/private/);
  assert.match(serialized, /\[redacted\]|\/Users\/\[user\]/);
  assert.equal(snapshot.automaticSpendLimitUsd, 0);
  assert.equal(snapshot.retention.maximumEvents, 250);
  assert.ok(snapshot.events.every((event) => event.reference.path.startsWith("/")));
});

test("activity distinguishes canonical request summaries from execution run events", () => {
  const approved = structuredClone(live);
  approved.recentEvents[0] = { ...approved.recentEvents[0]!, state: "approved" };
  const summary = buildActivitySnapshot({ live: approved, autonomy, query: { range: "all", kinds: ["request"] }, now });
  const run = buildActivitySnapshot({ live, autonomy, query: { range: "all", kinds: ["request"] }, now });
  assert.equal(summary.events[0]?.source, "request_summary");
  assert.equal(run.events[0]?.source, "request_run");
});
