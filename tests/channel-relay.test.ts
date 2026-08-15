import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";

import relay, { updateSlackSourceMessage } from "../apps/channel-relay/src/index.js";

test("relay authenticates Slack, stores only opaque decision metadata, and permits one authorized pull", async () => {
  const entries = new Map<string, string>(); const secret = "slack-signing-secret-123456789"; const token = "relay-pull-token-123456789";
  const kv = { get: async (key: string) => entries.has(key) ? JSON.parse(entries.get(key)!) : null, put: async (key: string, value: string) => { entries.set(key, value); }, delete: async (key: string) => { entries.delete(key); }, list: async ({ prefix = "" } = {}) => ({ keys: [...entries.keys()].filter((key) => key.startsWith(prefix)).map((name) => ({ name })) }) };
  const env = { OWNER_RESPONSES: kv, CHANNEL_RELAY_TOKEN: token, SLACK_SIGNING_SECRET: secret, DISCORD_PUBLIC_KEY: "0".repeat(64) } as any;
  const payload = { type: "block_actions", user: { id: "U-owner", name: "personal-name" }, channel: { id: "C-owner", name: "private-name" }, actions: [{ action_id: "codkesh_owner_response:approve", value: "decision_0123456789abcdef" }], message: { text: "private project source" } };
  const body = new URLSearchParams({ payload: JSON.stringify(payload) }).toString(); const timestamp = String(Math.floor(Date.now() / 1000)); const signature = `v0=${createHmac("sha256", secret).update(`v0:${timestamp}:${body}`).digest("hex")}`;
  const accepted = await relay.fetch(new Request("https://relay.test/v1/channels/slack/interactions", { method: "POST", headers: { "X-Slack-Request-Timestamp": timestamp, "X-Slack-Signature": signature }, body }), env); assert.equal(accepted.status, 200);
  assert.equal(await accepted.text(), "");
  const stored = [...entries.values()].join(""); assert.doesNotMatch(stored, /personal-name|private-name|project source/i); assert.match(stored, /decision_0123456789abcdef/); assert.ok(entries.has("audit:decision_0123456789abcdef"));
  assert.equal((await relay.fetch(new Request("https://relay.test/v1/channels/responses/pull", { method: "POST" }), env)).status, 401);
  const pulled = await relay.fetch(new Request("https://relay.test/v1/channels/responses/pull", { method: "POST", headers: { Authorization: `Bearer ${token}` } }), env); assert.equal(pulled.status, 200); const firstPull = (await pulled.json()) as any; assert.equal(firstPull.responses.length, 1); assert.equal(entries.size, 2);
  const replay = await relay.fetch(new Request("https://relay.test/v1/channels/responses/pull", { method: "POST", headers: { Authorization: `Bearer ${token}` } }), env); assert.equal(((await replay.json()) as any).responses.length, 1);
  const ack = await relay.fetch(new Request("https://relay.test/v1/channels/responses/ack", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ relayIds: [firstPull.responses[0].relayId] }) }), env); assert.equal(ack.status, 200); assert.equal(entries.size, 1); assert.ok(entries.has("audit:decision_0123456789abcdef"));
});

test("relay rejects a tampered Slack body before durable storage", async () => {
  let writes = 0; const secret = "slack-signing-secret-123456789"; const timestamp = String(Math.floor(Date.now() / 1000)); const original = "payload=%7B%7D"; const signature = `v0=${createHmac("sha256", secret).update(`v0:${timestamp}:${original}`).digest("hex")}`;
  const env = { OWNER_RESPONSES: { get: async () => null, put: async () => { writes += 1; }, delete: async () => undefined, list: async () => ({ keys: [] }) }, CHANNEL_RELAY_TOKEN: "token", SLACK_SIGNING_SECRET: secret, DISCORD_PUBLIC_KEY: "0".repeat(64) } as any;
  const response = await relay.fetch(new Request("https://relay.test/v1/channels/slack/interactions", { method: "POST", headers: { "X-Slack-Request-Timestamp": timestamp, "X-Slack-Signature": signature }, body: `${original}x` }), env); assert.equal(response.status, 401); assert.equal(writes, 0);
});

test("Slack source-message acknowledgement is visible, bounded, and origin locked", async () => {
  const requests: Array<{ url: string; body: any }> = [];
  const updated = await updateSlackSourceMessage("https://hooks.slack.com/services/T/B/opaque", async (input, init) => {
    requests.push({ url: String(input), body: JSON.parse(String(init?.body)) });
    return new Response("ok", { status: 200 });
  });
  assert.equal(updated, true);
  assert.equal(requests[0]?.url, "https://hooks.slack.com/services/T/B/opaque");
  assert.deepEqual(requests[0]?.body, {
    replace_original: true,
    text: "Decision received by Codkesh. The signed response is queued for local verification.",
    blocks: [],
    attachments: [],
  });
  let calls = 0;
  assert.equal(await updateSlackSourceMessage("https://example.com/actions/T/B/secret", async () => { calls += 1; return new Response(); }), false);
  assert.equal(await updateSlackSourceMessage("https://hooks.slack.com/services/T/B/secret?leak=yes", async () => { calls += 1; return new Response(); }), false);
  assert.equal(await updateSlackSourceMessage("https://hooks.slack.com/services/T/B", async () => { calls += 1; return new Response(); }), false);
  assert.equal(await updateSlackSourceMessage("https://hooks.slack.com/not-a-response/T/B/secret", async () => { calls += 1; return new Response(); }), false);
  assert.equal(calls, 0);
});

test("Slack interaction acknowledges immediately and schedules the safe source-message replacement", async () => {
  const entries = new Map<string, string>();
  const secret = "slack-signing-secret-123456789";
  const pending: Promise<unknown>[] = [];
  const env = { OWNER_RESPONSES: { get: async () => null, put: async (key: string, value: string) => { entries.set(key, value); }, delete: async () => undefined, list: async () => ({ keys: [] }) }, CHANNEL_RELAY_TOKEN: "token", SLACK_SIGNING_SECRET: secret, DISCORD_PUBLIC_KEY: "0".repeat(64) } as any;
  const payload = { type: "block_actions", user: { id: "U-owner" }, channel: { id: "C-owner" }, response_url: "https://example.com/not-allowed", actions: [{ action_id: "codkesh_owner_response:approve", value: "decision_0123456789abcdef" }] };
  const body = new URLSearchParams({ payload: JSON.stringify(payload) }).toString();
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = `v0=${createHmac("sha256", secret).update(`v0:${timestamp}:${body}`).digest("hex")}`;
  const response = await relay.fetch(new Request("https://relay.test/v1/channels/slack/interactions", { method: "POST", headers: { "X-Slack-Request-Timestamp": timestamp, "X-Slack-Signature": signature }, body }), env, { waitUntil: (promise) => { pending.push(promise); } });
  assert.equal(response.status, 200);
  assert.ok([...entries.keys()].some((key) => key.startsWith("response:")));
  assert.equal(pending.length, 1);
  assert.equal(await response.text(), "");
  await Promise.all(pending);
  assert.equal(entries.size, 2);
  assert.match(entries.get("audit:decision_0123456789abcdef") ?? "", /U-owner/);
  assert.match(entries.get("audit:decision_0123456789abcdef") ?? "", /"responseUrlPresent":true/);
  assert.match(entries.get("audit:decision_0123456789abcdef") ?? "", /"sourceMessageUpdated":false/);
});
