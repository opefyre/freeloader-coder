import assert from "node:assert/strict";
import test from "node:test";

import {
  abandonWorkspace,
  createIsolatedWorkspace,
  evaluateWorkspaceCleanup,
  isolationProfileSchema,
  isolationProfiles,
  pauseWorkspace
} from "../packages/execution/src/index.js";

test("concurrent tasks and runs receive unique workspaces and branches", () => {
  const profile = isolationProfiles[0]!;
  const first = createIsolatedWorkspace({
    taskId: "PIPE-60",
    runId: "run-a",
    baseline: "a".repeat(40),
    profile,
    createdAt: 100
  });
  const second = createIsolatedWorkspace({
    taskId: "PIPE-60",
    runId: "run-b",
    baseline: "a".repeat(40),
    profile,
    createdAt: 100
  });
  assert.notEqual(first.workspaceRef, second.workspaceRef);
  assert.notEqual(first.branch, second.branch);
  assert.equal(first.ancestryVerified, true);
});

test("reduced isolation cannot claim strong-only capabilities", () => {
  assert.throws(
    () => isolationProfileSchema.parse({
      ...isolationProfiles[1],
      capabilities: [...isolationProfiles[1]!.capabilities, "secret_reference"]
    }),
    /Reduced isolation/
  );
});

test("abandoned workspaces remain recoverable before bounded cleanup", () => {
  const workspace = createIsolatedWorkspace({
    taskId: "PIPE-60",
    runId: "run-a",
    baseline: "b".repeat(40),
    profile: isolationProfiles[0],
    createdAt: 100
  });
  const abandoned = abandonWorkspace({ workspace, now: 200, recoveryWindowMs: 60_000 });
  assert.equal(abandoned.state, "recoverable");
  assert.equal(evaluateWorkspaceCleanup(abandoned, 30_000).action, "preserve");
  const cleanup = evaluateWorkspaceCleanup(abandoned, 60_200);
  assert.equal(cleanup.action, "cleanup");
  assert.equal(cleanup.workspace.state, "cleanup_ready");
});

test("pausing preserves identity, baseline, and a new state digest", () => {
  const workspace = createIsolatedWorkspace({
    taskId: "PIPE-60",
    runId: "run-a",
    baseline: "c".repeat(40),
    profile: isolationProfiles[2],
    createdAt: 100
  });
  const paused = pauseWorkspace(workspace);
  assert.equal(paused.state, "paused");
  assert.equal(paused.workspaceRef, workspace.workspaceRef);
  assert.equal(paused.baseline, workspace.baseline);
  assert.notEqual(paused.stateDigest, workspace.stateDigest);
});
