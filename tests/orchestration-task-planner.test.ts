import assert from "node:assert/strict";
import test from "node:test";

import {
  approveTaskPlan,
  chooseTaskAssignments,
  createTaskPlan,
  editTaskPlan,
  type PlannedTask
} from "../packages/orchestration/src/task-planner.js";

function task(id: string, dependsOn: readonly string[] = []): PlannedTask {
  return {
    id,
    title: `Implement ${id}`,
    outcome: `${id} is observably complete.`,
    scope: [`${id} scope`],
    exclusions: ["No deployment"],
    acceptanceCriteria: [`${id} passes`],
    allowedFiles: [`packages/${id}/index.ts`],
    dependsOn,
    risk: "medium",
    providerCapabilities: ["typescript"],
    checks: ["npm test"],
    estimatedMinutes: 60
  };
}

test("task plans are deterministic, bounded, complete, and dependency ordered", () => {
  const first = createTaskPlan({ planId: "plan-1", tasks: [task("b", ["a"]), task("a")] });
  const second = createTaskPlan({ planId: "plan-1", tasks: [task("a"), task("b", ["a"])] });
  assert.deepEqual(first, second);
  assert.deepEqual(first.order, ["a", "b"]);
  assert.throws(() => createTaskPlan({
    planId: "bad",
    tasks: [task("a", ["b"]), task("b", ["a"])]
  }));
});

test("draft plans support edit, reorder, split, merge, and guarded removal", () => {
  const plan = createTaskPlan({
    planId: "plan-edit",
    tasks: [task("a"), task("b", ["a"]), task("c", ["a"])]
  });
  const edited = editTaskPlan(plan, {
    type: "edit",
    taskId: "c",
    patch: { estimatedMinutes: 90, title: "Review C" }
  });
  assert.equal(edited.tasks.find((item) => item.id === "c")?.estimatedMinutes, 90);
  const reordered = editTaskPlan(edited, { type: "reorder", order: ["a", "c", "b"] });
  assert.deepEqual(reordered.order, ["a", "c", "b"]);
  assert.throws(() => editTaskPlan(reordered, { type: "remove", taskId: "a" }));

  const split = editTaskPlan(reordered, {
    type: "split",
    taskId: "c",
    first: task("c-contract", ["a"]),
    second: task("c-ui", ["c-contract"])
  });
  assert.deepEqual(split.order, ["a", "c-contract", "c-ui", "b"]);
  const merged = editTaskPlan(split, {
    type: "merge",
    taskIds: ["c-contract", "c-ui"],
    merged: task("c-merged", ["a"])
  });
  assert.deepEqual(merged.order, ["a", "c-merged", "b"]);
  assert.equal(merged.tasks.some((item) => item.id === "c-merged"), true);
});

test("dependent work cannot be reordered early and approval freezes the plan", () => {
  const plan = createTaskPlan({ planId: "plan-freeze", tasks: [task("a"), task("b", ["a"])] });
  assert.throws(() => editTaskPlan(plan, { type: "reorder", order: ["b", "a"] }));
  const approved = approveTaskPlan(plan);
  assert.equal(approved.state, "approved");
  assert.throws(() => editTaskPlan(approved, {
    type: "edit",
    taskId: "a",
    patch: { title: "Late mutation" }
  }));
});

test("provider assignment becomes specialist-led for high-risk or multi-capability work", () => {
  const general = task("general");
  const specialist = {
    ...task("security"),
    risk: "high" as const,
    providerCapabilities: ["security", "typescript"]
  };
  assert.deepEqual(
    chooseTaskAssignments([general, specialist]).map((entry) => entry.strategy),
    ["single_model", "specialist"]
  );
});
