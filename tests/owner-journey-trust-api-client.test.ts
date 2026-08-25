import assert from "node:assert/strict";
import test from "node:test";

import { createControlPlaneServer } from "../apps/core/src/control-plane.js";
import { getOwnerJourneyTrust, tickOwnerJourneyTrust } from "../apps/studio/src/owner-journey-certification-client.js";
import type { OwnerJourneyTrustSnapshot } from "../packages/runtime/src/owner-journey-certification.js";

const now = 1_800_000_000_000;
const snapshot: OwnerJourneyTrustSnapshot = {
  schemaVersion: 1, provenance: "local_owner_journey_trust", observedAt: now, validForMs: 15_000, automaticSpendLimitUsd: 0,
  freshness: { schemaVersion: 1, provenance: "local_certification_freshness", state: "current", observedAt: now, lastPassedAt: now - 1_000, nextCheckAt: now + 604_800_000, dueAt: now + 604_800_000, retryAt: null, cadenceMs: 604_800_000, automaticSpendLimitUsd: 0, message: "Local certification is current." },
  learning: { schemaVersion: 1, provenance: "privacy_safe_external_learning_aggregate", observedAt: now, completedSessions: 0, eligibleForDecision: false, minimumSampleSize: 3, completionRatePercent: null, medianTimeToPreviewSeconds: null, averageTrustRating: null, trustAtLeastFourPercent: null, frictionCounts: { setup: 0, navigation: 0, trust: 0, clarity: 0, speed: 0, approval: 0, none: 0 }, excludedDrafts: 0, excludedWithdrawn: 0, automaticSpendLimitUsd: 0, limitations: ["Three sessions required."] },
  readiness: { schemaVersion: 1, provenance: "local_pilot_readiness_policy", observedAt: now, state: "learning_needed", title: "More owner sessions needed", reason: "Three sessions required.", nextAction: "Record a session", reasons: ["Minimum sample not reached."], automaticSpendLimitUsd: 0 },
};

test("trust API and client are loopback-only, bounded, input-free, zero-cost, and idempotency guarded", async () => {
  let ticks = 0;
  const server = createControlPlaneServer({
    host: "127.0.0.1", port: 0, allowedOrigins: ["http://127.0.0.1:4310"],
    health: () => ({ schemaVersion: 1, instanceId: "0f86b913-7600-4c6f-a102-2fc6e4250c6f", status: "ready", observedAt: now, uptimeSeconds: 1 }),
    snapshot: () => ({ schemaVersion: 1, instanceId: "0f86b913-7600-4c6f-a102-2fc6e4250c6f", provenance: "local_observation", featureDataMode: "synthetic_fixture", observedAt: now, validForMs: 15_000, setup: { state: "ready", requiredChecksReady: 1, requiredChecksTotal: 1 }, services: [] }),
    ownerJourneyTrust: { snapshot: () => snapshot, tick: () => { ticks += 1; return snapshot; } },
  });
  const port = await server.listen(); const endpoint = `http://127.0.0.1:${port}`;
  try {
    assert.equal((await getOwnerJourneyTrust(endpoint)).readiness.state, "learning_needed");
    assert.equal((await tickOwnerJourneyTrust(endpoint, "trust.client.tick.0001")).automaticSpendLimitUsd, 0);
    assert.equal(ticks, 1);
    assert.equal((await fetch(`${endpoint}/api/v1/owner-journey-trust?bad=1`)).status, 400);
    assert.equal((await fetch(`${endpoint}/api/v1/owner-journey-trust`, { method: "POST" })).status, 405);
    assert.equal((await fetch(`${endpoint}/api/v1/owner-journey-trust/tick`, { method: "GET" })).status, 405);
    assert.equal((await fetch(`${endpoint}/api/v1/owner-journey-trust/tick`, { method: "POST" })).status, 400);
    assert.equal((await fetch(`${endpoint}/api/v1/owner-journey-trust/tick`, { method: "POST", headers: { Origin: "https://example.com", "Idempotency-Key": "trust.client.tick.0002" } })).status, 403);
  } finally { await server.close(); }
  await assert.rejects(() => getOwnerJourneyTrust("https://example.com"));
});
