import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { OwnerJourneyTrustService, buildTrustSnapshot } from "../apps/core/src/owner-journey-trust-service.js";
import type { ExternalLearningCollection, ExternalLearningSession, OwnerJourneyCertificationSnapshot } from "../packages/runtime/src/owner-journey-certification.js";

const DAY = 86_400_000;
const now = 1_800_000_000_000;
const digest = "a".repeat(64);
function certification(completedAt = now - DAY, state: OwnerJourneyCertificationSnapshot["state"] = "passed"): OwnerJourneyCertificationSnapshot {
  const receipt = { schemaVersion: 1 as const, certificationId: digest, mode: "synthetic_zero_cost" as const, outcome: "passed" as const, startedAt: new Date(completedAt - 1_000).toISOString(), completedAt: new Date(completedAt).toISOString(), durationMs: 1_000, suites: ["owner_mvp", "new_product", "existing_product"].map((id) => ({ id, outcome: "passed" as const, evidenceDigest: digest })) as any, stages: ["plain_language_intake", "workspace_and_resources", "governed_artifacts", "context_and_eligibility", "solution_approval", "jira_backlog", "isolated_implementation", "deterministic_validation", "independent_review", "integration", "durable_completion"].map((name) => ({ name, outcome: "passed" as const, evidenceDigest: digest })) as any, paidCalls: 0 as const, externalEffects: 0 as const, privacy: { prompts: false as const, sourceCode: false as const, attachments: false as const, credentials: false as const, absolutePaths: false as const, personalIdentifiers: false as const, privateJiraContent: false as const }, limitations: ["Synthetic evidence only."], nextAction: "Record owner learning." };
  return { schemaVersion: 1, provenance: "local_owner_journey_certification", observedAt: now, validForMs: 15_000, automaticSpendLimitUsd: 0, state, runId: state === "not_run" ? null : `cert_run_${"b".repeat(20)}`, message: "Observed.", receipt: state === "passed" ? receipt : null, lastPassedReceipt: state === "not_run" ? null : receipt, historyCount: state === "not_run" ? 0 : 1 };
}
function session(index: number, status: ExternalLearningSession["status"] = "completed", seconds = 600, rating = 4): ExternalLearningSession {
  return { schemaVersion: 1, id: `learning_${index.toString(16).padStart(20, "0")}`, revision: 2, status, participantAlias: `participant-alias-${index}`, consentedAt: now - 10_000, scenario: "new_product", startedAt: now - 9_000, completedAt: status === "completed" ? now - 1_000 : null, timeToPreviewSeconds: status === "completed" ? seconds : null, trustRating: status === "completed" ? rating : null, frictions: status === "completed" ? [index % 2 ? "clarity" : "none"] : [], note: status === "completed" ? `private note ${index}` : "", evidenceDigest: index.toString(16).padStart(64, "0"), synthetic: false };
}
function collection(sessions: ExternalLearningSession[]): ExternalLearningCollection { return { schemaVersion: 1, provenance: "local_consented_owner_learning", automaticSpendLimitUsd: 0, sessions }; }

test("privacy-safe aggregate excludes aliases, notes, drafts, withdrawals and requires three completed sessions", () => {
  const trust = buildTrustSnapshot(certification(), collection([session(1), session(2), session(3, "draft"), session(4, "withdrawn")]), { schemaVersion: 1, revision: 1, lastTickAt: null, lastAttemptAt: null, retryAt: null, failureCount: 0 }, now);
  assert.equal(trust.learning.completedSessions, 2);
  assert.equal(trust.learning.eligibleForDecision, false);
  assert.equal(trust.readiness.state, "learning_needed");
  assert.equal(JSON.stringify(trust).includes("participant-"), false);
  assert.equal(JSON.stringify(trust).includes("private note"), false);
  assert.equal(trust.learning.excludedDrafts, 1);
  assert.equal(trust.learning.excludedWithdrawn, 1);
});

test("readiness is deterministic and honest across certification and threshold states", () => {
  const good = collection([session(1, "completed", 500, 5), session(2, "completed", 700, 4), session(3, "completed", 900, 4)]);
  const stored = { schemaVersion: 1 as const, revision: 1, lastTickAt: null, lastAttemptAt: null, retryAt: null, failureCount: 0 };
  assert.equal(buildTrustSnapshot(certification(), good, stored, now).readiness.state, "review_ready");
  assert.equal(buildTrustSnapshot(certification(now - 9 * DAY), good, stored, now).readiness.state, "certification_needed");
  const poor = collection([session(1, "completed", 2_000, 2), session(2, "completed", 2_100, 3), session(3, "completed", 2_200, 4)]);
  const result = buildTrustSnapshot(certification(), poor, stored, now);
  assert.equal(result.readiness.state, "thresholds_not_met");
  assert.equal(result.readiness.reasons.length >= 2, true);
  assert.equal(result.automaticSpendLimitUsd, 0);
});

test("automatic scheduler runs only when due, coalesces, survives restart, and backs off safely", async () => {
  const root = await mkdtemp(join(tmpdir(), "codkesh-trust-"));
  let current = certification(now - 8 * DAY);
  let calls = 0;
  const certificationService = { snapshot: async () => current, run: async () => { calls += 1; await new Promise((resolve) => setTimeout(resolve, 10)); current = certification(now); } };
  const service = new OwnerJourneyTrustService(root, certificationService, { list: async () => collection([]) });
  const [one, two] = await Promise.all([service.tick(now), service.tick(now)]);
  assert.equal(calls, 1);
  assert.equal(one.freshness.state, "current");
  assert.deepEqual(one, two);
  await new OwnerJourneyTrustService(root, certificationService, { list: async () => collection([]) }).tick(now + 1_000);
  assert.equal(calls, 1);

  const failedRoot = await mkdtemp(join(tmpdir(), "codkesh-trust-"));
  const failed = new OwnerJourneyTrustService(failedRoot, { snapshot: async () => certification(now - 8 * DAY, "failed"), run: async () => { calls += 1; throw new Error("no"); } }, { list: async () => collection([]) });
  const failedSnapshot = await failed.tick(now);
  assert.equal(failedSnapshot.freshness.state, "failed");
  assert.equal(failedSnapshot.freshness.retryAt, now + 6 * 60 * 60_000);
  const callsAfterFailure = calls;
  await failed.tick(now + 1_000);
  assert.equal(calls, callsAfterFailure);
});

test("scheduler rejects unsafe cadence and corrupt persisted state", async () => {
  const root = await mkdtemp(join(tmpdir(), "codkesh-trust-"));
  assert.throws(() => new OwnerJourneyTrustService(root, {} as any, {} as any, 1_000), /cadence/);
  await writeFile(join(root, "owner-journey-trust.json"), "{}\n", "utf8");
  const service = new OwnerJourneyTrustService(root, { snapshot: async () => certification(), run: async () => undefined }, { list: async () => collection([]) });
  await assert.rejects(() => service.snapshot(now), /corrupt/);
});
