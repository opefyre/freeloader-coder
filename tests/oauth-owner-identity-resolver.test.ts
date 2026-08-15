import test from "node:test";
import assert from "node:assert/strict";

import { OAuthOwnerIdentityResolver } from "../apps/core/src/oauth-owner-identity-resolver.js";

test("OAuth owner identity resolver binds stable and legacy connection aliases to the authenticated human", async () => {
  const secrets = new Map([
    ["vault:providers/slack/default", JSON.stringify({ accessToken: "slack-access-token", ownerActorId: "U-owner" })],
    ["vault:providers/discord/default", JSON.stringify({ accessToken: "discord-access-token" })],
  ]);
  const resolver = new OAuthOwnerIdentityResolver(
    { read: async (reference) => secrets.get(reference) ?? null },
    async (input) => {
      const url = String(input);
      if (url.includes("slack.com")) return new Response(JSON.stringify({ ok: true, user_id: "U-bot", team_id: "T-stable", team: "Workspace" }), { status: 200 });
      return new Response(JSON.stringify({ id: "D-owner", username: "owner", global_name: "Owner" }), { status: 200 });
    },
  );
  assert.deepEqual(await resolver.resolve(), [
    { provider: "slack", connectionId: "slack:T-stable", ownerActorId: "U-owner" },
    { provider: "slack", connectionId: "slack:Workspace", ownerActorId: "U-owner" },
    { provider: "discord", connectionId: "discord:D-owner", ownerActorId: "D-owner" },
    { provider: "discord", connectionId: "discord:Owner", ownerActorId: "D-owner" },
    { provider: "discord", connectionId: "discord:owner", ownerActorId: "D-owner" },
  ]);
});

test("Slack bot identity is never accepted as the owner when OAuth omitted the human actor", async () => {
  const resolver = new OAuthOwnerIdentityResolver(
    { read: async () => JSON.stringify({ accessToken: "slack-access-token" }) },
    async () => Response.json({ ok: true, user_id: "U-bot", team_id: "T-stable", team: "Workspace" }),
  );
  assert.deepEqual(await resolver.resolve(), []);
});

test("missing, malformed, denied, and oversized identity evidence fails closed without exposing credentials", async () => {
  const calls: string[] = [];
  const resolver = new OAuthOwnerIdentityResolver(
    { read: async (reference) => reference.includes("slack") ? "not-json" : JSON.stringify({ accessToken: "discord-access-token" }) },
    async (input) => { calls.push(String(input)); return new Response("x".repeat(1_000_001), { status: 200 }); },
  );
  assert.deepEqual(await resolver.resolve(), []);
  assert.equal(calls.length, 1);
  assert.ok(!JSON.stringify(calls).includes("discord-access-token"));
});
