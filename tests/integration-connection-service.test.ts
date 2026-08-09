import assert from "node:assert/strict";
import test from "node:test";

import { IntegrationConnectionService } from "../apps/core/src/integration-connection-service.js";

test("GitHub discovery returns authenticated account and bounded repository metadata", async () => {
  const calls: string[] = [];
  const service = new IntegrationConnectionService(async (file, args) => {
    calls.push(`${file} ${args.join(" ")}`);
    if (args[0] === "api") return { stdout: "opefyre\n" };
    return { stdout: JSON.stringify([{ id: "R_1", nameWithOwner: "opefyre/app", url: "https://github.com/opefyre/app", isPrivate: true, defaultBranchRef: { name: "main" } }]) };
  });
  const result = await service.probeGitHub();
  assert.equal(result.connections[0]?.state, "ready");
  assert.equal(result.connections[0]?.accountLabel, "opefyre");
  assert.equal(result.connections[0]?.resources[0]?.label, "opefyre/app");
  assert.deepEqual(calls, ["gh api user --jq .login", "gh repo list --limit 100 --json id,nameWithOwner,url,isPrivate,defaultBranchRef"]);
  assert.equal(JSON.stringify(result).includes("secret-token-value"), false);
});

test("GitHub discovery fails closed without credentials or executable", async () => {
  const missing = new IntegrationConnectionService(async () => { throw new Error("spawn gh ENOENT"); });
  assert.equal((await missing.probeGitHub()).connections[0]?.state, "unavailable");
  const signedOut = new IntegrationConnectionService(async () => { throw new Error("authentication required"); });
  assert.equal((await signedOut.probeGitHub()).connections[0]?.state, "not_connected");
});

test("Jira connection stores credentials in the vault and exposes only project metadata", async () => {
  const stored = new Map<string, string>();
  const vault = {
    async write(reference: string, value: string) { stored.set(reference, value); },
    async read(reference: string) { return stored.get(reference) ?? null; },
    async delete(reference: string) { stored.delete(reference); },
  };
  const requests: string[] = [];
  const service = new IntegrationConnectionService(undefined, vault, async (input, init) => {
    const url = String(input);
    requests.push(url);
    assert.match(String((init?.headers as Record<string, string>).Authorization), /^Basic /);
    if (url.endsWith("/myself")) return Response.json({ displayName: "Opefyre" });
    return Response.json({ values: [{ id: "10001", key: "PIPE", name: "Pipeline", projectTypeKey: "software" }] });
  });
  const result = await service.connectJira({ schemaVersion: 1, siteUrl: "https://opefyre.atlassian.net/", email: "opefyre@gmail.com", apiToken: "secret-token" });
  const jira = result.connections.find((connection) => connection.provider === "jira");
  assert.equal(jira?.state, "ready");
  assert.equal(jira?.resources[0]?.label, "PIPE · Pipeline");
  assert.equal(jira?.resources[0]?.kind, "jira_project");
  assert.deepEqual(requests, ["https://opefyre.atlassian.net/rest/api/3/myself", "https://opefyre.atlassian.net/rest/api/3/project/search?maxResults=100&orderBy=name"]);
  assert.equal(JSON.stringify(result).includes("secret-token"), false);
  assert.equal(stored.has("vault:providers/jira/default"), true);
  await service.disconnectJira();
  assert.equal(stored.size, 0);
});

test("Jira connection deletes rejected credentials and fails closed", async () => {
  const stored = new Map<string, string>();
  const vault = {
    async write(reference: string, value: string) { stored.set(reference, value); },
    async read(reference: string) { return stored.get(reference) ?? null; },
    async delete(reference: string) { stored.delete(reference); },
  };
  const service = new IntegrationConnectionService(undefined, vault, async () => new Response("denied", { status: 401 }));
  await assert.rejects(() => service.connectJira({ schemaVersion: 1, siteUrl: "https://opefyre.atlassian.net", email: "opefyre@gmail.com", apiToken: "bad-token" }));
  assert.equal(stored.size, 0);
  assert.equal((await service.list()).connections.find((connection) => connection.provider === "jira")?.state, "not_connected");
  await assert.rejects(() => service.connectJira({ schemaVersion: 1, siteUrl: "https://localhost", email: "opefyre@gmail.com", apiToken: "secret-token" }));
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
  const result = await service.connectTelegram({ schemaVersion: 1, botToken: token, chatId: "-1001234567890" });
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
  await assert.rejects(() => service.connectTelegram({ schemaVersion: 1, botToken: "123456789:abcdefghijklmnopqrstuvwxyzABCDE_12345", chatId: "-1001234567890" }));
  assert.equal(stored.has("vault:providers/telegram/default"), false);
  await assert.rejects(() => service.connectTelegram({ schemaVersion: 1, botToken: "not-a-token", chatId: "all" }));
});
