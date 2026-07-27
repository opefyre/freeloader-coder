import assert from "node:assert/strict";
import test from "node:test";
import { decideRetry } from "../packages/orchestration/src/retry.js";
import { modelResultEnvelopeSchema } from "../packages/schemas/src/index.js";

test("model result contracts accept declared plan shape and reject invented fields", () => {
  const valid = {
    schemaVersion: 1,
    requestId: "request-1",
    kind: "plan",
    result: {
      summary: "Bounded plan",
      files: [{ path: "src/a.ts", reason: "Required change" }],
      steps: ["Edit", "Validate"],
      risks: []
    }
  };
  assert.equal(modelResultEnvelopeSchema.safeParse(valid).success, true);
  assert.equal(modelResultEnvelopeSchema.safeParse({
    ...valid,
    result: { ...valid.result, assumedComplete: true }
  }).success, false);
  assert.equal(modelResultEnvelopeSchema.safeParse({
    ...valid,
    result: { summary: "Missing required structure" }
  }).success, false);
});

test("transient retry uses bounded exponential delay and stops at budget", () => {
  const first = decideRetry({
    failureClass: "transient_provider",
    attempt: 1,
    maxAttempts: 3,
    now: 1_000,
    baseDelayMs: 100,
    deterministicJitter: 5
  });
  assert.deepEqual(first, {
    action: "retry",
    retryAt: 1_105,
    nextAttempt: 2,
    reason: "bounded transient retry"
  });
  const exhausted = decideRetry({
    failureClass: "validation",
    attempt: 3,
    maxAttempts: 3,
    now: 2_000,
    baseDelayMs: 100,
    deterministicJitter: 0
  });
  assert.equal(exhausted.action, "quarantine");
  assert.equal(exhausted.retryAt, null);
});

test("permission, policy, and uncertain outcomes never retry automatically", () => {
  for (const failureClass of ["permission", "policy", "outcome_unknown"] as const) {
    const decision = decideRetry({
      failureClass,
      attempt: 1,
      maxAttempts: 4,
      now: 1_000,
      baseDelayMs: 100,
      deterministicJitter: 0
    });
    assert.equal(decision.action, "needs_user");
    assert.equal(decision.retryAt, null);
  }
});
