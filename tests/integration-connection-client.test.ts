import assert from "node:assert/strict";
import test from "node:test";

import { connectJiraConnection, probeGitHubConnection } from "../apps/studio/src/integration-connection-client.js";

test("connection client uses loopback, no credentials, and idempotency", async () => {
  let observed: { url?: string; init?: RequestInit } = {};
  const result = await probeGitHubConnection({ endpoint: "http://127.0.0.1:4312", idempotencyKey: "github-probe:123456789", fetcher: async (url, init) => {
    observed = { url: String(url), ...(init ? { init } : {}) };
    return Response.json({ schemaVersion: 1, provenance: "local_observation", observedAt: 1, connections: [{ schemaVersion: 1, provider: "github", state: "ready", accountLabel: "owner", authMethod: "github_cli_oauth", observedAt: 1, resources: [], nextAction: "Choose repositories inside a project." }] });
  } });
  assert.equal(result.connections[0]?.state, "ready");
  assert.equal(observed.url, "http://127.0.0.1:4312/api/v1/integration-connections/github/probe");
  assert.equal(observed.init?.credentials, "omit");
  assert.equal((observed.init?.headers as Record<string,string>)["Idempotency-Key"], "github-probe:123456789");
  await assert.rejects(() => probeGitHubConnection({ endpoint: "https://example.com", idempotencyKey: "x", fetcher: fetch }));
});

test("Jira connection sends its credential only to the loopback control plane", async () => {
  let observed: { url?: string; init?: RequestInit } = {};
  await connectJiraConnection({ endpoint: "http://127.0.0.1:4312", siteUrl: "https://opefyre.atlassian.net", email: "opefyre@gmail.com", apiToken: "secret-token", idempotencyKey: "jira-connect:123456789", fetcher: async (url, init) => {
    observed = { url: String(url), ...(init ? { init } : {}) };
    return Response.json({ schemaVersion: 1, provenance: "local_observation", observedAt: 1, connections: [{ schemaVersion: 1, provider: "jira", state: "ready", accountLabel: "Opefyre", authMethod: "jira_api_token", observedAt: 1, resources: [], nextAction: "Choose a Jira project inside a project." }] });
  } });
  assert.equal(observed.url, "http://127.0.0.1:4312/api/v1/integration-connections/jira");
  assert.equal(observed.init?.credentials, "omit");
  assert.match(String(observed.init?.body), /secret-token/);
  await assert.rejects(() => connectJiraConnection({ endpoint: "https://example.com", siteUrl: "https://opefyre.atlassian.net", email: "opefyre@gmail.com", apiToken: "secret-token", idempotencyKey: "x", fetcher: fetch }));
});
