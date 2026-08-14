import assert from "node:assert/strict";
import { generateKeyPairSync, sign, createHmac } from "node:crypto";
import test from "node:test";

import { verifyDiscordRequest, verifyOwnerResponseEnvelope, verifySlackRequest } from "../packages/orchestration/src/owner-response-verification.js";

const now = 1_800_000_000_000;
const envelope = {
  schemaVersion: 1 as const,
  provider: "slack" as const,
  deliveryId: "decision_123",
  projectId: "project_0123456789abcdef",
  expectedRevision: 7,
  channelId: "C123",
  actorId: "U123",
  response: { kind: "solution" as const, decision: "approved" as const, artifactDigest: "a".repeat(64) },
  issuedAt: now - 1_000,
  expiresAt: now + 60_000,
};

test("canonical owner responses bind provider, project revision, channel, actor, expiry, and replay state", () => {
  const verified = verifyOwnerResponseEnvelope(envelope, { provider: "slack", projectId: envelope.projectId, revision: 7, channelId: "C123", actorId: "U123", consumedDeliveryIds: new Set() }, now);
  assert.equal(verified.idempotencyKey, "slack:decision_123");
  for (const [patch, message] of [
    [{ actorId: "U999" }, "actor"], [{ channelId: "C999" }, "channel"], [{ expectedRevision: 6 }, "stale"], [{ expiresAt: now }, "expired"],
  ] as const) assert.throws(() => verifyOwnerResponseEnvelope({ ...envelope, ...patch }, { provider: "slack", projectId: envelope.projectId, revision: 7, channelId: "C123", actorId: "U123", consumedDeliveryIds: new Set() }, now), new RegExp(message, "i"));
  assert.throws(() => verifyOwnerResponseEnvelope(envelope, { provider: "slack", projectId: envelope.projectId, revision: 7, channelId: "C123", actorId: "U123", consumedDeliveryIds: new Set([envelope.deliveryId]) }, now), /consumed/i);
});

test("Slack request verification rejects tampering and stale deliveries", () => {
  const body = "payload=%7B%22type%22%3A%22block_actions%22%7D";
  const timestamp = String(Math.floor(now / 1_000));
  const secret = "slack-signing-secret-123456789";
  const signature = `v0=${createHmac("sha256", secret).update(`v0:${timestamp}:${body}`).digest("hex")}`;
  assert.equal(verifySlackRequest(body, timestamp, signature, secret, now), true);
  assert.equal(verifySlackRequest(`${body}x`, timestamp, signature, secret, now), false);
  assert.equal(verifySlackRequest(body, String(Number(timestamp) - 301), signature, secret, now), false);
});

test("Discord request verification rejects tampering and stale deliveries", () => {
  const pair = generateKeyPairSync("ed25519");
  const publicDer = pair.publicKey.export({ format: "der", type: "spki" });
  const publicKey = publicDer.subarray(publicDer.length - 32).toString("hex");
  const timestamp = String(Math.floor(now / 1_000));
  const body = JSON.stringify({ type: 3, data: { custom_id: "decision_123" } });
  const signature = sign(null, Buffer.from(`${timestamp}${body}`), pair.privateKey).toString("hex");
  assert.equal(verifyDiscordRequest(body, timestamp, signature, publicKey, now), true);
  assert.equal(verifyDiscordRequest(`${body}x`, timestamp, signature, publicKey, now), false);
  assert.equal(verifyDiscordRequest(body, String(Number(timestamp) - 301), signature, publicKey, now), false);
});
