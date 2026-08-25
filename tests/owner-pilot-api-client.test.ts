import assert from "node:assert/strict";
import test from "node:test";

import { createControlPlaneServer } from "../apps/core/src/control-plane.js";
import {
  advanceOwnerPilot,
  completeOwnerPilot,
  createOwnerPilot,
  getOwnerPilotReview,
  listOwnerPilot,
  withdrawOwnerPilot,
} from "../apps/studio/src/owner-journey-certification-client.js";

const now = 1_800_000_000_000;
const id = `pilot_${"a".repeat(20)}`;
const projectId = `project_${"b".repeat(16)}`;
const base = {
  schemaVersion: 1 as const,
  id,
  projectId,
  revision: 1,
  status: "active" as const,
  scenario: "new_product" as const,
  consentedAt: now,
  startedAt: now,
  previewAt: null,
  completedAt: null,
  milestones: [{ name: "session_started" as const, at: now }],
  trustRating: null,
  frictions: [],
  note: "",
  evidenceDigest: "c".repeat(64),
  automaticSpendLimitUsd: 0 as const,
};

test("owner pilot loopback API is method-safe, idempotent, bounded, and zero-cost", async () => {
  const keys: string[] = [];
  const server = createControlPlaneServer({
    host: "127.0.0.1",
    port: 0,
    allowedOrigins: ["http://127.0.0.1:4310"],
    health: () => ({
      schemaVersion: 1,
      instanceId: "0f86b913-7600-4c6f-a102-2fc6e4250c6f",
      status: "ready",
      observedAt: now,
      uptimeSeconds: 1,
    }),
    snapshot: () => ({
      schemaVersion: 1,
      instanceId: "0f86b913-7600-4c6f-a102-2fc6e4250c6f",
      provenance: "local_observation",
      featureDataMode: "synthetic_fixture",
      observedAt: now,
      validForMs: 15_000,
      setup: { state: "ready", requiredChecksReady: 1, requiredChecksTotal: 1 },
      services: [],
    }),
    ownerPilot: {
      list: () => ({
        schemaVersion: 1,
        provenance: "local_consented_owner_pilot",
        sessions: [],
        automaticSpendLimitUsd: 0,
      }),
      create: (_input, key) => {
        keys.push(key);
        return base;
      },
      advance: () => ({
        ...base,
        revision: 2,
        milestones: [
          ...base.milestones,
          { name: "context_ready" as const, at: now + 1 },
        ],
      }),
      complete: () => ({
        ...base,
        revision: 2,
        status: "completed" as const,
        previewAt: now + 1,
        completedAt: now + 2,
        milestones: [
          ...base.milestones,
          { name: "context_ready" as const, at: now + 1 },
          { name: "solution_approved" as const, at: now + 1 },
          { name: "first_preview" as const, at: now + 1 },
          { name: "session_completed" as const, at: now + 2 },
        ],
        trustRating: 4,
        frictions: ["none" as const],
      }),
      withdraw: () => ({ ...base, revision: 2, status: "withdrawn" as const }),
      review: () => ({
        schemaVersion: 1,
        provenance: "privacy_safe_owner_pilot_review",
        observedAt: now,
        state: "sample_needed",
        title: "More pilot sessions needed",
        reason: "3 more completed consented sessions required.",
        completedSessions: 0,
        minimumSampleSize: 3,
        completionRatePercent: null,
        medianTimeToPreviewSeconds: null,
        trustAtLeastFourPercent: null,
        rankedFrictions: [],
        improvements: [],
        limitations: ["Pilot evidence only."],
        evidenceDigest: "d".repeat(64),
        automaticSpendLimitUsd: 0,
      }),
    },
  });
  const port = await server.listen();
  const endpoint = `http://127.0.0.1:${port}`;
  try {
    assert.equal((await listOwnerPilot(endpoint)).sessions.length, 0);
    assert.equal((await getOwnerPilotReview(endpoint)).state, "sample_needed");
    assert.equal(
      (
        await createOwnerPilot(
          endpoint,
          { projectId, scenario: "new_product", consent: true, startedAt: now },
          "pilot.client.create.0001",
        )
      ).id,
      id,
    );
    assert.deepEqual(keys, ["pilot.client.create.0001"]);
    assert.equal(
      (
        await advanceOwnerPilot(endpoint, id, {
          expectedRevision: 1,
          milestone: "context_ready",
          at: now + 1,
        })
      ).revision,
      2,
    );
    assert.equal(
      (
        await completeOwnerPilot(endpoint, id, {
          expectedRevision: 1,
          completedAt: now + 2,
          trustRating: 4,
          frictions: ["none"],
          note: "",
        })
      ).status,
      "completed",
    );
    assert.equal(
      (await withdrawOwnerPilot(endpoint, id, 1)).status,
      "withdrawn",
    );
    assert.equal(
      (await fetch(`${endpoint}/api/v1/owner-pilot?bad=1`)).status,
      400,
    );
    assert.equal(
      (await fetch(`${endpoint}/api/v1/owner-pilot`, { method: "DELETE" }))
        .status,
      405,
    );
    assert.equal(
      (
        await fetch(`${endpoint}/api/v1/owner-pilot`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await fetch(`${endpoint}/api/v1/owner-pilot`, {
          headers: { Origin: "https://example.com" },
        })
      ).status,
      403,
    );
  } finally {
    await server.close();
  }
  await assert.rejects(() => listOwnerPilot("https://example.com"));
});
