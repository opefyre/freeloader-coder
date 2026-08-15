import assert from "node:assert/strict";
import { createHmac, generateKeyPairSync, sign } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { SignedOwnerResponseService, type OwnerResponseDelivery } from "../apps/core/src/signed-owner-response-service.js";

const now = 1_800_000_000_000;
const delivery: OwnerResponseDelivery = { deliveryId: "decision_0123456789abcdef", provider: "slack", projectId: "project_0123456789abcdef", revision: 4, channelId: "C-owner", ownerActorId: "U-owner", response: { kind: "solution", decision: "approved", artifactDigest: "a".repeat(64) }, issuedAt: now - 1_000, expiresAt: now + 60_000 };

test("signed Slack response applies once to the exact owner, channel, revision, and lifecycle", async () => {
  const root = await mkdtemp(join(tmpdir(), "codkesh-slack-owner-")); let decisions = 0; let reconciled = 0;
  const service = new SignedOwnerResponseService(root, { get: async (provider, id) => provider === "slack" && id === delivery.deliveryId ? delivery : null }, { get: async () => ({ revision: 4 }), answer: async () => undefined, decideSolution: async (_project, input, key) => { decisions += 1; assert.equal((input as any).decision, "approved"); assert.equal(key, `slack:${delivery.deliveryId}`); } }, async () => { reconciled += 1; }, () => now);
  const payload = { type: "block_actions", user: { id: "U-owner", name: "secret-name-omitted" }, channel: { id: "C-owner", name: "private-channel-omitted" }, actions: [{ action_id: "codkesh_owner_response:approve", value: delivery.deliveryId }] };
  const raw = new URLSearchParams({ payload: JSON.stringify(payload) }).toString(); const timestamp = String(now / 1_000); const secret = "slack-signing-secret-123456789"; const signature = `v0=${createHmac("sha256", secret).update(`v0:${timestamp}:${raw}`).digest("hex")}`;
  assert.deepEqual(await service.acceptSlack(raw, { timestamp, signature }, secret), { projectId: delivery.projectId, deliveryId: delivery.deliveryId, applied: true });
  assert.equal(decisions, 1); assert.equal(reconciled, 1);
  assert.deepEqual(await service.acceptSlack(raw, { timestamp, signature }, secret), { projectId: delivery.projectId, deliveryId: delivery.deliveryId, applied: true, replay: true });
  assert.equal(decisions, 1);
});

test("signed Slack response still rejects wrong owner, wrong channel, tampering, and stale revision", async () => {
  const secret = "slack-signing-secret-123456789";
  for (const variation of [{ user: "U-other", channel: "C-owner", revision: 4 }, { user: "U-owner", channel: "C-other", revision: 4 }, { user: "U-owner", channel: "C-owner", revision: 5 }]) {
    const root = await mkdtemp(join(tmpdir(), "codkesh-slack-deny-")); const service = new SignedOwnerResponseService(root, { get: async () => delivery }, { get: async () => ({ revision: variation.revision }), answer: async () => undefined, decideSolution: async () => assert.fail("must not mutate") }, async () => assert.fail("must not reconcile"), () => now);
    const raw = new URLSearchParams({ payload: JSON.stringify({ type: "block_actions", user: { id: variation.user }, channel: { id: variation.channel }, actions: [{ action_id: "codkesh_owner_response:approve", value: delivery.deliveryId }] }) }).toString(); const timestamp = String(now / 1_000); const signature = `v0=${createHmac("sha256", secret).update(`v0:${timestamp}:${raw}`).digest("hex")}`;
    await assert.rejects(() => service.acceptSlack(raw, { timestamp, signature }, secret), /actor|channel|stale/i);
    await assert.rejects(() => service.acceptSlack(`${raw}x`, { timestamp, signature }, secret), /signature/i);
  }
});

