import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { SlackOwnerNotificationTransport } from "../apps/core/src/oauth-owner-notification-transport.js";
import { SignedOwnerResponseService, type OwnerResponseDelivery } from "../apps/core/src/signed-owner-response-service.js";

const now = 1_800_000_000_000;
const plan = {
  schemaVersion: 1 as const,
  provider: "slack" as const,
  projectId: "project_0123456789abcdef",
  projectRevision: 7,
  channelId: "C0123456789",
  title: "Codkesh review",
  message: "The reviewed solution is ready.",
  actions: [
    { label: "Approve" as const, deliveryId: "decision_0123456789abcdef" },
    { label: "Decline" as const, deliveryId: "decision_fedcba9876543210" },
  ],
  expiresAt: now + 60_000,
};

test("the exact Slack button emitted by Codkesh is accepted by the signed-response boundary", async () => {
  let outbound: any;
  await new SlackOwnerNotificationTransport(
    { read: async () => JSON.stringify({ accessToken: "slack-secret-access-token" }) },
    async (_input, init) => {
      outbound = JSON.parse(String(init?.body));
      return Response.json({ ok: true, channel: plan.channelId, ts: "123.456" });
    },
  ).send(plan);

  const button = outbound.blocks.find((block: any) => block.type === "actions").elements[0];
  const delivery: OwnerResponseDelivery = {
    deliveryId: button.value,
    provider: "slack",
    projectId: plan.projectId,
    revision: plan.projectRevision,
    channelId: plan.channelId,
    ownerActorId: "U-owner",
    response: { kind: "solution", decision: "approved", artifactDigest: "a".repeat(64) },
    issuedAt: now - 1_000,
    expiresAt: plan.expiresAt,
  };
  let applied = 0;
  const service = new SignedOwnerResponseService(
    await mkdtemp(join(tmpdir(), "codkesh-slack-roundtrip-")),
    { get: async (provider, id) => provider === "slack" && id === delivery.deliveryId ? delivery : null },
    {
      get: async () => ({ revision: plan.projectRevision }),
      answer: async () => undefined,
      decideSolution: async () => { applied += 1; },
    },
    async () => undefined,
    () => now,
  );
  const payload = {
    type: "block_actions",
    user: { id: "U-owner" },
    channel: { id: plan.channelId },
    actions: [{ action_id: button.action_id, value: button.value }],
  };
  const raw = new URLSearchParams({ payload: JSON.stringify(payload) }).toString();
  const timestamp = String(now / 1_000);
  const signingSecret = "slack-signing-secret-123456789";
  const signature = `v0=${createHmac("sha256", signingSecret).update(`v0:${timestamp}:${raw}`).digest("hex")}`;

  await service.acceptSlack(raw, { timestamp, signature }, signingSecret);
  assert.equal(applied, 1);
});
