import assert from "node:assert/strict";
import test from "node:test";

import { createControlPlaneServer } from "../apps/core/src/control-plane.js";
import {
  completeExternalOwnerLearning,
  createExternalOwnerLearning,
  getOwnerJourneyCertification,
  listExternalOwnerLearning,
  previewOwnerJourneyCertification,
  runOwnerJourneyCertification,
  withdrawExternalOwnerLearning,
  getOwnerCertificationEvidence,
  ownerCertificationEvidenceFilename,
} from "../apps/studio/src/owner-journey-certification-client.js";
import type { OwnerJourneyCertificationSnapshot } from "../packages/runtime/src/owner-journey-certification.js";
import type {
  ControlPlaneHealth,
  ControlPlaneSnapshot,
} from "../packages/runtime/src/control-plane.js";

const now = 1_800_000_000_000;
const instanceId = "0f86b913-7600-4c6f-a102-2fc6e4250c6f";
const health: ControlPlaneHealth = {
  schemaVersion: 1,
  instanceId,
  status: "ready",
  observedAt: now,
  uptimeSeconds: 5,
};
const runtime: ControlPlaneSnapshot = {
  schemaVersion: 1,
  instanceId,
  provenance: "local_observation",
  featureDataMode: "synthetic_fixture",
  observedAt: now,
  validForMs: 15_000,
  setup: { state: "ready", requiredChecksReady: 1, requiredChecksTotal: 1 },
  services: [
    {
      id: "control_plane",
      state: "available",
      required: true,
      observedAt: now,
    },
  ],
};
const snapshot: OwnerJourneyCertificationSnapshot = {
  schemaVersion: 1,
  provenance: "local_owner_journey_certification",
  observedAt: now,
  validForMs: 15_000,
  automaticSpendLimitUsd: 0,
  state: "not_run",
  runId: null,
  message: "Certification has not run yet.",
  receipt: null,
  lastPassedReceipt: null,
  historyCount: 0,
};

