import type {
  ProviderCandidate,
  ProviderCapacityUsage
} from "./router.js";

export type FreeAccessKind = "permanent" | "account_limited" | "promotional_credit" | "none";

export interface ProviderCatalogModel {
  readonly id: string;
  readonly label: string;
  readonly contextWindowTokens: number;
  readonly maxOutputTokens: number;
  readonly preview: boolean;
}

export interface ProviderCatalogEntry {
  readonly id: string;
  readonly label: string;
  readonly apiBaseUrl: string;
  readonly dashboardUrl: string;
  readonly apiKeyEnvironmentVariable: string;
  readonly protocol: "openai_compatible";
  readonly freeAccess: FreeAccessKind;
  readonly zeroCostEligible: boolean;
  readonly requiresAccountLimitProbe: boolean;
  readonly summary: string;
  readonly sourceUrls: readonly string[];
  readonly models: readonly ProviderCatalogModel[];
  readonly documentedCapacity: {
    readonly requestsPerMinute?: number | undefined;
    readonly requestsPerDay?: number | undefined;
    readonly tokensPerMinute?: number | undefined;
    readonly tokensPerDay?: number | undefined;
  };
}

export const verifiedProviderCatalog: readonly ProviderCatalogEntry[] = [
  {
    id: "cerebras",
    label: "Cerebras",
    apiBaseUrl: "https://api.cerebras.ai/v1",
    dashboardUrl: "https://cloud.cerebras.ai",
    apiKeyEnvironmentVariable: "CEREBRAS_API_KEY",
    protocol: "openai_compatible",
    freeAccess: "account_limited",
    zeroCostEligible: true,
    requiresAccountLimitProbe: true,
    summary: "Permanent $0 inference with organization-specific limits and very fast coding models.",
    sourceUrls: [
      "https://inference-docs.cerebras.ai/support/pricing",
      "https://inference-docs.cerebras.ai/support/rate-limits",
      "https://inference-docs.cerebras.ai/resources/openai"
    ],
    models: [
      {
        id: "gpt-oss-120b",
        label: "GPT OSS 120B",
        contextWindowTokens: 131_000,
        maxOutputTokens: 40_000,
        preview: false
      },
      {
        id: "zai-glm-4.7",
        label: "Z.ai GLM 4.7",
        contextWindowTokens: 131_072,
        maxOutputTokens: 65_000,
        preview: true
      }
    ],
    documentedCapacity: {
      requestsPerMinute: 5,
      requestsPerDay: 2_400,
      tokensPerMinute: 30_000,
      tokensPerDay: 1_000_000
    }
  },
  {
    id: "mistral",
    label: "Mistral",
    apiBaseUrl: "https://api.mistral.ai/v1",
    dashboardUrl: "https://console.mistral.ai",
    apiKeyEnvironmentVariable: "MISTRAL_API_KEY",
    protocol: "openai_compatible",
    freeAccess: "account_limited",
    zeroCostEligible: true,
    requiresAccountLimitProbe: true,
    summary: "Free mode requires no card and supports limited API evaluation and prototyping.",
    sourceUrls: [
      "https://docs.mistral.ai/getting-started/quickstarts/studio/activate-and-generate-api-key",
      "https://help.mistral.ai/en/articles/698531-why-am-i-hitting-api-rate-limits-and-how-do-i-increase-them"
    ],
    models: [
      {
        id: "mistral-small-latest",
        label: "Mistral Small",
        contextWindowTokens: 256_000,
        maxOutputTokens: 32_000,
        preview: false
      }
    ],
    documentedCapacity: {}
  },
  {
    id: "zhipu",
    label: "Zhipu AI",
    apiBaseUrl: "https://open.bigmodel.cn/api/paas/v4",
    dashboardUrl: "https://open.bigmodel.cn",
    apiKeyEnvironmentVariable: "ZHIPU_API_KEY",
    protocol: "openai_compatible",
    freeAccess: "permanent",
    zeroCostEligible: true,
    requiresAccountLimitProbe: true,
    summary: "GLM Flash models are explicitly free and include agentic coding and tool calling.",
    sourceUrls: [
      "https://docs.bigmodel.cn/cn/guide/models/free/glm-4.7-flash",
      "https://docs.bigmodel.cn/cn/api/rate-limit"
    ],
    models: [
      {
        id: "glm-4.7-flash",
        label: "GLM 4.7 Flash",
        contextWindowTokens: 200_000,
        maxOutputTokens: 128_000,
        preview: false
      }
    ],
    documentedCapacity: {}
  },
  {
    id: "sambanova",
    label: "SambaNova",
    apiBaseUrl: "https://api.sambanova.ai/v1",
    dashboardUrl: "https://cloud.sambanova.ai",
    apiKeyEnvironmentVariable: "SAMBANOVA_API_KEY",
    protocol: "openai_compatible",
    freeAccess: "permanent",
    zeroCostEligible: true,
    requiresAccountLimitProbe: true,
    summary: "No-payment-method accounts receive a small permanent per-model free allowance.",
    sourceUrls: [
      "https://docs.sambanova.ai/docs/en/models/rate-limits",
      "https://docs.sambanova.ai/docs/en/get-started/api-keys-urls",
      "https://docs.sambanova.ai/docs/en/models/sambacloud-models"
    ],
    models: [
      {
        id: "DeepSeek-V3.1",
        label: "DeepSeek V3.1",
        contextWindowTokens: 128_000,
        maxOutputTokens: 8_000,
        preview: false
      }
    ],
    documentedCapacity: {
      requestsPerMinute: 20,
      requestsPerDay: 20,
      tokensPerDay: 200_000
    }
  },
  {
    id: "deepseek",
    label: "DeepSeek Platform",
    apiBaseUrl: "https://api.deepseek.com",
    dashboardUrl: "https://platform.deepseek.com",
    apiKeyEnvironmentVariable: "DEEPSEEK_API_KEY",
    protocol: "openai_compatible",
    freeAccess: "promotional_credit",
    zeroCostEligible: false,
    requiresAccountLimitProbe: true,
    summary: "Token-priced API; granted trial balance is temporary and is not a permanent free tier.",
    sourceUrls: [
      "https://api-docs.deepseek.com/quick_start/pricing",
      "https://api-docs.deepseek.com/api/get-user-balance/"
    ],
    models: [
      {
        id: "deepseek-v4-flash",
        label: "DeepSeek V4 Flash",
        contextWindowTokens: 1_000_000,
        maxOutputTokens: 384_000,
        preview: false
      }
    ],
    documentedCapacity: {}
  }
] as const;

