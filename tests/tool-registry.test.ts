import assert from "node:assert/strict";
import test from "node:test";

import {
  ToolInvocationLedger,
  ToolRegistry,
  validateToolResult,
  type ToolDefinition,
  type ToolGrant
} from "../packages/tools/src/index.js";

function tool(overrides: Partial<ToolDefinition> = {}): ToolDefinition {
  return {
    schemaVersion: 1,
    id: "studio.patch",
    version: "1.0.0",
    title: "Scoped patch",
    description: "Apply one validated project patch.",
    origin: "official",
    publisher: "Pipeline Studio",
    sourceUrl: "https://example.com/studio-patch",
    signature: `sha256:${"a".repeat(64)}`,
    inputSchema: { type: "object", required: ["patch"] },
    outputSchema: { type: "object", required: ["receipt"] },
    capabilities: ["project.write"],
    effects: ["read_project", "write_project", "create_checkpoint"],
    reversible: true,
    idempotent: true,
    timeoutMs: 30_000,
    retryLimit: 1,
    compensation: "Restore the pre-effect checkpoint.",
    postcondition: "Workspace digest and changed paths are observed.",
    evidence: "Record a redacted tool receipt.",
    redaction: "Remove credentials, personal paths, and source excerpts.",
    compatibility: { core: "^1.0.0", platforms: ["darwin-arm64", "linux-x64"] },
    ...overrides
  };
}

function grant(definition: ToolDefinition): ToolGrant {
  return {
    projectId: "project-1",
    toolId: definition.id,
    version: definition.version,
    capabilities: [...definition.capabilities],
    effects: [...definition.effects],
    approvedAt: 100,
    expiresAt: 10_000,
    revokedAt: null
  };
}

test("typed registry rejects unsigned, duplicate, and regressing tool contracts", () => {
  const registry = new ToolRegistry();
  const definition = registry.register(tool());
  assert.equal(definition.id, "studio.patch");
  assert.throws(() => registry.register(tool()), /move forward/);
  assert.throws(() => registry.register(tool({ version: "0.9.0" })), /move forward/);
  assert.throws(
    () => registry.register(tool({ id: "community.patch", origin: "unverified", signature: null })),
    /signature/
  );
});

test("planning enforces exact project, version, schema, capabilities, and effects", () => {
  const registry = new ToolRegistry();
  const definition = registry.register(tool());
  const approved = grant(definition);
  const plan = registry.plan({
    invocationId: "invocation-1",
    projectId: "project-1",
    toolId: definition.id,
    version: definition.version,
    payload: { patch: "synthetic" },
    requestedEffects: ["write_project", "create_checkpoint"],
    grant: approved,
    idempotencyKey: "task-1.patch-1",
    now: 1_000
  });
  assert.equal(plan.deadlineAt, 31_000);
  assert.throws(
    () => registry.plan({
      invocationId: "invocation-2",
      projectId: "project-1",
      toolId: definition.id,
      version: definition.version,
      payload: {},
      requestedEffects: ["write_project"],
      grant: approved,
      idempotencyKey: "task-1.patch-2",
      now: 1_000
    }),
    /input/
  );
  assert.throws(
    () => registry.plan({
      invocationId: "invocation-3",
      projectId: "project-1",
      toolId: definition.id,
      version: definition.version,
      payload: { patch: "synthetic" },
      requestedEffects: ["write_network"],
      grant: approved,
      idempotencyKey: "task-1.patch-3",
      now: 1_000
    }),
    /undeclared/
  );
});

test("results require declared effects, output contract, and observed postcondition", () => {
  const registry = new ToolRegistry();
  const definition = registry.register(tool());
  const plan = registry.plan({
    invocationId: "invocation-1",
    projectId: "project-1",
    toolId: definition.id,
    version: definition.version,
    payload: { patch: "synthetic" },
    requestedEffects: ["write_project"],
    grant: grant(definition),
    idempotencyKey: "task-1.patch",
    now: 1_000
  });
  assert.equal(validateToolResult({
    plan,
    output: { receipt: "observed" },
    observedEffects: ["write_project"],
    postconditionObserved: true
  }).verified, true);
  assert.throws(
    () => validateToolResult({
      plan,
      output: { receipt: "claimed" },
      observedEffects: ["write_project"],
      postconditionObserved: false
    }),
    /postcondition/
  );
});

test("invocation ledger makes replay safe and rejects duplicate effects", () => {
  const registry = new ToolRegistry();
  const definition = registry.register(tool());
  const plan = registry.plan({
    invocationId: "invocation-ledger",
    projectId: "project-1",
    toolId: definition.id,
    version: definition.version,
    payload: { patch: "synthetic" },
    requestedEffects: ["write_project"],
    grant: grant(definition),
    idempotencyKey: "task-ledger.patch",
    now: 1_000
  });
  const ledger = new ToolInvocationLedger();
  assert.equal(ledger.begin(plan, 1_000).replayed, false);
  assert.equal(ledger.begin(plan, 1_001).replayed, true);
  ledger.start(plan.idempotencyKey, 1_002);
  ledger.recordEffect({
    idempotencyKey: plan.idempotencyKey,
    effectId: "effect-1",
    effect: "write_project",
    now: 1_003
  });
  assert.throws(
    () => ledger.recordEffect({
      idempotencyKey: plan.idempotencyKey,
      effectId: "effect-1",
      effect: "write_project",
      now: 1_004
    }),
    /Duplicate effect/
  );
});

test("cancellation and timeout preserve compensation requirements", () => {
  const registry = new ToolRegistry();
  const definition = registry.register(tool({ timeoutMs: 1_000 }));
  const buildPlan = (key: string) => registry.plan({
    invocationId: key,
    projectId: "project-1",
    toolId: definition.id,
    version: definition.version,
    payload: { patch: "synthetic" },
    requestedEffects: ["write_project"],
    grant: grant(definition),
    idempotencyKey: key,
    now: 1_000
  });
  const ledger = new ToolInvocationLedger();
  const cancelled = buildPlan("task-cancel.patch");
  ledger.begin(cancelled, 1_000);
  ledger.start(cancelled.idempotencyKey, 1_100);
  ledger.recordEffect({
    idempotencyKey: cancelled.idempotencyKey,
    effectId: "effect-cancel",
    effect: "write_project",
    now: 1_200
  });
  assert.equal(ledger.cancel(cancelled.idempotencyKey, 1_300).state, "cancelled");
  assert.equal(ledger.compensate({
    idempotencyKey: cancelled.idempotencyKey,
    evidence: "Checkpoint digest restored.",
    now: 1_400
  }).state, "compensated");

  const timedOut = buildPlan("task-timeout.patch");
  ledger.begin(timedOut, 1_000);
  assert.equal(ledger.timeout(timedOut.idempotencyKey, 2_000).state, "timed_out");
  assert.throws(
    () => ledger.compensate({
      idempotencyKey: timedOut.idempotencyKey,
      evidence: "Nothing ran.",
      now: 2_100
    }),
    /no compensable/
  );
});
