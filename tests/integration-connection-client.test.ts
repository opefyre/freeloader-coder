import assert from "node:assert/strict";
import test from "node:test";

import { beginIntegrationOAuth, configureIntegrationOAuth, probeGitHubConnection, probeJiraConnection } from "../apps/studio/src/integration-connection-client.js";

test("connection client uses loopback, no credentials, and idempotency", async () => {
  let observed: { url?: string; init?: RequestInit } = {};
  const result = await probeGitHubConnection({ endpoint: "http://127.0.0.1:4312", idempotencyKey: "github-probe:123456789", fetcher: async (url, init) => {
    observed = { url: String(url), ...(init ? { init } : {}) };
    return Response.json({ schemaVersion: 1, provenance: "local_observation", observedAt: 1, connections: [{ schemaVersion: 1, provider: "github", state: "ready", accountLabel: "owner", authMethod: "github_device_oauth", observedAt: 1, resources: [], nextAction: "Choose repositories inside a project." }] });
  } });
  assert.equal(result.connections[0]?.state, "ready");
  assert.equal(observed.url, "http://127.0.0.1:4312/api/v1/integration-connections/github/probe");
  assert.equal(observed.init?.credentials, "omit");
  assert.equal((observed.init?.headers as Record<string,string>)["Idempotency-Key"], "github-probe:123456789");
  await assert.rejects(() => probeGitHubConnection({ endpoint: "https://example.com", idempotencyKey: "x", fetcher: fetch }));
});

test("Jira connection refresh uses the authenticated loopback control plane", async () => {
  let observed: { url?: string; init?: RequestInit } = {};
  const result = await probeJiraConnection({ endpoint: "http://127.0.0.1:4312", idempotencyKey: "jira-probe:123456789", fetcher: async (url, init) => {
    observed = { url: String(url), ...(init ? { init } : {}) };
    return Response.json({ schemaVersion: 1, provenance: "local_observation", observedAt: 1, connections: [{ schemaVersion: 1, provider: "jira", state: "ready", accountLabel: "owner", authMethod: "jira_oauth_3lo", observedAt: 1, resources: [{ id: "10200", kind: "jira_project", label: "CKPILOT · Codkesh Pilot — Disposable", detail: "CKPILOT", url: "https://opefyre.atlassian.net/browse/CKPILOT" }], nextAction: "Choose a Jira project inside a project." }] });
  } });
  assert.equal(result.connections[0]?.resources[0]?.detail, "CKPILOT");
  assert.equal(observed.url, "http://127.0.0.1:4312/api/v1/integration-connections/jira/probe");
  assert.equal((observed.init?.headers as Record<string,string>)["Idempotency-Key"], "jira-probe:123456789");
});

test("Jira OAuth setup sends app configuration only to the loopback control plane", async () => {
  let observed: { url?: string; init?: RequestInit } = {};
  await configureIntegrationOAuth({ endpoint: "http://127.0.0.1:4312", provider: "jira", clientId: "jira-client-id", clientSecret: "secret-value", idempotencyKey: "jira-oauth:123456789", fetcher: async (url, init) => {
    observed = { url: String(url), ...(init ? { init } : {}) };
    return Response.json({ schemaVersion: 1, provenance: "local_observation", observedAt: 1, connections: [{ schemaVersion: 1, provider: "jira", state: "not_connected", accountLabel: null, authMethod: "jira_oauth_3lo", observedAt: 1, resources: [], nextAction: "Connect Jira." }] });
  } });
  assert.equal(observed.url, "http://127.0.0.1:4312/api/v1/integration-connections/oauth/configure");
  assert.equal(observed.init?.credentials, "omit");
  assert.match(String(observed.init?.body), /secret-value/);
  await assert.rejects(() => beginIntegrationOAuth({ endpoint: "https://example.com", provider: "jira", idempotencyKey: "x", fetcher: fetch }));
});
