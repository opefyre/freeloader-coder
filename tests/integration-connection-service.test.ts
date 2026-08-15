import assert from "node:assert/strict";
import test from "node:test";

import { IntegrationConnectionService } from "../apps/core/src/integration-connection-service.js";

test("GitHub never probes developer CLI and requires browser OAuth setup", async () => {
  let runnerCalled = false;
  const service = new IntegrationConnectionService(async () => { runnerCalled = true; return { stdout: "" }; });
  const result = await service.probeGitHub();
  assert.equal(result.connections[0]?.state, "setup_required");
  assert.equal(result.connections[0]?.authMethod, "github_device_oauth");
  assert.equal(runnerCalled, false);
});

test("Jira API-token sign-in is disabled and OAuth app configuration is vault-only", async () => {
  const stored = new Map<string, string>();
  const vault = {
    async write(reference: string, value: string) { stored.set(reference, value); },
    async read(reference: string) { return stored.get(reference) ?? null; },
    async delete(reference: string) { stored.delete(reference); },
  };
  const service = new IntegrationConnectionService(undefined, vault);
  await assert.rejects(() => service.connectJira({ schemaVersion: 1, siteUrl: "https://opefyre.atlassian.net", email: "owner@example.com", apiToken: "secret-token" }), /disabled/);
  await service.configureOAuth({ schemaVersion: 1, provider: "jira", clientId: "jira-client-id", clientSecret: "jira-client-secret" });
  assert.equal(stored.has("vault:oauth-apps/jira"), true);
  assert.equal(JSON.stringify(await service.list()).includes("jira-client-secret"), false);
});

test("a stale Jira credential is isolated instead of breaking every connection", async () => {
  const stored = new Map([["vault:providers/jira/default", JSON.stringify({ accessToken: "stale-token" })]]);
  const vault = {
    async write(reference: string, value: string) { stored.set(reference, value); },
    async read(reference: string) { return stored.get(reference) ?? null; },
    async delete(reference: string) { stored.delete(reference); },
  };
  const service = new IntegrationConnectionService(undefined, vault, async () => new Response("denied", { status: 401 }));
  const result = await service.list();
  assert.equal(result.connections.find((connection) => connection.provider === "jira")?.state, "unavailable");
  assert.equal(result.connections.find((connection) => connection.provider === "github")?.state, "not_connected");
});

test("Jira remains usable when the optional profile endpoint is unavailable", async () => {
  const stored = new Map([["vault:providers/jira/default", JSON.stringify({ accessToken: "valid-token" })]]);
  const vault = {
    async write(reference: string, value: string) { stored.set(reference, value); },
    async read(reference: string) { return stored.get(reference) ?? null; },
    async delete(reference: string) { stored.delete(reference); },
  };
  const service = new IntegrationConnectionService(undefined, vault, async (input) => {
    const url = String(input);
    if (url.endsWith("/oauth/token/accessible-resources")) return Response.json([{ id: "cloud-1", name: "Opefyre", url: "https://opefyre.atlassian.net" }]);
    if (url.endsWith("/rest/api/3/myself")) return new Response("forbidden", { status: 403 });
    if (url.includes("/rest/api/3/project/search")) return Response.json({ values: [{ id: "10000", key: "PIPE", name: "Coding Pipeline" }] });
    return new Response("not found", { status: 404 });
  });
  const jira = (await service.list()).connections.find((connection) => connection.provider === "jira");
  assert.equal(jira?.state, "ready");
  assert.equal(jira?.accountLabel, "Opefyre");
  assert.equal(jira?.resources[0]?.label, "PIPE · Coding Pipeline");
});

test("broker-issued Jira OAuth migrates its refresh token to a sealed rotating grant", async () => {
  const stored = new Map<string, string>();
  const vault = { async write(reference: string, value: string) { stored.set(reference, value); }, async read(reference: string) { return stored.get(reference) ?? null; }, async delete(reference: string) { stored.delete(reference); } };
  let refreshRequest: Record<string, unknown> | null = null;
  const service = new IntegrationConnectionService(undefined, vault, async (input, init) => {
    const url = String(input);
    if (url.endsWith("/v1/oauth/exchange")) return Response.json({ credential: { access_token: "initial-access", refresh_token: "legacy-refresh-token-value", expires_in: -1 } });
    if (url.endsWith("/v1/oauth/refresh")) { refreshRequest = JSON.parse(String(init?.body)); return Response.json({ credential: { access_token: "renewed-access", refresh_grant: "sealed.rotated", expires_in: 3600 } }); }
    assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer renewed-access");
    if (url.endsWith("/oauth/token/accessible-resources")) return Response.json([{ id: "cloud-1", name: "Opefyre", url: "https://opefyre.atlassian.net" }]);
    if (url.endsWith("/rest/api/3/myself")) return Response.json({ displayName: "Opefyre" });
    if (url.includes("/rest/api/3/project/search")) return Response.json({ values: [{ id: "10132", key: "PIPE", name: "Coding Pipeline" }] });
    return new Response("not found", { status: 404 });
  });
  await service.completeBrokerOAuth("jira", "x".repeat(40));
  assert.deepEqual(refreshRequest, { provider: "jira", refreshToken: "legacy-refresh-token-value" });
  assert.equal(stored.get("vault:providers/jira/refresh"), JSON.stringify({ brokerRefreshGrant: "sealed.rotated" }));
  assert.equal([...stored.values()].some((value) => value.includes("legacy-refresh-token-value")), false);
  assert.equal((await service.list()).connections.find((connection) => connection.provider === "jira")?.state, "ready");
});

