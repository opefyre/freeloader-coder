import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("apps/studio/src/components/control-center/control-center.tsx", "utf8");
const app = readFileSync("apps/studio/src/App.tsx", "utf8");

test("Overview mounts the source-backed Control Center", () => {
  assert.match(app, /<ControlCenter navigate=\{navigate\} \/>/);
  for (const heading of ["The whole system, with receipts", "Pipeline velocity", "Provider execution share", "Safe operator action", "Local doctor and support bundle"]) {
    assert.match(source, new RegExp(heading));
  }
});

test("visual elements expose exact work and provider sources", () => {
  assert.match(source, /setSelectedTask/);
  assert.match(source, /Open exact Jira task/);
  assert.match(source, /provider\.dashboard/);
  assert.match(source, /navigate\("evidence"\)/);
  assert.match(source, /navigate\("work"\)/);
});

test("operator actions and diagnostics require previews with truthful effects", () => {
  assert.match(source, /Preview pause/);
  assert.match(source, /checkpoint preserved/);
  assert.match(source, /Preview support bundle/);
  assert.match(source, /Excluded: source code, prompts, credentials, user paths/);
  assert.match(source, /aria-live="polite"/);
});
