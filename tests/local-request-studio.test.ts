import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Studio separates real request state from guided orchestration examples", async () => {
  const panel = await readFile(
    "apps/studio/src/components/conversation/local-request-panel.tsx",
    "utf8"
  );
  const proposal = await readFile(
    "apps/studio/src/components/conversation/local-proposal-card.tsx",
    "utf8"
  );
  const studioUi = `${panel}\n${proposal}`;
  for (const phrase of [
    "What do you want to build?",
    "Work in progress",
    "New project",
    "Choose folder",
    "Attach files",
    "GitHub repositories",
    "Connect GitHub in Settings first.",
    "Jira project",
    "Connect Jira in Settings first.",
    "saved to this project.",
    "No worker or provider activity is implied",
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
    "Prepare grounded AI proposal",
    "Generate with free provider",
    "Retry eligible free providers",
    "Free-provider execution",
    "No provider call has been recorded",
    "Grounded model proposal",
    "Untrusted suggestion · never applied automatically",
    "Accept proposal preview",
    "Reject proposal",
    "Reconcile provider outcome",
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
  assert.equal(studioUi.includes(phrase), true, `Missing truthful UI contract: ${phrase}`);
  }
  assert.equal(panel.includes("listIntegrationConnections"), true);
  assert.equal(panel.includes("setLocalProjectResources"), true);
  assert.equal(panel.includes('connection.provider === "github"'), true);
  assert.equal(panel.includes('connection.provider === "jira"'), true);
  assert.equal(panel.includes("connections[0]"), false);
  const app = await readFile("apps/studio/src/App.tsx", "utf8");
  assert.equal(app.includes('LocalRequestPanel mode="compose"'), true);
  assert.equal(app.includes('LocalRequestPanel mode="queue"'), true);
  assert.equal(app.includes("<AutonomousWorkCenter endpoint={controlPlaneEndpoint} />"), true);
  const controlPlane = await readFile("apps/core/src/control-plane.ts", "utf8");
  assert.equal(controlPlane.includes("const MAX_REQUEST_BYTES = 900_000"), true);
});
