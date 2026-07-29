import assert from "node:assert/strict";
import test from "node:test";

import {
  studioViews,
  validateWorkspaceRegistry,
  workspaceDefinitions,
  type WorkspaceDefinition,
} from "../apps/studio/src/routing.js";

test("workspace registry is complete, unique, and projects navigation deliberately", () => {
  assert.deepEqual(validateWorkspaceRegistry(workspaceDefinitions), []);
  assert.equal(studioViews.length, 13);
  assert.equal(
    studioViews.filter((view) => workspaceDefinitions[view].group === "primary").length,
    8
  );
  assert.equal(
    studioViews.filter((view) => workspaceDefinitions[view].mobile).length,
    8
  );
  assert.deepEqual(
    studioViews.filter((view) => workspaceDefinitions[view].group === "secondary"),
    ["launch", "releases", "trust", "accessibility", "settings"]
  );
});

test("duplicate paths and incomplete copy fail registry validation", () => {
  const valid: WorkspaceDefinition = {
    path: "/one",
    label: "One",
    mobileLabel: "One",
    note: "One note",
    eyebrow: "One eyebrow",
    title: "One title",
    description: "One description",
    group: "primary",
    mobile: true,
  };
  const errors = validateWorkspaceRegistry({
    one: valid,
    two: { ...valid, label: "" },
  });
  assert.deepEqual(errors, [
    "two: duplicate path /one.",
    "two: label is empty.",
  ]);
});

test("demo-sensitive registry copy never presents synthetic counts or connections as live", () => {
  assert.match(workspaceDefinitions.overview.description, /synthetic/);
  assert.match(workspaceDefinitions.work.eyebrow, /Demo:/);
  assert.match(workspaceDefinitions.integrations.eyebrow, /Demo connection/);
  assert.match(workspaceDefinitions.evidence.eyebrow, /Demo:/);
});
