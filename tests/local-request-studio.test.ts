import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Studio separates real request state from guided orchestration examples", async () => {
  const panel = await readFile(
    "apps/studio/src/components/conversation/local-request-panel.tsx",
    "utf8"
  );
  for (const phrase of [
    "Create real local work",
    "Real local work queue",
    "No AI · no source changes",
    "No worker or provider activity is implied",
    "Time passing never becomes invented progress",
    "Approve zero-effect contract",
    "Authorize isolated preparation",
    "Prepare isolated workspace",
    "Start bounded run",
    "git diff --check · fixed argv · 10s limit · 64 KiB output cap",
    "Observed changes",
    "Exact isolated replacement",
    "Choose an approved file",
    "Preview exact replacement",
    "Approve exact patch",
    "Apply inside worktree",
    "Validate isolated patch",
    "Roll back isolated patch",
    "Multi-file change set",
    "Preview atomic change set",
    "Approve exact change set",
    "Apply all files atomically",
    "Validate complete change set",
    "Roll back every file",
    "Reconcile interrupted change set",
    "Applied means isolated bytes verified",
    "Local isolated commit",
    "Preview local commit",
    "Approve local commit",
    "Create isolated commit",
    "Undo isolated commit",
    "Hooks and signing disabled",
    "Local canonical integration",
    "Preview local integration",
    "Approve local integration",
    "Integrate into local branch",
    "Undo local integration",
    "conflict probe passed",
    "Cancel and preserve",
    "Record zero-effect checkpoint",
    "Release proof lease",
    "Maximum cost",
    "Ground and draft plan",
    "Real topology and execution plan",
    "Approve and freeze plan",
    "Grounding citations explain why",
    "topology paths define proposed targets",
    "execution unauthorized",
    "Save task",
  ]) {
    assert.equal(panel.includes(phrase), true, `Missing truthful UI contract: ${phrase}`);
  }
  const app = await readFile("apps/studio/src/App.tsx", "utf8");
  assert.equal(app.includes('LocalRequestPanel mode="compose"'), true);
  assert.equal(app.includes('LocalRequestPanel mode="queue"'), true);
  assert.equal(app.includes("interactive preview, not active work"), true);
  const controlPlane = await readFile("apps/core/src/control-plane.ts", "utf8");
  assert.equal(controlPlane.includes("const MAX_REQUEST_BYTES = 98_304"), true);
});
