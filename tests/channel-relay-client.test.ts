import assert from "node:assert/strict";
import test from "node:test";
import { ChannelRelayClient } from "../apps/core/src/channel-relay-client.js";

test("relay client acknowledges only decisions applied locally and leaves failures retryable", async () => {
  const applied: string[] = []; const acknowledgements: string[][] = []; const responses = [
    { schemaVersion: 1, relayId: "01234567-89ab-4def-8123-456789abcdef", provider: "slack", deliveryId: "decision_0123456789abcdef", channelId: "C-owner", actorId: "U-owner", messageTs: "1234567890.123456", receivedAt: 1 },
    { schemaVersion: 1, relayId: "abcdef01-2345-4abc-8123-456789abcdef", provider: "discord", deliveryId: "decision_abcdef0123456789", channelId: "D-owner", actorId: "DU-owner", messageTs: null, receivedAt: 1 },
  ];
  const updated: string[] = [];
  const client = new ChannelRelayClient("https://relay.example", "relay-token-0123456789abcdef", { acceptRelayed: async (item: any) => { if (item.provider === "discord") throw new Error("temporary"); applied.push(item.deliveryId); return {} as any; } }, async (item) => { if (item.messageTs) updated.push(item.messageTs); }, async (url, init) => { if (String(url).endsWith("/pull")) return Response.json({ schemaVersion: 1, responses }); acknowledgements.push((JSON.parse(String(init?.body)) as any).relayIds); return Response.json({ acknowledged: 1 }); });
  assert.deepEqual(await client.synchronize(), { applied: 1, pending: 1 }); assert.deepEqual(applied, ["decision_0123456789abcdef"]); assert.deepEqual(acknowledgements, [[responses[0]!.relayId]]);
  assert.deepEqual(updated, ["1234567890.123456"]);
});

test("relay client rejects insecure endpoints, short tokens, remote errors, and malformed collections", async () => {
  assert.throws(() => new ChannelRelayClient("http://relay.example", "relay-token-0123456789abcdef", { acceptRelayed: async () => ({} as any) }), /HTTPS/i);
  assert.throws(() => new ChannelRelayClient("https://relay.example", "short", { acceptRelayed: async () => ({} as any) }), /token/i);
  const client = new ChannelRelayClient("https://relay.example", "relay-token-0123456789abcdef", { acceptRelayed: async () => ({} as any) }, async () => undefined, async () => Response.json({ responses: [{ secret: "bad" }] }));
  await assert.rejects(() => client.synchronize());
});
