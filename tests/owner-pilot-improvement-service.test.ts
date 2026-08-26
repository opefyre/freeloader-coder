import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { OwnerPilotImprovementService } from "../apps/core/src/owner-pilot-improvement-service.js";
import type { OwnerPilotImprovement, OwnerPilotReview } from "../packages/runtime/src/owner-journey-certification.js";

const projectId = `project_${"a".repeat(16)}`;
const improvement = {
  id: `improvement_${"b".repeat(20)}`,
  category: "clarity" as const,
  title: "Improve decision clarity",
  problem: "Owners repeatedly found decisions unclear.",
  recommendation: "Show outcome, impact, and bounded options.",
  evidenceCount: 3,
  priority: "high" as const,
  estimatedSize: "small" as const,
  dependencies: [],
  acceptanceCriteria: ["Three sessions pass.", "The owner sees one next action."],
  evidenceDigest: "c".repeat(64),
};
const review: OwnerPilotReview = {
  schemaVersion: 1,
  provenance: "privacy_safe_owner_pilot_review",
  observedAt: 10,
  state: "improvements_needed",
  title: "Pilot improvements ready",
  reason: "One improvement is ready.",
  completedSessions: 3,
  minimumSampleSize: 3,
  completionRatePercent: 100,
  medianTimeToPreviewSeconds: 60,
  trustAtLeastFourPercent: 67,
  rankedFrictions: [{ category: "clarity", count: 3 }],
  improvements: [improvement],
  limitations: ["Pilot evidence only."],
  evidenceDigest: "d".repeat(64),
  automaticSpendLimitUsd: 0,
};

test("improvement handoff previews before mutation, supports edit and decline, and rejects stale approval", async () => {
  const directory = await mkdtemp(join(tmpdir(), "codkesh-improvement-"));
  let mutations = 0;
  const service = new OwnerPilotImprovementService(directory, { review: async () => review }, {
    selectedProject: async () => ({ key: "PIPE" }),
    createImprovement: async () => { mutations += 1; return { issueId: "1", issueKey: "PIPE-1", url: "https://example.atlassian.net/browse/PIPE-1", evidenceCommented: true }; },
  }, () => 100);
  const preview = await service.preview({ projectId, expectedReviewDigest: review.evidenceDigest }, "improvement.preview.0001");
  assert.equal(preview.state, "pending");
  assert.equal(preview.jiraProjectKey, "PIPE");
  assert.equal(mutations, 0);
  assert.deepEqual(preview, await service.preview({ projectId, expectedReviewDigest: review.evidenceDigest }, "improvement.preview.0001"));
  const edited = await service.edit(preview.id, { expectedRevision: preview.revision, improvements: [{ ...improvement, title: "Clarify every decision" }] });
  assert.notEqual(edited.previewDigest, preview.previewDigest);
  await assert.rejects(() => service.approve(edited.id, { expectedRevision: edited.revision, expectedPreviewDigest: preview.previewDigest }), /exact preview/i);
  const declined = await service.decline(edited.id, { expectedRevision: edited.revision, expectedPreviewDigest: edited.previewDigest });
  assert.equal(declined.state, "declined");
  assert.equal(mutations, 0);
});

test("improvement handoff is durable, idempotent, and resumes only failed Jira items", async () => {
  const directory = await mkdtemp(join(tmpdir(), "codkesh-improvement-"));
  const second = { ...improvement, id: `improvement_${"e".repeat(20)}`, title: "Improve navigation", category: "navigation" as const };
  const multi = { ...review, improvements: [improvement, second] };
  const calls: string[] = [];
  let fail = true;
  const jira = {
    selectedProject: async () => ({ key: "PIPE" }),
    createImprovement: async (_projectId: string, item: OwnerPilotImprovement) => {
      calls.push(item.id);
      if (item.id === second.id && fail) { fail = false; throw new Error("Jira temporarily unavailable"); }
      const key = item.id === improvement.id ? "PIPE-1" : "PIPE-2";
      return { issueId: key, issueKey: key, url: `https://example.atlassian.net/browse/${key}`, evidenceCommented: true };
    },
  };
  const first = new OwnerPilotImprovementService(directory, { review: async () => multi }, jira, () => 200);
  const preview = await first.preview({ projectId, expectedReviewDigest: multi.evidenceDigest }, "improvement.preview.0002");
  const partial = await first.approve(preview.id, { expectedRevision: preview.revision, expectedPreviewDigest: preview.previewDigest });
  assert.equal(partial.state, "partially_applied");
  assert.equal(partial.receipts.length, 1);
  const restarted = new OwnerPilotImprovementService(directory, { review: async () => multi }, jira, () => 300);
  const completed = await restarted.approve(partial.id, { expectedRevision: partial.revision, expectedPreviewDigest: partial.previewDigest });
  assert.equal(completed.state, "completed");
  assert.deepEqual(calls, [improvement.id, second.id, second.id]);
  const replay = await restarted.approve(completed.id, { expectedRevision: preview.revision, expectedPreviewDigest: completed.previewDigest });
  assert.equal(replay.state, "completed");
  assert.equal(calls.length, 3);
});

test("non-improvement pilot decisions cannot reach Jira preview or mutation", async () => {
  for (const state of ["certification_needed", "sample_needed", "review_ready"] as const) {
    const directory = await mkdtemp(join(tmpdir(), "codkesh-improvement-"));
    let jiraCalls = 0;
    const deniedReview: OwnerPilotReview = {
      ...review,
      state,
      improvements: state === "review_ready" ? [] : review.improvements,
    };
    const service = new OwnerPilotImprovementService(
      directory,
      { review: async () => deniedReview },
      {
        selectedProject: async () => { jiraCalls += 1; return { key: "PIPE" }; },
        createImprovement: async () => { jiraCalls += 1; throw new Error("must not run"); },
      },
      () => 400,
    );
    await assert.rejects(
      () => service.preview(
        { projectId, expectedReviewDigest: deniedReview.evidenceDigest },
        `improvement.denied.${state}`,
      ),
      /no evidence-backed improvements/i,
    );
    assert.equal(jiraCalls, 0);
    assert.equal((await service.list()).drafts.length, 0);
  }
});
