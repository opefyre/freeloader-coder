import assert from "node:assert/strict";
import test from "node:test";

import { approveInfrastructureMutation, createInfrastructureMutationPreview, digestInfrastructureDesign, executeInfrastructureMutation, infrastructureDesignSchema, renderInfrastructureDocuments, type InfrastructureAdapter, type InfrastructureDesign } from "../packages/orchestration/src/infrastructure-delivery.js";

const now = 1_800_000_000_000;
const design: InfrastructureDesign = infrastructureDesignSchema.parse({
  schemaVersion: 1, projectId: "project_0123456789abcdef", requestId: "request_0123456789abcdef0123", contextDigest: "a".repeat(64), solutionDigest: "b".repeat(64), approvedSolutionDigest: "b".repeat(64),
  environments: [{ name: "preview", purpose: "Disposable owner-approved release verification environment.", promotionFrom: null }],
  topology: ["A static edge service serves the owner-approved build."], services: [{ name: "web", purpose: "Serve the disposable product preview.", runtime: "Provider-managed edge runtime.", dependencies: [] }],
  resources: [{ provider: "Cloudflare", accountId: "account-test", projectOrTenantId: "codkesh-test", resourceId: "disposable-preview", region: "global", kind: "pages", freeTierVerifiedAt: now, billingEnabled: false, promotionalCreditOnly: false, evidence: ["Provider account reports a zero-cost free plan."] }],
  infrastructureAsCode: ["infra/wrangler.jsonc is the reviewed source of resource configuration."], secrets: [{ purpose: "Authenticate the bounded deployment adapter.", reference: "vault://projects/test/cloudflare-token", consumers: ["deployment-adapter"] }],
  networking: ["Public HTTPS terminates at the provider edge."], dataAndBackups: ["This static disposable environment has no persistent data."], observability: ["Verify HTTPS status and immutable release identifier after deployment."], deployment: ["Build, deploy the exact approved artifact, then run provider and endpoint checks."], rollback: ["Delete the disposable deployment and verify the endpoint no longer resolves."], runbook: ["Stop and request owner help when rollback cannot be verified."],
  alternatives: [{ option: "Cloudflare Pages", decision: "Chosen because the verified account has billing disabled and supports the disposable static preview.", citations: ["provider://cloudflare/account-plan"] }], citations: ["local://CONTEXT.md", "local://DESIGN.md", "provider://cloudflare/account-plan"],
});

function preview(designDigest = digestInfrastructureDesign(design)) { return createInfrastructureMutationPreview({ projectId: design.projectId, requestId: design.requestId, designDigest, provider: "Cloudflare", accountId: "account-test", projectOrTenantId: "codkesh-test", resourceId: "disposable-preview", region: "global", action: "deploy", permissions: ["pages:write"], maximumCostUsd: 0, reversible: true, rollbackAction: "Delete the exact deployment identifier and verify absence.", idempotencyKey: "deploy-disposable-preview-v1", createdAt: now, expiresAt: now + 60_000 }); }

test("approved infrastructure design renders complete digest-bound INFRA and OPS rules", () => {
  const rendered = renderInfrastructureDocuments(design);
  for (const heading of ["Environments and topology", "Services, data, and networking", "Infrastructure as code and verified resources", "Secrets", "Deployment, observability, and rollback", "Alternatives and sources"]) assert.match(rendered.infra, new RegExp(heading));
  assert.match(rendered.opsRules, /does not authorize a cloud mutation/);
  assert.match(rendered.opsRules, /Credentials are resolved from vault references/);
  assert.ok(rendered.infra.includes(rendered.designDigest));
  assert.doesNotMatch(rendered.infra, /actual-secret-value/);
});

test("paid, billing-enabled, promotional-credit, secret-bearing, and unapproved designs fail closed", () => {
  assert.throws(() => infrastructureDesignSchema.parse({ ...design, approvedSolutionDigest: "c".repeat(64) }), /exact approved solution/);
  assert.throws(() => infrastructureDesignSchema.parse({ ...design, resources: [{ ...design.resources[0], billingEnabled: true }] }), /zero-cost/);
  assert.throws(() => infrastructureDesignSchema.parse({ ...design, resources: [{ ...design.resources[0], promotionalCreditOnly: true }] }), /zero-cost/);
  assert.throws(() => infrastructureDesignSchema.parse({ ...design, secrets: [{ purpose: "Bad embedded secret.", reference: "secret-value", consumers: ["web"] }] }));
});

