import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Projects mounts a real local registry journey before the synthetic example", async () => {
  const [app, panel] = await Promise.all([
    readFile("apps/studio/src/App.tsx", "utf8"),
    readFile(
      "apps/studio/src/components/projects/local-projects-panel.tsx",
      "utf8"
    ),
  ]);
  assert.match(app, /components\/projects\/local-projects-panel\.js/);
  assert.ok(app.indexOf("<LocalProjectsPanel />") < app.indexOf("Guided synthetic example"));
  for (const phrase of [
    "Your real local projects",
    "Choose project folder",
    "No project folder selected",
    "Live local registry",
    "Repository writes",
    "Commands or AI",
    "Browser path access",
    "No real project registered yet",
    "Rescan metadata",
    "Forget registration",
    "The repository and every file inside it remain untouched",
  ]) {
    assert.equal(panel.includes(phrase), true, `Missing local project contract: ${phrase}`);
  }
  assert.match(panel, /openNativePicker\(\{ endpoint, kind: "folder" \}\)/);
  assert.doesNotMatch(panel, /Absolute repository path/);
  assert.doesNotMatch(panel, /placeholder="\/Users\/you\/Projects\/my-app"/);
});

test("real project UI keeps facts, inferences, decisions, warnings, and recovery explicit", async () => {
  const panel = await readFile(
    "apps/studio/src/components/projects/local-projects-panel.tsx",
    "utf8"
  );
  for (const phrase of [
    "Evidence:",
    "Bounded inferences",
    "Your decisions",
    "Honest limitations",
    "Runtime offline",
    "last safe project view is preserved",
    'aria-live="polite"',
  ]) {
    assert.equal(panel.includes(phrase), true, `Missing truthfulness state: ${phrase}`);
  }
});

test("opening a portfolio project enters the dedicated project workspace", async () => {
  const [app, portfolio, panel] = await Promise.all([
    readFile("apps/studio/src/App.tsx", "utf8"),
    readFile("apps/studio/src/components/projects/project-portfolio.tsx", "utf8"),
    readFile("apps/studio/src/components/conversation/local-request-panel.tsx", "utf8"),
  ]);
  assert.match(portfolio, /openProject: \(projectId: string\) => void/);
  assert.match(app, /projectRoute\(projectId\)/);
  assert.match(app, /ProjectSettingsPanel endpoint=\{endpoint\} projectId=\{selectedProjectId\}/);
  assert.match(app, /ProjectActivityDashboard endpoint=\{endpoint\} mode="analytics" projectId=\{selectedProjectId\}/);
  assert.match(app, />\s*All projects\s*</);
  assert.match(panel, /initialProjectId\?: string/);
  assert.doesNotMatch(app, /function BuildWorkspace[\s\S]*\/activity\?project=/);
});
