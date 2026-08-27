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
  await seedRepresentativeCohort(service);
  const review = await service.review(trust(), startedAt + 10_000);
  assert.equal(review.state, "improvements_needed");
  assert.equal(review.improvements.length, 1);
  assert.equal(review.improvements[0]?.category, "clarity");
  assert.equal(review.improvements[0]?.evidenceCount, 2);
  assert.match(review.improvements[0]?.evidenceDigest ?? "", /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(review).includes("participant"), false);
  assert.deepEqual(review, await service.review(trust(), startedAt + 10_000));
});

test("pilot cohort report makes strict, deterministic, privacy-safe product decisions", async () => {
  const directory = await mkdtemp(join(tmpdir(), "codkesh-owner-pilot-"));
  const service = new OwnerPilotService(directory);
  await seedRepresentativeCohort(service);
  const improve = await service.cohortReport(trust(), startedAt + 10_000);
  assert.equal(improve.decision, "improve");
  assert.equal(improve.thresholds.length, 7);
  assert.equal(improve.distinctProjects, 2);
  assert.equal(improve.distinctScenarios, 2);
  assert.equal(improve.nextSession.action, "complete_session");
  assert.equal(improve.nextSession.scenario, "existing_product");
  assert.match(improve.nextSession.instruction, /Historical evidence remains/);
  assert.equal(improve.thresholds.at(-1)?.state, "failed");
  assert.equal(improve.automaticSpendLimitUsd, 0);
  assert.deepEqual(Object.values(improve.privacy), Array(8).fill(false));
  assert.deepEqual(improve, await service.cohortReport(trust(), startedAt + 10_000));

  const insufficient = trust();
  insufficient.learning.completedSessions = 2;
  insufficient.learning.eligibleForDecision = false;
  assert.equal((await service.cohortReport(insufficient)).decision, "sample_needed");

  const failed = trust();
  failed.learning.completionRatePercent = 79;
  assert.equal((await service.cohortReport(failed)).decision, "pause");

  const passing = trust();
  passing.learning.frictionCounts.clarity = 1;
  assert.equal((await service.cohortReport(passing)).decision, "proceed");

  const stale = trust();
  stale.freshness.state = "due";
  assert.equal((await service.cohortReport(stale)).decision, "certification_needed");
});

test("failed trust keeps evidence-backed recovery visible and recommends another real session", async () => {
  const directory = await mkdtemp(join(tmpdir(), "codkesh-owner-pilot-"));
  const service = new OwnerPilotService(directory);
  await seedRepresentativeCohort(service);
  const lowTrust = trust();
  lowTrust.learning.trustAtLeastFourPercent = 43;
  const report = await service.cohortReport(lowTrust, startedAt + 10_000);
  const review = await service.review(lowTrust, startedAt + 10_000);
  assert.equal(report.decision, "pause");
  assert.equal(report.nextSession.action, "complete_session");
  assert.match(report.nextAction, /run the next/i);
  assert.equal(review.state, "improvements_needed");
  assert.equal(review.improvements.length > 0, true);
});

test("repeated project and scenario sessions cannot game representative readiness", async () => {
  const directory = await mkdtemp(join(tmpdir(), "codkesh-owner-pilot-"));
  const service = new OwnerPilotService(directory);
  for (let index = 0; index < 3; index += 1)
    await completePilot(service, projectId, "new_product", `pilot.coverage.${index.toString().padStart(4, "0")}`, startedAt + index * 10_000);
  const report = await service.cohortReport(trust(), startedAt + 40_000);
  const review = await service.review(trust(), startedAt + 40_000);
  assert.equal(report.decision, "sample_needed");
  assert.equal(review.state, "sample_needed");
  assert.equal(review.improvements.length, 0);
  assert.equal(report.distinctProjects, 1);
  assert.equal(report.distinctScenarios, 1);
  assert.equal(report.nextSession.action, "add_project");
  assert.match(report.nextAction, /different project/i);
  assert.equal(JSON.stringify(report).includes(projectId), false);
});

test("completion rejects contradictory no-friction evidence without mutation", async () => {
  const directory = await mkdtemp(join(tmpdir(), "codkesh-owner-pilot-"));
  const service = new OwnerPilotService(directory);
  let session = await service.create({ projectId, scenario: "new_product", consent: true, startedAt }, "pilot.friction.create.0001", startedAt);
  for (const [milestone, offset] of [["context_ready", 1_000], ["solution_approved", 2_000], ["first_preview", 3_000]] as const)
    session = await service.advance(session.id, { expectedRevision: session.revision, milestone, at: startedAt + offset });
  await assert.rejects(() => service.complete(session.id, { expectedRevision: session.revision, completedAt: startedAt + 4_000, trustRating: 4, frictions: ["none", "setup"], note: "" }), /cannot be combined/i);
  assert.equal((await service.list()).sessions[0]?.status, "active");
});

test("only one pilot can be active across the local owner journey", async () => {
  const directory = await mkdtemp(join(tmpdir(), "codkesh-owner-pilot-"));
  const service = new OwnerPilotService(directory);
  await service.create({ projectId, scenario: "new_product", consent: true, startedAt }, "pilot.single.create.0001", startedAt);
  await assert.rejects(
    () => service.create({ projectId: `project_${"b".repeat(16)}`, scenario: "major_feature", consent: true, startedAt: startedAt + 1 }, "pilot.single.create.0002", startedAt + 1),
    /already active/i,
  );
  assert.equal((await service.list()).sessions.length, 1);
});

