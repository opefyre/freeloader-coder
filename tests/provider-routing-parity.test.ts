import assert from "node:assert/strict";
import test from "node:test";
import {
  routeProviders,
  validateRouteCandidates,
  type ProviderCandidate,
  type RouteRequest
} from "../packages/providers/src/router.js";

const now = 1_800_000_000_000;
const usage = {
  requestsToday: 0,
  tokensToday: 0,
  inputTokensToday: 0,
  outputTokensToday: 0,
  requestTimestamps: [],
  tokenSamples: []
};
const base: ProviderCandidate = {
  id: "groq-implementer",
  providerId: "groq",
  modelId: "openai/gpt-oss-120b",
  priority: 10,
  configured: true,
  privacy: "training_eligible",
  location: "external",
  paid: false,
  roles: ["implementer"],
  kinds: ["code"],
  dataClasses: ["public_test", "non_personal_test", "source_code"],
  contextWindowTokens: 128_000,
  maxOutputTokens: 64_000,
  capacity: { unit: "provider_reported", requestsPerMinute: 30 },
  usage,
  circuitOpenUntil: 0
};
const request: RouteRequest = {
  role: "implementer",
  kind: "code",
  dataClass: "source_code",
  minimumPrivacy: "training_eligible",
  estimatedInputTokens: 2_000,
  requestedOutputTokens: 4_000,
  allowPaid: false,
  now
};

test("router deterministically prefers an explicitly preferred eligible provider", () => {
  const second = {
    ...base,
    id: "cloudflare-implementer",
    providerId: "cloudflare",
    modelId: "@cf/qwen/qwen3-30b-a3b-fp8",
    priority: 20
  };
  const result = routeProviders([base, second], {
    ...request,
    preferredProviderIds: ["cloudflare"]
  });
  assert.equal(result.selected?.id, "cloudflare-implementer");
});

test("router falls back around circuits and provider-reported exhaustion", () => {
  const open = { ...base, circuitOpenUntil: now + 60_000 };
  const exhausted = {
    ...base,
    id: "gemini-implementer",
    providerId: "gemini",
    modelId: "gemini-flash",
    usage: { ...usage, providerRemainingRequests: 0, providerResetAt: now + 120_000 }
  };
  const fallback = {
    ...base,
    id: "openrouter-implementer",
    providerId: "openrouter",
    modelId: "free",
    priority: 30
  };
  const result = routeProviders([open, exhausted, fallback], request);
  assert.equal(result.selected?.id, "openrouter-implementer");
  assert.deepEqual(result.rejected.map((item) => item.reason), [
    "circuit-open",
    "provider-reported-exhausted"
  ]);
  assert.equal(result.rejected[1]?.retryAt, now + 120_000);
});

test("Cloudflare uses neuron budget rather than a fictional generic token cap", () => {
  const cloudflare: ProviderCandidate = {
    ...base,
    id: "cloudflare-qwen",
    providerId: "cloudflare",
    modelId: "@cf/qwen/qwen3-30b-a3b-fp8",
    contextWindowTokens: 32_768,
    maxOutputTokens: 4_768,
    capacity: {
      unit: "neurons",
      freeUnitsPerDay: 10_000,
      inputUnitsPerMillion: 100,
      outputUnitsPerMillion: 200
    },
    usage: { ...usage, freeUnitsToday: 9_999 }
  };
  const result = routeProviders([cloudflare], {
    ...request,
    estimatedInputTokens: 10_000,
    requestedOutputTokens: 1_000
  });
  assert.equal(result.selected, null);
  assert.equal(result.rejected[0]?.reason, "daily-free-budget-limit");
});

test("context safety is model-specific", () => {
  const qwen = {
    ...base,
    id: "cloudflare-qwen",
    providerId: "cloudflare",
    modelId: "qwen",
    contextWindowTokens: 32_768,
    maxOutputTokens: 4_768
  };
  const result = routeProviders([qwen, base], {
    ...request,
    estimatedInputTokens: 30_000,
    requestedOutputTokens: 2_000
  });
  assert.equal(result.selected?.id, "groq-implementer");
  assert.equal(result.rejected[0]?.reason, "input-too-large");
});

test("paid providers and external sensitive-data routes remain ineligible", () => {
  const paid = routeProviders([{ ...base, paid: true }], request);
  assert.equal(paid.selected, null);
  assert.equal(paid.rejected[0]?.reason, "paid-disabled");

  const external = {
    ...base,
    dataClasses: ["credential" as const],
    privacy: "zero_retention" as const
  };
  const local = {
    ...base,
    id: "private-local",
    providerId: "local-runtime",
    modelId: "qwen-local",
    privacy: "local" as const,
    location: "local" as const,
    dataClasses: ["credential" as const],
    capacity: { unit: "unmetered" as const }
  };
  const result = routeProviders([external, local], {
    ...request,
    dataClass: "credential",
    minimumPrivacy: "zero_retention"
  });
  assert.equal(result.selected?.id, "private-local");
  assert.equal(result.rejected[0]?.reason, "sensitive-data-requires-local");
});

test("route validation rejects ambiguous duplicate provider-model identities", () => {
  assert.throws(
    () => validateRouteCandidates([base, { ...base, id: "duplicate" }]),
    /Duplicate provider-model/
  );
});
