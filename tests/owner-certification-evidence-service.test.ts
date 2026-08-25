import assert from "node:assert/strict";
import test from "node:test";

import { OwnerCertificationEvidenceService } from "../apps/core/src/owner-certification-evidence-service.js";

const digest = "a".repeat(64);
const certification = {
  schemaVersion: 1, provenance: "local_owner_journey_certification", observedAt: 40, validForMs: 15_000,
  automaticSpendLimitUsd: 0, state: "passed", runId: `cert_run_${"a".repeat(20)}`, message: "Passed.", historyCount: 1,
  receipt: null,
  lastPassedReceipt: {
    schemaVersion: 1, certificationId: "b".repeat(64), mode: "synthetic_zero_cost", outcome: "passed",
    startedAt: "2026-08-25T10:00:00.000Z", completedAt: "2026-08-25T10:01:00.000Z", durationMs: 60_000,
    suites: ["owner_mvp", "new_product", "existing_product"].map((id) => ({ id, outcome: "passed", evidenceDigest: digest })),
    stages: ["plain_language_intake", "workspace_and_resources", "governed_artifacts", "context_and_eligibility", "solution_approval", "jira_backlog", "isolated_implementation", "deterministic_validation", "independent_review", "integration", "durable_completion"].map((name) => ({ name, outcome: "passed", evidenceDigest: digest })),
    paidCalls: 0, externalEffects: 0,
    privacy: { prompts: false, sourceCode: false, attachments: false, credentials: false, absolutePaths: false, personalIdentifiers: false, privateJiraContent: false },
    limitations: ["Local proof only."], nextAction: "Run owner sessions.",
  },
} as const;
const trust = {
  schemaVersion: 1, provenance: "local_owner_journey_trust", observedAt: 41, validForMs: 15_000, automaticSpendLimitUsd: 0,
  freshness: { schemaVersion: 1, provenance: "local_certification_freshness", state: "current", observedAt: 41, lastPassedAt: 40, nextCheckAt: 50, dueAt: 50, retryAt: null, cadenceMs: 86_400_000, automaticSpendLimitUsd: 0, message: "Current." },
  learning: { schemaVersion: 1, provenance: "privacy_safe_external_learning_aggregate", observedAt: 41, completedSessions: 3, eligibleForDecision: true, minimumSampleSize: 3, completionRatePercent: 100, medianTimeToPreviewSeconds: 120, averageTrustRating: 4, trustAtLeastFourPercent: 67, frictionCounts: { setup: 0, navigation: 2, trust: 0, clarity: 0, speed: 0, approval: 0, none: 1 }, excludedDrafts: 0, excludedWithdrawn: 0, automaticSpendLimitUsd: 0, limitations: ["Aggregate only."] },
  readiness: { schemaVersion: 1, provenance: "local_pilot_readiness_policy", observedAt: 41, state: "review_ready", title: "Ready", reason: "Ready.", nextAction: "Review evidence", reasons: [], automaticSpendLimitUsd: 0 },
} as const;
const review = { schemaVersion: 1, provenance: "privacy_safe_owner_pilot_review", observedAt: 42, state: "improvements_needed", title: "Improve", reason: "Repeated friction.", completedSessions: 3, minimumSampleSize: 3, completionRatePercent: 100, medianTimeToPreviewSeconds: 120, trustAtLeastFourPercent: 67, rankedFrictions: [{ category: "navigation", count: 2 }], improvements: [], limitations: ["Pilot only."], evidenceDigest: "c".repeat(64), automaticSpendLimitUsd: 0 } as const;
const improvements = { schemaVersion: 1, provenance: "local_owner_approved_improvement_handoff", automaticSpendLimitUsd: 0, drafts: [{ schemaVersion: 1, id: `improvement_draft_${"d".repeat(20)}`, projectId: `project_${"e".repeat(16)}`, revision: 2, state: "completed", reviewDigest: digest, previewDigest: "f".repeat(64), improvements: [], jiraProjectKey: "PIPE", createdAt: 10, updatedAt: 43, declinedAt: null, completedAt: 43, receipts: [{ improvementId: `improvement_${"1".repeat(20)}`, issueId: "1", issueKey: "PIPE-1", url: "https://example.atlassian.net/browse/PIPE-1", evidenceCommented: true }], lastError: null, automaticSpendLimitUsd: 0 }] } as const;

test("owner evidence packet is deterministic, zero-cost, and privacy-safe", async () => {
  const service = new OwnerCertificationEvidenceService({ certification: async () => certification as never, trust: async () => trust as never, review: async () => review as never, improvements: async () => improvements as never });
  const first = await service.packet();
  const second = await service.packet();
  assert.deepEqual(second, first);
  const laterObservation = new OwnerCertificationEvidenceService({ certification: async () => ({ ...certification, observedAt: 9_999 } as never), trust: async () => ({ ...trust, observedAt: 9_999 } as never), review: async () => ({ ...review, observedAt: 9_999 } as never), improvements: async () => improvements as never });
  assert.equal((await laterObservation.packet()).packetDigest, first.packetDigest);
  assert.equal(first.generatedAt, Date.parse("2026-08-25T10:01:00.000Z"));
  assert.equal(first.automaticSpendLimitUsd, 0);
  assert.equal(first.externalEffects, 0);
  assert.equal(first.improvementHandoffs[0]?.receipts[0]?.issueKey, "PIPE-1");
  const serialized = JSON.stringify(first);
  for (const prohibited of ["prompt body", "source body", "session note", "/Users/"]) assert.equal(serialized.includes(prohibited), false);
  assert.deepEqual(first.privacy, { prompts: false, sourceCode: false, attachments: false, credentials: false, absolutePaths: false, personalIdentifiers: false, sessionNotes: false, privateJiraContent: false });
});

test("owner evidence packet explicitly represents missing passing certification", async () => {
  const service = new OwnerCertificationEvidenceService({ certification: async () => ({ ...certification, state: "not_run", runId: null, lastPassedReceipt: null } as never), trust: async () => trust as never, review: async () => review as never, improvements: async () => ({ ...improvements, drafts: [] } as never) });
  const packet = await service.packet();
  assert.equal(packet.certification.certificationId, null);
  assert.match(packet.certification.limitations[0]!, /No passing/);
});