test("canonical evidence reconciles milestones in order without manual claims", async () => {
  const directory = await mkdtemp(join(tmpdir(), "codkesh-owner-pilot-"));
  const service = new OwnerPilotService(directory);
  let session = await service.create({ projectId, scenario: "new_product", consent: true, startedAt }, "pilot.reconcile.create.0001", startedAt);
  const contextDigest = "1".repeat(64);
  session = await service.reconcile(session.id, { schemaVersion: 1, projectId, observedAt: startedAt + 2_000, activityAt: startedAt + 1_000, contextDigest, approvedDesignDigest: null, previewEvidenceDigest: null }, startedAt + 2_000);
  assert.equal(session.milestones.at(-1)?.name, "context_ready");
  const replay = await service.reconcile(session.id, { schemaVersion: 1, projectId, observedAt: startedAt + 2_000, activityAt: startedAt + 1_000, contextDigest, approvedDesignDigest: null, previewEvidenceDigest: null }, startedAt + 2_000);
  assert.equal(replay.revision, session.revision);
  session = await service.reconcile(session.id, { schemaVersion: 1, projectId, observedAt: startedAt + 4_000, activityAt: startedAt + 3_000, contextDigest, approvedDesignDigest: "2".repeat(64), previewEvidenceDigest: "3".repeat(64) }, startedAt + 4_000);
  assert.deepEqual(session.milestones.map((milestone) => milestone.name), ["session_started", "context_ready", "solution_approved", "first_preview"]);
  assert.equal((await service.summary(session.id, startedAt + 5_000)).state, "preview_ready");
});

test("stale pilot interrupts, resumes from proof, and exports a private receipt", async () => {
  const directory = await mkdtemp(join(tmpdir(), "codkesh-owner-pilot-"));
  const service = new OwnerPilotService(directory);
  let session = await service.create({ projectId, scenario: "major_feature", consent: true, startedAt }, "pilot.interrupt.create.0001", startedAt);
  session = await service.reconcile(session.id, { schemaVersion: 1, projectId, observedAt: startedAt + 31 * 60_000, activityAt: startedAt, contextDigest: null, approvedDesignDigest: null, previewEvidenceDigest: null }, startedAt + 31 * 60_000);
  assert.equal(session.status, "interrupted");
  assert.match((await service.summary(session.id, startedAt + 31 * 60_000)).nextAction, /resume|withdraw/i);
  await assert.rejects(() => service.create({ projectId, scenario: "major_feature", consent: true, startedAt: startedAt + 31 * 60_000 }, "pilot.interrupt.create.0002", startedAt + 31 * 60_000), /already active/i);
  const interruptedRevision = session.revision;
  session = await service.reconcile(session.id, { schemaVersion: 1, projectId, observedAt: startedAt + 32 * 60_000, activityAt: startedAt + 32 * 60_000, contextDigest: "4".repeat(64), approvedDesignDigest: null, previewEvidenceDigest: null }, startedAt + 32 * 60_000);
  assert.equal(session.status, "active");
  assert.equal(session.revision > interruptedRevision, true);
  const receipt = await service.receipt(session.id);
  assert.equal(receipt.automaticSpendLimitUsd, 0);
  assert.equal(receipt.privacy.sourceCode, false);
  assert.equal(JSON.stringify(receipt).includes("/Users/"), false);
  assert.equal(receipt.projectIdDigest.length, 64);
  assert.equal(JSON.stringify(receipt).includes(projectId), false);
});

test("pilot reconciliation rejects cross-project, future, and malformed evidence", async () => {
  const directory = await mkdtemp(join(tmpdir(), "codkesh-owner-pilot-"));
  const service = new OwnerPilotService(directory);
  const session = await service.create({ projectId, scenario: "existing_product", consent: true, startedAt }, "pilot.invalid.create.0001", startedAt);
  await assert.rejects(() => service.reconcile(session.id, { schemaVersion: 1, projectId: `project_${"b".repeat(16)}`, observedAt: startedAt + 1, activityAt: startedAt, contextDigest: null, approvedDesignDigest: null, previewEvidenceDigest: null }, startedAt + 1), /different project/i);
  await assert.rejects(() => service.reconcile(session.id, { schemaVersion: 1, projectId, observedAt: startedAt, activityAt: startedAt + 1, contextDigest: null, approvedDesignDigest: null, previewEvidenceDigest: null }, startedAt + 1));
  await assert.rejects(() => service.reconcile(session.id, { schemaVersion: 1, projectId, observedAt: startedAt + 1, activityAt: startedAt, contextDigest: "bad", approvedDesignDigest: null, previewEvidenceDigest: null }, startedAt + 1));
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

async function seedRepresentativeCohort(service: OwnerPilotService) {
  await completePilot(service, projectId, "new_product", "pilot.seed.create.0001", startedAt);
  await completePilot(service, `project_${"b".repeat(16)}`, "major_feature", "pilot.seed.create.0002", startedAt + 10_000);
  await completePilot(service, projectId, "new_product", "pilot.seed.create.0003", startedAt + 20_000);
}

async function completePilot(service: OwnerPilotService, selectedProjectId: string, scenario: "new_product" | "existing_product" | "major_feature", key: string, at: number) {
  let session = await service.create({ projectId: selectedProjectId, scenario, consent: true, startedAt: at }, key, at);
  for (const [milestone, offset] of [["context_ready", 1_000], ["solution_approved", 2_000], ["first_preview", 3_000]] as const)
    session = await service.advance(session.id, { expectedRevision: session.revision, milestone, at: at + offset });
  return service.complete(session.id, { expectedRevision: session.revision, completedAt: at + 4_000, trustRating: 4, frictions: ["clarity"], note: "" });
}
