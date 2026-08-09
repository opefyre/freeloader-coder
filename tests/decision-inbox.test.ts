import assert from "node:assert/strict";
import test from "node:test";

import { buildDecisionSnapshot } from "../apps/core/src/decision-inbox.js";
import type { AutonomySnapshot } from "../packages/runtime/src/autonomy.js";
import type { LiveOperationsSnapshot } from "../packages/runtime/src/live-operations.js";

const now = 1_800_000_000_000;
const projectId = "project_0123456789abcdef";
const requestId = "request_0123456789abcdef0123";
const live: LiveOperationsSnapshot = {
  schemaVersion: 1, provenance: "local_operational_aggregation", observedAt: now, validForMs: 15_000, automaticSpendLimitUsd: 0, health: "attention",
  totals: { projects: 1, requests: 1, active: 0, completed: 0, needsAttention: 1, providers: 1, readyProviders: 0 },
  stages: ["needs_input", "queued", "approved", "claimed", "checkpointed", "completed", "interrupted", "cancelled"].map((stage) => ({ stage: stage as LiveOperationsSnapshot["stages"][number]["stage"], count: stage === "needs_input" ? 1 : 0 })),
  providers: [{ id: "connection_groq", providerId: "groq", label: "Groq", modelId: "model-free", state: "limited", admitted: true, zeroCost: true, updatedAt: now - 500 }],
  recentEvents: [
    { id: "event_0123456789abcdef", kind: "request", state: "validation_failed", title: "Validation needs review", detail: "token=super-secret /Users/private/repo failed.", observedAt: now - 100, projectId, requestId, providerId: "groq" },
    { id: "event_1123456789abcdef", kind: "project", state: "warning", title: "Project warning", detail: "A deterministic scan needs review.", observedAt: now - 200, projectId, requestId: null, providerId: null },
    { id: "event_2123456789abcdef", kind: "system", state: "healthy", title: "Healthy", detail: "No decision.", observedAt: now - 300, projectId: null, requestId: null, providerId: null },
  ],
};
const autonomy: AutonomySnapshot = {
  schemaVersion: 1, provenance: "local_autonomy_coordinator", observedAt: now, validForMs: 15_000, automaticSpendLimitUsd: 0, health: "attention", running: true,
  preferences: [], overrides: [],
  recommendations: [{
    requestId, projectId, expectedUpdatedAt: now - 50, classification: "approval", action: null, boundary: "approve_plan",
    title: "Approve the grounded plan", reason: "Human authority is required.", effect: "none", maximumCostUsd: 0,
    automaticAllowed: false, retryAt: null, evidence: ["Canonical request revision"],
  }],
  leases: [{ requestId, owner: "local_safe_step_coordinator", acquiredAt: now - 1_000, expiresAt: now - 10 }],
  receipts: [], nextWakeAt: null,
};

test("decision aggregation maps canonical blockers, prioritizes, deduplicates, and summarizes", () => {
  const snapshot = buildDecisionSnapshot({ live, autonomy, query: { range: "7d" }, now });
  assert.deepEqual([...new Set(snapshot.items.map((item) => item.category))].sort(), ["approval", "failure", "project", "provider", "recovery"]);
  assert.equal(snapshot.items[0]?.priority, "critical");
  assert.equal(snapshot.items[0]?.category, "recovery");
  assert.equal(snapshot.summary.open, 5);
  assert.equal(snapshot.summary.critical, 1);
  assert.equal(snapshot.summary.approvals, 1);
  assert.equal(snapshot.summary.providerWaits, 1);
  assert.equal(snapshot.summary.blockedProjects, 1);
  assert.deepEqual(snapshot.items.map((item) => item.id), buildDecisionSnapshot({ live, autonomy, query: { range: "7d" }, now }).items.map((item) => item.id));
});

