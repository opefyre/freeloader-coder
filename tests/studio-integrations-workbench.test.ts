import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const app = readFileSync("apps/studio/src/App.tsx", "utf8");
const routing = readFileSync("apps/studio/src/routing.ts", "utf8");
const workbench = readFileSync(
  "apps/studio/src/components/integrations/integration-workbench.tsx",
  "utf8"
);

test("Integrations has a stable route and mounts a dedicated connected-work surface", () => {
  assert.match(routing, /integrations:\s*\{\s*path: "\/integrations"/);
  assert.match(app, /view === "integrations"/);
  assert.match(app, /<IntegrationWorkbench \/>/);
  assert.match(routing, /label: "Connect"/);
});

test("connected-work UI exposes granular grants, import, grounding, publishing, and sync", () => {
  for (const text of [
    "Least privilege",
    "Repository entry",
    "GitHub Models",
    "Jira planning import",
    "Task graph preview",
    "Publish verified checkpoint",
    "Synchronize Jira evidence"
  ]) {
    assert.match(workbench, new RegExp(text));
  }
  assert.match(workbench, /Interactive demo · no network writes/);
  assert.match(workbench, /0 broad tokens · 0 duplicate writes/);
  assert.match(workbench, /Nothing has been written yet/);
  assert.match(workbench, /Model output alone can never produce Done/);
});

test("integration actions are interactive, source-linked, and responsive", () => {
  assert.match(workbench, /aria-pressed/);
  assert.match(workbench, /aria-live="polite"/);
  assert.match(workbench, /opefyre\.atlassian\.net\/browse\/PIPE-72/);
  assert.match(workbench, /github\.com\/settings\/installations/);
  assert.match(workbench, /xl:grid-cols/);
  assert.match(app, /grid-cols-8/);
});
