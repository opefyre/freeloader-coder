import assert from "node:assert/strict";
import test from "node:test";
import { runWorkflow, type WorkflowAdapters } from "../packages/orchestration/src/workflow.js";

function fakeAdapters(overrides: Partial<WorkflowAdapters> = {}): WorkflowAdapters {
  return {
    prepare: async () => "workspace prepared",
    plan: async () => "plan recorded",
    implement: async () => "change produced",
    validate: async (_taskId, tier) => ({ passed: true, evidence: `${tier} passed` }),
    heal: async (_taskId, attempt) => `repair ${attempt} produced`,
    review: async (_taskId, kind) => ({ verdict: "pass", evidence: `${kind} approved` }),
    commit: async () => "commit observed",
    integrate: async () => "integration observed",
    ...overrides
  };
}

test("single-computer fake journey reaches review ready with observed evidence", async () => {
  const result = await runWorkflow("task-1", fakeAdapters());
  assert.equal(result.stage, "review_ready");
  assert.deepEqual(result.evidence, [
    "workspace prepared",
    "plan recorded",
    "change produced",
    "fast passed",
    "full passed",
    "functional approved",
    "design approved",
    "commit observed",
    "integration observed"
  ]);
});

test("validation failure heals within a bounded budget", async () => {
  let validations = 0;
  const result = await runWorkflow("task-2", fakeAdapters({
    validate: async (_taskId, tier) => {
      validations += 1;
      return validations === 1
        ? { passed: false, evidence: "lint failed" }
        : { passed: true, evidence: `${tier} passed after repair` };
    }
  }));
  assert.equal(result.stage, "review_ready");
  assert.equal(result.healingAttempts, 1);
  assert.equal(result.evidence.includes("repair 1 produced"), true);
});

test("exhausted healing budget quarantines instead of claiming completion", async () => {
  const result = await runWorkflow("task-3", fakeAdapters({
    validate: async () => ({ passed: false, evidence: "repeatable failure" })
  }), { maxHealingAttempts: 1 });
  assert.equal(result.stage, "quarantined");
  assert.equal(result.healingAttempts, 1);
  assert.equal(result.evidence.at(-1), "repeatable failure");
});

test("review uncertainty requires the user and prevents commit or integration", async () => {
  let effects = 0;
  const result = await runWorkflow("task-4", fakeAdapters({
    review: async (_taskId, kind) => kind === "functional"
      ? { verdict: "needs_user", evidence: "product choice required" }
      : { verdict: "pass", evidence: "approved" },
    commit: async () => { effects += 1; return "commit"; },
    integrate: async () => { effects += 1; return "integration"; }
  }));
  assert.equal(result.stage, "needs_user");
  assert.equal(effects, 0);
});
