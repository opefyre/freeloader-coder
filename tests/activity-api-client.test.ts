import assert from "node:assert/strict";
import test from "node:test";

import { createControlPlaneServer } from "../apps/core/src/control-plane.js";
import { createActivityExport, fetchActivity } from "../apps/studio/src/activity-client.js";
import type { ActivitySnapshot } from "../packages/runtime/src/activity.js";
import type { ControlPlaneHealth, ControlPlaneSnapshot } from "../packages/runtime/src/control-plane.js";

const now = 1_800_000_000_000;
const activity: ActivitySnapshot = {
  schemaVersion: 1, provenance: "local_activity_explorer", observedAt: now, validForMs: 15_000, automaticSpendLimitUsd: 0,
  query: { range: "24h", kinds: [], severities: [], projectId: null, providerId: null, search: "" },
  summary: { observed: 0, active: 0, decisions: 0, failures: 0, recoveries: 0, providers: 0, lastActivityAt: null },
  facets: { kinds: [], severities: [], projects: [], providers: [] },
  retention: { bounded: true, maximumEvents: 250, completeness: "bounded_current_state", earliestObservedAt: null },
  events: [],
};
const instanceId = "0f86b913-7600-4c6f-a102-2fc6e4250c6f";
const health: ControlPlaneHealth = { schemaVersion: 1, instanceId, status: "ready", observedAt: now, uptimeSeconds: 5 };
const runtime: ControlPlaneSnapshot = { schemaVersion: 1, instanceId, provenance: "local_observation", featureDataMode: "synthetic_fixture", observedAt: now, validForMs: 15_000, setup: { state: "ready", requiredChecksReady: 1, requiredChecksTotal: 1 }, services: [{ id: "control_plane", state: "available", required: true, observedAt: now }] };

test("activity API validates bounded queries and remains read-only", async () => {
  const observed: unknown[] = [];
  const server = createControlPlaneServer({
    host: "127.0.0.1", port: 0, allowedOrigins: ["http://127.0.0.1:4310"], health: () => health, snapshot: () => runtime,
    activity: (query) => { observed.push(query); return { ...activity, query }; },
  });
  const port = await server.listen();
  const endpoint = `http://127.0.0.1:${port}`;
  try {
    const result = await fetchActivity({ endpoint, query: { range: "7d", kinds: ["request"], severities: ["failure"], search: "validation" } });
    assert.equal(result.query.range, "7d");
    assert.deepEqual(result.query.kinds, ["request"]);
    assert.equal(observed.length, 1);
    assert.equal((await fetch(`${endpoint}/api/v1/activity`, { method: "POST" })).status, 405);
    assert.equal((await fetch(`${endpoint}/api/v1/activity?unknown=yes`)).status, 400);
    assert.equal((await fetch(`${endpoint}/api/v1/activity?kind=request&kind=request`)).status, 400);
    assert.equal((await fetch(`${endpoint}/api/v1/activity?search=${"a".repeat(81)}`)).status, 400);
    assert.equal((await fetch(`${endpoint}/api/v1/activity`, { headers: { Origin: "https://example.com" } })).status, 403);
  } finally { await server.close(); }
});

test("activity client rejects remote, malformed, oversized, and unsafe export data", async () => {
  await assert.rejects(() => fetchActivity({ endpoint: "https://example.com", fetcher: async () => Response.json(activity) }));
  await assert.rejects(() => fetchActivity({ endpoint: "http://127.0.0.1:4312", fetcher: async () => Response.json({ schemaVersion: 1 }) }));
  await assert.rejects(() => fetchActivity({ endpoint: "http://127.0.0.1:4312", fetcher: async () => new Response("{}", { headers: { "content-length": "700001" } }) }));
  assert.equal(createActivityExport(activity, now).events.length, 0);
  assert.throws(() => createActivityExport({ ...activity, events: [{ secret: "bad" }] } as unknown as ActivitySnapshot, now));
});
