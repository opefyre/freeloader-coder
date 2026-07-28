import {
  routeProviders,
  type ProviderCandidate,
} from "../../../packages/providers/src/router.js";
import {
  buildProviderTelemetry,
  type ProviderTelemetry
} from "../../../packages/providers/src/telemetry.js";

const now = 1_800_000_000_000;
const emptyUsage = {
  requestsToday: 0,
  tokensToday: 0,
  inputTokensToday: 0,
  outputTokensToday: 0,
  requestTimestamps: [],
  tokenSamples: []
};
const shared = {
  configured: true,
  privacy: "training_eligible" as const,
  location: "external" as const,
  paid: false,
  roles: ["planner", "implementer", "reviewer"],
  kinds: ["plan", "code", "review"],
  dataClasses: ["public_test", "non_personal_test", "source_code"] as const,
  circuitOpenUntil: 0
};

const candidates: readonly ProviderCandidate[] = [
  {
    ...shared,
    id: "groq-gpt-oss",
    providerId: "groq",
    modelId: "openai/gpt-oss-120b",
    priority: 10,
    contextWindowTokens: 128_000,
    maxOutputTokens: 64_000,
    capacity: { unit: "provider_reported" },
    usage: {
      ...emptyUsage,
      requestsToday: 12,
      tokensToday: 96_400,
      inputTokensToday: 82_000,
      outputTokensToday: 14_400,
      providerRemainingRequests: 118
    }
  },
  {
    ...shared,
    id: "cloudflare-qwen",
    providerId: "cloudflare",
    modelId: "@cf/qwen/qwen3-30b-a3b-fp8",
    priority: 20,
    contextWindowTokens: 32_768,
    maxOutputTokens: 4_768,
    capacity: {
      unit: "neurons",
      freeUnitsPerDay: 10_000,
      inputUnitsPerMillion: 100,
      outputUnitsPerMillion: 200
    },
    usage: {
      ...emptyUsage,
      requestsToday: 8,
      tokensToday: 48_000,
      inputTokensToday: 40_000,
      outputTokensToday: 8_000,
      freeUnitsToday: 5_600
    }
  },
  {
    ...shared,
    id: "gemini-flash",
    providerId: "gemini",
    modelId: "gemini-flash",
    priority: 30,
    contextWindowTokens: 1_000_000,
    maxOutputTokens: 65_536,
    capacity: { unit: "provider_reported" },
    usage: {
      ...emptyUsage,
      requestsToday: 3,
      tokensToday: 22_100,
      inputTokensToday: 20_000,
      outputTokensToday: 2_100,
      providerRemainingRequests: 0,
      providerResetAt: now + 3_600_000
    }
  },
  {
    ...shared,
    id: "openrouter-free",
    providerId: "openrouter",
    modelId: "openrouter/free",
    priority: 40,
    contextWindowTokens: 64_000,
    maxOutputTokens: 8_000,
    capacity: { unit: "provider_reported" },
    usage: {
      ...emptyUsage,
      requestsToday: 2,
      tokensToday: 13_000,
      inputTokensToday: 11_000,
      outputTokensToday: 2_000
    }
  }
];

const route = routeProviders(candidates, {
  role: "implementer",
  kind: "code",
  dataClass: "source_code",
  minimumPrivacy: "training_eligible",
  estimatedInputTokens: 8_000,
  requestedOutputTokens: 4_000,
  allowPaid: false,
  now
});
const runtimeEvidence = {
  groq: { successfulCalls: 10, failedCalls: 2, lastSuccessAt: now - 60_000, lastFailureAt: now - 900_000 },
  cloudflare: { successfulCalls: 7, failedCalls: 1, lastSuccessAt: now - 240_000, lastFailureAt: now - 1_800_000 },
  gemini: { successfulCalls: 2, failedCalls: 1, lastSuccessAt: now - 3_600_000, lastFailureAt: now - 120_000 },
  openrouter: { successfulCalls: 2, failedCalls: 0, lastSuccessAt: now - 7_200_000, lastFailureAt: null }
} as const;

export const providerTelemetry: readonly ProviderTelemetry[] = candidates.map((candidate) =>
  buildProviderTelemetry({
    candidate,
    route,
    runtime: runtimeEvidence[candidate.providerId as keyof typeof runtimeEvidence],
    now
  })
);

export const successfulProviderCalls = providerTelemetry.reduce(
  (sum, provider) => sum + provider.successfulCalls,
  0
);
