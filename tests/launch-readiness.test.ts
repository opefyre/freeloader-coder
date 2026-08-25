import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  assessLaunchReadiness,
  assessLearningReview,
  launchReadinessSchema,
} from "../packages/releases/src/launch-readiness.js";

const firstPublicReview = JSON.parse(
  await readFile(
    "docs/evidence/PIPE-112-LAUNCH-LEARNING-2026-08-25.json",
    "utf8"
  )
);

const positioning = {
  schemaVersion: 1,
  id: "positioning-public-1",
  audience: "GitHub-capable vibecoders building real software",
  category: "Free-first autonomous development operations plane",
  promise: "Reliable autonomous development without a surprise AI bill.",
  proof: [
    "Paid routes deny by default.",
    "Deterministic validation and independent review gate completion.",
  ],
  sourceUrls: [
    "https://opencode.ai/docs/",
    "https://docs.openhands.dev/overview/introduction",
    "https://aider.chat/docs/",
  ],
  prohibitedClaims: [
    "Free forever or unlimited",
    "Fully autonomous",
    "Always secure or production ready",
  ],
  validatedAt: "2026-07-29T09:00:00.000Z",
  reviewAfter: "2026-10-29T09:00:00.000Z",
} as const;

const readyPlan = {
  schemaVersion: 1,
  releaseId: "release-1.0.0",
  positioning,
  gates: [
    gate("license", "License", "passed"),
    gate("security", "Security", "passed"),
    gate("accessibility", "Accessibility", "passed"),
    gate("support", "Support", "passed"),
    gate("rollback", "Rollback", "passed"),
  ],
  channels: [
    {
      id: "github",
      label: "GitHub",
      state: "ready",
      owner: "release owner",
      rollback: "Pause intake and withdraw the release.",
    },
  ],
  incidentOwner: "incident owner",
  supportCapacityPerDay: 20,
  plannedLaunchAt: null,
} as const;

test("launch readiness requires current evidence, support, and a ready channel", () => {
  const decision = assessLaunchReadiness(
    readyPlan,
    "2026-07-29T10:00:00.000Z"
  );
  assert.equal(decision.ready, true);
  assert.equal(decision.blockers.length, 0);
});

test("one not-run gate blocks launch and preserves its recovery", () => {
  const decision = assessLaunchReadiness(
    {
      ...readyPlan,
      gates: readyPlan.gates.map((entry) =>
        entry.id === "security" ? { ...entry, state: "not_run" as const } : entry
      ),
    },
    "2026-07-29T10:00:00.000Z"
  );
  assert.equal(decision.ready, false);
  assert.equal(decision.blockers[0]?.id, "security");
  assert.match(decision.blockers[0]?.recovery ?? "", /evidence/);
});

test("launch contracts reject unsourced claims and missing stop conditions", () => {
  assert.throws(() =>
    launchReadinessSchema.parse({
      ...readyPlan,
      positioning: { ...positioning, sourceUrls: [] },
    })
  );
  assert.throws(() =>
    launchReadinessSchema.parse({
      ...readyPlan,
      gates: readyPlan.gates.map((entry) => ({ ...entry, stopCondition: "" })),
    })
  );
});

test("learning review is actionable only with complete privacy-safe metrics", () => {
  const metric = {
    schemaVersion: 1,
    unit: "percent",
    baseline: 70,
    target: 85,
    current: 88,
    owner: "product owner",
    cohort: "first local projects",
    source: "local_event",
    containsPromptContent: false,
    containsSourceCode: false,
    reviewCadence: "weekly",
  } as const;
  const assessment = assessLearningReview({
    schemaVersion: 1,
    reviewId: "review-local-beta",
    reviewedAt: "2026-07-29T10:00:00.000Z",
    metrics: [
      { ...metric, id: "activation", label: "Validated preview" },
      { ...metric, id: "recovery", label: "Recovered work" },
      { ...metric, id: "trust", label: "Trusted result" },
      { ...metric, id: "support", label: "Safe reproduction" },
    ],
    decision: "keep",
    rationale: "Every current local-beta outcome meets its target.",
    ownedExperiments: [],
  });
  assert.equal(assessment.actionable, true);
  assert.equal(assessment.privacySafe, true);
});

test("change decision without an owned experiment is not actionable", () => {
  const metric = {
    schemaVersion: 1,
    unit: "count",
    baseline: 1,
    target: 0,
    current: 1,
    owner: "product owner",
    cohort: "local beta",
    source: "support",
    containsPromptContent: false,
    containsSourceCode: false,
    reviewCadence: "weekly",
  } as const;
  const result = assessLearningReview({
    schemaVersion: 1,
    reviewId: "review-change",
    reviewedAt: "2026-07-29T10:00:00.000Z",
    metrics: [
      { ...metric, id: "metric-a", label: "Metric A" },
      { ...metric, id: "metric-b", label: "Metric B" },
      { ...metric, id: "metric-c", label: "Metric C" },
      { ...metric, id: "metric-d", label: "Metric D" },
    ],
    decision: "change",
    rationale: "The current experience misses a required outcome.",
    ownedExperiments: [],
  });
  assert.equal(result.actionable, false);
});

test("first public review records honest baselines and an owned next experiment", () => {
  const result = assessLearningReview(firstPublicReview);

  assert.equal(result.actionable, true);
  assert.equal(result.privacySafe, true);
  assert.deepEqual(result.missingBaselines, []);
  assert.deepEqual(result.missingCurrentValues, []);
  assert.equal(firstPublicReview.decision, "insufficient_evidence");
  assert.equal(firstPublicReview.ownedExperiments.length, 1);
  assert.match(firstPublicReview.rationale, /cannot distinguish genuine users/i);
  assert.ok(
    firstPublicReview.metrics.every(
      (metric: {
        containsPromptContent: boolean;
        containsSourceCode: boolean;
      }) => !metric.containsPromptContent && !metric.containsSourceCode
    )
  );
});

function gate(
  id: string,
  label: string,
  state: "passed" | "blocked" | "needs_user" | "not_run"
) {
  return {
    schemaVersion: 1,
    id,
    label,
    owner: "release owner",
    state,
    evidenceRef: state === "passed" ? `evidence:${id}` : null,
    stopCondition: `${label} failure stops public launch.`,
    recovery: `Attach current ${label.toLowerCase()} evidence before retrying.`,
  } as const;
}
