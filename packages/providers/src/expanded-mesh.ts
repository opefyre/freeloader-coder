import { z } from "zod";

import type {
  ProviderCanaryEvidence,
  ProviderQuotaEvidence
} from "../../schemas/src/index.js";
import { catalogProvider } from "./catalog.js";
import type {
  ProviderCandidate,
  ProviderCapacityUsage
} from "./router.js";

export const expandedProviderIdSchema = z.enum([
  "nvidia-nim",
  "huggingface",
  "mistral",
  "zhipu",
  "sambanova"
]);

export const providerAccountEvidenceSchema = z.strictObject({
  schemaVersion: z.literal(1),
  providerId: expandedProviderIdSchema,
  planMode: z.enum(["free", "experiment", "promotional_credit", "unknown"]),
  billingEnabled: z.boolean(),
  paymentMethodPresent: z.boolean().nullable(),
  regionStatus: z.enum(["allowed", "restricted", "unknown"]),
  explicitFreeModel: z.boolean(),
  resolvedModelId: z.string().trim().min(1).max(160),
  grantedBalanceMicros: z.number().int().nonnegative().nullable(),
  toppedUpBalanceMicros: z.number().int().nonnegative().nullable(),
  balanceCompositionKnown: z.boolean(),
  fundSeparationProven: z.boolean(),
  promotionalModeEnabled: z.boolean(),
  promotionExpiresAt: z.number().int().positive().nullable(),
  observedAt: z.number().int().nonnegative(),
  expiresAt: z.number().int().positive(),
  source: z.enum(["account_api", "response_headers", "user_attestation"])
}).refine(
  (value) => value.expiresAt > value.observedAt,
  "Provider account evidence must expire after observation."
);

export type ExpandedProviderId = z.infer<typeof expandedProviderIdSchema>;
export type ProviderAccountEvidence = z.infer<typeof providerAccountEvidenceSchema>;

export type ExpandedAdmissionReason =
  | "ready"
  | "scheduled_wait"
  | "stale_account_evidence"
  | "billing_enabled"
  | "wrong_plan"
  | "model_not_free"
  | "model_alias_changed"
  | "region_restricted"
  | "account_verification_required"
  | "canary_failed"
  | "capability_unproven"
  | "quota_exhausted"
  | "payment_uncertain"
  | "credit_mode_disabled"
  | "credit_composition_unknown"
  | "credit_fund_separation_unproven"
  | "credit_exhausted"
  | "credit_expired";

export interface ExpandedAdmissionDecision {
  readonly admitted: boolean;
  readonly state: "ready" | "waiting" | "needs_user" | "denied";
  readonly reason: ExpandedAdmissionReason;
  readonly detail: string;
  readonly retryAt: number | null;
  readonly permanentFree: boolean;
}

export function evaluateExpandedAdmission(input: {
  readonly evidence: unknown;
  readonly canary: ProviderCanaryEvidence;
  readonly quota: ProviderQuotaEvidence;
  readonly requiredCapabilities: readonly ("chat" | "structured_output" | "tool_calling" | "long_context")[];
  readonly now: number;
  readonly promotionalReserveMicros?: number | undefined;
}): ExpandedAdmissionDecision {
  const evidence = providerAccountEvidenceSchema.parse(input.evidence);
  const provider = catalogProvider(evidence.providerId);
  const model = provider.models.find((candidate) => candidate.id === evidence.resolvedModelId);
  const permanentFree = provider.zeroCostEligible;
  if (evidence.expiresAt <= input.now) {
    return denied("stale_account_evidence", "Account and plan evidence must be refreshed.", evidence.expiresAt, permanentFree);
  }
  if (evidence.billingEnabled) {
    return denied("billing_enabled", "Billing-enabled accounts are excluded from automatic free routing.", null, permanentFree);
  }
  if (!model) {
    return denied("model_alias_changed", "The observed model identity is not in the verified catalogue.", null, permanentFree);
  }
  if (input.canary.status !== "passed" || input.canary.modelId !== evidence.resolvedModelId) {
    return denied("canary_failed", "The exact observed model has not passed its live canary.", null, permanentFree);
  }
  const missing = input.requiredCapabilities.find(
    (capability) => !input.canary.capabilities.includes(capability)
  );
  if (missing) {
    return denied("capability_unproven", `The ${missing.replaceAll("_", " ")} capability is unproven.`, null, permanentFree);
  }
  if (
    input.quota.remainingRequests === 0
    || input.quota.remainingTokens === 0
  ) {
    return {
      admitted: false,
      state: "waiting",
      reason: "quota_exhausted",
      detail: "Capacity is exhausted. Work remains queued until the observed reset.",
      retryAt: input.quota.resetAt,
      permanentFree
    };
  }

  if (evidence.providerId === "nvidia-nim") {
    if (evidence.planMode !== "free") return denied("wrong_plan", "Free NVIDIA Developer Program access is required.", null, true);
    if (!evidence.explicitFreeModel) return denied("model_not_free", "The selected NIM model is not available through free developer access.", null, true);
    if (!["account_api", "response_headers"].includes(input.quota.source)) {
      return denied("account_verification_required", "Live account limits are required before admission.", null, true);
    }
  }
  if (evidence.providerId === "huggingface") {
    if (evidence.planMode !== "free") return denied("wrong_plan", "A Hugging Face free-user account is required.", null, true);
    if (!evidence.explicitFreeModel) return denied("model_not_free", "The selected routed model is not available to this free account.", null, true);
  }
  if (evidence.providerId === "mistral") {
    if (evidence.planMode !== "experiment") return denied("wrong_plan", "Mistral Experiment mode must be proven.", null, true);
    if (!evidence.explicitFreeModel) return denied("model_not_free", "The resolved Mistral alias is not free in this workspace.", null, true);
  }
  if (evidence.providerId === "zhipu") {
    if (evidence.regionStatus === "restricted") return denied("region_restricted", "This account or region cannot use the selected endpoint.", null, true);
    if (evidence.regionStatus === "unknown") return denied("account_verification_required", "Confirm regional availability before routing.", null, true);
    if (!evidence.explicitFreeModel) return denied("model_not_free", "The exact GLM model is not currently documented and proven free.", null, true);
  }
  if (evidence.providerId === "sambanova") {
    if (evidence.paymentMethodPresent !== false) return denied("payment_uncertain", "A no-payment-method free account must be proven.", null, true);
    if (evidence.planMode !== "free") return denied("wrong_plan", "SambaNova free-plan evidence is required.", null, true);
  }
  return {
    admitted: true,
    state: "ready",
    reason: "ready",
    detail: "Plan, model, account, quota, and capability evidence are current.",
    retryAt: null,
    permanentFree
  };
}

