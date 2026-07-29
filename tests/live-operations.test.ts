import assert from "node:assert/strict";
import test from "node:test";

import { buildLiveOperationsSnapshot } from "../apps/core/src/live-operations.js";
import { createControlPlaneServer } from "../apps/core/src/control-plane.js";
import { fetchLiveOperations } from "../apps/studio/src/live-operations-client.js";
import type { ControlPlaneHealth, ControlPlaneSnapshot } from "../packages/runtime/src/control-plane.js";
import type { LocalProjectCollection } from "../packages/runtime/src/local-projects.js";
import type { LocalRequestCollection } from "../packages/runtime/src/local-requests.js";
import type { PublicProviderConnectionCollection } from "../packages/runtime/src/provider-connections.js";

const observedAt = 1_800_000_000_000;
const projects: LocalProjectCollection = {
  schemaVersion: 1,
  provenance: "local_observation",
  observedAt,
  projects: [{
    schemaVersion: 1,
    id: "project_0123456789abcdef",
    displayName: "Studio",
    state: "ready",
    observedAt,
    validForMs: 15_000,
    facts: [],
    inferences: [],
    decisions: [],
    warnings: [],
  }],
};
const requests: LocalRequestCollection = {
  schemaVersion: 1,
  provenance: "local_observation",
  observedAt,
  requests: [{
    schemaVersion: 1,
    id: "request_0123456789abcdef0123",
    projectId: "project_0123456789abcdef",
    outcome: "Add status panel token=top-secret-value /Users/alice/private",
    readiness: "ready",
    state: "completed",
    provenance: "local_request",
    createdAt: observedAt - 2_000,
    updatedAt: observedAt - 1_000,
    findings: [],
    workPreview: null,
    run: null,
  }],
};
const providers: PublicProviderConnectionCollection = {
  schemaVersion: 1,
  observedAt,
  automaticSpendLimitUsd: 0,
  catalog: [],
  connections: [{
    schemaVersion: 1,
    id: "groq-primary",
    providerId: "groq",
    providerLabel: "Groq",
    modelId: "openai/gpt-oss-120b",
    state: "ready",
    credentialState: "active",
    maskedCredential: "vault:••••",
    privacyClass: "training_eligible",
    capabilityRoles: ["planner", "implementer", "reviewer"],
    cost: {
      access: "permanent_free",
      plan: "Free",
      zeroCost: true,
      billingEnabled: false,
      observedAt,
      expiresAt: observedAt + 60_000,
      source: "user_attestation",
    },
    quota: {
      source: "conservative_default",
      observedAt,
      expiresAt: observedAt + 60_000,
      requestsPerMinute: 5,
      requestsPerDay: 1_000,
      tokensPerMinute: null,
      tokensPerDay: null,
      remainingRequests: null,
      remainingTokens: null,
      resetAt: null,
    },
    canary: {
      status: "passed",
      observedAt,
      expiresAt: observedAt + 60_000,
      modelId: "openai/gpt-oss-120b",
      capabilities: ["chat", "structured_output"],
      inputTokens: 5,
      outputTokens: 3,
      failureCode: null,
    },
    admission: {
      admitted: true,
      reason: "eligible",
      detail: "Free route admitted.",
      retryAt: null,
    },
    updatedAt: observedAt,
  }],
};

test("live aggregation derives truthful totals and redacts sensitive text", () => {
  const snapshot = buildLiveOperationsSnapshot({ projects, requests, providers, now: observedAt });
  assert.equal(snapshot.totals.projects, 1);
  assert.equal(snapshot.totals.requests, 1);
  assert.equal(snapshot.totals.completed, 1);
  assert.equal(snapshot.totals.readyProviders, 1);
  assert.equal(snapshot.health, "idle");
  assert.equal(snapshot.automaticSpendLimitUsd, 0);
  const serialized = JSON.stringify(snapshot);
  assert.equal(serialized.includes("top-secret-value"), false);
  assert.equal(serialized.includes("/Users/alice"), false);
  assert.match(serialized, /\[redacted\]/);
  assert.match(serialized, /\/Users\/\[user\]/);
});

test("live aggregation distinguishes attention from healthy idle", () => {
  const snapshot = buildLiveOperationsSnapshot({
    projects,
    providers: { ...providers, connections: [] },
    requests: {
      ...requests,
      requests: [{ ...requests.requests[0]!, state: "interrupted" }],
    },
    now: observedAt,
  });
  assert.equal(snapshot.health, "attention");
  assert.equal(snapshot.totals.needsAttention, 1);
  assert.equal(snapshot.totals.readyProviders, 0);
});

test("loopback endpoint and Studio client exchange only validated live operations", async () => {
  const live = buildLiveOperationsSnapshot({ projects, requests, providers, now: observedAt });
  const instanceId = "0f86b913-7600-4c6f-a102-2fc6e4250c6f";
  const health: ControlPlaneHealth = { schemaVersion: 1, instanceId, status: "ready", observedAt, uptimeSeconds: 5 };
  const snapshot: ControlPlaneSnapshot = {
    schemaVersion: 1,
    instanceId,
    provenance: "local_observation",
    featureDataMode: "synthetic_fixture",
    observedAt,
    validForMs: 15_000,
    setup: { state: "ready", requiredChecksReady: 1, requiredChecksTotal: 1 },
    services: [{ id: "control_plane", state: "available", required: true, observedAt }],
  };
  const server = createControlPlaneServer({
    host: "127.0.0.1",
    port: 0,
    allowedOrigins: ["http://127.0.0.1:4310"],
    health: () => health,
    snapshot: () => snapshot,
    liveOperations: () => live,
  });
  const port = await server.listen();
  try {
    const result = await fetchLiveOperations({ endpoint: `http://127.0.0.1:${port}` });
    assert.deepEqual(result, live);
    assert.equal((await fetch(`http://127.0.0.1:${port}/api/v1/live-operations`, { method: "POST" })).status, 405);
    assert.equal((await fetch(`http://127.0.0.1:${port}/api/v1/live-operations`, { headers: { Origin: "https://example.com" } })).status, 403);
  } finally {
    await server.close();
  }
});

test("Studio client rejects oversized, malformed, and non-loopback responses", async () => {
  await assert.rejects(() => fetchLiveOperations({
    endpoint: "https://example.com",
    fetcher: async () => Response.json({}),
  }));
  await assert.rejects(() => fetchLiveOperations({
    endpoint: "http://127.0.0.1:4312",
    fetcher: async () => new Response("{}", { headers: { "content-length": "250001" } }),
  }));
  await assert.rejects(() => fetchLiveOperations({
    endpoint: "http://127.0.0.1:4312",
    fetcher: async () => Response.json({ schemaVersion: 1 }),
  }));
});
