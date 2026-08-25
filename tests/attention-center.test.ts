import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  AttentionError,
  LocalAttentionService,
} from "../apps/core/src/attention-center.js";
import type { DecisionSnapshot } from "../packages/runtime/src/decisions.js";
import type { LiveOperationsSnapshot } from "../packages/runtime/src/live-operations.js";
import type { OwnerJourneyCertificationSnapshot, OwnerJourneyTrustSnapshot } from "../packages/runtime/src/owner-journey-certification.js";

const now = 1_800_000_000_000;
const projectId = "project_0123456789abcdef";
const requestId = "request_0123456789abcdef0123";
const live: LiveOperationsSnapshot = {
  schemaVersion: 1,
  provenance: "local_operational_aggregation",
  observedAt: now,
  validForMs: 15_000,
  automaticSpendLimitUsd: 0,
  health: "attention",
  totals: {
    projects: 1,
    requests: 1,
    active: 0,
    completed: 1,
    needsAttention: 1,
    providers: 1,
    readyProviders: 0,
  },
  stages: [
    "needs_input",
    "queued",
    "approved",
    "claimed",
    "checkpointed",
    "completed",
    "interrupted",
    "cancelled",
  ].map((stage) => ({
    stage: stage as LiveOperationsSnapshot["stages"][number]["stage"],
    count: stage === "completed" ? 1 : 0,
  })),
  providers: [
    {
      id: "connection_groq",
      providerId: "groq",
      label: "Groq",
      modelId: "free",
      state: "limited",
      admitted: false,
      zeroCost: true,
      updatedAt: now - 200,
    },
  ],
  recentEvents: [
    {
      id: "event_0123456789abcdef",
      kind: "request",
      state: "completed",
      title: "Verified change completed",
      detail: "Validation and review passed.",
      observedAt: now - 100,
      projectId,
      requestId,
      providerId: "groq",
    },
  ],
};
const decisions: DecisionSnapshot = {
  schemaVersion: 1,
  provenance: "local_decision_inbox",
  observedAt: now,
  validForMs: 15_000,
  automaticSpendLimitUsd: 0,
  query: {
    range: "all",
    categories: [],
    priorities: [],
    owners: [],
    ages: [],
    projectId: null,
    providerId: null,
    search: "",
  },
  summary: {
    open: 2,
    critical: 1,
    overdue: 1,
    approvals: 1,
    blockedProjects: 1,
    providerWaits: 1,
    oldestObservedAt: now - 1_000,
  },
  facets: {
    categories: [],
    priorities: [],
    owners: [],
    ages: [],
    projects: [],
    providers: [],
  },
  retention: {
    bounded: true,
    maximumItems: 250,
    completeness: "bounded_current_state",
    earliestObservedAt: now - 1_000,
  },
  items: [
    {
      id: "decision_0123456789abcdef0123",
      category: "approval",
      priority: "critical",
      owner: "user",
      age: "overdue",
      state: "open",
      title: "Approve the grounded plan",
      reason:
        "Human authority is required. token=secret-value /Users/private/work",
      nextAction: "Review approval facts",
      authorityBoundary: "approve_plan",
      effect: "none",
      maximumCostUsd: 0,
      reversible: true,
      observedAt: now - 1_000,
      deadlineAt: now - 500,
      retryAt: null,
      projectId,
      requestId,
      providerId: null,
      source: "autonomy_recommendation",
      sourceRecordId: requestId,
      evidence: ["Canonical request revision"],
      reference: {
        surface: "work",
        path: `/work?request=${requestId}`,
        label: "Open work",
      },
    },
    {
      id: "decision_1123456789abcdef0123",
      category: "provider",
      priority: "medium",
      owner: "provider",
      age: "recent",
      state: "waiting",
      title: "Groq is limited",
      reason: "Free capacity is temporarily limited.",
      nextAction: "Inspect provider availability",
      authorityBoundary: "wait_for_provider",
      effect: "provider_request",
      maximumCostUsd: 0,
      reversible: true,
      observedAt: now - 200,
      deadlineAt: null,
      retryAt: null,
      projectId: null,
      requestId: null,
      providerId: "groq",
      source: "provider_connection",
      sourceRecordId: "connection_groq",
      evidence: ["Canonical provider state"],
      reference: {
        surface: "providers",
        path: "/providers?provider=groq",
        label: "Open provider",
      },
    },
  ],
};

