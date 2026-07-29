import assert from "node:assert/strict";
import test from "node:test";

import { createControlPlaneServer } from "../apps/core/src/control-plane.js";
import { fetchUniversalSearch } from "../apps/studio/src/search-client.js";
import type { UniversalSearchSnapshot } from "../packages/runtime/src/universal-search.js";
import type { ControlPlaneHealth, ControlPlaneSnapshot } from "../packages/runtime/src/control-plane.js";

const now = 1_800_000_000_000;
const search: UniversalSearchSnapshot = {
  schemaVersion: 1, provenance: "local_universal_search", observedAt: now, validForMs: 15_000, automaticSpendLimitUsd: 0,
  query: { query: "", scopes: [], limit: 24 },
  summary: { queryLength: 0, matched: 0, returned: 0, truncated: false, scopes: [] },
  completeness: "bounded_current_state", results: [],
};
const instanceId = "0f86b913-7600-4c6f-a102-2fc6e4250c6f";
const health: ControlPlaneHealth = { schemaVersion: 1, instanceId, status: "ready", observedAt: now, uptimeSeconds: 5 };
const runtime: ControlPlaneSnapshot = { schemaVersion: 1, instanceId, provenance: "local_observation", featureDataMode: "synthetic_fixture", observedAt: now, validForMs: 15_000, setup: { state: "ready", requiredChecksReady: 1, requiredChecksTotal: 1 }, services: [{ id: "control_plane", state: "available", required: true, observedAt: now }] };

test("universal search API validates queries, scopes, limits, origins, and methods", async () => {
  const observed: unknown[] = [];
  const server = createControlPlaneServer({
    host: "127.0.0.1", port: 0, allowedOrigins: ["http://127.0.0.1:4310"], health: () => health, snapshot: () => runtime,
    search: (query) => { observed.push(query); return { ...search, query }; },
  });
  const port = await server.listen();
  const endpoint = `http://127.0.0.1:${port}`;
  try {
    const result = await fetchUniversalSearch({ endpoint, query: { query: "provider", scopes: ["provider"], limit: 12 } });
    assert.equal(result.query.query, "provider");
    assert.deepEqual(result.query.scopes, ["provider"]);
    assert.equal(observed.length, 1);
    assert.equal((await fetch(`${endpoint}/api/v1/search`, { method: "POST" })).status, 405);
    assert.equal((await fetch(`${endpoint}/api/v1/search?unknown=yes`)).status, 400);
    assert.equal((await fetch(`${endpoint}/api/v1/search?scope=provider&scope=provider`)).status, 400);
    assert.equal((await fetch(`${endpoint}/api/v1/search?limit=4`)).status, 400);
    assert.equal((await fetch(`${endpoint}/api/v1/search?q=${"a".repeat(81)}`)).status, 400);
    assert.equal((await fetch(`${endpoint}/api/v1/search`, { headers: { Origin: "https://example.com" } })).status, 403);
  } finally { await server.close(); }
});

test("universal search client rejects remote, malformed, and oversized responses", async () => {
  await assert.rejects(() => fetchUniversalSearch({ endpoint: "https://example.com", fetcher: async () => Response.json(search) }));
  await assert.rejects(() => fetchUniversalSearch({ endpoint: "http://127.0.0.1:4312", fetcher: async () => Response.json({ schemaVersion: 1 }) }));
  await assert.rejects(() => fetchUniversalSearch({ endpoint: "http://127.0.0.1:4312", fetcher: async () => new Response("{}", { headers: { "content-length": "700001" } }) }));
});