test("Telegram connection verifies the bot and selected chat without exposing its token", async () => {
  const stored = new Map<string, string>();
  const vault = {
    async write(reference: string, value: string) { stored.set(reference, value); },
    async read(reference: string) { return stored.get(reference) ?? null; },
    async delete(reference: string) { stored.delete(reference); },
  };
  const service = new IntegrationConnectionService(undefined, vault, async (input) => {
    const url = String(input);
    if (url.endsWith("/getMe")) return Response.json({ ok: true, result: { username: "pipeline_owner_bot" } });
    return Response.json({ ok: true, result: { id: -1001234567890, title: "Pipeline approvals" } });
  });
  const token = "123456789:abcdefghijklmnopqrstuvwxyzABCDE_12345";
  const result = await service.connectTelegram({ schemaVersion: 1, botToken: token, chatId: "-1001234567890", ownerUserId: "123456789" });
  const telegram = result.connections.find((connection) => connection.provider === "telegram");
  assert.equal(telegram?.state, "ready");
  assert.equal(telegram?.resources[0]?.kind, "telegram_chat");
  assert.equal(telegram?.resources[0]?.label, "Pipeline approvals");
  assert.equal(JSON.stringify(result).includes(token), false);
  assert.equal(stored.has("vault:providers/telegram/default"), true);
  await service.disconnectTelegram();
  assert.equal(stored.has("vault:providers/telegram/default"), false);
});

test("Telegram connection rejects invalid or unauthorized bot credentials and removes them", async () => {
  const stored = new Map<string, string>();
  const vault = {
    async write(reference: string, value: string) { stored.set(reference, value); },
    async read(reference: string) { return stored.get(reference) ?? null; },
    async delete(reference: string) { stored.delete(reference); },
  };
  const service = new IntegrationConnectionService(undefined, vault, async () => new Response("denied", { status: 401 }));
  await assert.rejects(() => service.connectTelegram({ schemaVersion: 1, botToken: "123456789:abcdefghijklmnopqrstuvwxyzABCDE_12345", chatId: "-1001234567890", ownerUserId: "123456789" }));
  assert.equal(stored.has("vault:providers/telegram/default"), false);
  await assert.rejects(() => service.connectTelegram({ schemaVersion: 1, botToken: "not-a-token", chatId: "all", ownerUserId: "owner" }));
});

test("Google OAuth stores refresh capability and exposes only discovered account, calendars, and projects", async () => {
  const stored = new Map<string, string>();
  const vault = {
    async write(reference: string, value: string) { stored.set(reference, value); },
    async read(reference: string) { return stored.get(reference) ?? null; },
    async delete(reference: string) { stored.delete(reference); },
  };
  const service = new IntegrationConnectionService(undefined, vault, async (input) => {
    const url = String(input);
    if (url.endsWith("/v1/oauth/exchange")) return Response.json({ credential: { access_token: "google-access", refresh_token: "google-refresh-token-value", expires_in: 3600 } });
    if (url.includes("openidconnect")) return Response.json({ sub: "u1", email: "owner@example.com" });
    if (url.includes("calendarList")) return Response.json({ items: [{ id: "primary", summary: "Owner calendar", primary: true }] });
    if (url.includes("cloudresourcemanager")) return Response.json({ projects: [{ projectId: "pipeline-oauth", name: "Pipeline OAuth" }] });
    return new Response("not found", { status: 404 });
  });
  await service.completeBrokerOAuth("google", "x".repeat(40));
  const result = await service.list(); const google = result.connections.find((connection) => connection.provider === "google");
  assert.equal(google?.state, "ready");
  assert.deepEqual(google?.resources.map((resource) => resource.kind), ["google_account", "google_calendar", "gcloud_project"]);
  assert.equal(stored.get("vault:providers/google/default")?.includes("google-refresh-token-value"), true);
  assert.equal(JSON.stringify(result).includes("google-access"), false);
});

test("Slack OAuth verifies the workspace and exposes selectable channels without exposing its token", async () => {
  const stored = new Map<string, string>();
  const vault = {
    async write(reference: string, value: string) { stored.set(reference, value); },
    async read(reference: string) { return stored.get(reference) ?? null; },
    async delete(reference: string) { stored.delete(reference); },
  };
  const service = new IntegrationConnectionService(undefined, vault, async (input) => {
    const url = String(input);
    if (url.endsWith("/v1/oauth/exchange")) return Response.json({ credential: { access_token: "slack-access-token", authed_user: { id: "U-human-owner" } } });
    if (url.endsWith("/auth.test")) return Response.json({ ok: true, team_id: "T1", team: "Opefyre", url: "https://opefyre.slack.com/" });
    if (url.includes("conversations.list")) return Response.json({ ok: true, channels: [{ id: "C1", name: "pipeline", is_private: false }] });
    return new Response("not found", { status: 404 });
  });
  await service.completeBrokerOAuth("slack", "x".repeat(40));
  const result = await service.list(); const slack = result.connections.find((connection) => connection.provider === "slack");
  assert.equal(slack?.state, "ready");
  assert.deepEqual(slack?.resources.map((resource) => resource.kind), ["slack_workspace", "slack_channel"]);
  assert.equal(JSON.parse(stored.get("vault:providers/slack/default") ?? "{}").ownerActorId, "U-human-owner");
  assert.equal(JSON.stringify(result).includes("slack-access-token"), false);
});
