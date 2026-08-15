import assert from "node:assert/strict";
import test from "node:test";

import { resolveCurrentJiraCredential } from "../apps/core/src/jira-oauth-credential.js";

test("expired Jira OAuth credentials renew through the broker and rotate both vault records", async () => {
  const now = 1_000_000;
  const stored = new Map([
    ["vault:providers/jira/default", JSON.stringify({ accessToken: "expired-token", expiresAt: now - 1 })],
    ["vault:providers/jira/refresh", JSON.stringify({ brokerRefreshGrant: "sealed-refresh-grant" })],
  ]);
  const result = await resolveCurrentJiraCredential(
    { read: async (key) => stored.get(key) ?? null, write: async (key, value) => { stored.set(key, value); } },
    async (_input, init) => {
      assert.deepEqual(JSON.parse(String(init?.body)), { provider: "jira", refreshGrant: "sealed-refresh-grant" });
      return Response.json({ credential: { access_token: "renewed-token", refresh_grant: "rotated-refresh-grant", expires_in: 3600 } });
    },
    () => now,
  );
  assert.deepEqual(JSON.parse(result!), { accessToken: "renewed-token", refreshToken: null, expiresAt: now + 3_600_000 });
  assert.deepEqual(JSON.parse(stored.get("vault:providers/jira/refresh")!), { brokerRefreshGrant: "rotated-refresh-grant" });
});

test("current, basic, and missing credentials avoid renewal while expired credentials fail closed", async () => {
  let calls = 0;
  const fetcher = async () => { calls += 1; return Response.json({}); };
  const current = JSON.stringify({ accessToken: "current-token", expiresAt: 2_000_000 });
  assert.equal(await resolveCurrentJiraCredential({ read: async () => current }, fetcher, () => 1_000_000), current);
  const basic = JSON.stringify({ siteUrl: "https://example.atlassian.net", email: "owner@example.com", apiToken: "token" });
  assert.equal(await resolveCurrentJiraCredential({ read: async () => basic }, fetcher, () => 1_000_000), basic);
  assert.equal(await resolveCurrentJiraCredential({ read: async () => null }, fetcher, () => 1_000_000), null);
  await assert.rejects(() => resolveCurrentJiraCredential({ read: async (key) => key.endsWith("default") ? JSON.stringify({ accessToken: "expired-token", expiresAt: 1 }) : null }, fetcher, () => 1_000_000), /secure renewal is unavailable/);
  assert.equal(calls, 0);
});
