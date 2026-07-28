import assert from "node:assert/strict";
import test from "node:test";

import {
  acquireControllerLease,
  buildRepairPlan,
  checkpointServicesBeforeInterruption,
  reconcileInterruptedEffects,
  runtimeStateDigest,
  type InterruptedEffect,
  type RuntimeService,
} from "../packages/runtime/src/index.js";

const ownerA = "f17a7d91-2619-4510-9d3c-0d7459876f86";
const ownerB = "58d262f6-644d-460d-92b8-b45cd4343690";

test("only one authoritative controller can own a live profile", () => {
  const first = acquireControllerLease({
    current: null,
    profileId: "main",
    ownerId: ownerA,
    pid: 101,
    port: 4310,
    now: 1_000,
  });
  assert.throws(
    () =>
      acquireControllerLease({
        current: first,
        profileId: "main",
        ownerId: ownerB,
        pid: 202,
        port: 4311,
        now: 1_001,
      }),
    /authoritative controller/
  );
  const renewed = acquireControllerLease({
    current: first,
    profileId: "main",
    ownerId: ownerA,
    pid: 101,
    port: 4310,
    now: 2_000,
  });
  assert.equal(renewed.ownerId, ownerA);
  assert.equal(renewed.acquiredAt, first.acquiredAt);
});

test("an expired controller can be replaced without duplicate authority", () => {
  const expired = acquireControllerLease({
    current: null,
    profileId: "main",
    ownerId: ownerA,
    pid: 101,
    port: 4310,
    now: 1_000,
    durationMs: 5_000,
  });
  const replacement = acquireControllerLease({
    current: expired,
    profileId: "main",
    ownerId: ownerB,
    pid: 202,
    port: 4311,
    now: 7_000,
  });
  assert.equal(replacement.ownerId, ownerB);
  assert.equal(replacement.port, 4311);
});

test("sleep and shutdown checkpoint every active service", () => {
  const services: RuntimeService[] = [
    { id: "core", state: "healthy", required: true, restartCount: 0, lastCheckpointId: null },
    { id: "worker", state: "healthy", required: true, restartCount: 1, lastCheckpointId: null },
    { id: "local_model", state: "stopped", required: false, restartCount: 0, lastCheckpointId: null },
  ];
  const drained = checkpointServicesBeforeInterruption(services, "checkpoint-17");
  assert.equal(drained[0]?.state, "draining");
  assert.equal(drained[1]?.lastCheckpointId, "checkpoint-17");
  assert.equal(drained[2]?.state, "stopped");
});

test("restart reconciliation never duplicates attempted effects", () => {
  const effects: InterruptedEffect[] = [
    {
      effectId: "write-1",
      idempotencyKey: "work:write-1",
      state: "not_started",
      checkpointId: "cp-1",
    },
    {
      effectId: "publish-2",
      idempotencyKey: "work:publish-2",
      state: "attempted",
      checkpointId: "cp-1",
    },
    {
      effectId: "commit-3",
      idempotencyKey: "work:commit-3",
      state: "postcondition_verified",
      checkpointId: "cp-1",
    },
  ];
  assert.deepEqual(
    reconcileInterruptedEffects(effects).map((effect) => [
      effect.outcome,
      effect.mayExecute,
    ]),
    [
      ["resume", true],
      ["outcome_unknown", false],
      ["complete", false],
    ]
  );
});

test("one-click repair preserves projects and secrets and flags unsafe uncertainty", () => {
  const safe = buildRepairPlan({
    staleController: true,
    portConflict: true,
    projectionNeedsRebuild: true,
    interruptedEffects: [],
  });
  assert.equal(safe.state, "safe_to_apply");
  assert.equal(
    safe.actions.every(
      (action) => action.preservesProjects && action.preservesSecrets
    ),
    true
  );
  const unsafe = buildRepairPlan({
    staleController: false,
    portConflict: false,
    projectionNeedsRebuild: false,
    interruptedEffects: [
      {
        effectId: "external-1",
        idempotencyKey: "external:1",
        state: "attempted",
        checkpointId: "cp-1",
      },
    ],
  });
  assert.equal(unsafe.state, "needs_user");
  assert.match(unsafe.blocker ?? "", /attempted without a verified outcome/);
});

test("runtime state digest changes when lifecycle evidence changes", () => {
  const initial = runtimeStateDigest({ lease: null, services: [], effects: [] });
  const changed = runtimeStateDigest({
    lease: null,
    services: [
      {
        id: "core",
        state: "healthy",
        required: true,
        restartCount: 0,
        lastCheckpointId: "cp-1",
      },
    ],
    effects: [],
  });
  assert.notEqual(initial, changed);
});

