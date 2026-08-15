import assert from "node:assert/strict";
import test from "node:test";

import { CHANNEL_RELAY_CREDENTIAL_REFERENCE, resolveChannelRelayRuntimeConfig } from "../apps/core/src/channel-relay-runtime-config.js";

test("channel relay config loads a complete vault-backed HTTPS origin", async () => {
  let reference = "";
  const result = await resolveChannelRelayRuntimeConfig({ read: async (input) => { reference = input; return JSON.stringify({ endpoint: "https://relay.example.test", token: "relay-token-12345678901234567890" }); } }, {});
  assert.equal(reference, CHANNEL_RELAY_CREDENTIAL_REFERENCE);
  assert.deepEqual(result, { endpoint: "https://relay.example.test", token: "relay-token-12345678901234567890" });
});

test("channel relay config fails closed for partial, insecure, or corrupt configuration", async () => {
  await assert.rejects(() => resolveChannelRelayRuntimeConfig({ read: async () => null }, { CODKESH_CHANNEL_RELAY_URL: "https://relay.example.test" }), /both/i);
  await assert.rejects(() => resolveChannelRelayRuntimeConfig({ read: async () => JSON.stringify({ endpoint: "http://relay.example.test", token: "relay-token-12345678901234567890" }) }, {}), /invalid|https/i);
  await assert.rejects(() => resolveChannelRelayRuntimeConfig({ read: async () => "not-json" }, {}), /invalid/i);
});

test("channel relay config remains disabled when no explicit configuration exists", async () => {
  assert.equal(await resolveChannelRelayRuntimeConfig({ read: async () => null }, {}), null);
});
