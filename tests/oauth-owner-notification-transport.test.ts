import assert from "node:assert/strict";
import test from "node:test";

import { SlackOwnerNotificationTransport } from "../apps/core/src/oauth-owner-notification-transport.js";

const plan = { schemaVersion: 1 as const, provider: "slack" as const, projectId: "project_0123456789abcdef", projectRevision: 7, channelId: "C0123456789", title: "Codkesh review", message: "Approve <the> reviewed & cited solution.", actions: [{ label: "Approve" as const, deliveryId: "decision_0123456789abcdef" }, { label: "Decline" as const, deliveryId: "decision_fedcba9876543210" }], expiresAt: 2_000_000_000_000 };

test("Slack transport sends one bounded interactive owner decision without exposing its credential", async () => {
  const requests: Array<{ url: string; authorization: string | null; body: any }> = [];
  const transport = new SlackOwnerNotificationTransport({ read: async () => JSON.stringify({ accessToken: "slack-secret-access-token" }) }, async (input, init) => { requests.push({ url: String(input), authorization: new Headers(init?.headers).get("Authorization"), body: JSON.parse(String(init?.body)) }); return Response.json({ ok: true, channel: plan.channelId, ts: "123.456" }); });
  await transport.send(plan);
  const request = requests[0]!;
  assert.equal(request?.url, "https://slack.com/api/chat.postMessage");
  assert.equal(request?.authorization, "Bearer slack-secret-access-token");
  assert.equal(request?.body.channel, plan.channelId);
  assert.equal(request?.body.blocks[1].text.text, "Approve &lt;the&gt; reviewed &amp; cited solution.");
  assert.deepEqual(request.body.blocks[2].elements.map((item: any) => [item.action_id, item.value]), [["codkesh_owner_response:approve", plan.actions[0]!.deliveryId], ["codkesh_owner_response:decline", plan.actions[1]!.deliveryId]]);
  assert.equal(JSON.stringify(request?.body).includes("slack-secret-access-token"), false);
});

test("Slack transport fails closed for missing credentials, wrong provider, denial, and mismatched channel", async () => {
  await assert.rejects(() => new SlackOwnerNotificationTransport({ read: async () => null }).send(plan), /not connected/i);
  await assert.rejects(() => new SlackOwnerNotificationTransport({ read: async () => JSON.stringify({ accessToken: "valid-token-value" }) }).send({ ...plan, provider: "discord" } as any), /non-Slack/i);
  await assert.rejects(() => new SlackOwnerNotificationTransport({ read: async () => JSON.stringify({ accessToken: "valid-token-value" }) }, async () => Response.json({ ok: false, error: "not_in_channel" })).send(plan), /not_in_channel/i);
  await assert.rejects(() => new SlackOwnerNotificationTransport({ read: async () => JSON.stringify({ accessToken: "valid-token-value" }) }, async () => Response.json({ ok: true, channel: "C-other", ts: "123.456" })).send(plan), /failed/i);
});