export function catalogProvider(providerId: string): ProviderCatalogEntry {
  const provider = verifiedProviderCatalog.find((entry) => entry.id === providerId);
  if (!provider) throw new Error(`Unknown provider catalog entry: ${providerId}`);
  return provider;
}

export function createFreeCatalogCandidate(input: {
  readonly providerId: string;
  readonly modelId: string;
  readonly configured: boolean;
  readonly priority: number;
  readonly usage: ProviderCapacityUsage;
}): ProviderCandidate {
  const provider = catalogProvider(input.providerId);
  if (!provider.zeroCostEligible) {
    throw new Error(`${provider.label} is not eligible for automatic zero-cost routing.`);
  }
  const model = provider.models.find((entry) => entry.id === input.modelId);
  if (!model) {
    throw new Error(`Unknown ${provider.label} catalog model: ${input.modelId}`);
  }
  const limits = provider.documentedCapacity;
  return {
    id: `${provider.id}-${model.id}`,
    providerId: provider.id,
    modelId: model.id,
    priority: input.priority,
    configured: input.configured,
    privacy: "training_eligible",
    location: "external",
    paid: false,
    costClass: "free",
    billingMode: "free_tier",
    roles: ["planner", "implementer", "reviewer"],
    kinds: ["plan", "code", "review"],
    dataClasses: ["public_test", "non_personal_test", "source_code"],
    contextWindowTokens: model.contextWindowTokens,
    maxOutputTokens: model.maxOutputTokens,
    capacity: {
      unit: "provider_reported",
      maxConcurrentRequests: 1,
      ...limits
    },
    ...(limits.requestsPerDay && limits.requestsPerDay > 2
      ? {
          reservation: {
            kinds: ["review"],
            requestsPerDay: Math.max(1, Math.floor(limits.requestsPerDay * 0.1))
          }
        }
      : {}),
    usage: input.usage,
    circuitOpenUntil: 0
  };
}
