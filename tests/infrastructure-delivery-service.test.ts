import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { InfrastructureDeliveryService } from "../apps/core/src/infrastructure-delivery-service.js";
import { infrastructureDesignSchema, type InfrastructureAdapter } from "../packages/orchestration/src/infrastructure-delivery.js";

const projectId = "project_0123456789abcdef"; const requestId = "request_0123456789abcdef0123"; const now = 1_800_000_000_000;
const design = infrastructureDesignSchema.parse({ schemaVersion: 1, projectId, requestId, contextDigest: "a".repeat(64), solutionDigest: "b".repeat(64), approvedSolutionDigest: "b".repeat(64), environments: [{ name: "preview", purpose: "Disposable release proof environment.", promotionFrom: null }], topology: ["Static edge deployment."], services: [{ name: "web", purpose: "Serve preview.", runtime: "Edge runtime.", dependencies: [] }], resources: [{ provider: "Cloudflare", accountId: "account-test", projectOrTenantId: "codkesh-test", resourceId: "preview", region: "global", kind: "pages", freeTierVerifiedAt: now, billingEnabled: false, promotionalCreditOnly: false, evidence: ["Verified free account."] }], infrastructureAsCode: ["infra/wrangler.jsonc"], secrets: [{ purpose: "Deploy safely.", reference: "vault://projects/test/cloudflare-token", consumers: ["adapter"] }], networking: ["HTTPS edge."], dataAndBackups: ["No data."], observability: ["Status and marker."], deployment: ["Approved artifact only."], rollback: ["Delete exact deployment."], runbook: ["Escalate failed rollback."], alternatives: [{ option: "Pages", decision: "Verified reversible free target.", citations: ["provider://cloudflare"] }], citations: ["local://DESIGN.md"] });
const previewInput = { schemaVersion: 1 as const, requestId, provider: "Cloudflare", accountId: "account-test", projectOrTenantId: "codkesh-test", resourceId: "preview", region: "global", action: "deploy" as const, permissions: ["pages:write"], maximumCostUsd: 0 as const, reversible: true, rollbackAction: "Delete exact deployment and verify absence." };

test("durable infrastructure service keeps design, approval, execution, receipt, and replay separated", async () => {
  const root = await mkdtemp(join(tmpdir(), "codkesh-infra-")); let applies = 0;
  const adapter: InfrastructureAdapter = { apply: async () => { applies++; return { providerOperationId: "operation-123", endpoint: "https://preview.example.test", evidence: ["Applied."] }; }, verify: async () => [{ name: "provider", passed: true, evidence: "Provider active." }], rollback: async () => "Deleted." };
  const service = new InfrastructureDeliveryService(root, new Map([["Cloudflare", adapter]]), () => now);
  await service.publishDesign(projectId, design, "design-publish-001"); assert.equal(applies, 0);
  const preview = await service.preview(projectId, previewInput, "infra-preview-001"); assert.equal(applies, 0);
  await service.approve(projectId, preview.id, "infra-approval-001"); assert.equal(applies, 0);
  const receipt = await service.execute(projectId, preview.id, "infra-execution-001"); assert.equal(receipt.state, "verified"); assert.equal(applies, 1);
  const status = await service.status(projectId); assert.equal(status.operations.length, 1); assert.deepEqual(status.operations[0], { preview, approval: await service.approve(projectId, preview.id, "infra-approval-001"), receipt });
  const replay = await service.execute(projectId, preview.id, "infra-execution-001"); assert.deepEqual(replay, receipt); assert.equal(applies, 1);
  const restarted = new InfrastructureDeliveryService(root, new Map([["Cloudflare", adapter]]), () => now); assert.deepEqual(await restarted.receipt(projectId, preview.id), receipt); assert.deepEqual(await restarted.getDesign(projectId), design);
});

test("service rejects targets outside approved inventory and execution without approval or adapter", async () => {
  const root = await mkdtemp(join(tmpdir(), "codkesh-infra-")); const service = new InfrastructureDeliveryService(root, new Map(), () => now);
  await service.publishDesign(projectId, design, "design-publish-002");
  await assert.rejects(() => service.preview(projectId, { ...previewInput, resourceId: "unapproved" }, "infra-preview-bad"), /approved design inventory/);
  const preview = await service.preview(projectId, previewInput, "infra-preview-002"); await assert.rejects(() => service.execute(projectId, preview.id, "infra-execution-002"), /owner approval/);
  await service.approve(projectId, preview.id, "infra-approval-002"); await assert.rejects(() => service.execute(projectId, preview.id, "infra-execution-003"), /not available/);
});
