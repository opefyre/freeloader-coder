import assert from "node:assert/strict";
import test from "node:test";

import { CloudflarePagesInfrastructureAdapter } from "../apps/core/src/cloudflare-pages-infrastructure-adapter.js";
import { createInfrastructureMutationPreview } from "../packages/orchestration/src/infrastructure-delivery.js";

const now = 1_800_000_000_000;
const token = "test-cloudflare-secret-that-must-not-leak";
const preview = createInfrastructureMutationPreview({
  projectId: "project_0123456789abcdef",
  requestId: "request_0123456789abcdef0123",
  designDigest: "a".repeat(64),
  provider: "Cloudflare",
  accountId: "account-test",
  projectOrTenantId: "codkesh-test",
  resourceId: "codkesh-preview",
  region: "global",
  action: "deploy",
  permissions: ["pages:write"],
  maximumCostUsd: 0,
  reversible: true,
  rollbackAction: "Delete the exact deployment and verify absence.",
  idempotencyKey: "cloudflare-pages-test-001",
  createdAt: now,
  expiresAt: now + 60_000,
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

test("Cloudflare adapter applies, observes, smoke-checks, and rolls back the exact approved Pages deployment", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const responses = [
    json({ success: true, result: { name: "codkesh-preview" } }),
    json({ success: true, result: { id: "deployment-123", url: "https://deployment-123.codkesh-preview.pages.dev" } }),
    json({ success: true, result: { id: "deployment-123", latest_stage: { status: "active" } } }),
    json({ success: true, result: { id: "deployment-123", latest_stage: { status: "success" } } }),
    new Response("ok", { status: 200 }),
    json({ success: true, result: null }),
    json({ success: false, errors: [{ message: "not found" }] }, 404),
  ];
  const fetcher: typeof fetch = async (url, init) => {
    calls.push(init ? { url: String(url), init } : { url: String(url) });
    const response = responses.shift();
    assert.ok(response, "unexpected request");
    return response;
  };
  const adapter = new CloudflarePagesInfrastructureAdapter(
    { read: async () => JSON.stringify({ secret: token }) },
    { fetcher, sleep: async () => undefined, pollAttempts: 3, pollIntervalMs: 0 }
  );

  const applied = await adapter.apply(preview);
  assert.equal(applied.providerOperationId, "deployment-123");
  assert.equal(applied.endpoint, "https://deployment-123.codkesh-preview.pages.dev/");
  const checks = await adapter.verify(preview, applied);
  assert.deepEqual(checks.map((check) => check.passed), [true, true]);
  const rollback = await adapter.rollback(preview, applied);
  assert.match(rollback, /confirmed deployment deployment-123 is absent/);
  assert.deepEqual(calls.map((call) => call.init?.method), ["GET", "POST", "GET", "GET", "GET", "DELETE", "GET"]);
  assert.ok(calls.every((call, index) => index === 4 || new Headers(call.init?.headers).get("Authorization") === `Bearer ${token}`));
  assert.ok(calls[1]!.url.endsWith("/accounts/account-test/pages/projects/codkesh-preview/deployments"));
  assert.ok(calls[5]!.url.endsWith("/deployments/deployment-123"));
  assert.ok(!JSON.stringify({ applied, checks, rollback }).includes(token));
});

test("Cloudflare adapter fails closed before mutation for missing credentials or changed authority", async () => {
  let fetches = 0;
  const fetcher: typeof fetch = async () => { fetches += 1; return json({ success: true }); };
  const missing = new CloudflarePagesInfrastructureAdapter({ read: async () => null }, { fetcher });
  await assert.rejects(() => missing.apply(preview), /not connected/);
  const connected = new CloudflarePagesInfrastructureAdapter({ read: async () => JSON.stringify({ secret: token }) }, { fetcher });
  await assert.rejects(() => connected.apply({ ...preview, provider: "Other" }), /only accepts Cloudflare/);
  await assert.rejects(() => connected.apply({ ...preview, action: "delete" }), /deploy or disposable-create/);
  await assert.rejects(() => connected.apply({ ...preview, permissions: ["pages:read"] }), /pages:write/);
  assert.equal(fetches, 0);
});

test("Cloudflare adapter returns safe failed verification evidence for provider failure and timeout", async () => {
  for (const response of [
    json({ success: true, result: { id: "deployment-123", latest_stage: { status: "failure" } } }),
    json({ success: true, result: { id: "deployment-123", latest_stage: { status: "active" } } }),
  ]) {
    const adapter = new CloudflarePagesInfrastructureAdapter(
      { read: async () => JSON.stringify({ secret: token }) },
      { fetcher: async () => response.clone(), sleep: async () => undefined, pollAttempts: 1 }
    );
    const checks = await adapter.verify(preview, { providerOperationId: "deployment-123", endpoint: "https://deployment-123.codkesh-preview.pages.dev" });
    assert.equal(checks.length, 1);
    assert.equal(checks[0]?.passed, false);
    assert.ok(!JSON.stringify(checks).includes(token));
  }
});

test("Cloudflare adapter tolerates bounded HTTPS propagation delay before declaring the release healthy", async () => {
  const responses = [
    json({ success: true, result: { id: "deployment-123", latest_stage: { status: "success" } } }),
    new Response("not ready", { status: 404 }),
    new Response("ok", { status: 200 }),
  ];
  let sleeps = 0;
  const adapter = new CloudflarePagesInfrastructureAdapter(
    { read: async () => JSON.stringify({ secret: token }) },
    { fetcher: async () => { const response = responses.shift(); assert.ok(response); return response; }, sleep: async () => { sleeps += 1; }, pollAttempts: 1, pollIntervalMs: 0, smokeAttempts: 3 }
  );
  const checks = await adapter.verify(preview, { providerOperationId: "deployment-123", endpoint: "https://deployment-123.codkesh-preview.pages.dev" });
  assert.deepEqual(checks.map((check) => check.passed), [true, true]);
  assert.equal(sleeps, 1);
});

test("Cloudflare adapter never exposes a credential through provider errors", async () => {
  const adapter = new CloudflarePagesInfrastructureAdapter(
    { read: async () => JSON.stringify({ secret: token }) },
    { fetcher: async () => json({ success: false, errors: [{ message: `bad ${token}` }] }, 403) }
  );
  let message = "";
  try { await adapter.apply(preview); } catch (error) { message = error instanceof Error ? error.message : String(error); }
  assert.match(message, /HTTP 403/);
  assert.ok(!message.includes(token));
});

test("Cloudflare adapter creates, deploys, verifies, and removes an isolated disposable Pages project", async () => {
  const disposable = createInfrastructureMutationPreview({ ...withoutGenerated(preview), action: "create", idempotencyKey: "cloudflare-disposable-test-001" });
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const responses = [
    json({ success: false, errors: [{ message: "not found" }] }, 404),
    json({ success: true, result: { name: "codkesh-preview" } }),
    json({ success: true, result: { id: "deployment-disposable", url: "https://deployment-disposable.codkesh-preview.pages.dev" } }),
    json({ success: true, result: { id: "deployment-disposable", latest_stage: { status: "success" } } }),
    new Response("ok", { status: 200 }),
    json({ success: true, result: null }),
    json({ success: false }, 404),
  ];
  const adapter = new CloudflarePagesInfrastructureAdapter({ read: async () => JSON.stringify({ secret: token }) }, { fetcher: async (url, init) => { calls.push(init ? { url: String(url), init } : { url: String(url) }); const response = responses.shift(); assert.ok(response); return response; }, sleep: async () => undefined, pollAttempts: 1 });
  const applied = await adapter.apply(disposable);
  assert.equal((await adapter.verify(disposable, applied)).every((check) => check.passed), true);
  assert.match(await adapter.rollback(disposable, applied), /disposable project codkesh-preview is absent/);
  assert.deepEqual(calls.map((call) => call.init?.method), ["GET", "POST", "POST", "GET", "GET", "DELETE", "GET"]);
  const projectCreate = JSON.parse(String(calls[1]?.init?.body)) as { name: string; production_branch: string };
  assert.deepEqual(projectCreate, { name: "codkesh-preview", production_branch: "main" });
  const deploymentBody = calls[2]?.init?.body; assert.ok(deploymentBody instanceof FormData); assert.equal(deploymentBody.get("manifest"), "{}"); assert.ok(deploymentBody.get("_worker.js") instanceof Blob);
  assert.ok(calls[5]?.url.endsWith("/pages/projects/codkesh-preview"));
});

test("failed disposable upload compensates by deleting the newly created project", async () => {
  const disposable = createInfrastructureMutationPreview({ ...withoutGenerated(preview), action: "create", idempotencyKey: "cloudflare-disposable-test-002" });
  const calls: string[] = [];
  const responses = [json({ success: false }, 404), json({ success: true, result: {} }), json({ success: false }, 500), json({ success: true, result: null }), json({ success: false }, 404)];
  const adapter = new CloudflarePagesInfrastructureAdapter({ read: async () => JSON.stringify({ secret: token }) }, { fetcher: async (url) => { calls.push(String(url)); const response = responses.shift(); assert.ok(response); return response; } });
  await assert.rejects(() => adapter.apply(disposable), /HTTP 500/);
  assert.equal(calls.length, 5);
  assert.ok(calls[3]?.endsWith("/pages/projects/codkesh-preview"));
});

function withoutGenerated(value: typeof preview) {
  const { schemaVersion: ignoredSchema, id: ignoredId, digest: ignoredDigest, ...input } = value;
  void ignoredSchema; void ignoredId; void ignoredDigest;
  return input;
}
