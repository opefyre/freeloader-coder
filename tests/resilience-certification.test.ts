import assert from "node:assert/strict";
import test from "node:test";

import { RESILIENCE_SCENARIOS, certifyResilience, type ResilienceObservation } from "../packages/orchestration/src/resilience-certification.js";

test("certification requires every named recovery path with safe restart and zero duplicate effects", () => {
  const certification = certifyResilience(RESILIENCE_SCENARIOS.map(observation));
  assert.equal(certification.certified, true);
  assert.equal(certification.scenarioCount, 11);
  assert.equal(certification.evidenceRefs.length, 11);
  assert.deepEqual(certification.failures, []);
});

test("certification fails closed on missing, unsafe, vague, unresumed, and duplicate evidence", () => {
  const observations = RESILIENCE_SCENARIOS.slice(1).map(observation);
  observations[0] = {
    ...observations[0]!,
    evidenceRef: "fixture",
    safeStatePreserved: false,
    blocker: "bad",
    smallestOwnerAction: "",
    restartObserved: false,
    resumed: false,
    duplicateEffects: 1,
  };
  observations.push(observations[0]!);
  const certification = certifyResilience(observations);
  assert.equal(certification.certified, false);
  assert.match(certification.failures.join("\n"), /process_crash: missing fault-injection evidence/);
  assert.match(certification.failures.join("\n"), /stale_lease: duplicate observation/);
  assert.match(certification.failures.join("\n"), /stale_lease: safe state was not preserved/);
  assert.match(certification.failures.join("\n"), /stale_lease: 1 duplicate effect/);
});

function observation(scenario: (typeof RESILIENCE_SCENARIOS)[number]): ResilienceObservation {
  return {
    scenario,
    evidenceRef: `test:resilience/${scenario}`,
    safeStatePreserved: true,
    blocker: `Observed and classified ${scenario.replaceAll("_", " ")}.`,
    smallestOwnerAction: "Retry after the named condition is resolved.",
    restartObserved: true,
    resumed: true,
    duplicateEffects: 0,
  };
}
