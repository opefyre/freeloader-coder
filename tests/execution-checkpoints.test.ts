import assert from "node:assert/strict";
import test from "node:test";

import {
  analyzeCheckpointApplication,
  createExecutionCheckpoint,
  recordCheckpointDecision
} from "../packages/execution/src/index.js";

function checkpoint(conflicts: readonly unknown[] = []) {
  return createExecutionCheckpoint({
    id: "checkpoint-task",
    projectId: "project-1",
    kind: "validation",
    sourceDigest: "a".repeat(64),
    affectedFeatures: ["Project onboarding"],
    files: ["src/App.tsx", "tests/app.test.ts"],
    generatedData: ["dist/report.json"],
    conflicts: conflicts as never,
    restoreImpact: "Restore two product-owned files; preserve notes.txt.",
    createdAt: 100
  });
}

test("clean checkpoints apply automatically while preserving unrelated changes", () => {
  const result = analyzeCheckpointApplication({
    checkpoint: checkpoint(),
    unrelatedUserPaths: ["notes.txt"]
  });
  assert.equal(result.mode, "automatic");
  assert.deepEqual(result.applyPaths, ["src/App.tsx", "tests/app.test.ts"]);
  assert.deepEqual(result.preservedPaths, ["notes.txt"]);
});

test("conflict handling exposes both sides and never discards either", () => {
  const conflict = {
    path: "src/App.tsx",
    currentDigest: "b".repeat(64),
    proposedDigest: "c".repeat(64),
    currentLabel: "Your current version",
    proposedLabel: "Pipeline Studio proposal"
  };
  const result = analyzeCheckpointApplication({
    checkpoint: checkpoint([conflict]),
    unrelatedUserPaths: []
  });
  assert.equal(result.mode, "guided_conflict");
  assert.deepEqual(result.conflicts, [conflict]);
  assert.ok(result.options.includes("Keep the current version"));
  assert.ok(result.options.includes("Use the proposed version"));
  assert.ok(result.options.includes("Open both versions side by side"));
  assert.doesNotMatch(JSON.stringify(result), /discard/i);
});

test("keep, restore, and publish decisions are auditable", () => {
  for (const action of ["keep", "restore", "publish"] as const) {
    const decision = recordCheckpointDecision({
      checkpoint: checkpoint(),
      action,
      actorId: "user-1",
      decidedAt: 200,
      reversible: action !== "publish",
      compensation: action === "publish" ? "Create a compensating revert." : "Return to the prior checkpoint."
    });
    assert.equal(decision.action, action);
    assert.match(decision.evidenceDigest, /^[a-f0-9]{64}$/);
    assert.ok(decision.compensation.length > 0);
  }
});
