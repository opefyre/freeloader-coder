import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyLocalizedProviderError,
  createExpandedProviderCandidate,
  evaluateExpandedAdmission,
  providerAccountEvidenceSchema,
  type ExpandedProviderId,
  type ProviderAccountEvidence
} from "../packages/providers/src/expanded-mesh.js";
import { catalogProvider } from "../packages/providers/src/catalog.js";
import { routeProviders, type ProviderCapacityUsage } from "../packages/providers/src/router.js";
import type {
  ProviderCanaryEvidence,
  ProviderQuotaEvidence
} from "../packages/schemas/src/index.js";

const now = 1_800_000_000_000;
const usage: ProviderCapacityUsage = {
  requestsToday: 0,
  tokensToday: 0,
  inputTokensToday: 0,
  outputTokensToday: 0,
  requestTimestamps: [],
  tokenSamples: []
};

const modelIds: Record<ExpandedProviderId, string> = {
  cerebras: "gpt-oss-120b",
  mistral: "mistral-small-latest",
  zhipu: "glm-4.7-flash",
  sambanova: "DeepSeek-V3.1",
  deepseek: "deepseek-v4-flash"
};

function account(
  providerId: ExpandedProviderId,
  overrides: Partial<ProviderAccountEvidence> = {}
): ProviderAccountEvidence {
  const planMode = providerId === "mistral"
    ? "experiment"
    : providerId === "deepseek"
      ? "promotional_credit"
      : "free";
  return providerAccountEvidenceSchema.parse({
    schemaVersion: 1,
    providerId,
    planMode,
    billingEnabled: false,
    paymentMethodPresent: providerId === "sambanova" ? false : null,
    regionStatus: "allowed",
    explicitFreeModel: providerId !== "deepseek",
    resolvedModelId: modelIds[providerId],
    grantedBalanceMicros: providerId === "deepseek" ? 2_000_000 : null,
    toppedUpBalanceMicros: providerId === "deepseek" ? 5_000_000 : null,
    balanceCompositionKnown: providerId === "deepseek",
    fundSeparationProven: providerId === "deepseek",
    promotionalModeEnabled: providerId === "deepseek",
    promotionExpiresAt: providerId === "deepseek" ? now + 86_400_000 : null,
    observedAt: now - 1_000,
    expiresAt: now + 3_600_000,
    source: "account_api",
    ...overrides
  });
}

function canary(
  providerId: ExpandedProviderId,
  capabilities: ProviderCanaryEvidence["capabilities"] = ["chat", "structured_output"]
): ProviderCanaryEvidence {
  return {
    status: "passed",
    observedAt: now - 1_000,
    expiresAt: now + 86_400_000,
    modelId: modelIds[providerId],
    capabilities,
    inputTokens: 12,
    outputTokens: 4,
    failureCode: null
  };
}

function quota(overrides: Partial<ProviderQuotaEvidence> = {}): ProviderQuotaEvidence {
  return {
    source: "account_api",
    observedAt: now - 1_000,
    expiresAt: now + 900_000,
    requestsPerMinute: 5,
    requestsPerDay: 100,
    tokensPerMinute: 30_000,
    tokensPerDay: 1_000_000,
    remainingRequests: 99,
    remainingTokens: 999_000,
    resetAt: now + 60_000,
    ...overrides
  };
}

test("catalogue classifies permanent capacity and promotional credit honestly", () => {
  for (const providerId of ["cerebras", "mistral", "zhipu", "sambanova"] as const) {
    assert.equal(catalogProvider(providerId).zeroCostEligible, true);
  }
  const deepseek = catalogProvider("deepseek");
  assert.equal(deepseek.zeroCostEligible, false);
  assert.equal(deepseek.freeAccess, "promotional_credit");
});

test("Cerebras requires live account limits and complete canary evidence", () => {
  const ready = evaluateExpandedAdmission({
    evidence: account("cerebras"),
    canary: canary("cerebras"),
    quota: quota(),
    requiredCapabilities: ["chat", "structured_output"],
    now
  });
  assert.equal(ready.admitted, true);
  const defaultsOnly = evaluateExpandedAdmission({
    evidence: account("cerebras"),
    canary: canary("cerebras"),
    quota: quota({ source: "conservative_default" }),
    requiredCapabilities: ["chat"],
    now
  });
  assert.equal(defaultsOnly.reason, "account_verification_required");
});

test("Mistral admits only Experiment mode and keeps unknown limits single-flight", () => {
  const unknownQuota = quota({
    source: "conservative_default",
    requestsPerMinute: null,
    requestsPerDay: null,
    tokensPerMinute: null,
    tokensPerDay: null,
    remainingRequests: null,
    remainingTokens: null,
    resetAt: null
  });
  const candidate = createExpandedProviderCandidate({
    evidence: account("mistral"),
    canary: canary("mistral", ["chat", "structured_output", "tool_calling"]),
    quota: unknownQuota,
    requiredCapabilities: ["chat"],
    usage,
    priority: 20,
    now
  });
  assert.equal(candidate.capacity.maxConcurrentRequests, 1);
  assert.equal(candidate.capacity.requestsPerDay, undefined);
  assert.equal(evaluateExpandedAdmission({
    evidence: account("mistral", { planMode: "unknown" }),
    canary: canary("mistral"),
    quota: unknownQuota,
    requiredCapabilities: ["chat"],
    now
  }).reason, "wrong_plan");
});

