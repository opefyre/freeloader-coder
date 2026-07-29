import assert from "node:assert/strict";
import test from "node:test";

import { buildUniversalSearchSnapshot } from "../apps/core/src/universal-search.js";
import type { ActivitySnapshot } from "../packages/runtime/src/activity.js";
import type { DecisionSnapshot } from "../packages/runtime/src/decisions.js";
import type { LiveOperationsSnapshot } from "../packages/runtime/src/live-operations.js";

const now = 1_800_000_000_000;
const projectId = "project_0123456789abcdef";
const requestId = "request_0123456789abcdef0123";
const live: LiveOperationsSnapshot = {
  schemaVersion: 1, provenance: "local_operational_aggregation", observedAt: now, validForMs: 15_000, automaticSpendLimitUsd: 0, health: "attention",
  totals: { projects: 1, requests: 1, active: 1, completed: 0, needsAttention: 1, providers: 1, readyProviders: 1 },
  stages: ["needs_input", "queued", "approved", "claimed", "checkpointed", "completed", "interrupted", "cancelled"].map((stage) => ({ stage: stage as LiveOperationsSnapshot["stages"][number]["stage"], count: stage === "needs_input" ? 1 : 0 })),
  providers: [{ id: "connection_groq", providerId: "groq", label: "Groq", modelId: "llama-free", state: "ready", admitted: true, zeroCost: true, updatedAt: now - 200 }],
  recentEvents: [
    { id: "event_0123456789abcdef", kind: "request", state: "needs_input", title: "Clarify dashboard scope", detail: "token=super-secret /Users/private/repo needs a decision.", observedAt: now - 100, projectId, requestId, providerId: "groq" },
    { id: "event_1123456789abcdef", kind: "project", state: "warning", title: "Pipeline Studio", detail: "Read-only scan warning.", observedAt: now - 300, projectId, requestId: null, providerId: null },
  ],
};
const activity: ActivitySnapshot = {
  schemaVersion: 1, provenance: "local_activity_explorer", observedAt: now, validForMs: 15_000, automaticSpendLimitUsd: 0,
  query: { range: "all", kinds: [], severities: [], projectId: null, providerId: null, search: "" },
  summary: { observed: 0, active: 0, decisions: 0, failures: 0, recoveries: 0, providers: 0, lastActivityAt: null },
  facets: { kinds: [], severities: [], projects: [], providers: [] },
  retention: { bounded: true, maximumEvents: 250, completeness: "bounded_current_state", earliestObservedAt: null },
  events: [],
};
const decisions: DecisionSnapshot = {
  schemaVersion: 1, provenance: "local_decision_inbox", observedAt: now, validForMs: 15_000, automaticSpendLimitUsd: 0,
  query: { range: "all", categories: [], priorities: [], owners: [], ages: [], projectId: null, providerId: null, search: "" },
  summary: { open: 1, critical: 0, overdue: 0, approvals: 1, blockedProjects: 1, providerWaits: 0, oldestObservedAt: now - 50 },
  facets: { categories: [], priorities: [], owners: [], ages: [], projects: [], providers: [] },
  retention: { bounded: true, maximumItems: 250, completeness: "bounded_current_state", earliestObservedAt: now - 50 },
  items: [{
    id: "decision_0123456789abcdef0123", category: "approval", priority: "medium", owner: "user", age: "new", state: "open",
    title: "Approve the grounded plan", reason: "Human authority is required.", nextAction: "Review approval facts", authorityBoundary: "approve plan",
    effect: "none", maximumCostUsd: 0, reversible: true, observedAt: now - 50, deadlineAt: null, retryAt: null, projectId, requestId, providerId: null,
    source: "autonomy_recommendation", sourceRecordId: requestId, evidence: ["Canonical request revision"],
    reference: { surface: "work", path: `/work?request=${requestId}`, label: "Open work" },
  }],
};

test("universal search returns deterministic suggestions and ranked canonical results", () => {
  const suggested = buildUniversalSearchSnapshot({ live, activity, decisions, query: { query: "", limit: 24 }, now });
  assert.ok(suggested.results.some((item) => item.title === "Decision inbox"));
  assert.ok(suggested.results.every((item) => item.matchReason === "suggested"));
  const provider = buildUniversalSearchSnapshot({ live, activity, decisions, query: { query: "Groq", scopes: ["provider"], limit: 5 }, now });
  assert.equal(provider.results[0]?.title, "Groq");
  assert.equal(provider.results[0]?.matchReason, "exact");
  assert.deepEqual(provider.results[0]?.highlights[0], { field: "title", start: 0, end: 4 });
  assert.deepEqual(provider.results.map((item) => item.id), buildUniversalSearchSnapshot({ live, activity, decisions, query: { query: "Groq", scopes: ["provider"], limit: 5 }, now }).results.map((item) => item.id));
});

test("universal search scopes, token matching, counts, and safe references are exact", () => {
  const result = buildUniversalSearchSnapshot({ live, activity, decisions, query: { query: "grounded approval", scopes: ["decision"], limit: 5 }, now });
  assert.equal(result.results.length, 1);
  assert.equal(result.results[0]?.scope, "decision");
  assert.equal(result.results[0]?.reference.path, `/work?request=${requestId}`);
  assert.equal(result.summary.scopes[0]?.value, "decision");
  assert.equal(result.summary.queryLength, 17);
  assert.equal(result.automaticSpendLimitUsd, 0);
});

test("universal search redacts sensitive values, bounds results, and never returns external actions", () => {
  const result = buildUniversalSearchSnapshot({ live, activity, decisions, query: { query: "clarify", limit: 5 }, now });
  const serialized = JSON.stringify(result);
  assert.doesNotMatch(serialized, /super-secret|\/Users\/private/);
  assert.match(serialized, /\[redacted\]|\/Users\/\[user\]/);
  assert.ok(result.results.every((item) => item.reference.path.startsWith("/")));
  assert.equal(result.completeness, "bounded_current_state");
  assert.ok(result.results.length <= 5);
});
