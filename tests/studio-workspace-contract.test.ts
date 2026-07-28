import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("workspace exposes trusted destinations and keyboard command semantics", async () => {
  const source = await readFile("apps/studio/src/workspace.ts", "utf8");
  for (const label of [
    "Control center",
    "Conversation",
    "Current work",
    "Needs you",
    "Checkpoints",
    "Preview",
    "Restore",
    "Help & setup"
  ]) {
    assert.match(source, new RegExp(label));
  }
  assert.match(source, /aria-label="Find anything"/);
  assert.match(source, /Control\/Command \+ K|event\.metaKey \|\| event\.ctrlKey/);
  assert.match(source, /event\.key === "Escape"/);
  assert.match(source, /window\.onpopstate/);
});

test("workspace labels fixture claims and prevents inert decision controls", async () => {
  const source = await readFile("apps/studio/src/workspace.ts", "utf8");
  assert.match(source, /fixture-badge">Demo data/);
  assert.match(source, /data-product-choice=/);
  assert.match(source, /aria-pressed=/);
  assert.match(source, /Demo choice recorded locally\. No project data was changed\./);
  assert.doesNotMatch(source, /commit 726d351/);
});

test("workspace renders provider evidence as interactive, explicitly demo-scoped telemetry", async () => {
  const workspace = await readFile("apps/studio/src/workspace.ts", "utf8");
  const fixture = await readFile("apps/studio/src/runtime-fixture.ts", "utf8");
  assert.match(workspace, /Provider mesh · demo evidence/);
  assert.match(workspace, /data-provider-id/);
  assert.match(workspace, /successfulProviderCalls/);
  assert.match(fixture, /buildProviderTelemetry/);
  assert.match(fixture, /successfulCalls/);
  assert.doesNotMatch(fixture, /from "\.\.\/\.\.\/\.\.\/packages\/providers\/src\/index\.js"/);
});

test("workspace has explicit responsive, focus, motion, and contrast contracts", async () => {
  const styles = await readFile("apps/studio/src/styles.css", "utf8");
  const tokens = await readFile("packages/ui/src/tokens.css", "utf8");
  assert.match(styles, /@media \(max-width: 92rem\)/);
  assert.match(styles, /@media \(max-width: 68rem\)/);
  assert.match(styles, /@media \(max-width: 48rem\)/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(tokens, /\.ps-focusable:focus-visible/);
  assert.match(tokens, /@media \(forced-colors: active\)/);
});
