import assert from "node:assert/strict";
import test from "node:test";

import { createControlPlaneServer } from "../apps/core/src/control-plane.js";
import { createDecisionExport, fetchDecisions } from "../apps/studio/src/decision-client.js";
import type { DecisionSnapshot } from "../packages/runtime/src/decisions.js";
import type { ControlPlaneHealth, ControlPlaneSnapshot } from "../packages/runtime/src/control-plane.js";

const now = 1_800_000_000_000;
const decisions: DecisionSnapshot = {
  schemaVersion: 1, provenance: "local_decision_inbox", observedAt: now, validForMs: 15_000, automaticSpendLimitUsd: 0,
  query: { range: "7d", categories: [], priorities: [], owners: [], ages: [], projectId: null, providerId: null, search: "" },
  summary: { open: 0, critical: 0, overdue: 0, approvals: 0, blockedProjects: 0, providerWaits: 0, oldestObservedAt: null },
  facets: { categories: [], priorities: [], owners: [], ages: [], projects: [], providers: [] },
  retention: { bounded: true, maximumItems: 250, completeness: "bounded_current_state", earliestObservedAt: null },
  items: [],
};
const instanceId = "0f86b913-7600-4c6f-a102-2fc6e4250c6f";
const health: ControlPlaneHealth = { schemaVersion: 1, instanceId, status: "ready", observedAt: now, uptimeSeconds: 5 };
const runtime: ControlPlaneSnapshot = { schemaVersion: 1, instanceId, provenance: "local_observation", featureDataMode: "synthetic_fixture", observedAt: now, validForMs: 15_000, setup: { state: "ready", requiredChecksReady: 1, requiredChecksTotal: 1 }, services: [{ id: "control_plane", state: "available", required: true, observedAt: now }] };

test("decision API validates bounded queries and remains read-only", async () => {
  const observed: unknown[] = [];
  const server = createControlPlaneServer({
    host: "127.0.0.1", port: 0, allowedOrigins: ["http://127.0.0.1:4310"], health: () => health, snapshot: () => runtime,
    decisions: (query) => { observed.push(query); return { ...decisions, query }; },
  });
  const port = await server.listen();
  const endpoint = `http://127.0.0.1:${port}`;
  try {
    const result = await fetchDecisions({ endpoint, query: { range: "30d", categories: ["failure"], priorities: ["high"], owners: ["user"], ages: ["recent"], search: "validation" } });
    assert.equal(result.query.range, "30d");
    assert.deepEqual(result.query.categories, ["failure"]);
    assert.equal(observed.length, 1);
    assert.equal((await fetch(`${endpoint}/api/v1/decisions`, { method: "POST" })).status, 405);
    assert.equal((await fetch(`${endpoint}/api/v1/decisions?unknown=yes`)).status, 400);
    assert.equal((await fetch(`${endpoint}/api/v1/decisions?priority=high&priority=high`)).status, 400);
    assert.equal((await fetch(`${endpoint}/api/v1/decisions?search=${"a".repeat(81)}`)).status, 400);
    assert.equal((await fetch(`${endpoint}/api/v1/decisions`, { headers: { Origin: "https://example.com" } })).status, 403);
  } finally { await server.close(); }
});

test("decision client rejects remote, malformed, oversized, and unsafe export data", async () => {
  await assert.rejects(() => fetchDecisions({ endpoint: "https://example.com", fetcher: async () => Response.json(decisions) }));
  await assert.rejects(() => fetchDecisions({ endpoint: "http://127.0.0.1:4312", fetcher: async () => Response.json({ schemaVersion: 1 }) }));
  await assert.rejects(() => fetchDecisions({ endpoint: "http://127.0.0.1:4312", fetcher: async () => new Response("{}", { headers: { "content-length": "700001" } }) }));
  assert.equal(createDecisionExport(decisions, now).items.length, 0);
  assert.throws(() => createDecisionExport({ ...decisions, items: [{ secret: "bad" }] } as unknown as DecisionSnapshot, now));
});
