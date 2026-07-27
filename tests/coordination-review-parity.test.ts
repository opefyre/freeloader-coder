import assert from "node:assert/strict";
import test from "node:test";
import { aggregateReviewQuorum } from "../packages/orchestration/src/reviews.js";
import {
  beginEffect,
  claimLease,
  completeEffect,
  emptyCoordinationState,
  reconcileInterruptedEffects,
  releaseLease
} from "../packages/storage/src/coordination.js";

test("lease claim rejects overlap but permits a new owner after expiry", () => {
  const first = claimLease(emptyCoordinationState(), {
    taskId: "task-1",
    leaseId: "lease-1",
    ownerId: "worker-1",
    expiresAt: 200
  }, 100);
  assert.throws(() => claimLease(first, {
    taskId: "task-1",
    leaseId: "lease-2",
    ownerId: "worker-2",
    expiresAt: 250
  }, 150));
  const reclaimed = claimLease(first, {
    taskId: "task-1",
    leaseId: "lease-2",
    ownerId: "worker-2",
    expiresAt: 350
  }, 250);
  assert.equal(reclaimed.leases.get("task-1")?.ownerId, "worker-2");
  assert.equal(releaseLease(reclaimed, "task-1", "lease-2").leases.size, 0);
});

test("effects are idempotent and interrupted attempts become outcome unknown", () => {
  const begun = beginEffect(emptyCoordinationState(), {
    idempotencyKey: "effect-1",
    inputDigest: "input-a"
  });
  assert.equal(begun.execute, true);
  assert.equal(beginEffect(begun.state, {
    idempotencyKey: "effect-1",
    inputDigest: "input-a"
  }).execute, false);
  assert.throws(() => beginEffect(begun.state, {
    idempotencyKey: "effect-1",
    inputDigest: "input-b"
  }));
  const interrupted = reconcileInterruptedEffects(begun.state);
  assert.equal(interrupted.effects.get("effect-1")?.status, "outcome_unknown");
  const completed = completeEffect(begun.state, "effect-1", "output-a");
  assert.equal(completed.effects.get("effect-1")?.status, "completed");
});

test("review quorum preserves dissent but blocks severe or needs-user findings", () => {
  const dissent = aggregateReviewQuorum([
    { reviewerId: "a", verdict: "pass", findings: [] },
    { reviewerId: "b", verdict: "fail", findings: [{ severity: "minor", message: "Polish" }] }
  ]);
  assert.equal(dissent.verdict, "pass");
  assert.equal(dissent.dissent, true);

  const severe = aggregateReviewQuorum([
    { reviewerId: "a", verdict: "pass", findings: [] },
    { reviewerId: "b", verdict: "fail", findings: [{ severity: "major", message: "Broken flow" }] }
  ]);
  assert.equal(severe.verdict, "fail");

  const uncertain = aggregateReviewQuorum([
    { reviewerId: "a", verdict: "pass", findings: [] },
    { reviewerId: "b", verdict: "needs_user", findings: [] }
  ]);
  assert.equal(uncertain.verdict, "needs_user");
});
