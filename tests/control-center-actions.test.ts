import assert from "node:assert/strict";
import test from "node:test";
import { applyTaskAction, previewTaskAction } from "../packages/control-center/src/actions.js";

test("actions are state-valid and replay is idempotent", () => {
  const preview = previewTaskAction({ action: "pause", state: "running", activeLease: "lease-1", preservedWork: ["branch", "artifacts"], affectedDependencies: ["task-b"] });
  assert.equal(preview.allowed, true);
  const first = applyTaskAction({ preview, actor: "opefyre", reason: "Review", idempotencyKey: "pause-1", appliedKeys: new Set() });
  const replay = applyTaskAction({ preview, actor: "opefyre", reason: "Review", idempotencyKey: "pause-1", appliedKeys: new Set(["pause-1"]) });
  assert.equal(first.applied, true);
  assert.equal(replay.applied, false);
  assert.equal(replay.audit.postcondition, "Existing result preserved");
});

test("quarantined work cannot be resurrected and explains the smallest decision", () => {
  const preview = previewTaskAction({ action: "resume", state: "quarantined", activeLease: null, preservedWork: ["evidence"], affectedDependencies: [] });
  assert.equal(preview.allowed, false);
  assert.match(preview.blocker!, /evidence review/);
  assert.match(preview.smallestDecision!, /repair, abandon, or create replacement/);
});
