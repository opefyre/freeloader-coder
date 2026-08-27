import assert from "node:assert/strict";
import test from "node:test";

import { ownerDesignDecisionGuidance, ownerDesignDecisionGuidanceSchema, ownerProjectGuidance, ownerProjectGuidanceSchema } from "../packages/runtime/src/owner-project-guidance.js";
import type { LocalProjectSnapshot } from "../packages/runtime/src/local-projects.js";

const stages = ["intake", "context_review", "clarification", "solution_design", "awaiting_design_approval", "backlog_design", "backlog_qa", "delivery", "blocked", "complete", "cancelled"] as const;

test("every lifecycle stage has one complete owner command model", () => {
  for (const stage of stages) {
    const result = ownerProjectGuidance(project(stage));
    assert.equal(result.lifecycleStage, stage);
    assert.ok(result.stageLabel.length > 0);
    assert.ok(result.primaryAction.label.length > 0);
    assert.ok(result.approvalBoundary.length > 0);
    assert.ok(result.downstreamEffect.length > 0);
    assert.ok(result.recovery.length > 0);
    assert.equal(result.automaticSpendLimitUsd, 0);
    ownerProjectGuidanceSchema.parse(result);
  }
});

test("design approval guidance bounds every owner choice without authorizing delivery", () => {
  const decision = ownerDesignDecisionGuidanceSchema.parse(ownerDesignDecisionGuidance());
  assert.equal(decision.options.map((option) => option.id).join(","), "approved,revision_requested,declined");
  assert.match(decision.consequence, /Jira-backed backlog/);
  assert.match(decision.consequence, /does not authorize implementation or deployment/i);
  assert.match(decision.recovery, /preserving the current evidence/i);
  assert.equal(decision.automaticSpendLimitUsd, 0);
});

test("owner-required, autonomous, terminal, warning, and failed states stay honest", () => {
  assert.equal(ownerProjectGuidance(project("clarification")).primaryAction.destination, "actions");
  assert.equal(ownerProjectGuidance(project("awaiting_design_approval")).ownerState, "action_required");
  assert.equal(ownerProjectGuidance(project("delivery")).ownerState, "autonomous");
  assert.equal(ownerProjectGuidance(project("complete")).ownerState, "complete");
  assert.equal(ownerProjectGuidance({ ...project("delivery"), state: "warning", warnings: ["Provider evidence is stale."] }).recovery, "Provider evidence is stale.");
  const failed = ownerProjectGuidance({ ...project("delivery"), state: "failed", warnings: ["Preserved receipt is invalid."] });
  assert.equal(failed.stageLabel, "Recovery required");
  assert.equal(failed.primaryAction.destination, "actions");
  assert.match(failed.approvalBoundary, /No action is authorized/);
});

test("incomplete Jira evidence prevents a completion claim", () => {
  const incomplete = ownerProjectGuidance({
    ...project("complete"),
    progress: {
      source: "jira",
      completed: 11,
      total: 48,
      blocked: 0,
      percent: 23,
      observedAt: 1,
    },
  });
  assert.equal(incomplete.stageLabel, "Completion not verified");
  assert.equal(incomplete.ownerState, "attention");
  assert.equal(incomplete.primaryAction.label, "Review Jira progress");
  assert.equal(incomplete.primaryAction.destination, "progress");
  assert.match(incomplete.outcome, /11 of 48/);

  const verified = ownerProjectGuidance({
    ...project("complete"),
    progress: {
      source: "jira",
      completed: 48,
      total: 48,
      blocked: 0,
      percent: 100,
      observedAt: 1,
    },
  });
  assert.equal(verified.stageLabel, "Complete");
  assert.equal(ownerProjectGuidance(project("complete")).stageLabel, "Complete");
});

function project(lifecycleStage: LocalProjectSnapshot["lifecycleStage"]): LocalProjectSnapshot {
  return { schemaVersion: 1, id: "project_1234567890abcdef", displayName: "Example", lifecycleStage, state: "ready", observedAt: 1, validForMs: 1_000, facts: [], inferences: [], decisions: [], warnings: [] };
}
