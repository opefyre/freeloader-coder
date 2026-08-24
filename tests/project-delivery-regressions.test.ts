import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { isOwnerFacingUiDeliveryItem } from "../apps/core/src/project-delivery-authority.js";
import { ProjectDeliveryPlanCoordinator } from "../apps/core/src/project-delivery-plan-coordinator.js";

test("UI language in broad product context does not misclassify non-UI file authority", () => {
  assert.equal(isOwnerFacingUiDeliveryItem({ title: "Build decision behavior", allowedFiles: ["src/features/decisions.ts", "tests/behavior.test.ts"] }), false);
  assert.equal(isOwnerFacingUiDeliveryItem({ title: "Build owner experience", allowedFiles: ["src/ui/page.tsx", "index.html"] }), true);
});

test("post-plan execution validation exposes its concrete owner action", async () => {
  const root = await mkdtemp(join(tmpdir(), "delivery-plan-actionable-"));
  try {
    const error = Object.assign(new Error("plan_deadbeef lacks build and visual journey validation."), { code: "ui_acceptance_missing" });
    const coordinator = new ProjectDeliveryPlanCoordinator(root, { run: async () => ({} as never) } as never, () => 100, async () => { throw error; });
    await coordinator.schedule("project_abcdef0123456789");
    for (let attempt = 0; attempt < 50 && (await coordinator.get("project_abcdef0123456789"))?.state !== "needs_user"; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 2));
    assert.equal((await coordinator.get("project_abcdef0123456789"))?.safeMessage, error.message);
    await coordinator.shutdown();
  } finally { await rm(root, { recursive: true, force: true }); }
});
