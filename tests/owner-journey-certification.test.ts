import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { OWNER_JOURNEY_STAGES, certifyOwnerJourney, validateOwnerJourneyCertification } from "../apps/core/src/owner-journey-certification.js";

const digest = "a".repeat(64);

test("owner journey certification is complete, ordered, private, and zero-cost", async () => {
  let now = 1_800_000_000_000;
  const receipt = await certifyOwnerJourney({ now: () => now += 25, run: async () => ({ exitCode: 0, passed: 3, failed: 0, digest }) });
  assert.deepEqual(receipt.stages.map((stage) => stage.name), [...OWNER_JOURNEY_STAGES]);
  assert.equal(receipt.suites.length, 3);
  assert.equal(receipt.paidCalls, 0);
  assert.equal(receipt.externalEffects, 0);
  assert.equal(Object.values(receipt.privacy).some(Boolean), false);
  assert.match(receipt.nextAction, /external-owner journey/i);
});

test("owner journey certification fails nonzero and rejects incomplete or private receipts", async () => {
  await assert.rejects(certifyOwnerJourney({ run: async () => ({ exitCode: 1, passed: 2, failed: 1, digest }) }), /failed/);
  const valid = await certifyOwnerJourney({ run: async () => ({ exitCode: 0, passed: 3, failed: 0, digest }) });
  assert.throws(() => validateOwnerJourneyCertification({ ...valid, stages: valid.stages.slice(1) }), /Every owner-journey stage/);
  assert.throws(() => validateOwnerJourneyCertification({ ...valid, nextAction: "Read /Users/private/project" }), /private material/);
  assert.throws(() => validateOwnerJourneyCertification({ ...valid, paidCalls: 1 as 0 }), /zero-cost/);
});

test("committed owner journey receipt remains schema-valid and honestly synthetic", async () => {
  const receipt = JSON.parse(await readFile("docs/evidence/PIPE-622-OWNER-JOURNEY-CERTIFICATION.json", "utf8"));
  const validated = validateOwnerJourneyCertification(receipt);
  assert.equal(validated.mode, "synthetic_zero_cost");
  assert.match(validated.limitations.join(" "), /not evidence of external adoption/i);
  assert.equal(validated.nextAction.includes("external-owner journey"), true);
});