test("decision filters are conjunctive and unknown healthy observations create no work", () => {
  const filtered = buildDecisionSnapshot({ live, autonomy, query: { range: "24h", categories: ["failure"], priorities: ["high"], owners: ["user"], search: "validation" }, now });
  assert.equal(filtered.items.length, 1);
  assert.equal(filtered.items[0]?.category, "failure");
  assert.equal(filtered.items[0]?.reference.surface, "work");
  const none = buildDecisionSnapshot({ live, autonomy, query: { range: "24h", search: "healthy" }, now });
  assert.equal(none.items.length, 0);
});

test("decision privacy, authority, aging, cost, and bounded-retention rules are enforced", () => {
  const snapshot = buildDecisionSnapshot({ live, autonomy, query: { range: "all" }, now });
  const serialized = JSON.stringify(snapshot);
  assert.doesNotMatch(serialized, /super-secret|\/Users\/private/);
  assert.match(serialized, /\[redacted\]|\/Users\/\[user\]/);
  assert.ok(snapshot.items.every((item) => item.maximumCostUsd === 0));
  assert.ok(snapshot.items.every((item) => item.authorityBoundary && item.evidence.length > 0));
  assert.equal(snapshot.retention.maximumItems, 250);
  assert.ok(snapshot.items.every((item) => item.reference.path.startsWith("/")));
});

test("unanswered lifecycle clarifications appear as project-scoped owner actions", () => {
  const lifecycle = {
    schemaVersion: 1 as const, projectId, stage: "clarification" as const, revision: 2, mission: "Build a portal.", assessment: null,
    questions: [{ id: "question_0123456789abcdef", prompt: "Who can sign up?", whyItMatters: "Identity architecture changes.", options: [{ id: "invite", label: "Invite", consequence: "Admins invite." }, { id: "public", label: "Public", consequence: "Anyone registers." }], allowsCustomAnswer: false, sourceFindingIds: ["identity-gap"] }],
    answers: [], artifacts: [], designApproval: null, designFeedback: [], jiraEpicId: null, blockedReason: null, updatedAt: now - 25,
  };
  const snapshot = buildDecisionSnapshot({ live: { ...live, providers: [], recentEvents: [] }, autonomy: { ...autonomy, recommendations: [], leases: [] }, lifecycles: [lifecycle], query: { range: "all" }, now });
  assert.equal(snapshot.items.length, 1);
  assert.equal(snapshot.items[0]?.category, "input");
  assert.equal(snapshot.items[0]?.owner, "user");
  assert.equal(snapshot.items[0]?.projectId, projectId);
  assert.equal(snapshot.items[0]?.source, "project_clarification");
  assert.equal(snapshot.items[0]?.reference.path, `/work?project=${projectId}`);
  assert.equal(snapshot.summary.blockedProjects, 1);
});

test("reviewed solutions appear as digest-backed owner approvals", () => {
  const lifecycle = {
    schemaVersion: 1 as const, projectId, stage: "awaiting_design_approval" as const, revision: 5, mission: "Build a portal.", assessment: null, questions: [], answers: [],
    artifacts: [{ kind: "solution" as const, projectRelativePath: ".pipeline/SOLUTION.md" as const, digest: "b".repeat(64), revision: 1, createdAt: now - 30, citations: ["local://CONTEXT.md"], reviewerIds: ["product-reviewer", "technical-reviewer"], qaPassed: true }],
    designApproval: null, designFeedback: [], jiraEpicId: null, blockedReason: null, updatedAt: now - 25,
  };
  const snapshot = buildDecisionSnapshot({ live: { ...live, providers: [], recentEvents: [] }, autonomy: { ...autonomy, recommendations: [], leases: [] }, lifecycles: [lifecycle], query: { range: "all" }, now });
  assert.equal(snapshot.items.length, 1);
  assert.equal(snapshot.items[0]?.source, "project_solution");
  assert.equal(snapshot.items[0]?.category, "approval");
  assert.match(snapshot.items[0]?.evidence.join(" ") ?? "", /2 independent reviewers/);
});
