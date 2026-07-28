import assert from "node:assert/strict";
import test from "node:test";
import {
  createDefaultCostPolicy,
  evaluatePaidUse,
  type CostPolicy,
  type PaidUseGrant
} from "../packages/policy/src/index.js";
import {
  routeProviders,
  type ProviderCandidate,
  type RouteRequest
} from "../packages/providers/src/router.js";
import {
  costPolicySchema,
  paidUseGrantSchema
} from "../packages/schemas/src/index.js";

const now = 1_800_000_000_000;
const confirmationDigest = "a".repeat(64);
const usage = {
  requestsToday: 0,
  tokensToday: 0,
  inputTokensToday: 0,
  outputTokensToday: 0,
  requestTimestamps: [],
  tokenSamples: []
};
const freeCandidate: ProviderCandidate = {
  id: "gemini-free",
  providerId: "gemini",
  modelId: "gemini-flash",
  priority: 1,
  configured: true,
  privacy: "training_eligible",
  location: "external",
  paid: false,
  costClass: "free",
  billingMode: "free_tier",
  providerConnectionId: "connection-gemini",
  projectId: "project-free",
  roles: ["implementer"],
  kinds: ["code"],
  dataClasses: ["source_code"],
  contextWindowTokens: 1_000_000,
  maxOutputTokens: 8_000,
  capacity: { unit: "provider_reported" },
  usage,
  circuitOpenUntil: 0
};
const request: RouteRequest = {
  role: "implementer",
  kind: "code",
  dataClass: "source_code",
  minimumPrivacy: "training_eligible",
  estimatedInputTokens: 4_000,
  requestedOutputTokens: 1_000,
  allowPaid: false,
  now
};

test("every default cost policy is free-only and cannot produce a paid route", () => {
  const policy = createDefaultCostPolicy();
  assert.deepEqual(policy, {
    schemaVersion: 1,
    mode: "free_only",
    paidUseGrants: []
  });
  const paid = {
    ...freeCandidate,
    id: "paid",
    paid: true,
    costClass: "paid" as const,
    billingMode: "billing_enabled" as const,
    estimatedCostMinor: 1
  };
  const result = routeProviders([paid], { ...request, allowPaid: true });
  assert.equal(result.selected, null);
  assert.equal(result.rejected[0]?.reason, "paid-disabled");
});

test("free-only rejects unknown-cost models and billing-enabled Gemini projects", () => {
  const unknown = routeProviders([{
    ...freeCandidate,
    id: "unknown",
    costClass: "unknown"
  }], request);
  assert.equal(unknown.rejected[0]?.reason, "unknown-cost");

  const billingEnabled = routeProviders([{
    ...freeCandidate,
    id: "billing-enabled",
    billingMode: "billing_enabled"
  }], request);
  assert.equal(billingEnabled.rejected[0]?.reason, "billing-enabled-project");
});

test("a boolean cannot enable paid use without exact connection, route, budget, and confirmation", () => {
  const paid = {
    ...freeCandidate,
    id: "paid",
    paid: true,
    costClass: "paid" as const,
    billingMode: "billing_enabled" as const,
    projectId: "project-paid",
    estimatedCostMinor: 25
  };
  const withoutGrant = routeProviders([paid], {
    ...request,
    allowPaid: true,
    costPolicy: { schemaVersion: 1, mode: "paid_authorized", paidUseGrants: [] }
  });
  assert.equal(withoutGrant.rejected[0]?.reason, "paid-authorization-missing");

  const grant = paidGrant();
  const mismatch = routeProviders([paid], {
    ...request,
    allowPaid: true,
    costPolicy: {
      schemaVersion: 1,
      mode: "paid_authorized",
      paidUseGrants: [{ ...grant, modelId: "different-model" }]
    }
  });
  assert.equal(mismatch.rejected[0]?.reason, "paid-authorization-mismatch");

  const authorized = routeProviders([paid], {
    ...request,
    allowPaid: true,
    paidConfirmationDigest: grant.finalConfirmationDigest,
    costPolicy: {
      schemaVersion: 1,
      mode: "paid_authorized",
      paidUseGrants: [grant]
    }
  });
  assert.equal(authorized.selected?.id, "paid");
});

test("exact paid authorization is time bounded and hard-budgeted", () => {
  const grant = paidGrant();
  const policy: CostPolicy = {
    schemaVersion: 1,
    mode: "paid_authorized",
    paidUseGrants: [grant]
  };
  assert.deepEqual(
    evaluatePaidUse(policy, {
      providerConnectionId: grant.providerConnectionId,
      providerId: grant.providerId,
      modelId: grant.modelId,
      projectId: grant.projectId,
      estimatedCostMinor: 25,
      finalConfirmationDigest: grant.finalConfirmationDigest
    }, now),
    { allowed: true, authorizationId: grant.authorizationId, remainingMinor: 25 }
  );
  assert.equal(evaluatePaidUse(policy, {
    providerConnectionId: grant.providerConnectionId,
    providerId: grant.providerId,
    modelId: grant.modelId,
    projectId: grant.projectId,
    estimatedCostMinor: 51,
    finalConfirmationDigest: grant.finalConfirmationDigest
  }, now).allowed, false);
  assert.equal(evaluatePaidUse(policy, {
    providerConnectionId: grant.providerConnectionId,
    providerId: grant.providerId,
    modelId: grant.modelId,
    projectId: grant.projectId,
    estimatedCostMinor: 1,
    finalConfirmationDigest: grant.finalConfirmationDigest
  }, grant.expiresAt).allowed, false);
  assert.deepEqual(evaluatePaidUse(policy, {
    providerConnectionId: grant.providerConnectionId,
    providerId: grant.providerId,
    modelId: grant.modelId,
    projectId: grant.projectId,
    estimatedCostMinor: 1,
    finalConfirmationDigest: "b".repeat(64)
  }, now), {
    allowed: false,
    reason: "confirmation-invalid",
    detail: "The final paid-use confirmation is missing, invalid, or belongs to a different route."
  });
});

test("cost schemas reject silent grants, unknown fields, invalid confirmation, and overspend", () => {
  const grant = paidGrant();
  assert.equal(paidUseGrantSchema.safeParse(grant).success, true);
  assert.equal(paidUseGrantSchema.safeParse({ ...grant, hidden: true }).success, false);
  assert.equal(paidUseGrantSchema.safeParse({
    ...grant,
    finalConfirmationDigest: "not-confirmed"
  }).success, false);
  assert.equal(paidUseGrantSchema.safeParse({
    ...grant,
    spentMinor: grant.maximumSpendMinor + 1
  }).success, false);
  assert.equal(costPolicySchema.safeParse({
    schemaVersion: 1,
    mode: "free_only",
    paidUseGrants: [grant]
  }).success, false);
});

function paidGrant(): PaidUseGrant {
  return {
    schemaVersion: 1,
    authorizationId: "paid-auth-1",
    providerConnectionId: "connection-gemini",
    providerId: "gemini",
    modelId: "gemini-flash",
    projectId: "project-paid",
    currency: "USD",
    maximumSpendMinor: 100,
    spentMinor: 50,
    connectionApproved: true,
    routeApproved: true,
    finalConfirmationDigest: confirmationDigest,
    approvedAt: now - 1_000,
    expiresAt: now + 60_000,
    revokedAt: null
  };
}
