import assert from "node:assert/strict";
import test from "node:test";

import { createControlPlaneServer } from "../apps/core/src/control-plane.js";
import { advanceSafeStep, changeProjectAutonomyMode, fetchAutonomySnapshot } from "../apps/studio/src/autonomy-client.js";
import type { AutonomySnapshot } from "../packages/runtime/src/autonomy.js";
import type { ControlPlaneHealth, ControlPlaneSnapshot } from "../packages/runtime/src/control-plane.js";

const now = 1_800_000_000_000;
const autonomy: AutonomySnapshot = {
  schemaVersion: 1, provenance: "local_autonomy_coordinator", observedAt: now, validForMs: 15_000,
  automaticSpendLimitUsd: 0, health: "idle", running: true, preferences: [], overrides: [],
  recommendations: [], leases: [], receipts: [], nextWakeAt: null,
};
const instanceId = "0f86b913-7600-4c6f-a102-2fc6e4250c6f";
const health: ControlPlaneHealth = { schemaVersion: 1, instanceId, status: "ready", observedAt: now, uptimeSeconds: 5 };
const runtime: ControlPlaneSnapshot = { schemaVersion: 1, instanceId, provenance: "local_observation", featureDataMode: "synthetic_fixture", observedAt: now, validForMs: 15_000, setup: { state: "ready", requiredChecksReady: 1, requiredChecksTotal: 1 }, services: [{ id: "control_plane", state: "available", required: true, observedAt: now }] };

test("autonomy API is read-only by default and mutations require idempotency", async () => {
  const calls: string[] = [];
  const server = createControlPlaneServer({
    host: "127.0.0.1", port: 0, allowedOrigins: ["http://127.0.0.1:4310"], health: () => health, snapshot: () => runtime,
    autonomy: {
      snapshot: () => autonomy,
      setProjectMode: (id) => { calls.push(`mode:${id}`); return { schemaVersion: 1, outcome: "mode_changed", snapshot: autonomy, receipt: null }; },
      setProjectPaused: (id) => { calls.push(`pause:${id}`); return { schemaVersion: 1, outcome: "pause_changed", snapshot: autonomy, receipt: null }; },
      setRequestMode: (id) => { calls.push(`request-mode:${id}`); return { schemaVersion: 1, outcome: "mode_changed", snapshot: autonomy, receipt: null }; },
      advance: (id) => { calls.push(`advance:${id}`); return { schemaVersion: 1, outcome: "no_action", snapshot: autonomy, receipt: null }; },
    },
  });
  const port = await server.listen();
  const base = `http://127.0.0.1:${port}`;
  try {
    assert.deepEqual(await fetchAutonomySnapshot({ endpoint: base }), autonomy);
    assert.equal((await fetch(`${base}/api/v1/autonomy`, { method: "POST" })).status, 405);
    assert.equal((await fetch(`${base}/api/v1/autonomy`, { headers: { Origin: "https://example.com" } })).status, 403);
    assert.equal((await fetch(`${base}/api/v1/autonomy/projects/project_0123456789abcdef/mode`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ schemaVersion: 1, mode: "guided", confirmBroaderAutomation: false }) })).status, 400);
    await changeProjectAutonomyMode({ endpoint: base, projectId: "project_0123456789abcdef", mode: "autonomous", confirmBroaderAutomation: true, idempotencyKey: "mode:0123456789abcdef" });
    await advanceSafeStep({ endpoint: base, requestId: "request_0123456789abcdef0123", expectedUpdatedAt: now, idempotencyKey: "advance:0123456789abcdef" });
    assert.deepEqual(calls, ["mode:project_0123456789abcdef", "advance:request_0123456789abcdef0123"]);
  } finally { await server.close(); }
});

test("browser client rejects remote origins, malformed data, oversized bodies, and bad identities", async () => {
  await assert.rejects(() => fetchAutonomySnapshot({ endpoint: "https://example.com", fetcher: async () => Response.json(autonomy) }));
  await assert.rejects(() => fetchAutonomySnapshot({ endpoint: "http://127.0.0.1:4312", fetcher: async () => Response.json({ schemaVersion: 1 }) }));
  await assert.rejects(() => fetchAutonomySnapshot({ endpoint: "http://127.0.0.1:4312", fetcher: async () => new Response("{}", { headers: { "content-length": "400001" } }) }));
  await assert.rejects(() => changeProjectAutonomyMode({ endpoint: "http://127.0.0.1:4312", projectId: "bad", mode: "guided", confirmBroaderAutomation: false, idempotencyKey: "mode:bad", fetcher: async () => Response.json({}) }));
});