test("attention aggregation classifies, redacts, fingerprints, facets, and badges canonical evidence", async () => {
  const directory = await mkdtemp(join(tmpdir(), "attention-"));
  const service = new LocalAttentionService(directory);
  const snapshot = await service.snapshot(decisions, live, {}, now);
  assert.equal(snapshot.items.length, 3);
  assert.equal(snapshot.summary.badge, 3);
  assert.equal(snapshot.summary.critical, 1);
  assert.equal(snapshot.items[0]?.category, "action");
  assert.ok(snapshot.items.some((item) => item.category === "provider"));
  assert.ok(snapshot.items.some((item) => item.category === "completion"));
  assert.doesNotMatch(
    JSON.stringify(snapshot),
    /secret-value|\/Users\/private/,
  );
  assert.match(JSON.stringify(snapshot), /\[redacted\]|\/Users\/\[user\]/);
  assert.equal(snapshot.automaticSpendLimitUsd, 0);
  assert.equal(snapshot.retention.maximumItems, 250);
});

test("certification truth becomes one deduplicated zero-cost Action Center item and transitions honestly", async () => {
  const directory = await mkdtemp(join(tmpdir(), "attention-certification-"));
  const service = new LocalAttentionService(directory);
  const base: OwnerJourneyCertificationSnapshot = {
    schemaVersion: 1,
    provenance: "local_owner_journey_certification",
    observedAt: now,
    validForMs: 15_000,
    automaticSpendLimitUsd: 0,
    state: "failed",
    runId: `cert_run_${"a".repeat(20)}`,
    message: "Certification did not pass. Prior evidence is safe.",
    receipt: null,
    lastPassedReceipt: null,
    historyCount: 0,
  };
  const failed = await service.snapshot(decisions, live, {}, now, base);
  const failureItems = failed.items.filter((item) =>
    item.sourceRecordId.startsWith("cert_"),
  );
  assert.equal(failureItems.length, 1);
  assert.equal(failureItems[0]?.category, "recovery");
  assert.equal(failureItems[0]?.maximumCostUsd, 0);
  assert.match(
    failureItems[0]?.reference.path ?? "",
    /activity\?certification/,
  );
  const receipt = {
    schemaVersion: 1 as const,
    certificationId: "b".repeat(64),
    mode: "synthetic_zero_cost" as const,
    outcome: "passed" as const,
    startedAt: "2027-01-15T07:59:59.000Z",
    completedAt: "2027-01-15T08:00:00.000Z",
    durationMs: 1_000,
    suites: (["owner_mvp", "new_product", "existing_product"] as const).map(
      (id) => ({
        id,
        outcome: "passed" as const,
        evidenceDigest: "c".repeat(64),
      }),
    ),
    stages: (
      [
        "plain_language_intake",
        "workspace_and_resources",
        "governed_artifacts",
        "context_and_eligibility",
        "solution_approval",
        "jira_backlog",
        "isolated_implementation",
        "deterministic_validation",
        "independent_review",
        "integration",
        "durable_completion",
      ] as const
    ).map((name) => ({
      name,
      outcome: "passed" as const,
      evidenceDigest: "d".repeat(64),
    })),
    paidCalls: 0 as const,
    externalEffects: 0 as const,
    privacy: {
      prompts: false as const,
      sourceCode: false as const,
      attachments: false as const,
      credentials: false as const,
      absolutePaths: false as const,
      personalIdentifiers: false as const,
      privateJiraContent: false as const,
    },
    limitations: ["Synthetic only."],
    nextAction: "Record one external journey.",
  };
  const passed = await service.snapshot(decisions, live, {}, now, {
    ...base,
    state: "passed",
    message: "Passed.",
    receipt,
    lastPassedReceipt: receipt,
  });
  const item = passed.items.find((entry) =>
    entry.sourceRecordId.startsWith("cert_"),
  );
  assert.equal(item?.category, "action");
  assert.match(item?.title ?? "", /real owner session/i);
  assert.doesNotMatch(JSON.stringify(item), /adopted|customer/i);
});

test("pilot readiness contributes one deduplicated privacy-safe Action Center item", async () => {
  const directory = await mkdtemp(join(tmpdir(), "attention-pilot-"));
  const service = new LocalAttentionService(directory);
  const trust: OwnerJourneyTrustSnapshot = {
    schemaVersion: 1, provenance: "local_owner_journey_trust", observedAt: now, validForMs: 15_000, automaticSpendLimitUsd: 0,
    freshness: { schemaVersion: 1, provenance: "local_certification_freshness", state: "current", observedAt: now, lastPassedAt: now - 1_000, nextCheckAt: now + 1_000, dueAt: now + 1_000, retryAt: null, cadenceMs: 604_800_000, automaticSpendLimitUsd: 0, message: "Current." },
    learning: { schemaVersion: 1, provenance: "privacy_safe_external_learning_aggregate", observedAt: now, completedSessions: 2, eligibleForDecision: false, minimumSampleSize: 3, completionRatePercent: 100, medianTimeToPreviewSeconds: 600, averageTrustRating: 4.5, trustAtLeastFourPercent: 100, frictionCounts: { setup: 0, navigation: 0, trust: 0, clarity: 1, speed: 0, approval: 0, none: 1 }, excludedDrafts: 1, excludedWithdrawn: 1, automaticSpendLimitUsd: 0, limitations: ["More evidence required."] },
    readiness: { schemaVersion: 1, provenance: "local_pilot_readiness_policy", observedAt: now, state: "learning_needed", title: "More owner sessions needed", reason: "One more completed consented session is required.", nextAction: "Record a consented owner session", reasons: ["Minimum sample not reached."], automaticSpendLimitUsd: 0 },
  };
  const snapshot = await service.snapshot(decisions, live, {}, now, undefined, trust);
  const items = snapshot.items.filter((item) => item.sourceRecordId.startsWith("pilot-readiness"));
  assert.equal(items.length, 1);
  assert.equal(items[0]?.maximumCostUsd, 0);
  assert.match(items[0]?.title ?? "", /owner sessions/i);
  assert.doesNotMatch(JSON.stringify(items[0]), /participant-|private note|adopted/i);
});

