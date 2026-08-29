import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import { OwnerChannelRuntime } from "../apps/core/src/owner-channel-runtime.js";
import type { OwnerNotificationPlan } from "../apps/core/src/owner-response-delivery-planner.js";

const plan: OwnerNotificationPlan = {
  schemaVersion: 1,
  provider: "slack",
  projectId: "project_aaaaaaaaaaaaaaaa",
  projectRevision: 4,
  channelId: "C123",
  title: "Project",
  message: "The reviewed solution is ready.",
  actions: [
    { label: "Approve", deliveryId: "decision_aaaaaaaaaaaaaaaa" },
    { label: "Decline", deliveryId: "decision_bbbbbbbbbbbbbbbb" },
  ],
  expiresAt: 2_000_000,
};

test("owner channel runtime delivers once across restarts and reconciles responses", async () => {
  const directory = await mkdtemp(join(tmpdir(), "codkesh-owner-runtime-"));
  const sent: OwnerNotificationPlan[] = [];
  let reconciled = 0;
  const dependencies = {
    planner: { plan: async () => [plan] },
    transports: [{ provider: "slack" as const, send: async (item: OwnerNotificationPlan) => { sent.push(item); } }],
    relay: { synchronize: async () => ({ applied: 1, pending: 0 }) },
    onApplied: async () => { reconciled += 1; },
  };
  const first = new OwnerChannelRuntime(directory, dependencies.planner, dependencies.transports, dependencies.relay, dependencies.onApplied, () => 1_000_000);
  assert.deepEqual(await first.synchronize(), { planned: 1, delivered: 1, deferred: 0, applied: 1, pending: 0, awaiting: 1 });
  const restarted = new OwnerChannelRuntime(directory, dependencies.planner, dependencies.transports, dependencies.relay, dependencies.onApplied, () => 1_000_001);
  assert.deepEqual(await restarted.synchronize(), { planned: 1, delivered: 0, deferred: 0, applied: 1, pending: 0, awaiting: 1 });
  assert.equal(sent.length, 1);
  assert.equal(reconciled, 2);
});

test("failed and unavailable transports remain retryable without blocking another provider", async () => {
  const directory = await mkdtemp(join(tmpdir(), "codkesh-owner-runtime-"));
  const discord = { ...plan, provider: "discord" as const, channelId: "D123" };
  let attempts = 0;
  const runtime = new OwnerChannelRuntime(directory, { plan: async () => [plan, discord] }, [{ provider: "slack", send: async () => { attempts += 1; throw new Error("offline"); } }], null, undefined, () => 1_000_000);
  assert.deepEqual(await runtime.synchronize(), { planned: 2, delivered: 0, deferred: 2, applied: 0, pending: 0, awaiting: 0 });
  assert.deepEqual(await runtime.synchronize(), { planned: 2, delivered: 0, deferred: 2, applied: 0, pending: 0, awaiting: 0 });
  assert.equal(attempts, 2);
});

test("relay failure is contained and corrupt runtime state fails closed", async () => {
  const directory = await mkdtemp(join(tmpdir(), "codkesh-owner-runtime-"));
  const runtime = new OwnerChannelRuntime(directory, { plan: async () => [] }, [], { synchronize: async () => { throw new Error("offline"); } }, undefined, () => 1_000_000);
  assert.deepEqual(await runtime.synchronize(), { planned: 0, delivered: 0, deferred: 0, applied: 0, pending: 0, awaiting: 0 });
  const statePath = join(directory, "owner-channel-runtime.json");
  assert.doesNotReject(() => readFile(statePath, "utf8"));
  await writeFile(statePath, "not-json");
  await assert.rejects(() => runtime.synchronize(), /state is corrupt/);
});

test("idle and local-only synchronization make zero relay requests", async () => {
  const directory = await mkdtemp(join(tmpdir(), "codkesh-owner-runtime-"));
  let relayCalls = 0;
  const relay = { synchronize: async () => { relayCalls += 1; return { applied: 0, pending: 0 }; } };
  const idle = new OwnerChannelRuntime(directory, { plan: async () => [] }, [], relay, undefined, () => 1_000_000);
  assert.deepEqual(await idle.synchronize(), { planned: 0, delivered: 0, deferred: 0, applied: 0, pending: 0, awaiting: 0 });
  assert.equal(relayCalls, 0);

  const activeDirectory = await mkdtemp(join(tmpdir(), "codkesh-owner-runtime-"));
  const active = new OwnerChannelRuntime(activeDirectory, { plan: async () => [plan] }, [{ provider: "slack", send: async () => undefined }], relay, undefined, () => 1_000_000);
  assert.deepEqual(await active.synchronize({ includeRelay: false }), { planned: 1, delivered: 1, deferred: 0, applied: 0, pending: 0, awaiting: 1 });
  assert.equal(relayCalls, 0);
  assert.deepEqual(await active.synchronize(), { planned: 1, delivered: 0, deferred: 0, applied: 0, pending: 0, awaiting: 1 });
  assert.equal(relayCalls, 1);
});
