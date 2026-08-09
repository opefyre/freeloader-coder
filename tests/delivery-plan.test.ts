import assert from "node:assert/strict";
import test from "node:test";

import { deliveryPlanContentSchema } from "../packages/orchestration/src/delivery-plan.js";
import { completeDeliveryPlan } from "./delivery-plan-fixture.js";

test("self-contained delivery hierarchy enforces every executable layer", () => {
  const plan = deliveryPlanContentSchema.parse(completeDeliveryPlan());
  assert.equal(plan.items.length, 4);
  assert.equal(plan.items.at(-1)?.estimatedMinutes, 90);
});

test("delivery hierarchy rejects oversized subtasks, broken parents, duplicate IDs, and cycles", () => {
  const base = completeDeliveryPlan();
  assert.throws(() => deliveryPlanContentSchema.parse({ ...base, items: base.items.map((item) => item.type === "subtask" ? { ...item, estimatedMinutes: 180 } : item) }), /one to two hours/);
  assert.throws(() => deliveryPlanContentSchema.parse({ ...base, items: base.items.map((item) => item.type === "task" ? { ...item, parentId: base.items[0]!.id } : item) }), /requires a story parent/);
  assert.throws(() => deliveryPlanContentSchema.parse({ ...base, items: [...base.items, { ...base.items[3]! }] }), /unique/);
  assert.throws(() => deliveryPlanContentSchema.parse({ ...base, items: base.items.map((item, index) => index === 0 ? { ...item, dependencies: [base.items[1]!.id] } : index === 1 ? { ...item, dependencies: [base.items[0]!.id] } : item) }), /acyclic/);
});