export function createExpandedProviderCandidate(input: {
  readonly evidence: ProviderAccountEvidence;
  readonly canary: ProviderCanaryEvidence;
  readonly quota: ProviderQuotaEvidence;
  readonly requiredCapabilities: readonly ("chat" | "structured_output" | "tool_calling" | "long_context")[];
  readonly usage: ProviderCapacityUsage;
  readonly priority: number;
  readonly now: number;
  readonly estimatedCreditMicros?: number | undefined;
  readonly promotionalReserveMicros?: number | undefined;
}): ProviderCandidate {
  const decision = evaluateExpandedAdmission(input);
  if (!decision.admitted) throw new Error(`Expanded provider is not admitted: ${decision.reason}.`);
  const provider = catalogProvider(input.evidence.providerId);
  const model = provider.models.find((candidate) => candidate.id === input.evidence.resolvedModelId);
  if (!model) throw new Error("Admitted model disappeared from the catalogue.");
  const dailyRequests = input.quota.requestsPerDay ?? provider.documentedCapacity.requestsPerDay;
  const dailyTokens = input.quota.tokensPerDay ?? provider.documentedCapacity.tokensPerDay;
  const scarce = input.evidence.providerId === "sambanova";
  return {
    id: `${provider.id}-${model.id}`,
    providerId: provider.id,
    modelId: model.id,
    priority: input.priority,
    configured: true,
    privacy: "training_eligible",
    location: "external",
    paid: false,
    costClass: "free",
    billingMode: "free_tier",
    roles: capabilityRoles(input.canary.capabilities),
    kinds: scarce ? ["plan", "review", "recovery"] : ["plan", "code", "review"],
    dataClasses: ["public_test", "non_personal_test", "source_code"],
    contextWindowTokens: model.contextWindowTokens,
    maxOutputTokens: model.maxOutputTokens,
    capacity: {
      unit: "provider_reported",
      maxConcurrentRequests: 1,
      ...(input.quota.requestsPerMinute ? { requestsPerMinute: input.quota.requestsPerMinute } : {}),
      ...(dailyRequests ? { requestsPerDay: dailyRequests } : {}),
      ...(input.quota.tokensPerMinute ? { tokensPerMinute: input.quota.tokensPerMinute } : {}),
      ...(dailyTokens ? { tokensPerDay: dailyTokens } : {})
    },
    ...(scarce
      ? { reservation: { kinds: ["review", "recovery"], requestsPerDay: 4, tokensPerDay: 40_000 } }
      : dailyRequests && dailyRequests > 10
        ? { reservation: { kinds: ["review"], requestsPerDay: Math.max(1, Math.floor(dailyRequests * 0.1)) } }
        : {}),
    usage: {
      ...input.usage,
      providerRemainingRequests: input.quota.remainingRequests,
      providerRemainingTokens: input.quota.remainingTokens,
      providerResetAt: input.quota.resetAt
    },
    circuitOpenUntil: 0
  };
}

export function classifyLocalizedProviderError(input: {
  readonly providerId: ExpandedProviderId;
  readonly status: number;
  readonly message: string;
}): "authentication" | "region" | "account_verification" | "quota" | "credit" | "provider" {
  const normalized = input.message.toLowerCase();
  if (input.status === 401 || input.status === 403) {
    if (/地区|region|地域/.test(normalized)) return "region";
    if (/实名|verification|认证/.test(normalized)) return "account_verification";
    return "authentication";
  }
  if (input.status === 402 || /余额|balance|credit/.test(normalized)) return "credit";
  if (input.status === 429 || /限流|quota|rate.?limit/.test(normalized)) return "quota";
  return "provider";
}

function capabilityRoles(capabilities: readonly string[]): readonly ("planner" | "implementer" | "reviewer")[] {
  const roles: ("planner" | "implementer" | "reviewer")[] = ["planner", "reviewer"];
  if (capabilities.includes("structured_output")) roles.push("implementer");
  return roles;
}

function denied(
  reason: Exclude<ExpandedAdmissionReason, "ready" | "scheduled_wait" | "quota_exhausted">,
  detail: string,
  retryAt: number | null,
  permanentFree: boolean
): ExpandedAdmissionDecision {
  const needsUser = [
    "region_restricted",
    "account_verification_required",
    "payment_uncertain",
    "credit_composition_unknown",
    "credit_fund_separation_unproven"
  ].includes(reason);
  return {
    admitted: false,
    state: needsUser ? "needs_user" : "denied",
    reason,
    detail,
    retryAt,
    permanentFree
  };
}
