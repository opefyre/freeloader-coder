import assert from "node:assert/strict";
import test from "node:test";

import broker from "../apps/oauth-broker/src/index.js";

test("OAuth broker seals, rotates, binds, and rejects tampered Jira renewal grants", async () => {
  const entries = new Map<string, string>();
  const kv = {
    async get(key: string, type: "json") { const value = entries.get(key); return type === "json" && value ? JSON.parse(value) : null; },
    async put(key: string, value: string) { entries.set(key, value); },
    async delete(key: string) { entries.delete(key); },
  };
  const env = {
    OAUTH_STATE: kv,
    GITHUB_CLIENT_ID: "github", GITHUB_CLIENT_SECRET: "github-secret",
    JIRA_CLIENT_ID: "jira", JIRA_CLIENT_SECRET: "jira-secret",
    GOOGLE_CLIENT_ID: "google", GOOGLE_CLIENT_SECRET: "google-secret",
    SLACK_CLIENT_ID: "slack", SLACK_CLIENT_SECRET: "slack-secret",
    DISCORD_CLIENT_ID: "discord", DISCORD_CLIENT_SECRET: "discord-secret",
    OAUTH_SEAL_KEY: Buffer.alloc(32).toString("base64url"),
  };
  entries.set("state:state-value", JSON.stringify({ provider: "jira", verifier: "verifier", returnTo: "http://127.0.0.1:4310/oauth/broker/callback", createdAt: Date.now() }));
  const originalFetch = globalThis.fetch;
  let refreshCalls = 0;
  globalThis.fetch = async (input, init) => {
    assert.equal(String(input), "https://auth.atlassian.com/oauth/token");
    const body = JSON.parse(String(init?.body));
    if (body.grant_type === "authorization_code") return Response.json({ access_token: "access-one", refresh_token: "refresh-one-credential", expires_in: 3600 });
    refreshCalls += 1;
    assert.equal(body.refresh_token, "refresh-one-credential");
    return Response.json({ access_token: "access-two", refresh_token: "refresh-two-credential", expires_in: 3600 });
  };
  try {
    const callback = await broker.fetch(new Request("https://broker.test/callback/jira?code=code&state=state-value"), env);
    assert.equal(callback.status, 302);
    const ticket = new URL(callback.headers.get("location")!).searchParams.get("ticket")!;
    const exchange = await broker.fetch(new Request("https://broker.test/v1/oauth/exchange", { method: "POST", headers: { Origin: "http://127.0.0.1:4310", "Content-Type": "application/json" }, body: JSON.stringify({ ticket }) }), env);
    const exchanged = await exchange.json() as any;
    assert.equal(exchanged.credential.refresh_token, undefined);
    assert.equal(typeof exchanged.credential.refresh_grant, "string");
    assert.equal(JSON.stringify([...entries.values()]).includes("refresh-one-credential"), false);

    const renewed = await broker.fetch(new Request("https://broker.test/v1/oauth/refresh", { method: "POST", headers: { Origin: "http://127.0.0.1:4310", "Content-Type": "application/json" }, body: JSON.stringify({ provider: "jira", refreshGrant: exchanged.credential.refresh_grant }) }), env);
    const renewedBody = await renewed.json() as any;
    assert.equal(renewed.status, 200);
    assert.equal(renewedBody.credential.access_token, "access-two");
    assert.equal(renewedBody.credential.refresh_token, undefined);
    assert.notEqual(renewedBody.credential.refresh_grant, exchanged.credential.refresh_grant);
    assert.equal(refreshCalls, 1);

    const tamperIndex = exchanged.credential.refresh_grant.indexOf(".") + 5;
    const tampered = `${exchanged.credential.refresh_grant.slice(0, tamperIndex)}${exchanged.credential.refresh_grant[tamperIndex] === "A" ? "B" : "A"}${exchanged.credential.refresh_grant.slice(tamperIndex + 1)}`;
    assert.equal((await broker.fetch(new Request("https://broker.test/v1/oauth/refresh", { method: "POST", headers: { Origin: "http://127.0.0.1:4310", "Content-Type": "application/json" }, body: JSON.stringify({ provider: "jira", refreshGrant: tampered }) }), env)).status, 401);
    assert.equal((await broker.fetch(new Request("https://broker.test/v1/oauth/refresh", { method: "POST", headers: { Origin: "http://127.0.0.1:4310", "Content-Type": "application/json" }, body: JSON.stringify({ provider: "google", refreshGrant: exchanged.credential.refresh_grant }) }), env)).status, 401);
    assert.equal(refreshCalls, 1);
  } finally { globalThis.fetch = originalFetch; }
});