test("certification API and client are loopback-only, input-free, idempotent, bounded, and zero-cost", async () => {
  const keys: string[] = [];
  const server = createControlPlaneServer({
    host: "127.0.0.1",
    port: 0,
    allowedOrigins: ["http://127.0.0.1:4310"],
    health: () => health,
    snapshot: () => runtime,
    ownerJourneyCertification: {
      snapshot: () => snapshot,
      preview: () => ({
        schemaVersion: 1,
        previewId: `cert_preview_${"a".repeat(20)}`,
        effect: "local_validation_only",
        maximumCostUsd: 0,
        externalEffects: 0,
        estimatedMaximumMinutes: 10,
        preservesPriorPassingEvidence: true,
      }),
      run: (key) => {
        keys.push(key);
        return {
          schemaVersion: 1,
          outcome: "started",
          snapshot: {
            ...snapshot,
            state: "running",
            runId: `cert_run_${"b".repeat(20)}`,
            message: "Running locally.",
          },
        };
      },
    },
  });
  const port = await server.listen();
  const endpoint = `http://127.0.0.1:${port}`;
  try {
    assert.equal(
      (await getOwnerJourneyCertification(endpoint)).automaticSpendLimitUsd,
      0,
    );
    assert.equal(
      (await previewOwnerJourneyCertification(endpoint)).externalEffects,
      0,
    );
    assert.equal(
      (
        await runOwnerJourneyCertification(
          endpoint,
          "certification.client.0001",
        )
      ).snapshot.state,
      "running",
    );
    assert.deepEqual(keys, ["certification.client.0001"]);
    assert.equal(
      (await fetch(`${endpoint}/api/v1/owner-journey-certification?bad=1`))
        .status,
      400,
    );
    assert.equal(
      (
        await fetch(`${endpoint}/api/v1/owner-journey-certification`, {
          headers: { Origin: "https://example.com" },
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await fetch(`${endpoint}/api/v1/owner-journey-certification/run`, {
          method: "POST",
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await fetch(`${endpoint}/api/v1/owner-journey-certification`, {
          method: "POST",
        })
      ).status,
      405,
    );
    assert.equal(
      (
        await fetch(`${endpoint}/api/v1/owner-journey-certification/run`, {
          method: "GET",
        })
      ).status,
      405,
    );
  } finally {
    await server.close();
  }
  await assert.rejects(() =>
    getOwnerJourneyCertification("https://example.com"),
  );
});

test("owner certification evidence API is input-free, loopback-only, bounded, and deterministic", async () => {
  const packet = {
    schemaVersion: 1 as const, provenance: "local_owner_certification_evidence" as const, generatedAt: now,
    packetDigest: "e".repeat(64), automaticSpendLimitUsd: 0 as const, externalEffects: 0 as const,
    certification: { state: "not_run" as const, certificationId: null, completedAt: null, stages: [], limitations: ["No passing local owner-journey certification is currently available."] },
    readiness: { state: "certification_needed" as const, completedSessions: 0, minimumSampleSize: 3 as const, nextAction: "Run the local check", reasons: ["not_run"] },
    pilotReview: { state: "certification_needed" as const, completionRatePercent: null, medianTimeToPreviewSeconds: null, trustAtLeastFourPercent: null, rankedFrictions: [], evidenceDigest: "f".repeat(64), limitations: ["Current certification is required."] },
    improvementHandoffs: [],
    privacy: { prompts: false as const, sourceCode: false as const, attachments: false as const, credentials: false as const, absolutePaths: false as const, personalIdentifiers: false as const, sessionNotes: false as const, privateJiraContent: false as const },
    limitations: ["Local proof only."],
  };
  const server = createControlPlaneServer({ host: "127.0.0.1", port: 0, allowedOrigins: ["http://127.0.0.1:4310"], health: () => health, snapshot: () => runtime, ownerCertificationEvidence: { packet: () => packet } });
  const port = await server.listen(); const endpoint = `http://127.0.0.1:${port}`;
  try {
    const result = await getOwnerCertificationEvidence(endpoint);
    assert.deepEqual(result, packet);
    assert.equal(ownerCertificationEvidenceFilename(result), "codkesh-owner-evidence-eeeeeeeeeeee.json");
    assert.equal((await fetch(`${endpoint}/api/v1/owner-certification-evidence?bad=1`)).status, 400);
    assert.equal((await fetch(`${endpoint}/api/v1/owner-certification-evidence`, { method: "POST" })).status, 405);
    assert.equal((await fetch(`${endpoint}/api/v1/owner-certification-evidence`, { headers: { Origin: "https://example.com" } })).status, 403);
  } finally { await server.close(); }
  await assert.rejects(() => getOwnerCertificationEvidence("https://example.com"));
});

test("external-owner learning API requires consent and supports bounded draft, completion, and withdrawal", async () => {
  const sessions: any[] = [];
  const server = createControlPlaneServer({ host: "127.0.0.1", port: 0, allowedOrigins: ["http://127.0.0.1:4310"], health: () => health, snapshot: () => runtime, externalOwnerLearning: {
    list: () => ({ schemaVersion: 1, provenance: "local_consented_owner_learning", automaticSpendLimitUsd: 0, sessions }),
    create: (input: any) => { const session = { schemaVersion: 1, id: `learning_${"a".repeat(20)}`, revision: 1, status: "draft", participantAlias: input.participantAlias, consentedAt: now, scenario: input.scenario, startedAt: input.startedAt, completedAt: null, timeToPreviewSeconds: null, trustRating: null, frictions: [], note: "", evidenceDigest: "b".repeat(64), synthetic: false }; sessions.push(session); return session as any; },
    complete: (_id, input: any) => { const { expectedRevision: _expectedRevision, ...completion } = input; return { ...sessions[0], ...completion, revision: 2, status: "completed", evidenceDigest: "c".repeat(64) }; },
    withdraw: () => ({ ...sessions[0], revision: 2, status: "withdrawn", evidenceDigest: "d".repeat(64) }),
  } });
  const port = await server.listen(); const endpoint = `http://127.0.0.1:${port}`;
  try {
    assert.equal((await listExternalOwnerLearning(endpoint)).sessions.length, 0);
    const draft = await createExternalOwnerLearning(endpoint, { participantAlias: "participant-a1b2c3", scenario: "major_feature", consent: true, startedAt: now }, "learning.client.create.0001"); assert.equal(draft.status, "draft");
    const completed = await completeExternalOwnerLearning(endpoint, draft.id, { expectedRevision: 1, completedAt: now + 500_000, timeToPreviewSeconds: 300, trustRating: 4, frictions: ["clarity"], note: "" }); assert.equal(completed.status, "completed");
    assert.equal((await withdrawExternalOwnerLearning(endpoint, draft.id, 1)).status, "withdrawn");
    assert.equal((await fetch(`${endpoint}/api/v1/external-owner-learning`, { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": "learning.client.invalid.0001" }, body: JSON.stringify({ participantAlias: "participant-a1b2c3", scenario: "major_feature", consent: false, startedAt: now }) })).status, 400);
    assert.equal(
      (
        await fetch(`${endpoint}/api/v1/external-owner-learning`, {
          method: "DELETE",
        })
      ).status,
      405,
    );
    assert.equal(
      (
        await fetch(
          `${endpoint}/api/v1/external-owner-learning/${draft.id}/complete`,
          { method: "GET" },
        )
      ).status,
      405,
    );
  } finally { await server.close(); }
});