test("Zhipu restrictions need the user and model boundaries reject oversized work", () => {
  const restricted = evaluateExpandedAdmission({
    evidence: account("zhipu", { regionStatus: "restricted" }),
    canary: canary("zhipu", ["chat", "structured_output", "tool_calling"]),
    quota: quota(),
    requiredCapabilities: ["chat"],
    now
  });
  assert.equal(restricted.state, "needs_user");
  const candidate = createExpandedProviderCandidate({
    evidence: account("zhipu"),
    canary: canary("zhipu", ["chat", "structured_output", "tool_calling"]),
    quota: quota(),
    requiredCapabilities: ["chat", "tool_calling"],
    usage,
    priority: 30,
    now
  });
  const route = routeProviders([candidate], {
    role: "implementer",
    kind: "code",
    dataClass: "source_code",
    minimumPrivacy: "training_eligible",
    estimatedInputTokens: 72_001,
    requestedOutputTokens: 128_000,
    allowPaid: false,
    now
  });
  assert.equal(route.state, "blocked");
  assert.equal(route.rejected[0]?.reason, "input-too-large");
});

test("SambaNova preserves scarce review capacity and schedules daily exhaustion", () => {
  const candidate = createExpandedProviderCandidate({
    evidence: account("sambanova"),
    canary: canary("sambanova"),
    quota: quota({ requestsPerDay: 20, tokensPerDay: 200_000, remainingRequests: 4 }),
    requiredCapabilities: ["chat"],
    usage: { ...usage, requestsToday: 16 },
    priority: 40,
    now
  });
  assert.equal(candidate.reservation?.requestsPerDay, 4);
  const plan = routeProviders([candidate], {
    role: "planner",
    kind: "plan",
    dataClass: "non_personal_test",
    minimumPrivacy: "training_eligible",
    estimatedInputTokens: 500,
    requestedOutputTokens: 200,
    allowPaid: false,
    now
  });
  assert.equal(plan.state, "waiting");
  assert.equal(plan.rejected[0]?.reason, "daily-request-limit");
  const review = routeProviders([candidate], {
    role: "reviewer",
    kind: "review",
    dataClass: "source_code",
    minimumPrivacy: "training_eligible",
    estimatedInputTokens: 500,
    requestedOutputTokens: 200,
    allowPaid: false,
    now
  });
  assert.equal(review.state, "dispatchable");
});

test("DeepSeek promotional credit requires composition and fund separation", () => {
  assert.equal(evaluateExpandedAdmission({
    evidence: account("deepseek", { balanceCompositionKnown: false }),
    canary: canary("deepseek"),
    quota: quota(),
    requiredCapabilities: ["chat"],
    now
  }).reason, "credit_composition_unknown");
  assert.equal(evaluateExpandedAdmission({
    evidence: account("deepseek", { fundSeparationProven: false }),
    canary: canary("deepseek"),
    quota: quota(),
    requiredCapabilities: ["chat"],
    now
  }).reason, "credit_fund_separation_unproven");
});

test("DeepSeek never enters default free routing but explicit credit mode is bounded", () => {
  const candidate = createExpandedProviderCandidate({
    evidence: account("deepseek"),
    canary: canary("deepseek"),
    quota: quota(),
    requiredCapabilities: ["chat"],
    usage,
    priority: 90,
    now,
    estimatedCreditMicros: 200_000,
    promotionalReserveMicros: 100_000
  });
  const request = {
    role: "reviewer",
    kind: "review",
    dataClass: "non_personal_test" as const,
    minimumPrivacy: "training_eligible" as const,
    estimatedInputTokens: 500,
    requestedOutputTokens: 200,
    allowPaid: false,
    now
  };
  assert.equal(routeProviders([candidate], request).rejected[0]?.reason, "promotional-credit-disabled");
  assert.equal(routeProviders([candidate], {
    ...request,
    allowPromotionalCredit: true
  }).state, "dispatchable");
  const exhausted = {
    ...candidate,
    estimatedCreditMicros: 1_950_000
  };
  assert.equal(routeProviders([exhausted], {
    ...request,
    allowPromotionalCredit: true
  }).rejected[0]?.reason, "promotional-credit-exhausted");
});

test("quota exhaustion becomes a scheduled wait and localized errors stay classified", () => {
  const waiting = evaluateExpandedAdmission({
    evidence: account("zhipu"),
    canary: canary("zhipu"),
    quota: quota({ remainingRequests: 0 }),
    requiredCapabilities: ["chat"],
    now
  });
  assert.equal(waiting.state, "waiting");
  assert.equal(waiting.retryAt, now + 60_000);
  assert.equal(classifyLocalizedProviderError({
    providerId: "zhipu",
    status: 403,
    message: "当前地区不可用"
  }), "region");
  assert.equal(classifyLocalizedProviderError({
    providerId: "deepseek",
    status: 402,
    message: "Insufficient balance"
  }), "credit");
});

test("provider account evidence is strict and cannot carry credentials or payloads", () => {
  assert.throws(
    () => providerAccountEvidenceSchema.parse({
      ...account("cerebras"),
      apiKey: "should-never-appear"
    }),
    /Unrecognized key/
  );
  assert.equal(JSON.stringify(account("deepseek")).includes("prompt"), false);
});
