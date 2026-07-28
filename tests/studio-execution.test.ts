import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  checkpointTimeline,
  conflictPreview,
  executionProfiles,
  executionTools,
  resourceSnapshot,
} from "../apps/studio/src/execution-fixture.js";

const appSource = readFileSync("apps/studio/src/App.tsx", "utf8");
const panelSource = readFileSync(
  "apps/studio/src/components/execution/execution-safety-panel.tsx",
  "utf8"
);

test("Work screen mounts the safe execution console", () => {
  assert.match(appSource, /<ExecutionSafetyPanel \/>/);
  assert.match(panelSource, /Safe execution console/);
  assert.match(panelSource, /Strong isolation/);
});

test("compute profiles expose truthful limits and an 8 GB path", () => {
  assert.deepEqual(
    executionProfiles.map((profile) => profile.id),
    ["lightweight", "standard", "distributed"]
  );
  assert.equal(
    executionProfiles
      .find((profile) => profile.id === "lightweight")
      ?.limits.includes("4 GB memory ceiling"),
    true
  );
  assert.match(panelSource, /Choose the pace; safety limits stay enforced/);
});

test("tool access is explicit and unknown tools are refused", () => {
  assert.equal(executionTools.length, 5);
  assert.equal(executionTools.every((tool) => tool.effect.length > 0), true);
  assert.match(panelSource, /Unknown tools are refused/);
});

test("checkpoint UI covers the complete lifecycle and safe restore impact", () => {
  assert.deepEqual(
    checkpointTimeline.map((item) => item.id),
    ["baseline", "task", "validation", "accepted", "published"]
  );
  assert.match(panelSource, /unrelated changes are preserved/);
  assert.match(panelSource, /Decision recorded locally/);
});

test("conflict UI preserves both versions and provides guided choices", () => {
  assert.equal(conflictPreview.current.label, "Your current version");
  assert.equal(conflictPreview.proposed.label, "Pipeline proposal");
  assert.equal(conflictPreview.options.length, 4);
  assert.match(panelSource, /Nothing is applied until you choose/);
});

test("resource pressure and resumable pause are visible in plain language", () => {
  assert.equal(resourceSnapshot.state, "Comfortable");
  assert.match(panelSource, /automatically reduces work or/);
  assert.match(panelSource, /Paused at a recoverable boundary/);
  assert.match(panelSource, /Resume will re-check resources first/);
});
