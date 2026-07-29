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
    "Run deterministic validation",
    "git diff --check · fixed argv · 10s limit · 64 KiB output cap",
    "Observed changes",
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
});