test("signed Discord interaction applies through the same canonical boundary", async () => {
  const root = await mkdtemp(join(tmpdir(), "codkesh-discord-owner-")); const pair = generateKeyPairSync("ed25519"); const der = pair.publicKey.export({ format: "der", type: "spki" }); const publicKey = der.subarray(der.length - 32).toString("hex");
  const discordDelivery = { ...delivery, provider: "discord" as const, channelId: "discord-channel", ownerActorId: "discord-owner" }; let decisions = 0;
  const service = new SignedOwnerResponseService(root, { get: async () => discordDelivery }, { get: async () => ({ revision: 4 }), answer: async () => undefined, decideSolution: async () => { decisions += 1; } }, async () => undefined, () => now);
  const timestamp = String(now / 1_000); const raw = JSON.stringify({ type: 3, channel_id: "discord-channel", member: { user: { id: "discord-owner" } }, data: { custom_id: `codkesh:${delivery.deliveryId}` } }); const signature = sign(null, Buffer.from(`${timestamp}${raw}`), pair.privateKey).toString("hex");
  await service.acceptDiscord(raw, { timestamp, signature }, publicKey); assert.equal(decisions, 1);
  await assert.rejects(() => service.acceptDiscord(`${raw} `, { timestamp, signature }, publicKey), /signature/i);
});

test("a downstream reconciliation failure leaves the signed response retryable", async () => {
  const root = await mkdtemp(join(tmpdir(), "codkesh-owner-reconcile-retry-"));
  const applied = new Set<string>();
  let reconciliations = 0;
  const service = new SignedOwnerResponseService(
    root,
    { get: async () => delivery },
    {
      get: async () => ({ revision: 4 }),
      answer: async () => undefined,
      decideSolution: async (_project, _input, key) => {
        applied.add(key);
      },
    },
    async () => {
      reconciliations += 1;
      if (reconciliations === 1) throw new Error("Jira temporarily unavailable");
    },
    () => now,
  );
  const payload = {
    type: "block_actions",
    user: { id: "U-owner" },
    channel: { id: "C-owner" },
    actions: [{ action_id: "codkesh_owner_response:approve", value: delivery.deliveryId }],
  };
  const raw = new URLSearchParams({ payload: JSON.stringify(payload) }).toString();
  const timestamp = String(now / 1_000);
  const secret = "slack-signing-secret-123456789";
  const signature = `v0=${createHmac("sha256", secret).update(`v0:${timestamp}:${raw}`).digest("hex")}`;

  await assert.rejects(
    () => service.acceptSlack(raw, { timestamp, signature }, secret),
    /temporarily unavailable/,
  );
  assert.equal(applied.size, 1, "the lifecycle effect remains idempotent");
  await assert.doesNotReject(() => service.acceptSlack(raw, { timestamp, signature }, secret));
  assert.equal(applied.size, 1, "retry does not duplicate the owner decision");
  assert.equal(reconciliations, 2);
  assert.deepEqual(await service.acceptSlack(raw, { timestamp, signature }, secret), { projectId: delivery.projectId, deliveryId: delivery.deliveryId, applied: true, replay: true });
});

test("a signed verification response is consumed without mutating the project", async () => {
  const root = await mkdtemp(join(tmpdir(), "codkesh-owner-verification-"));
  const verification = { ...delivery, response: { kind: "verification" as const, decision: "approved" as const, nonce: "0123456789abcdef" } };
  let mutations = 0;
  let reconciliations = 0;
  const service = new SignedOwnerResponseService(
    root,
    { get: async () => verification },
    { get: async () => ({ revision: 4 }), answer: async () => { mutations += 1; }, decideSolution: async () => { mutations += 1; } },
    async () => { reconciliations += 1; },
    () => now,
  );
  await service.acceptRelayed({ schemaVersion: 1, relayId: "01234567-89ab-4def-8123-456789abcdef", provider: "slack", deliveryId: verification.deliveryId, channelId: verification.channelId, actorId: verification.ownerActorId, receivedAt: now });
  assert.equal(mutations, 0);
  assert.equal(reconciliations, 0);
  assert.deepEqual(await service.acceptRelayed({ schemaVersion: 1, relayId: "abcdef01-2345-4abc-8123-456789abcdef", provider: "slack", deliveryId: verification.deliveryId, channelId: verification.channelId, actorId: verification.ownerActorId, receivedAt: now }), { projectId: delivery.projectId, deliveryId: delivery.deliveryId, applied: true, replay: true });
});
