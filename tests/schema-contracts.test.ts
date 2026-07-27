import assert from "node:assert/strict";
import test from "node:test";
import { eventSchema, safeErrorSchema, taskSchema } from "../packages/schemas/src/index.js";
import { replay } from "../packages/storage/src/replay.js";

const at = "2026-07-27T12:00:00.000Z";
const created = eventSchema.parse({
  schemaVersion: 1,
  sequence: 1,
  eventId: "event-1",
  occurredAt: at,
  type: "task.created",
  payload: { schemaVersion: 1, id: "task-1", title: "Demo", status: "ready", revision: 0 }
});
const changed = eventSchema.parse({
  schemaVersion: 1,
  sequence: 2,
  eventId: "event-2",
  occurredAt: at,
  type: "task.status_changed",
  payload: { taskId: "task-1", status: "working", revision: 1 }
});

test("strict v1 schemas reject unknown fields and unsupported versions", () => {
  assert.equal(taskSchema.safeParse({ ...created.payload, secret: "no" }).success, false);
  assert.equal(taskSchema.safeParse({ ...created.payload, schemaVersion: 2 }).success, false);
});

test("replaying the same journal reconstructs identical authoritative state", () => {
  const first = replay([created, changed]);
  const second = replay([created, changed]);
  assert.deepEqual([...first.tasks], [...second.tasks]);
  assert.equal(first.lastSequence, 2);
  assert.equal(first.tasks.get("task-1")?.status, "working");
});

test("replay rejects gaps and stale revisions", () => {
  assert.throws(() => replay([{ ...created, sequence: 2 }]));
  const stale = eventSchema.parse({
    schemaVersion: 1,
    sequence: 2,
    eventId: "event-stale",
    occurredAt: at,
    type: "task.status_changed",
    payload: { taskId: "task-1", status: "working", revision: 3 }
  });
  assert.throws(() => replay([created, stale]));
});

test("safe errors require ownership, action, and contain no diagnostic detail", () => {
  const error = safeErrorSchema.parse({
    schemaVersion: 1,
    code: "PROVIDER_UNAVAILABLE",
    owner: "provider",
    safeMessage: "The selected provider is temporarily unavailable.",
    nextAction: "Retry later or choose an available provider.",
    retryable: true,
    diagnosticId: "diag-1"
  });
  assert.equal("details" in error, false);
  assert.equal(error.owner, "provider");
});
