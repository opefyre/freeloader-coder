import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("workspace exposes trusted destinations and keyboard command semantics", async () => {
  const source = await readFile("apps/studio/src/App.tsx", "utf8");
  for (const label of [
    "Overview",
    "Conversation",
    "Work",
    "Providers",
    "Evidence",
    "Settings"
  ]) {
    assert.match(source, new RegExp(label));
  }
  assert.match(source, /Find tasks, runs, or evidence/);
  assert.match(source, /⌘ K/);
  assert.match(source, /aria-current=/);
  assert.match(source, /window\.history\[replace \? "replaceState" : "pushState"\]/);
  assert.match(source, /window\.addEventListener\("popstate"/);
  assert.match(source, /event\.key\.toLowerCase\(\) === "k"/);
  assert.match(source, /role="dialog"/);
  assert.match(source, /aria-modal="true"/);
  assert.match(source, /setActiveView/);
});

test("workspace labels fixture claims and prevents inert decision controls", async () => {
  const source = await readFile("apps/studio/src/App.tsx", "utf8");
  assert.match(source, /Demo data/);
  assert.match(source, /Choose the public product name/);
  assert.match(source, /Demo message received locally\. No task was created\./);
  assert.match(source, /Demo choice recorded locally\. No project data was changed\./);
  assert.match(source, /aria-pressed=\{selected\}/);
  assert.doesNotMatch(source, /commit 726d351/);
});

test("workspace provides dedicated interactive surfaces rather than inert anchors", async () => {
  const source = await readFile("apps/studio/src/App.tsx", "utf8");
  for (const title of [
    "Build through conversation",
    "Work that explains itself",
    "Models working as one system",
    "Trust, with receipts",
    "Connections and safeguards",
  ]) {
    assert.match(source, new RegExp(title));
  }
  assert.match(source, /onClick=\{\(\) => navigate\(item\.id\)\}/);
  assert.match(source, /onClick=\{\(\) => navigate\("conversation"\)\}/);
  assert.match(source, /https:\/\/opefyre\.atlassian\.net\/browse\/PIPE-33/);
});

test("workspace renders provider evidence as interactive, explicitly demo-scoped telemetry", async () => {
  const workspace = await readFile("apps/studio/src/App.tsx", "utf8");
  const fixture = await readFile("apps/studio/src/runtime-fixture.ts", "utf8");
  assert.match(workspace, /Provider mesh · demo evidence/);
  assert.match(workspace, /data-provider-id/);
  assert.match(workspace, /successfulProviderCalls/);
  assert.match(fixture, /buildProviderTelemetry/);
  assert.match(fixture, /routeEvidenceSummary/);
  assert.match(fixture, /successfulCalls/);
  assert.doesNotMatch(fixture, /from "\.\.\/\.\.\/\.\.\/packages\/providers\/src\/index\.js"/);
});

test("workspace exposes an interactive denial-of-wallet proof instead of a cost promise", async () => {
  const workspace = await readFile("apps/studio/src/App.tsx", "utf8");
  const fixture = await readFile("apps/studio/src/runtime-fixture.ts", "utf8");
  assert.match(workspace, /Denial of wallet/);
  assert.match(workspace, /Maximum automatic spend/);
  assert.match(workspace, /data-cost-details/);
  assert.match(workspace, /Paid mode requires a separate connection approval/);
  assert.match(fixture, /paidRoutesProduced: 0/);
  assert.match(fixture, /Billing-enabled projects denied/);
  assert.match(fixture, /lifecycle: "retired"/);
});

test("workspace has explicit responsive, focus, motion, and contrast contracts", async () => {
  const styles = await readFile("apps/studio/src/globals.css", "utf8");
  const source = await readFile("apps/studio/src/App.tsx", "utf8");
  assert.match(styles, /@media \(max-width: 76rem\)/);
  assert.match(styles, /@media \(max-width: 48rem\)/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(source, /focus-visible:ring-3/);
  assert.match(styles, /@media \(forced-colors: active\)/);
});