test("preview exposes exact target, permissions, cost, reversal, expiry, and immutable approval digest", async () => {
  const planned = preview();
  assert.equal(planned.maximumCostUsd, 0); assert.equal(planned.resourceId, "disposable-preview"); assert.deepEqual(planned.permissions, ["pages:write"]);
  const approval = approveInfrastructureMutation(planned, now + 1, 30_000);
  const changed = { ...planned, resourceId: "other-target" };
  await assert.rejects(() => executeInfrastructureMutation({ preview: changed, approval, design, adapter: adapter(), now: now + 2 }), /integrity/);
  await assert.rejects(() => executeInfrastructureMutation({ preview: planned, approval, design: { ...design, topology: ["Changed after approval."] }, adapter: adapter(), now: now + 2 }), /target changed/);
  await assert.rejects(() => executeInfrastructureMutation({ preview: planned, approval, design, adapter: adapter(), now: now + 60_001 }), /expired/);
});

test("disposable free-tier deployment is applied, provider-verified, observed, idempotent, and rollback-capable", async () => {
  let applies = 0;
  const good = adapter({ apply: async () => { applies += 1; return { providerOperationId: "operation-123", endpoint: "https://preview.example.test", evidence: ["Provider accepted immutable artifact."] }; } });
  const planned = preview(); const approval = approveInfrastructureMutation(planned, now + 1, 30_000);
  const receipt = await executeInfrastructureMutation({ preview: planned, approval, design, adapter: good, now: now + 2 });
  assert.equal(receipt.state, "verified"); assert.equal(receipt.endpoint, "https://preview.example.test"); assert.ok(receipt.checks.every((check) => check.passed));
  const replay = await executeInfrastructureMutation({ preview: planned, approval, design, adapter: good, now: now + 3, completed: new Map([[planned.idempotencyKey, receipt]]) });
  assert.deepEqual(replay, receipt); assert.equal(applies, 1);
});

test("failed verification and partial deployment trigger bounded rollback or exact owner escalation", async () => {
  const planned = preview(); const approval = approveInfrastructureMutation(planned, now + 1, 30_000);
  const unhealthy = adapter({ verify: async () => [{ name: "smoke", passed: false, evidence: "Endpoint returned 503." }] });
  const rolledBack = await executeInfrastructureMutation({ preview: planned, approval, design, adapter: unhealthy, now: now + 2 });
  assert.equal(rolledBack.state, "rolled_back"); assert.match(rolledBack.rollbackEvidence ?? "", /deleted/);
  const brokenRollback = adapter({ verify: async () => { throw new Error("health failed token=do-not-leak"); }, rollback: async () => { throw new Error("provider rollback unavailable secret=do-not-leak"); } });
  const needsUser = await executeInfrastructureMutation({ preview: planned, approval, design, adapter: brokenRollback, now: now + 2 });
  assert.equal(needsUser.state, "needs_user"); assert.match(needsUser.safeMessage, /owner attention/); assert.doesNotMatch(JSON.stringify(needsUser), /do-not-leak/);
});

function adapter(overrides: Partial<InfrastructureAdapter> = {}): InfrastructureAdapter {
  return {
    apply: async () => ({ providerOperationId: "operation-123", endpoint: "https://preview.example.test", evidence: ["Provider accepted immutable artifact."] }),
    verify: async () => [{ name: "provider", passed: true, evidence: "Provider reports deployment active." }, { name: "smoke", passed: true, evidence: "HTTPS endpoint returned the release marker." }, { name: "security", passed: true, evidence: "No credential material was present in the response." }, { name: "observability", passed: true, evidence: "Health telemetry was observed." }],
    rollback: async () => "Provider reports the exact disposable deployment deleted.", ...overrides,
  };
}
