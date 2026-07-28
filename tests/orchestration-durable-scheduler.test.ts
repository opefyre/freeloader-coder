import assert from "node:assert/strict";
import test from "node:test";

import {
  claimScheduledTask,
  classifyTaskActivity,
  eligibleTasks,
  renewTaskLease,
  transitionScheduledTask,
  type ScheduledTask
} from "../packages/orchestration/src/durable-scheduler.js";
import {
  beginEffect,
  emptyCoordinationState
} from "../packages/storage/src/coordination.js";

const tasks: readonly ScheduledTask[] = [
  { id: "a", dependsOn: [], priority: 2, enqueuedAt: 1, status: "completed", revision: 2 },
  { id: "b", dependsOn: ["a"], priority: 2, enqueuedAt: 3, status: "queued", revision: 1 },
  { id: "c", dependsOn: [], priority: 1, enqueuedAt: 4, status: "queued", revision: 1 },
  { id: "d", dependsOn: ["b"], priority: 0, enqueuedAt: 2, status: "queued", revision: 1 }
];

test("dependency eligibility and fairness choose one claimable task", () => {
  const state = emptyCoordinationState();
  assert.deepEqual(eligibleTasks(tasks, state, 100).map((task) => task.id), ["c", "b"]);
  const claimed = claimScheduledTask({
    tasks,
    coordination: state,
    workerId: "worker-1",
    now: 100,
    leaseMs: 50
  });
  assert.equal(claimed.task?.id, "c");
  assert.equal(claimed.lease?.ownerId, "worker-1");
  const secondClaim = claimScheduledTask({
    tasks: [tasks[2]!],
    coordination: claimed.coordination,
    workerId: "worker-2",
    now: 120,
    leaseMs: 50
  });
  assert.equal(secondClaim.task, null);
  assert.equal(secondClaim.lease, null);
});

test("only the live owner can heartbeat and transition an exact revision", () => {
  const claimed = claimScheduledTask({
    tasks,
    coordination: emptyCoordinationState(),
    workerId: "worker-1",
    now: 100,
    leaseMs: 50
  });
  const renewed = renewTaskLease({
    coordination: claimed.coordination,
    taskId: "c",
    leaseId: claimed.lease!.leaseId,
    ownerId: "worker-1",
    now: 120,
    leaseMs: 80
  });
  assert.equal(renewed.leases.get("c")?.expiresAt, 200);
  const running = transitionScheduledTask({
    task: claimed.task!,
    coordination: renewed,
    leaseId: claimed.lease!.leaseId,
    ownerId: "worker-1",
    now: 130,
    expectedRevision: 1,
    nextStatus: "running"
  });
  assert.equal(running.revision, 2);
  assert.throws(() => transitionScheduledTask({
    task: running,
    coordination: renewed,
    leaseId: claimed.lease!.leaseId,
    ownerId: "worker-2",
    now: 140,
    expectedRevision: 2,
    nextStatus: "completed"
  }));
});

test("slow versus stalled uses real stage activity and configurable evidence", () => {
  const evidence = {
    heartbeatAt: 900,
    modelActivityAt: 850,
    validationActivityAt: null,
    toolActivityAt: 800,
    modelRequestActive: true,
    validationActive: false,
    expectedStageDurationMs: 200
  };
  assert.equal(classifyTaskActivity({
    evidence,
    now: 1_000,
    minimumGraceMs: 150,
    maximumSilentMs: 600,
    expectedDurationMultiplier: 1
  }), "active");
  assert.equal(classifyTaskActivity({
    evidence,
    now: 1_300,
    minimumGraceMs: 150,
    maximumSilentMs: 600,
    expectedDurationMultiplier: 1
  }), "slow");
  assert.equal(classifyTaskActivity({
    evidence,
    now: 1_600,
    minimumGraceMs: 150,
    maximumSilentMs: 600,
    expectedDurationMultiplier: 1
  }), "stalled");
});

test("replay cannot duplicate an external effect", () => {
  const first = beginEffect(emptyCoordinationState(), {
    idempotencyKey: "task-b.publish.1",
    inputDigest: "sha256:input"
  });
  assert.equal(first.execute, true);
  assert.equal(beginEffect(first.state, {
    idempotencyKey: "task-b.publish.1",
    inputDigest: "sha256:input"
  }).execute, false);
});
