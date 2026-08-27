import assert from "node:assert/strict";
import test from "node:test";

import { ownerPilotRunbook, ownerPilotRunbookSchema } from "../packages/runtime/src/owner-pilot-runbook.js";

test("real-session runbook remains bounded, privacy-safe, and zero-cost for every scenario", () => {
  for (const scenario of ["new_product", "existing_product", "major_feature"] as const) {
    const runbook = ownerPilotRunbookSchema.parse(ownerPilotRunbook(scenario));
    assert.equal(runbook.scenario, scenario);
    assert.deepEqual(runbook.steps.map((step) => step.id), ["open_project", "follow_action", "record_result"]);
    assert.match(runbook.privacyBoundary, /stored locally/i);
    assert.match(runbook.privacyBoundary, /project content are excluded/i);
    assert.equal(runbook.automaticSpendLimitUsd, 0);
  }
});
