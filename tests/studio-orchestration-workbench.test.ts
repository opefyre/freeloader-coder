import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  "apps/studio/src/components/orchestration/orchestration-workbench.tsx",
  "utf8",
);
const app = readFileSync("apps/studio/src/App.tsx", "utf8");

test("Work route replaces the orchestration preview with the live coordinator", () => {
  assert.match(app, /<AutonomousWorkCenter endpoint=\{controlPlaneEndpoint\} \/>/);
  assert.doesNotMatch(app, /<OrchestrationWorkbench \/>/);
  assert.match(source, /Intent becomes an explicit decision/);
  assert.match(source, /Dependency-aware task plan/);
  assert.match(source, /Canonical grounding/);
  assert.match(source, /Durable scheduler evidence/);
});

test("task plan exposes bounded edits and approval freezes them", () => {
  assert.match(source, /type: "edit"/);
  assert.match(source, /type: "reorder"/);
  assert.match(source, /type: "remove"/);
  assert.match(source, /type: "split"/);
  assert.match(source, /type: "merge"/);
  assert.match(source, /approveTaskPlan\(plan\)/);
  assert.match(source, /disabled=\{plan\.state === "approved"\}/);
});

test("grounding and scheduler claims expose inspectable evidence", () => {
  assert.match(source, /github\.com\/opefyre\/pipeline-studio\/blob\/main/);
  assert.match(source, /citation\.path/);
  assert.match(source, /citation\.lines/);
  assert.match(source, /classifyTaskActivity/);
  assert.match(source, /Replay effect/);
  assert.match(source, /Already recorded · skipped/);
});

test("workbench controls communicate outcomes and remain accessible", () => {
  assert.match(source, /aria-live="polite"/);
  assert.match(source, /htmlFor="readiness-assumption"/);
  assert.match(source, /aria-labelledby="orchestration-workbench-title"/);
  assert.match(source, /Cycle evidence/);
});
