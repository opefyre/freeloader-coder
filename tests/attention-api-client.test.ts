import assert from "node:assert/strict";
import test from "node:test";

import { createControlPlaneServer } from "../apps/core/src/control-plane.js";
import { applyAttentionAction, fetchAttention, previewAttentionAction } from "../apps/studio/src/attention-client.js";
import type { AttentionSnapshot } from "../packages/runtime/src/attention.js";
import type { ControlPlaneHealth, ControlPlaneSnapshot } from "../packages/runtime/src/control-plane.js";

const now = 1_800_000_000_000;
const snapshot: AttentionSnapshot = {
  schemaVersion: 1, provenance: "local_attention_center", observedAt: now, validForMs: 15_000, automaticSpendLimitUsd: 0, revision: 0,
  query: { severities: [], categories: [], dispositions: [], projectId: null, providerId: null, search: "", includeSuppressed: true },
  summary: { total: 0, unread: 0, badge: 0, critical: 0, snoozed: 0, suppressed: 0, oldestObservedAt: null },
  facets: { severities: [], categories: [], dispositions: [], projects: [], providers: [] },
  quietHours: { enabled: false, startMinute: 1_320, endMinute: 480, timeZone: "UTC", criticalBypass: true }, quietHoursActive: false, nextDeliveryAt: null,
  retention: { bounded: true, maximumItems: 250, maximumReceipts: 500, completeness: "bounded_current_state" }, items: [],
};
const instanceId = "0f86b913-7600-4c6f-a102-2fc6e4250c6f";
const health: ControlPlaneHealth = { schemaVersion: 1, instanceId, status: "ready", observedAt: now, uptimeSeconds: 5 };
const runtime: ControlPlaneSnapshot = { schemaVersion: 1, instanceId, provenance: "local_observation", featureDataMode: "synthetic_fixture", observedAt: now, validForMs: 15_000, setup: { state: "ready", requiredChecksReady: 1, requiredChecksTotal: 1 }, services: [{ id: "control_plane", state: "available", required: true, observedAt: now }] };

test("attention API validates reads, previews, mutations, origins, methods, and idempotency", async () => {
  const observed: unknown[] = [];
  const server = createControlPlaneServer({
    host: "127.0.0.1", port: 0, allowedOrigins: ["http://127.0.0.1:4310"], health: () => health, snapshot: () => runtime,
    attention: {
      snapshot: (query) => { observed.push(query); return { ...snapshot, query }; },
      preview: (input) => ({ schemaVersion: 1, previewId: "attention_preview_0123456789abcdef0123", action: (input as { action: "read" }).action, target: "Item", effect: "local_preference_write", reversible: true, maximumCostUsd: 0, previousRevision: 0, nextDisposition: "read", effectiveAt: now, expiresAt: now + 60_000 }),
      apply: (_input, idempotencyKey) => ({ schemaVersion: 1, snapshot, receipt: { schemaVersion: 1, id: "attention_receipt_0123456789abcdef0123", idempotencyKey, action: "read", target: "attention_0123456789abcdef0123", previousRevision: 0, nextRevision: 1, appliedAt: now, outcome: "applied" } }),
      previewQuietHours: () => ({ schemaVersion: 1, previewId: "attention_preview_1123456789abcdef0123", action: "quiet_hours", target: "Quiet hours", effect: "local_preference_write", reversible: true, maximumCostUsd: 0, previousRevision: 0, nextDisposition: null, effectiveAt: now, expiresAt: now + 60_000 }),
      setQuietHours: (_input, _revision, idempotencyKey) => ({ schemaVersion: 1, snapshot, receipt: { schemaVersion: 1, id: "attention_receipt_1123456789abcdef0123", idempotencyKey, action: "quiet_hours", target: "quiet_hours", previousRevision: 0, nextRevision: 1, appliedAt: now, outcome: "applied" } }),
    },
  });
  const port = await server.listen();
  const endpoint = `http://127.0.0.1:${port}`;
  const action = { action: "read" as const, itemId: "attention_0123456789abcdef0123", expectedRevision: 0 };
  try {
    await fetchAttention({ endpoint, query: { severities: ["critical"], categories: ["action"], dispositions: ["unread"], search: "approval" } });
    assert.equal(observed.length, 1);
    assert.equal((await previewAttentionAction(endpoint, action)).action, "read");
    assert.equal((await applyAttentionAction(endpoint, action, "attention.client.apply.0001")).receipt.outcome, "applied");
    assert.equal((await fetch(`${endpoint}/api/v1/attention`, { method: "POST" })).status, 405);
    assert.equal((await fetch(`${endpoint}/api/v1/attention?unknown=yes`)).status, 400);
    assert.equal((await fetch(`${endpoint}/api/v1/attention?severity=critical&severity=critical`)).status, 400);
    assert.equal((await fetch(`${endpoint}/api/v1/attention`, { headers: { Origin: "https://example.com" } })).status, 403);
    assert.equal((await fetch(`${endpoint}/api/v1/attention/actions`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(action) })).status, 400);
  } finally { await server.close(); }
});

test("attention client rejects remote, malformed, oversized, and invalid responses", async () => {
  await assert.rejects(() => fetchAttention({ endpoint: "https://example.com" }));
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => Response.json({ schemaVersion: 1 });
    await assert.rejects(() => fetchAttention({ endpoint: "http://127.0.0.1:4312" }));
    globalThis.fetch = async () => new Response("{}", { headers: { "content-length": "700001" } });
    await assert.rejects(() => fetchAttention({ endpoint: "http://127.0.0.1:4312" }));
  } finally { globalThis.fetch = original; }
});