test("attention actions preview, persist, replay idempotently, reject stale revisions, and survive restart", async () => {
  const directory = await mkdtemp(join(tmpdir(), "attention-"));
  const service = new LocalAttentionService(directory);
  const first = await service.snapshot(decisions, live, {}, now);
  const item = first.items[0]!;
  const action = {
    action: "acknowledge" as const,
    itemId: item.id,
    expectedRevision: item.revision,
  };
  const preview = await service.preview(action, decisions, live, now);
  assert.equal(preview.effect, "local_preference_write");
  const applied = await service.apply(
    action,
    "attention.test.acknowledge.0001",
    decisions,
    live,
    now,
  );
  assert.equal(
    applied.snapshot.items.find((entry) => entry.id === item.id)?.disposition,
    "acknowledged",
  );
  const replay = await service.apply(
    action,
    "attention.test.acknowledge.0001",
    decisions,
    live,
    now + 1,
  );
  assert.equal(replay.receipt.id, applied.receipt.id);
  await assert.rejects(
    () =>
      service.apply(
        {
          action: "snooze",
          itemId: item.id,
          expectedRevision: item.revision,
          durationMinutes: 60,
        },
        "attention.test.acknowledge.0001",
        decisions,
        live,
        now + 1,
      ),
    (error: unknown) =>
      error instanceof AttentionError && error.code === "idempotency_conflict",
  );
  await assert.rejects(
    () =>
      service.apply(
        action,
        "attention.test.acknowledge.0002",
        decisions,
        live,
        now + 2,
      ),
    (error: unknown) =>
      error instanceof AttentionError && error.code === "stale_revision",
  );
  const restarted = new LocalAttentionService(directory);
  assert.equal(
    (await restarted.snapshot(decisions, live, {}, now + 3)).items.find(
      (entry) => entry.id === item.id,
    )?.disposition,
    "acknowledged",
  );
});

test("snooze expires deterministically and quiet hours suppress only non-critical delivery", async () => {
  const directory = await mkdtemp(join(tmpdir(), "attention-"));
  const service = new LocalAttentionService(directory);
  const initial = await service.snapshot(decisions, live, {}, now);
  const provider = initial.items.find((item) => item.category === "provider")!;
  const snoozed = await service.apply(
    {
      action: "snooze",
      itemId: provider.id,
      expectedRevision: provider.revision,
      durationMinutes: 5,
    },
    "attention.test.snooze.0001",
    decisions,
    live,
    now,
  );
  assert.equal(
    snoozed.snapshot.items.find((item) => item.id === provider.id)?.disposition,
    "snoozed",
  );
  assert.equal(
    (await service.snapshot(decisions, live, {}, now + 301_000)).items.find(
      (item) => item.id === provider.id,
    )?.disposition,
    "unread",
  );
  const preference = {
    enabled: true,
    startMinute: 0,
    endMinute: 1_439,
    timeZone: "UTC",
    criticalBypass: true as const,
  };
  const quiet = await service.setQuietHours(
    preference,
    snoozed.snapshot.revision,
    "attention.test.quiet.0001",
    decisions,
    live,
    now,
  );
  assert.equal(quiet.snapshot.quietHoursActive, true);
  assert.equal(
    quiet.snapshot.items.find((item) => item.severity === "critical")
      ?.suppressed,
    false,
  );
  assert.ok(
    quiet.snapshot.items
      .filter((item) => item.severity !== "critical")
      .every((item) => item.suppressed),
  );
});

test("corrupt durable attention state fails closed with recovery guidance", async () => {
  const directory = await mkdtemp(join(tmpdir(), "attention-"));
  await writeFile(
    join(directory, "attention-state.json"),
    '{"schemaVersion":99}',
    "utf8",
  );
  await assert.rejects(
    () =>
      new LocalAttentionService(directory).snapshot(decisions, live, {}, now),
    (error: unknown) =>
      error instanceof AttentionError && error.code === "corrupt_state",
  );
});
