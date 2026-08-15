import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { ResilienceCertificationService, type DurableResilienceObservation } from "../apps/core/src/resilience-certification-service.js";
import { RESILIENCE_SCENARIOS } from "../packages/orchestration/src/resilience-certification.js";

const projectId = "project_abcdef0123456789";

test("durable recovery evidence replays exactly, survives restart, and certifies only a complete matrix", async () => {
  const root = await mkdtemp(join(tmpdir(), "codkesh-resilience-certification-"));
  try {
    const service = new ResilienceCertificationService(root);
    const first = observation("process_crash", 0);
    assert.deepEqual(await service.record(first), first);
    assert.deepEqual(await service.record(first), first);
    await assert.rejects(() => service.record({ ...first, blocker: "Changed evidence must fail." }), /changed/);
    assert.equal((await service.certify(projectId)).certified, false);

    for (const [index, scenario] of RESILIENCE_SCENARIOS.entries()) {
      if (scenario !== "process_crash") await service.record(observation(scenario, index));
    }
    const restarted = new ResilienceCertificationService(root);
    const certification = await restarted.certify(projectId);
    assert.equal(certification.certified, true);
    assert.equal((await restarted.list(projectId)).length, 11);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("conflicting scenarios and corrupt durable state fail closed", async () => {
  const root = await mkdtemp(join(tmpdir(), "codkesh-resilience-corrupt-"));
  try {
    const service = new ResilienceCertificationService(root);
    await service.record(observation("process_crash", 0));
    await assert.rejects(() => service.record({ ...observation("process_crash", 1), requestId: "request_ffffffffffffffffffff" }), /already has evidence/);
    await writeFile(join(root, "resilience-certification.json"), "{}\n", "utf8");
    await assert.rejects(() => new ResilienceCertificationService(root).list(projectId), /unreadable/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

function observation(scenario: (typeof RESILIENCE_SCENARIOS)[number], index: number): DurableResilienceObservation {
  return {
    schemaVersion: 1,
    projectId,
    requestId: `request_${index.toString(16).padStart(20, "0")}`,
    scenario,
    evidenceRef: `event:resilience/${scenario}`,
    beforeDigest: "a".repeat(64),
    afterDigest: String((index % 9) + 1).repeat(64),
    recoveryReceipt: `receipt:resilience/${scenario}`,
    safeStatePreserved: true,
    blocker: `Observed ${scenario.replaceAll("_", " ")} in the named service path.`,
    smallestOwnerAction: "Resolve the named condition and resume.",
    restartObserved: true,
    resumed: true,
    duplicateEffects: 0,
    observedAt: 1_800_000_000_000 + index,
  };
}
