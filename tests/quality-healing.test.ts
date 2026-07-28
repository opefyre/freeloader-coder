import assert from "node:assert/strict";
import test from "node:test";

import { acceptHealing, planHealing, type HealingPolicy } from "../packages/orchestration/src/healing.js";

const policy: HealingPolicy = {
  maxAttempts: 2,
  allowedFiles: ["apps/studio/src/App.tsx"],
  protectedPaths: [".env", "secrets"],
  requiredChecks: ["typecheck", "test"],
  requiredReviewRoles: ["functional", "design"],
  minimumGoldenScore: 0.95,
};

test("bounded repair requires complete revalidation and review", () => {
  const repair = planHealing({
    failureClass: "implementation", attempt: 1,
    changedFiles: ["apps/studio/src/App.tsx"], policy,
    goldenScore: 0.98, previousGoldenScore: 0.98,
  });
  assert.equal(repair.status, "repairable");
  assert.throws(() => acceptHealing({ state: repair, checksRun: ["test"], reviewRolesRun: ["functional", "design"], policy }));
  assert.equal(acceptHealing({
    state: repair, checksRun: ["typecheck", "test"],
    reviewRolesRun: ["functional", "design"], policy,
  }).status, "recovered");
});

test("scope violations, exhausted budgets, and unsafe failures quarantine", () => {
  assert.equal(planHealing({
    failureClass: "implementation", attempt: 0, changedFiles: ["secrets/key"],
    policy, goldenScore: 1, previousGoldenScore: 1,
  }).status, "quarantined");
  assert.equal(planHealing({
    failureClass: "flaky", attempt: 2, changedFiles: ["apps/studio/src/App.tsx"],
    policy, goldenScore: 1, previousGoldenScore: 1,
  }).status, "quarantined");
});

test("product decisions need the user and golden regressions cannot release", () => {
  assert.equal(planHealing({
    failureClass: "product_decision", attempt: 0, changedFiles: ["apps/studio/src/App.tsx"],
    policy, goldenScore: 1, previousGoldenScore: 1,
  }).status, "needs_user");
  assert.equal(planHealing({
    failureClass: "provider", attempt: 0, changedFiles: ["apps/studio/src/App.tsx"],
    policy, goldenScore: 0.9, previousGoldenScore: 0.98,
  }).evidenceRefs[0], "golden-regression");
});
