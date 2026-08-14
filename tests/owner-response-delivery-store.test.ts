import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { OwnerResponseDeliveryStore } from "../apps/core/src/owner-response-delivery-store.js";

const projectId = "project_0123456789abcdef";
const base = { provider: "slack" as const, projectId, revision: 8, channelId: "C-owner", ownerActorId: "U-owner", response: { kind: "solution" as const, decision: "approved" as const, artifactDigest: "a".repeat(64) }, idempotencyKey: "solution:revision-8:approve", ttlMs: 60_000 };

test("delivery registry is durable, deterministic, idempotent, project-scoped, and credential-free", async () => {
  const root = await mkdtemp(join(tmpdir(), "codkesh-deliveries-")); const now = 1_800_000_000_000; const store = new OwnerResponseDeliveryStore(root, () => now);
  const first = await store.register(base); const replay = await store.register(base);
  assert.deepEqual(replay, first); assert.match(first.deliveryId, /^decision_[a-f0-9]{16}$/); assert.equal(first.expiresAt, now + 60_000);
  assert.deepEqual(await new OwnerResponseDeliveryStore(root, () => now).get("slack", first.deliveryId), first);
  assert.equal(await store.get("discord", first.deliveryId), null); assert.equal((await store.list(projectId)).length, 1); assert.equal((await store.list("project_ffffffffffffffff")).length, 0);
  const raw = await readFile(join(root, "owner-response-deliveries.json"), "utf8"); assert.doesNotMatch(raw, /token|secret|source code|message text/i);
  await assert.rejects(() => store.register({ ...base, channelId: "C-other" }), /reused with different content/i);
});

test("expired deliveries are pruned and corrupt state fails closed", async () => {
  const root = await mkdtemp(join(tmpdir(), "codkesh-deliveries-expiry-")); let now = 1_800_000_000_000; const store = new OwnerResponseDeliveryStore(root, () => now); const delivery = await store.register(base);
  now = delivery.expiresAt; assert.equal(await store.pruneExpired(), 1); assert.equal(await store.get("slack", delivery.deliveryId), null);
  await writeFile(join(root, "owner-response-deliveries.json"), "not-json"); await assert.rejects(() => store.list(), /corrupt/i);
});
