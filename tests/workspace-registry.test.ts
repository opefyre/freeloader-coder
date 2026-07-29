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
  assert.equal(studioViews.length, 15);
  assert.equal(
    studioViews.filter((view) => workspaceDefinitions[view].group === "primary").length,
    10
  );
  assert.equal(
    studioViews.filter((view) => workspaceDefinitions[view].mobile).length,
    10
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

test("registry copy distinguishes live-backed surfaces from demo-sensitive surfaces", () => {
  assert.match(workspaceDefinitions.overview.description, /Live projects/);
  assert.doesNotMatch(workspaceDefinitions.overview.description, /synthetic/);
  assert.match(workspaceDefinitions.work.eyebrow, /Live local coordination/);
  assert.doesNotMatch(workspaceDefinitions.work.eyebrow, /Demo:/);
  assert.match(workspaceDefinitions.activity.eyebrow, /Live local history/);
  assert.doesNotMatch(workspaceDefinitions.activity.eyebrow, /Demo:/);
  assert.match(workspaceDefinitions.decisions.eyebrow, /Live local queue/);
  assert.doesNotMatch(workspaceDefinitions.decisions.eyebrow, /Demo:/);
  assert.match(workspaceDefinitions.integrations.eyebrow, /Demo connection/);
  assert.match(workspaceDefinitions.evidence.eyebrow, /Demo:/);
});
