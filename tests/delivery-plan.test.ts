import assert from "node:assert/strict";
import test from "node:test";

import { deliveryPlanContentSchema } from "../packages/orchestration/src/delivery-plan.js";
import { completeDeliveryPlan } from "./delivery-plan-fixture.js";

test("self-contained delivery hierarchy enforces every executable layer", () => {
  const plan = deliveryPlanContentSchema.parse(completeDeliveryPlan());
  assert.equal(plan.items.length, 4);
  assert.equal(plan.coverage.length, 10);
  assert.deepEqual(new Set(plan.coverage.map((entry) => entry.requirement)), new Set(["behavior", "architecture", "user_experience", "data", "integrations", "security", "privacy", "reliability", "rollout", "metrics"]));
  assert.equal(plan.gates[0]?.kind, "owner_approval");
  assert.equal(plan.items.at(-1)?.estimatedMinutes, 90);
  assert.deepEqual(plan.items.at(-1)?.allowedFiles, ["src/workflow.ts", "tests/workflow.test.ts"]);
});

test("delivery hierarchy rejects missing coverage, non-executable mappings, orphan work, and invalid gates", () => {
  const base = completeDeliveryPlan();
  assert.throws(() => deliveryPlanContentSchema.parse({ ...base, coverage: base.coverage.slice(1) }), /10 elements|missing approved solution requirement/);
  assert.throws(() => deliveryPlanContentSchema.parse({ ...base, coverage: base.coverage.map((entry, index) => index === 0 ? { ...entry, itemIds: [base.items[0]!.id] } : entry) }), /executable subtask/);
  assert.throws(() => deliveryPlanContentSchema.parse({ ...base, items: base.items.filter((item) => item.type !== "subtask") }), /orphaned|at least one subtask/);
  assert.throws(() => deliveryPlanContentSchema.parse({ ...base, gates: [{ ...base.gates[0]!, beforeItemIds: ["plan_ffffffffffffffff"] }] }), /only work in this plan/);
});

test("delivery hierarchy rejects oversized subtasks, broken parents, duplicate IDs, and cycles", () => {
  const base = completeDeliveryPlan();
  assert.throws(() => deliveryPlanContentSchema.parse({ ...base, items: base.items.map((item) => item.type === "subtask" ? { ...item, estimatedMinutes: 180 } : item) }), /one to two hours/);
  assert.throws(() => deliveryPlanContentSchema.parse({ ...base, items: base.items.map((item) => item.type === "task" ? { ...item, parentId: base.items[0]!.id } : item) }), /requires a story parent/);
  assert.throws(() => deliveryPlanContentSchema.parse({ ...base, items: [...base.items, { ...base.items[3]! }] }), /unique/);
  assert.throws(() => deliveryPlanContentSchema.parse({ ...base, items: base.items.map((item, index) => index === 0 ? { ...item, dependencies: [base.items[1]!.id] } : index === 1 ? { ...item, dependencies: [base.items[0]!.id] } : item) }), /acyclic/);
  assert.throws(() => deliveryPlanContentSchema.parse({ ...base, items: base.items.map((item) => item.type === "subtask" ? { ...item, allowedFiles: ["../secrets.txt"] } : item) }), /project-relative/);
});
