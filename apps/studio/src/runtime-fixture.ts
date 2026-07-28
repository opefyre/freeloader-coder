import {
  routeProviders,
  type ProviderCandidate,
} from "../../../packages/providers/src/router.js";
import {
  createFreeCatalogCandidate,
  verifiedProviderCatalog
} from "../../../packages/providers/src/catalog.js";
import { planProviderSchedule } from "../../../packages/orchestration/src/provider-scheduler.js";
import {
  buildProviderTelemetry,
  summarizeProviderAttempts,
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
  costClass: "free" as const,
  billingMode: "free_tier" as const,
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
    capacity: {
      unit: "provider_reported",
      maxConcurrentRequests: 2,
      requestsPerDay: 1_000
    },
    reservation: { kinds: ["review"], requestsPerDay: 50 },
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
      maxConcurrentRequests: 1,
      freeUnitsPerDay: 10_000,
      inputUnitsPerMillion: 100,
      outputUnitsPerMillion: 200
    },
    reservation: { kinds: ["review"], freeUnitsPerDay: 1_500 },
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
    lifecycle: "retired",
    retiresAt: now - 86_400_000,
    replacementProviderIds: ["groq", "cloudflare"],
    usage: {
      ...emptyUsage,
      requestsToday: 2,
      tokensToday: 13_000,
      inputTokensToday: 11_000,
      outputTokensToday: 2_000
    }
  },
  ...[
    ["cerebras", "gpt-oss-120b", 50],
    ["mistral", "mistral-small-latest", 60],
    ["zhipu", "glm-4.7-flash", 70],
    ["sambanova", "DeepSeek-V3.1", 80]
  ].map(([providerId, modelId, priority]) =>
    createFreeCatalogCandidate({
      providerId: String(providerId),
      modelId: String(modelId),
      configured: false,
      priority: Number(priority),
      usage: emptyUsage
    })
  )
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

const scheduledRouteRequest = {
  role: "implementer",
  kind: "code",
  dataClass: "source_code",
  minimumPrivacy: "training_eligible",
  estimatedInputTokens: 8_000,
  requestedOutputTokens: 4_000,
  allowPaid: false,
  now
} as const;
const plannedProviderWork = planProviderSchedule([
  ...["PIPE-142", "PIPE-145", "PIPE-149"].map((taskId, index) => ({
    id: taskId,
    taskId,
    workUnitId: "implementation",
    priority: 10 + index,
    enqueuedAt: now + index,
    candidates: [candidates[0]!],
    request: scheduledRouteRequest
  })),
  {
    id: "PIPE-151",
    taskId: "PIPE-151",
    workUnitId: "implementation",
    priority: 20,
    enqueuedAt: now + 3,
    candidates: [candidates[2]!],
    request: scheduledRouteRequest
  },
  {
    id: "PIPE-154",
    taskId: "PIPE-154",
    workUnitId: "implementation",
    priority: 30,
    enqueuedAt: now + 4,
    candidates: [{
      ...candidates[1]!,
      usage: { ...candidates[1]!.usage, activeRequests: 1 }
    }],
    request: scheduledRouteRequest
  }
], { now });

export const providerQueueSnapshot = {
  generatedAt: now,
  nextWakeAt: plannedProviderWork.nextWakeAt,
  dispatches: plannedProviderWork.dispatches.map((entry) => ({
    taskId: entry.item.taskId,
    providerId: entry.candidate.providerId,
    modelId: entry.candidate.modelId
  })),
  scheduled: plannedProviderWork.waiting.map((entry) => ({
    taskId: entry.item.taskId,
    retryAt: entry.retryAt,
    reason: entry.reason,
    providerId: entry.route.selected?.providerId
      ?? entry.route.rejected[0]?.providerId
      ?? "unavailable"
  })),
  protectedCapacity: [
    { providerId: "groq", label: "50 daily requests held for review" },
    { providerId: "cloudflare", label: "1,500 neurons held for review" }
  ]
} as const;

export const routeEvidenceSummary = {
  selectedProviderId: route.selected?.providerId ?? null,
  selectedModelId: route.selected?.modelId ?? null,
  eligibleProviderIds: route.eligible.map((candidate) => candidate.providerId),
  rejected: route.rejected.map((rejection) => ({
    providerId: rejection.providerId,
    reason: rejection.reason,
    retryAt: rejection.retryAt
  })),
  paidUsageAllowed: false
} as const;

export const costSafetySummary = {
  mode: "Free only",
  hardCeiling: "$0.00",
  paidRoutesProduced: 0,
  safeguards: [
    "Unknown-cost models denied",
    "Billing-enabled projects denied",
    "Exact paid grant required"
  ],
  alternatives: route.rejected.map((rejection) => ({
    providerId: rejection.providerId,
    reason: rejection.reason,
    retryAt: rejection.retryAt
  }))
} as const;

export const verifiedProviderSnapshot = verifiedProviderCatalog.map((provider) => ({
  id: provider.id,
  label: provider.label,
  dashboardUrl: provider.dashboardUrl,
  sourceUrl: provider.sourceUrls[0]!,
  modelId: provider.models[0]!.id,
  zeroCostEligible: provider.zeroCostEligible,
  freeAccess: provider.freeAccess,
  requiresAccountLimitProbe: provider.requiresAccountLimitProbe
}));
const attemptEvidence = [
  ...attemptsFor("groq", 10, 2, now - 60_000),
  ...attemptsFor("cloudflare", 7, 1, now - 240_000),
  ...attemptsFor("gemini", 2, 1, now - 3_600_000),
  ...attemptsFor("openrouter", 2, 0, now - 7_200_000)
];

export const providerTelemetry: readonly ProviderTelemetry[] = candidates.map((candidate) =>
  buildProviderTelemetry({
    candidate,
    route,
    runtime: summarizeProviderAttempts(attemptEvidence, candidate.providerId),
    now
  })
);

export const successfulProviderCalls = providerTelemetry.reduce(
  (sum, provider) => sum + provider.successfulCalls,
  0
);

function attemptsFor(
  providerId: string,
  succeeded: number,
  failed: number,
  mostRecentSuccess: number
): readonly {
  readonly providerId: string;
  readonly status: "succeeded" | "failed";
  readonly startedAt: number;
  readonly finishedAt: number;
}[] {
  return [
    ...Array.from({ length: succeeded }, (_, index) => ({
      providerId,
      status: "succeeded" as const,
      startedAt: mostRecentSuccess - index * 60_000 - 10_000,
      finishedAt: mostRecentSuccess - index * 60_000
    })),
    ...Array.from({ length: failed }, (_, index) => ({
      providerId,
      status: "failed" as const,
      startedAt: mostRecentSuccess - (index + 1) * 300_000 - 10_000,
      finishedAt: mostRecentSuccess - (index + 1) * 300_000
    }))
  ];
}
