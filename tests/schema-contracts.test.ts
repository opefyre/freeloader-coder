import assert from "node:assert/strict";
import test from "node:test";
import {
  approvalSchema,
  artifactSchema,
  commandSchema,
  dependencySchema,
  eventSchema,
  externalEffectSchema,
  leaseSchema,
  migrateTaskV0,
  modelCallSchema,
  providerJournalDocumentSchema,
  recoverySchema,
  reviewSchema,
  safeErrorSchema,
  taskSchema,
  toSafeError,
  toolCallSchema,
  validationSchema
} from "../packages/schemas/src/index.js";
import { replay } from "../packages/storage/src/replay.js";

const at = "2026-07-27T12:00:00.000Z";
const created = eventSchema.parse({
  schemaVersion: 1,
  sequence: 1,
  eventId: "event-1",
  occurredAt: at,
  type: "task.created",
  payload: { schemaVersion: 1, id: "task-1", title: "Demo", status: "ready", revision: 0, extensions: {} }
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

test("provider journal schema rejects malformed digests, events, and unknown fields", () => {
  const document = {
    schemaVersion: 1,
    taskId: "task-1",
    workUnitId: "implementation",
    requestDigest: "a".repeat(64),
    events: [{
      sequence: 1,
      eventId: "task-1:provider:1",
      taskId: "task-1",
      occurredAt: 100,
      type: "provider.task_initialized",
      workUnitId: "implementation",
      requestDigest: "a".repeat(64)
    }]
  };
  assert.equal(providerJournalDocumentSchema.safeParse(document).success, true);
  assert.equal(providerJournalDocumentSchema.safeParse({
    ...document,
    requestDigest: "not-a-digest"
  }).success, false);
  assert.equal(providerJournalDocumentSchema.safeParse({
    ...document,
    events: [{ ...document.events[0], hidden: true }]
  }).success, false);
  assert.equal(providerJournalDocumentSchema.safeParse({
    ...document,
    hidden: true
  }).success, false);
});

test("all v1 entity boundaries accept valid fixtures and reject unknown fields", () => {
  const hash = "a".repeat(64);
  const fixtures: ReadonlyArray<readonly [string, { safeParse(value: unknown): { success: boolean } }, object]> = [
    ["dependency", dependencySchema, { schemaVersion: 1, taskId: "task-2", dependsOnTaskId: "task-1", requiredStatus: "done" }],
    ["lease", leaseSchema, { schemaVersion: 1, taskId: "task-1", leaseId: "lease-1", ownerId: "worker-1", acquiredAt: at, expiresAt: "2026-07-27T12:05:00.000Z" }],
    ["model", modelCallSchema, { schemaVersion: 1, id: "model-1", taskId: "task-1", status: "requested", idempotencyKey: "idem-1", provider: "fake", model: "offline", privacyClass: "public_test", verified: false }],
    ["tool", toolCallSchema, { schemaVersion: 1, id: "tool-1", taskId: "task-1", status: "requested", idempotencyKey: "idem-2", tool: "read-file", effect: "read", approvalId: null }],
    ["approval", approvalSchema, { schemaVersion: 1, id: "approval-1", taskId: "task-1", actionDigest: hash, status: "requested", decidedBy: null, expiresAt: null }],
    ["artifact", artifactSchema, { schemaVersion: 1, id: "artifact-1", taskId: "task-1", mediaType: "text/plain", digest: `sha256:${hash}`, sizeBytes: 4 }],
    ["validation", validationSchema, { schemaVersion: 1, id: "validation-1", taskId: "task-1", validator: "test", outcome: "passed", evidenceArtifactIds: ["artifact-1"] }],
    ["review", reviewSchema, { schemaVersion: 1, id: "review-1", taskId: "task-1", reviewer: "reviewer-1", outcome: "approved", findingCount: 0 }],
    ["recovery", recoverySchema, { schemaVersion: 1, id: "recovery-1", taskId: "task-1", cause: "interrupted", action: "retry", attempt: 1 }],
    ["effect", externalEffectSchema, { schemaVersion: 1, id: "effect-1", taskId: "task-1", connector: "fake", operation: "issue.update", idempotencyKey: "idem-3", reversibility: "reversible", postcondition: "observed" }],
    ["command", commandSchema, { schemaVersion: 1, commandId: "command-1", idempotencyKey: "idem-4", issuedAt: at, type: "task.create", payload: {} }]
  ];
  for (const [name, schema, fixture] of fixtures) {
    assert.equal(schema.safeParse(fixture).success, true, `${name} fixture should pass`);
    assert.equal(schema.safeParse({ ...fixture, unexpected: true }).success, false, `${name} must reject unknown fields`);
  }
});

test("legacy v0 task migrates deterministically to supported v1", () => {
  const migrated = migrateTaskV0({ id: "task-old", summary: "Legacy task", state: "active" });
  assert.equal(migrated.schemaVersion, 1);
  assert.equal(migrated.status, "working");
  assert.equal(migrated.extensions["studio.migration.source"], "task-v0");
});

test("v1 namespaced extensions support additive forward data without weakening strict fields", () => {
  const parsed = taskSchema.parse({
    ...created.payload,
    extensions: { "example.future.priority": { score: 9 } }
  });
  assert.deepEqual(parsed.extensions["example.future.priority"], { score: 9 });
  assert.equal(taskSchema.safeParse({ ...parsed, futureTopLevel: true }).success, false);
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

test("local diagnostics are redacted into the safe transport error", () => {
  const safe = toSafeError({
    diagnosticId: "diag-2",
    code: "INTERNAL",
    owner: "platform",
    safeMessage: "The operation could not be completed.",
    nextAction: "Retry once, then export diagnostics if it continues.",
    retryable: true,
    localDetail: "credential=should-stay-local",
    cause: new Error("private local path")
  });
  const serialized = JSON.stringify(safe);
  assert.equal(serialized.includes("credential"), false);
  assert.equal(serialized.includes("private local path"), false);
  assert.equal(safe.nextAction.length > 0, true);
});
