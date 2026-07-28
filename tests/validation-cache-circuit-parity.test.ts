import assert from "node:assert/strict";
import test from "node:test";
import { ResultCache } from "../packages/providers/src/cache.js";
import {
  emptyCapacityUsage,
  recordCapacityUsage,
  recordCircuitFailure,
  recordCircuitSuccess
} from "../packages/providers/src/circuit.js";
import { runValidation } from "../packages/validation/src/runner.js";

const sourceDigest = "a".repeat(64);

test("validation selects deterministic tiers, fingerprints input, and redacts output", async () => {
  const validators = [
    { id: "types", tier: "full" as const, run: async () => ({ exitCode: 0, output: "types ok" }) },
    { id: "lint", tier: "fast" as const, run: async () => ({ exitCode: 1, output: "api_key=private-value" }) }
  ];
  const fast = await runValidation({
    tier: "fast",
    sourceDigest,
    validators,
    timeoutMs: 1_000,
    maxOutputBytes: 100
  });
  assert.deepEqual(fast.results.map((result) => result.id), ["lint"]);
  assert.equal(fast.passed, false);
  assert.equal(fast.results[0]?.outputExcerpt.includes("private-value"), false);

  const full = await runValidation({
    tier: "full",
    sourceDigest,
    validators,
    timeoutMs: 1_000,
    maxOutputBytes: 100
  });
  assert.deepEqual(full.results.map((result) => result.id), ["lint", "types"]);
  assert.notEqual(full.inputDigest, fast.inputDigest);
});

test("result cache is scoped, expiring, bounded, unverified, and rejects sensitive data", () => {
  let now = 100;
  const cache = new ResultCache<string>({ maxEntries: 1, ttlMs: 50, now: () => now });
  const keyA = cache.key({
    providerId: "provider-a",
    modelId: "model-a",
    kind: "plan",
    requestDigest: "request-a",
    scopeDigest: "scope-a"
  });
  const stored = cache.put(keyA, "source_code", "result-a");
  assert.equal(stored.verified, false);
  assert.equal(cache.get(keyA)?.value, "result-a");
  assert.throws(() => cache.put("secret", "credential", "never"));

  const keyB = cache.key({
    providerId: "provider-a",
    modelId: "model-a",
    kind: "plan",
    requestDigest: "request-b",
    scopeDigest: "scope-a"
  });
  cache.put(keyB, "public_test", "result-b");
  assert.equal(cache.get(keyA), null);
  now = 151;
  assert.equal(cache.get(keyB), null);
});

test("circuit opens only after transient threshold and success resets it", () => {
  const first = recordCircuitFailure({
    state: {
      consecutiveFailures: 0,
      openUntil: 0,
      lastFailureAt: null,
      lastFailureCode: null
    },
    now: 100,
    threshold: 2,
    cooldownMs: 50,
    transient: true
  });
  assert.equal(first.openUntil, 0);
  const second = recordCircuitFailure({
    state: first,
    now: 110,
    threshold: 2,
    cooldownMs: 50,
    transient: true
  });
  assert.equal(second.openUntil, 160);
  assert.deepEqual(recordCircuitSuccess(), {
    consecutiveFailures: 0,
    openUntil: 0,
    lastFailureAt: null,
    lastFailureCode: null
  });
});

test("capacity accounting records actual usage and resets on a UTC day boundary", () => {
  const used = recordCapacityUsage({
    state: emptyCapacityUsage(100),
    now: 200,
    inputTokens: 6,
    outputTokens: 2,
    freeUnits: 0.5
  });
  assert.equal(used.requestsToday, 1);
  assert.equal(used.inputTokensToday, 6);
  assert.equal(used.outputTokensToday, 2);
  assert.equal(used.freeUnitsToday, 0.5);
  const reset = recordCapacityUsage({
    state: used,
    now: 86_400_100,
    inputTokens: 2,
    outputTokens: 1
  });
  assert.equal(reset.requestsToday, 1);
  assert.equal(reset.inputTokensToday, 2);
  assert.equal(reset.outputTokensToday, 1);
});
