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
  readonly modelsPath?: string | undefined;
  readonly chatCompletionsPath?: string | undefined;
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
    id: "groq",
    label: "Groq",
    apiBaseUrl: "https://api.groq.com/openai/v1",
    dashboardUrl: "https://console.groq.com/keys",
    apiKeyEnvironmentVariable: "GROQ_API_KEY",
    protocol: "openai_compatible",
    freeAccess: "account_limited",
    zeroCostEligible: true,
    requiresAccountLimitProbe: true,
    summary: "Fast developer-tier inference admitted only after a live model and structured-output canary.",
    sourceUrls: [
      "https://console.groq.com/docs/models",
      "https://console.groq.com/docs/rate-limits"
    ],
    models: [
      {
        id: "openai/gpt-oss-120b",
        label: "GPT OSS 120B",
        contextWindowTokens: 131_072,
        maxOutputTokens: 65_536,
        preview: false
      }
    ],
    documentedCapacity: {}
  },
  {
    id: "gemini",
    label: "Google Gemini",
    apiBaseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    dashboardUrl: "https://aistudio.google.com/apikey",
    apiKeyEnvironmentVariable: "GEMINI_API_KEY",
    protocol: "openai_compatible",
    freeAccess: "account_limited",
    zeroCostEligible: true,
    requiresAccountLimitProbe: true,
    summary: "Google AI Studio free-project access; billing-enabled projects are excluded by user attestation.",
    sourceUrls: [
      "https://ai.google.dev/gemini-api/docs/openai",
      "https://ai.google.dev/gemini-api/docs/rate-limits"
    ],
    models: [
      {
        id: "gemini-3.5-flash-lite",
        label: "Gemini 3.5 Flash-Lite",
        contextWindowTokens: 1_048_576,
        maxOutputTokens: 65_536,
        preview: false
      }
    ],
    documentedCapacity: {}
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    apiBaseUrl: "https://openrouter.ai/api/v1",
    dashboardUrl: "https://openrouter.ai/settings/keys",
    apiKeyEnvironmentVariable: "OPENROUTER_API_KEY",
    protocol: "openai_compatible",
    freeAccess: "account_limited",
    zeroCostEligible: true,
    requiresAccountLimitProbe: true,
    summary: "Rotating free-model routing; only the explicit zero-cost router is eligible.",
    sourceUrls: [
      "https://openrouter.ai/docs/api/reference/overview",
      "https://openrouter.ai/models?max_price=0"
    ],
    models: [
      {
        id: "openrouter/free",
        label: "OpenRouter Free Router",
        contextWindowTokens: 131_072,
        maxOutputTokens: 16_384,
        preview: false
      }
    ],
    documentedCapacity: {}
  },
  {
    id: "github-models",
    label: "GitHub Models",
    apiBaseUrl: "https://models.github.ai",
    modelsPath: "/catalog/models",
    chatCompletionsPath: "/inference/chat/completions",
    dashboardUrl: "https://github.com/marketplace/models",
    apiKeyEnvironmentVariable: "GITHUB_TOKEN",
    protocol: "openai_compatible",
    freeAccess: "account_limited",
    zeroCostEligible: true,
    requiresAccountLimitProbe: true,
    summary: "Account-limited model inference with repository write access neither requested nor required.",
    sourceUrls: [
      "https://docs.github.com/en/rest/models/catalog",
      "https://docs.github.com/en/github-models"
    ],
    models: [
      {
        id: "openai/gpt-4.1-mini",
        label: "GPT-4.1 Mini",
        contextWindowTokens: 1_048_576,
        maxOutputTokens: 32_768,
        preview: false
      }
    ],
    documentedCapacity: {}
  },
  {
    id: "nvidia-nim",
    label: "NVIDIA NIM",
    apiBaseUrl: "https://integrate.api.nvidia.com/v1",
    dashboardUrl: "https://build.nvidia.com/explore/discover",
    apiKeyEnvironmentVariable: "NVIDIA_API_KEY",
    protocol: "openai_compatible",
    freeAccess: "account_limited",
    zeroCostEligible: true,
    requiresAccountLimitProbe: true,
    summary: "Free NVIDIA Developer Program inference; commercial and paid enterprise routes are excluded.",
    sourceUrls: [
      "https://docs.api.nvidia.com/nim/docs/product",
      "https://docs.api.nvidia.com/nim/docs/api-quickstart",
      "https://docs.api.nvidia.com/nim/reference/llm-apis"
    ],
    models: [
      {
        id: "meta/llama-3.1-8b-instruct",
        label: "Llama 3.1 8B Instruct",
        contextWindowTokens: 131_072,
        maxOutputTokens: 16_384,
        preview: false
      }
    ],
    documentedCapacity: {}
  },
  {
    id: "huggingface",
    label: "Hugging Face",
    apiBaseUrl: "https://router.huggingface.co/v1",
    dashboardUrl: "https://huggingface.co/settings/tokens",
    apiKeyEnvironmentVariable: "HF_TOKEN",
    protocol: "openai_compatible",
    freeAccess: "account_limited",
    zeroCostEligible: true,
    requiresAccountLimitProbe: true,
    summary: "Recurring free-user inference credit only; requests fail closed when the monthly allowance is exhausted.",
    sourceUrls: [
      "https://huggingface.co/docs/inference-providers/en/pricing",
      "https://huggingface.co/docs/inference-providers/en/index",
      "https://huggingface.co/docs/inference-providers/en/hub-api"
    ],
    models: [
      {
        id: "openai/gpt-oss-120b",
        label: "GPT OSS 120B",
        contextWindowTokens: 131_072,
        maxOutputTokens: 16_384,
        preview: false
      }
    ],
    documentedCapacity: {}
  },
  {
    id: "aion",
    label: "Aion Labs",
    apiBaseUrl: "https://api.aionlabs.ai/v1",
    dashboardUrl: "https://www.aionlabs.ai/app/api-keys/",
    apiKeyEnvironmentVariable: "AION_API_KEY",
    protocol: "openai_compatible",
    freeAccess: "permanent",
    zeroCostEligible: true,
    requiresAccountLimitProbe: true,
    summary: "No-card daily free credit with explicit request and token ceilings.",
    sourceUrls: [
      "https://www.aionlabs.ai/pricing/",
      "https://www.aionlabs.ai/docs/rate-limits/",
      "https://www.aionlabs.ai/docs/api-reference/"
    ],
    models: [
      {
        id: "aion-labs/aion-2.0",
        label: "Aion 2.0",
        contextWindowTokens: 131_072,
        maxOutputTokens: 32_768,
        preview: false
      }
    ],
    documentedCapacity: {
      requestsPerMinute: 15,
      tokensPerMinute: 20_000,
      tokensPerDay: 20_000
    }
  },
  {
    id: "kilo",
    label: "Kilo Gateway",
    apiBaseUrl: "https://api.kilo.ai/api/gateway",
    dashboardUrl: "https://app.kilo.ai/",
    apiKeyEnvironmentVariable: "KILO_API_KEY",
    protocol: "openai_compatible",
    freeAccess: "permanent",
    zeroCostEligible: true,
    requiresAccountLimitProbe: true,
    summary: "Auto Free rotates among current zero-cost models and returns 402 rather than consuming paid credit.",
    sourceUrls: [
      "https://kilo.ai/docs/getting-started/using-kilo-for-free",
      "https://kilo.ai/docs/gateway/api-reference",
      "https://kilo.ai/docs/gateway/usage-and-billing"
    ],
    models: [
      {
        id: "kilo-auto/free",
        label: "Kilo Auto Free",
        contextWindowTokens: 131_072,
        maxOutputTokens: 16_384,
        preview: false
      }
    ],
    documentedCapacity: {}
  },
  {
    id: "cohere",
    label: "Cohere Trial",
    apiBaseUrl: "https://api.cohere.ai/compatibility/v1",
    dashboardUrl: "https://dashboard.cohere.com/api-keys",
    apiKeyEnvironmentVariable: "COHERE_API_KEY",
    protocol: "openai_compatible",
    freeAccess: "account_limited",
    zeroCostEligible: true,
    requiresAccountLimitProbe: true,
    summary: "No-card trial key capped at 1,000 API calls monthly; non-production use only.",
    sourceUrls: [
      "https://docs.cohere.com/v1/docs/cohere-faqs",
      "https://docs.cohere.com/v1/docs/going-live",
      "https://docs.cohere.com/reference/list-models"
    ],
    models: [
      {
        id: "command-a-03-2025",
        label: "Command A",
        contextWindowTokens: 256_000,
        maxOutputTokens: 8_192,
        preview: false
      }
    ],
    documentedCapacity: {}
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
