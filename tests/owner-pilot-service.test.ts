import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { OwnerPilotService } from "../apps/core/src/owner-pilot-service.js";
import type { OwnerJourneyTrustSnapshot } from "../packages/runtime/src/owner-journey-certification.js";

const projectId = `project_${"a".repeat(16)}`;
const startedAt = 1_800_000_000_000;

test("owner pilot is consented, idempotent, ordered, restart-safe, and withdrawable", async () => {
  const directory = await mkdtemp(join(tmpdir(), "codkesh-owner-pilot-"));
  const first = new OwnerPilotService(directory);
  const created = await first.create(
    { projectId, scenario: "new_product", consent: true, startedAt },
    "pilot.service.create.0001",
    startedAt,
  );
  assert.equal(created.status, "active");
  assert.equal(created.automaticSpendLimitUsd, 0);
  assert.deepEqual(
    await first.create(
      { projectId, scenario: "new_product", consent: true, startedAt },
      "pilot.service.create.0001",
      startedAt,
    ),
    created,
  );
  await assert.rejects(() =>
    first.create(
      { projectId, scenario: "new_product", consent: true, startedAt },
      "pilot.service.create.0002",
      startedAt,
    ),
  );
  await assert.rejects(() =>
    first.advance(created.id, {
      expectedRevision: 1,
      milestone: "first_preview",
      at: startedAt + 1,
    }),
  );

  const restarted = new OwnerPilotService(directory);
  const context = await restarted.advance(created.id, {
    expectedRevision: 1,
    milestone: "context_ready",
    at: startedAt + 1_000,
  });
  const approved = await restarted.advance(created.id, {
    expectedRevision: context.revision,
    milestone: "solution_approved",
    at: startedAt + 2_000,
  });
  const preview = await restarted.advance(created.id, {
    expectedRevision: approved.revision,
    milestone: "first_preview",
    at: startedAt + 3_000,
  });
  const completed = await restarted.complete(created.id, {
    expectedRevision: preview.revision,
    completedAt: startedAt + 4_000,
    trustRating: 5,
    frictions: ["clarity"],
    note: "The decision could be clearer.",
  });
  assert.equal(completed.status, "completed");
  assert.equal(completed.previewAt, startedAt + 3_000);
  assert.equal(
    (await restarted.learningCollection()).sessions[0]?.timeToPreviewSeconds,
    3,
  );

  const withdrawn = await restarted.withdraw(completed.id, completed.revision);
  assert.equal(withdrawn.status, "withdrawn");
  assert.equal(withdrawn.note, "");
  assert.deepEqual(withdrawn.frictions, []);
  assert.equal(withdrawn.trustRating, null);
});

test("owner pilot rejects private notes and preserves corrupt evidence", async () => {
  const directory = await mkdtemp(join(tmpdir(), "codkesh-owner-pilot-"));
  const service = new OwnerPilotService(directory);
  let session = await service.create(
    { projectId, scenario: "major_feature", consent: true, startedAt },
    "pilot.service.private.0001",
    startedAt,
  );
  for (const milestone of [
    "context_ready",
    "solution_approved",
    "first_preview",
  ] as const) {
    session = await service.advance(session.id, {
      expectedRevision: session.revision,
      milestone,
      at: startedAt + session.revision * 1_000,
    });
  }
  await assert.rejects(() =>
    service.complete(session.id, {
      expectedRevision: session.revision,
      completedAt: startedAt + 5_000,
      trustRating: 4,
      frictions: ["none"],
      note: "token=secret-value",
    }),
  );
  const path = join(directory, "owner-pilot.json");
  await writeFile(path, "{broken", "utf8");
  await assert.rejects(
    () => new OwnerPilotService(directory).list(),
    /corrupt/i,
  );
  assert.equal(await readFile(path, "utf8"), "{broken");
});

test("pilot review is deterministic, aggregated, thresholded, and evidence-linked", async () => {
  const directory = await mkdtemp(join(tmpdir(), "codkesh-owner-pilot-"));
  const service = new OwnerPilotService(directory);
  const review = await service.review(trust(), startedAt + 10_000);
  assert.equal(review.state, "improvements_needed");
  assert.equal(review.improvements.length, 1);
  assert.equal(review.improvements[0]?.category, "clarity");
  assert.equal(review.improvements[0]?.evidenceCount, 2);
  assert.match(review.improvements[0]?.evidenceDigest ?? "", /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(review).includes("participant"), false);
  assert.deepEqual(review, await service.review(trust(), startedAt + 10_000));
});

function trust(): OwnerJourneyTrustSnapshot {
  return {
    schemaVersion: 1,
    provenance: "local_owner_journey_trust",
    observedAt: startedAt,
    validForMs: 15_000,
    freshness: {
      schemaVersion: 1,
      provenance: "local_certification_freshness",
      state: "current",
      observedAt: startedAt,
      lastPassedAt: startedAt,
      nextCheckAt: startedAt + 86_400_000,
      dueAt: null,
      retryAt: null,
      cadenceMs: 86_400_000,
      automaticSpendLimitUsd: 0,
      message: "Current.",
    },
    learning: {
      schemaVersion: 1,
      provenance: "privacy_safe_external_learning_aggregate",
      observedAt: startedAt,
      completedSessions: 3,
      eligibleForDecision: true,
      minimumSampleSize: 3,
      completionRatePercent: 100,
      medianTimeToPreviewSeconds: 120,
      averageTrustRating: 4,
      trustAtLeastFourPercent: 67,
      frictionCounts: {
        setup: 0,
        navigation: 0,
        trust: 0,
        clarity: 2,
        speed: 1,
        approval: 0,
        none: 0,
      },
      excludedDrafts: 0,
      excludedWithdrawn: 0,
      automaticSpendLimitUsd: 0,
      limitations: ["Pilot evidence only."],
    },
    readiness: {
      schemaVersion: 1,
      provenance: "local_pilot_readiness_policy",
      observedAt: startedAt,
      state: "review_ready",
      title: "Ready",
      reason: "Thresholds passed.",
      nextAction: "Review evidence.",
      reasons: [],
      automaticSpendLimitUsd: 0,
    },
    automaticSpendLimitUsd: 0,
  };
}
