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
  const voice = await readFile("apps/studio/src/components/conversation/local-voice-input.tsx", "utf8");
  const evidenceReview = await readFile(
    "apps/studio/src/components/conversation/local-evidence-review.tsx",
    "utf8"
  );
  const studioUi = `${panel}\n${proposal}\n${voice}\n${evidenceReview}`;
  for (const phrase of [
    "What do you want to build?",
    "Work in progress",
    "New project",
    "Choose folder",
    "Attach files",
    "Describe your idea… or drop files here",
    "Dropped attachments",
    "Upload",
    "Record voice",
    "Stop voice recording",
    "Review transcript",
    "Audio remains local. The speech model runs on this computer",
    "Microphone access was not granted.",
    "Recording stopped safely.",
    "Transcribe locally",
    "Upload audio",
    "Local transcript ready.",
    "Imported evidence summary",
    "evidence unit",
    "Review extracted summary",
    "Save correction",
    "Correction saved",
    "Saving regenerates project context from the owner correction.",
    "GitHub repositories",
    "Connect GitHub in Settings first.",
    "Jira project",
    "Connect Jira in Settings first.",
    "saved to this project.",
    "Ready for a new product request.",
    "No Jira",
    "repos",
    "Previously selected · unavailable from GitHub",
    "Previously selected · unavailable from Jira",
    "Find a repository or Jira project…",
    "No matching repositories.",
    "No matching Jira projects.",
    "No worker or provider activity is implied",
    "Approve zero-effect contract",
    "Authorize isolated preparation",
    "Prepare isolated workspace",
    "Start bounded run",
    "Diff check · safe commands · 10s · 64 KiB cap",
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
    "Citations explain why",
    "paths define targets",
    "execution unauthorized",
    "Save task",
  ]) {
  assert.equal(studioUi.includes(phrase), true, `Missing truthful UI contract: ${phrase}`);
  }
  assert.equal(panel.includes("listIntegrationConnections"), true);
  assert.equal(panel.includes("setLocalProjectResources"), true);
  assert.equal(panel.includes('connection.provider === "github"'), true);
  assert.equal(panel.includes('connection.provider === "jira"'), true);
  assert.equal(panel.includes("boundRepositories"), true);
  assert.equal(panel.includes("boundJira"), true);
  assert.equal(panel.includes("connections[0]"), false);
  const app = await readFile("apps/studio/src/App.tsx", "utf8");
  assert.equal(app.includes('LocalRequestPanel mode="compose"'), true);
  assert.equal(app.includes('LocalRequestPanel mode="queue"'), true);
  assert.equal(app.includes("<AutonomousWorkCenter endpoint={controlPlaneEndpoint} />"), true);
  const controlPlane = await readFile("apps/core/src/control-plane.ts", "utf8");
  assert.equal(controlPlane.includes("const MAX_REQUEST_BYTES = 900_000"), true);
});

test("native workspace and attachment controls expose keyboard and screen-reader recovery", async () => {
  const panel = await readFile(
    "apps/studio/src/components/conversation/local-request-panel.tsx",
    "utf8",
  );
  const client = await readFile(
    "apps/studio/src/native-picker-client.ts",
    "utf8",
  );

  assert.match(panel, /type="button"[\s\S]*onClick=\{\(\) => void chooseFolder\(\)\}/);
  assert.match(panel, /aria-label="Attach files"[\s\S]*onClick=\{\(\) => void chooseFiles\(\)\}/);
  assert.match(panel, /aria-live="polite"[\s\S]*\{notice\}/);
  assert.match(
    panel,
    /Native picker references are deliberately process-local[\s\S]*setWorkspacePath\(""\);[\s\S]*setWorkspaceLabel\("Choose folder again"\);/,
  );
  assert.doesNotMatch(
    panel,
    /setWorkspacePath\([\s\S]{0,120}resumable\.workspaceReference/,
  );
  assert.match(client, /Files and Folders settings/);
  assert.match(client, /Nothing was changed/);
});

test("starting a new project clears every project-scoped intake value", async () => {
  const panel = await readFile(
    "apps/studio/src/components/conversation/local-request-panel.tsx",
    "utf8",
  );

  const reset = panel.slice(
    panel.indexOf("function beginNewProject()"),
    panel.indexOf("const refresh = useCallback"),
  );
  for (const requiredReset of [
    'rememberDraft(null)',
    'setProjectId("__new__")',
    'setWorkspacePath("")',
    'setWorkspaceLabel("")',
    'setAttachments([])',
    'setBrowserAttachments([])',
    'setVoice(null)',
    'setSelectedRepositoryIds([])',
    'setSelectedJiraProjectId("")',
    'setSelectedTelegramChatIds([])',
    'setOutcome("")',
    'setClarificationChoices({})',
    'setCustomAnswers({})',
    'setLastSubmission(undefined)',
  ]) {
    assert.equal(reset.includes(requiredReset), true, `Missing reset: ${requiredReset}`);
  }
  assert.match(panel, /function beginNewProject\(\)/);
});

test("submission invalidates delayed autosave before durable work starts", async () => {
  const panel = await readFile(
    "apps/studio/src/components/conversation/local-request-panel.tsx",
    "utf8",
  );

  assert.match(panel, /const draftSaveTimer = useRef<number \| null>\(null\)/);
  assert.match(panel, /const draftGeneration = useRef\(0\)/);
  assert.match(
    panel,
    /async function submit\(\)[\s\S]*draftGeneration\.current \+= 1;[\s\S]*window\.clearTimeout\(draftSaveTimer\.current\);[\s\S]*setStatus\("working"\)/,
  );
  assert.match(
    panel,
    /const generation = draftGeneration\.current;[\s\S]*if \(generation !== draftGeneration\.current\) return;[\s\S]*saveResumableProjectIntakeDraft/,
  );
});
