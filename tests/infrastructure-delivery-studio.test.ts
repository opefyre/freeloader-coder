import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

import {
  approveInfrastructurePreview,
  createInfrastructurePreview,
  executeInfrastructurePreview,
  getInfrastructureDeliveryStatus,
  rollbackInfrastructurePreview,
} from "../apps/studio/src/infrastructure-delivery-client.js";
import {
  approveInfrastructureMutation,
  createInfrastructureMutationPreview,
  infrastructureDesignSchema,
} from "../packages/orchestration/src/infrastructure-delivery.js";

const now = 1_800_000_000_000;
const projectId = "project_0123456789abcdef";
const design = infrastructureDesignSchema.parse({ schemaVersion: 1, projectId, requestId: "request_0123456789abcdef0123", contextDigest: "a".repeat(64), solutionDigest: "b".repeat(64), approvedSolutionDigest: "b".repeat(64), environments: [{ name: "preview", purpose: "Disposable owner-approved release.", promotionFrom: null }], topology: ["Static edge release."], services: [{ name: "web", purpose: "Serve preview.", runtime: "Edge runtime.", dependencies: [] }], resources: [{ provider: "Cloudflare", accountId: "account-test", projectOrTenantId: "codkesh-test", resourceId: "codkesh-preview", region: "global", kind: "pages", freeTierVerifiedAt: now, billingEnabled: false, promotionalCreditOnly: false, evidence: ["Free plan verified."] }], infrastructureAsCode: ["infra/wrangler.jsonc"], secrets: [{ purpose: "Deploy safely.", reference: "vault://projects/test/cloudflare-token", consumers: ["adapter"] }], networking: ["HTTPS edge."], dataAndBackups: ["No persistent data."], observability: ["Provider status and HTTPS marker."], deployment: ["Approved artifact only."], rollback: ["Delete exact deployment and verify absence."], runbook: ["Escalate failed rollback."], alternatives: [{ option: "Pages", decision: "Free reversible release.", citations: ["provider://cloudflare"] }], citations: ["local://DESIGN.md"] });
const preview = createInfrastructureMutationPreview({ projectId, requestId: design.requestId, designDigest: "c".repeat(64), provider: "Cloudflare", accountId: "account-test", projectOrTenantId: "codkesh-test", resourceId: "codkesh-preview", region: "global", action: "deploy", permissions: ["pages:write"], maximumCostUsd: 0, reversible: true, rollbackAction: "Delete exact deployment and verify absence.", idempotencyKey: "studio-infra-test-001", createdAt: now, expiresAt: now + 60_000 });
const approval = approveInfrastructureMutation(preview, now + 1, 30_000);
const receipt = { schemaVersion: 1 as const, previewId: preview.id, previewDigest: preview.digest, state: "verified" as const, providerOperationId: "deployment-123", endpoint: "https://deployment-123.codkesh-preview.pages.dev/", checks: [{ name: "provider deployment", passed: true, evidence: "Cloudflare reports success." }], observedAt: now + 2, rollbackEvidence: null, safeMessage: "The provider reports the release healthy." };

test("Studio infrastructure client keeps review, approval, execution, and evidence distinct", async () => {
  const calls: Array<{ url: string; method: string; key: string | null }> = [];
  const fetcher: typeof fetch = async (url, init) => {
    calls.push({ url: String(url), method: String(init?.method), key: new Headers(init?.headers).get("Idempotency-Key") });
    if (String(url).endsWith("/status")) return json({ schemaVersion: 1, design, operations: [{ preview, approval: null, receipt: null }] });
    if (String(url).includes("/previews")) return json(preview);
    if (String(url).includes("/approvals")) return json(approval);
    return json(String(url).includes("/rollbacks") ? { ...receipt, state: "rolled_back", rollbackEvidence: "Exact deployment absent." } : receipt);
  };
  const endpoint = "http://127.0.0.1:4310/";
  assert.equal((await getInfrastructureDeliveryStatus({ endpoint, projectId, fetcher })).operations.length, 1);
  await createInfrastructurePreview({ endpoint, projectId, body: { schemaVersion: 1 }, idempotencyKey: "preview-key", fetcher });
  await approveInfrastructurePreview({ endpoint, projectId, previewId: preview.id, idempotencyKey: "approval-key", fetcher });
  assert.equal((await executeInfrastructurePreview({ endpoint, projectId, previewId: preview.id, idempotencyKey: "execution-key", fetcher })).state, "verified");
  assert.equal((await rollbackInfrastructurePreview({ endpoint, projectId, previewId: preview.id, idempotencyKey: "rollback-key", fetcher })).state, "rolled_back");
  assert.deepEqual(calls.map((call) => call.method), ["GET", "POST", "POST", "POST", "POST"]);
  assert.deepEqual(calls.map((call) => call.key), [null, "preview-key", "approval-key", "execution-key", "rollback-key"]);
});

test("owner release UI presents exact authority, zero cost, rollback, and observed receipt without technical setup clutter", async () => {
  const source = await readFile(resolve("apps/studio/src/components/projects/infrastructure-delivery-panel.tsx"), "utf8");
  for (const copy of ["Review deployment", "$0.00", "Automatic rollback", "Permission", "Expected result", "Approve and deploy", "Retry deployment", "Release verified", "Open verified release", "Remove disposable release", "Roll back release"]) assert.match(source, new RegExp(copy.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.doesNotMatch(source, /API key|command line|terminal|curl/i);
});

test("infrastructure client rejects remote endpoints and malformed evidence", async () => {
  await assert.rejects(() => getInfrastructureDeliveryStatus({ endpoint: "https://example.com/", projectId, fetcher: async () => json({}) }), /loopback-only/);
  await assert.rejects(() => getInfrastructureDeliveryStatus({ endpoint: "http://127.0.0.1:4310/", projectId, fetcher: async () => json({ schemaVersion: 1, design, operations: [{ preview, approval: null, receipt: { ...receipt, endpoint: "javascript:alert(1)" } }] }) }));
});

function json(value: unknown): Response { return new Response(JSON.stringify(value), { status: 200, headers: { "Content-Type": "application/json" } }); }
