import assert from "node:assert/strict";
import test from "node:test";

import {
  computeProfiles,
  evaluateResourcePolicy,
  recommendComputeProfile
} from "../packages/execution/src/index.js";

function snapshot(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    memoryMb: 8_192,
    availableMemoryMb: 4_096,
    freeDiskMb: 20_480,
    batteryPercent: 80,
    charging: true,
    thermal: "nominal",
    sleeping: false,
    concurrentWorkloads: 0,
    localModels: ["qwen3"],
    runtimes: ["node-22"],
    ...overrides
  };
}

test("8 GB machines select a bounded lightweight path", () => {
  const profile = recommendComputeProfile(snapshot());
  assert.equal(profile.id, "lightweight");
  assert.equal(profile.maxConcurrency, 1);
  assert.ok(profile.workerMemoryMb <= 1_536);
  assert.equal(profile.localModelsAllowed, false);
});

test("resource limits and healthy pressure are expressed in plain language", () => {
  const result = evaluateResourcePolicy({
    snapshot: snapshot(),
    profile: computeProfiles[0],
    activeState: { task: "PIPE-63", stage: "validation" }
  });
  assert.equal(result.decision, "run");
  assert.match(result.plainLanguage, /within the selected safe limits/);
  assert.ok(result.limits.some((limit) => /worker memory/.test(limit)));
  assert.ok(result.limits.some((limit) => /CPU ceiling/.test(limit)));
});

test("memory and workload pressure reduce concurrency", () => {
  const result = evaluateResourcePolicy({
    snapshot: snapshot({ availableMemoryMb: 2_000, concurrentWorkloads: 1 }),
    profile: computeProfiles[1],
    activeState: { task: "PIPE-63" }
  });
  assert.equal(result.decision, "reduce");
  assert.equal(result.concurrency, 1);
  assert.match(result.plainLanguage, /computer is busy/);
});

test("low disk, battery, thermal limits, and sleep pause with resumable state", () => {
  for (const pressure of [
    { freeDiskMb: 1_000 },
    { batteryPercent: 10, charging: false },
    { thermal: "serious" },
    { sleeping: true }
  ]) {
    const state = { task: "PIPE-63", stage: "implementation", files: ["src/App.tsx"] };
    const result = evaluateResourcePolicy({
      snapshot: snapshot(pressure),
      profile: computeProfiles[0],
      activeState: state
    });
    assert.equal(result.decision, "pause");
    assert.equal(result.concurrency, 0);
    assert.match(result.resumeToken ?? "", /^resume:/);
    assert.match(result.stateDigest, /^[a-f0-9]{64}$/);
    assert.match(result.plainLanguage, /can resume safely/);
  }
});
