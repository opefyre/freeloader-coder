import {
  providerConnectionSchema,
  type ProviderCanaryEvidence,
  type ProviderConnection
} from "../../schemas/src/index.js";
import { catalogProvider } from "./catalog.js";
import type {
  ProviderCandidate,
  ProviderCapacityUsage
} from "./router.js";

export type ProviderCapability =
  | "chat"
  | "structured_output"
  | "tool_calling"
  | "long_context";

export type ProviderAdmissionReason =
  | "ready"
  | "connection-not-ready"
  | "credential-revoked"
  | "endpoint-mismatch"
  | "model-mismatch"
  | "not-permanent-free"
  | "billing-enabled"
  | "cost-evidence-stale"
  | "quota-evidence-stale"
  | "canary-failed"
  | "canary-stale"
  | "capability-unproven";

export interface ProviderAdmissionDecision {
  readonly admitted: boolean;
  readonly reason: ProviderAdmissionReason;
  readonly detail: string;
  readonly retryAt: number | null;
}

export function evaluateProviderAdmission(input: {
  readonly connection: ProviderConnection;
  readonly now: number;
  readonly requiredCapabilities?: readonly ProviderCapability[] | undefined;
}): ProviderAdmissionDecision {
  const connection = providerConnectionSchema.parse(input.connection);
  const provider = catalogProvider(connection.providerId);
  const model = provider.models.find((entry) => entry.id === connection.modelId);

  if (connection.credentialState === "revoked" || connection.state === "revoked") {
    return denied("credential-revoked", "The credential was revoked. Connect a new key.", null);
  }
  if (connection.state !== "ready") {
    return denied(
      "connection-not-ready",
      "The connection has not completed its admission checks.",
      null
    );
  }
  if (normalizeUrl(connection.apiBaseUrl) !== normalizeUrl(provider.apiBaseUrl)) {
    return denied(
      "endpoint-mismatch",
      "The endpoint does not match the verified provider catalog.",
      null
    );
  }
  if (!model) {
    return denied("model-mismatch", "The selected model is not in the verified catalog.", null);
  }
  if (
    !provider.zeroCostEligible ||
    !["permanent_free", "account_limited_free"].includes(connection.cost.access) ||
    !connection.cost.zeroCost
  ) {
    return denied(
      "not-permanent-free",
      "This connection is not eligible for permanent free-only routing.",
      null
    );
  }
  if (connection.cost.billingEnabled) {
    return denied(
      "billing-enabled",
      "Billing-enabled connections are excluded from free-only routing.",
      null
    );
  }
  if (connection.cost.expiresAt <= input.now) {
    return denied(
      "cost-evidence-stale",
      "Free-plan evidence expired and must be checked again.",
      connection.cost.expiresAt
    );
  }
  if (connection.quota.expiresAt <= input.now) {
    return denied(
      "quota-evidence-stale",
      "Account-limit evidence expired and must be checked again.",
      connection.quota.expiresAt
    );
  }
  if (connection.canary.status !== "passed") {
    return denied(
      "canary-failed",
      "The latest live provider canary failed.",
      null
    );
  }
  if (connection.canary.expiresAt <= input.now) {
    return denied(
      "canary-stale",
      "The live provider canary expired and must be run again.",
      connection.canary.expiresAt
    );
  }
  const requiredCapabilities = input.requiredCapabilities ?? ["chat"];
  const missingCapability = requiredCapabilities.find(
    (capability) => !connection.canary.capabilities.includes(capability)
  );
  if (missingCapability) {
    return denied(
      "capability-unproven",
      `The ${missingCapability.replaceAll("_", " ")} capability has not been proven.`,
      null
    );
  }
  return {
    admitted: true,
    reason: "ready",
    detail: "Credential, free-plan, quota, model, endpoint, and canary evidence are current.",
    retryAt: null
  };
}

export function createAdmittedProviderCandidate(input: {
  readonly connection: ProviderConnection;
  readonly now: number;
  readonly priority: number;
  readonly usage: ProviderCapacityUsage;
  readonly requiredCapabilities?: readonly ProviderCapability[] | undefined;
}): ProviderCandidate {
  const decision = evaluateProviderAdmission(input);
  if (!decision.admitted) {
    throw new Error(`Provider connection is not admitted: ${decision.reason}.`);
  }
  const provider = catalogProvider(input.connection.providerId);
  const model = provider.models.find((entry) => entry.id === input.connection.modelId);
  if (!model) throw new Error("Admitted provider model disappeared from the catalog.");

  const quota = input.connection.quota;
  const requestsPerDay = quota.requestsPerDay ?? provider.documentedCapacity.requestsPerDay;
  const tokensPerDay = quota.tokensPerDay ?? provider.documentedCapacity.tokensPerDay;
  return {
    id: `${input.connection.providerId}-${input.connection.modelId}`,
    providerId: input.connection.providerId,
    modelId: input.connection.modelId,
    priority: input.priority,
    configured: true,
    privacy: "training_eligible",
    location: "external",
    paid: false,
    costClass: "free",
    billingMode: "free_tier",
    providerConnectionId: input.connection.id,
    roles: ["planner", "implementer", "reviewer"],
    kinds: ["plan", "code", "review"],
    dataClasses: ["public_test", "non_personal_test", "source_code"],
    contextWindowTokens: model.contextWindowTokens,
    maxOutputTokens: model.maxOutputTokens,
    capacity: {
      unit: "provider_reported",
      maxConcurrentRequests: 1,
      ...(quota.requestsPerMinute ?? provider.documentedCapacity.requestsPerMinute
        ? {
            requestsPerMinute:
              quota.requestsPerMinute ?? provider.documentedCapacity.requestsPerMinute
          }
        : {}),
      ...(requestsPerDay ? { requestsPerDay } : {}),
      ...(quota.tokensPerMinute ?? provider.documentedCapacity.tokensPerMinute
        ? {
            tokensPerMinute:
              quota.tokensPerMinute ?? provider.documentedCapacity.tokensPerMinute
          }
        : {}),
      ...(tokensPerDay ? { tokensPerDay } : {})
    },
    ...(requestsPerDay && requestsPerDay > 2
      ? {
          reservation: {
            kinds: ["review"],
            requestsPerDay: Math.max(1, Math.floor(requestsPerDay * 0.1))
          }
        }
      : {}),
    usage: {
      ...input.usage,
      providerRemainingRequests: quota.remainingRequests,
      providerRemainingTokens: quota.remainingTokens,
      providerResetAt: quota.resetAt
    },
    circuitOpenUntil: 0
  };
}

export interface CanaryResponse {
  readonly ok: boolean;
  readonly status: number;
  readonly json: () => Promise<unknown>;
}

export interface CanaryTransport {
  (url: string, init: {
    readonly method: "POST";
    readonly headers: Readonly<Record<string, string>>;
    readonly body: string;
    readonly signal: AbortSignal;
  }): Promise<CanaryResponse>;
}

export class ProviderCanaryError extends Error {
  constructor(readonly safeCode: string) {
    super(`Provider canary failed: ${safeCode}.`);
    this.name = "ProviderCanaryError";
  }
}

export async function runOpenAiCompatibleChatCanary(input: {
  readonly providerId: string;
  readonly modelId: string;
  readonly apiKey: string;
  readonly now: number;
  readonly ttlMs?: number | undefined;
  readonly timeoutMs?: number | undefined;
  readonly transport: CanaryTransport;
}): Promise<ProviderCanaryEvidence> {
  const provider = catalogProvider(input.providerId);
  if (provider.protocol !== "openai_compatible") {
    throw new ProviderCanaryError("unsupported-protocol");
  }
  if (!provider.models.some((model) => model.id === input.modelId)) {
    throw new ProviderCanaryError("unverified-model");
  }
  if (input.apiKey.trim().length < 8) {
    throw new ProviderCanaryError("invalid-credential");
  }

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    input.timeoutMs ?? 15_000
  );
  try {
    const response = await input.transport(
      `${normalizeUrl(provider.apiBaseUrl)}/chat/completions`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${input.apiKey}`,
          "content-type": "application/json"
        },
        body: JSON.stringify({
          model: input.modelId,
          messages: [
            {
              role: "user",
              content: "Reply with exactly: PIPELINE_STUDIO_CANARY"
            }
          ],
          max_tokens: 16,
          temperature: 0
        }),
        signal: controller.signal
      }
    );
    if (!response.ok) throw new ProviderCanaryError(statusCode(response.status));
    const payload = await response.json();
    const parsed = parseCanaryPayload(payload);
    return {
      status: "passed",
      observedAt: input.now,
      expiresAt: input.now + (input.ttlMs ?? 86_400_000),
      modelId: parsed.modelId || input.modelId,
      capabilities: ["chat"],
      inputTokens: parsed.inputTokens,
      outputTokens: parsed.outputTokens,
      failureCode: null
    };
  } catch (error) {
    if (error instanceof ProviderCanaryError) throw error;
    if (controller.signal.aborted) throw new ProviderCanaryError("timeout");
    throw new ProviderCanaryError("transport-failure");
  } finally {
    clearTimeout(timeout);
  }
}

function denied(
  reason: Exclude<ProviderAdmissionReason, "ready">,
  detail: string,
  retryAt: number | null
): ProviderAdmissionDecision {
  return { admitted: false, reason, detail, retryAt };
}

function normalizeUrl(url: string): string {
  return url.replace(/\/+$/, "");
}

function statusCode(status: number): string {
  if (status === 401 || status === 403) return "authentication-denied";
  if (status === 402) return "credit-unavailable";
  if (status === 404) return "model-or-endpoint-unavailable";
  if (status === 429) return "rate-limited";
  if (status >= 500) return "provider-unavailable";
  return "request-rejected";
}

function parseCanaryPayload(input: unknown): {
  readonly modelId: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
} {
  if (!isRecord(input)) throw new ProviderCanaryError("malformed-response");
  const choices = input.choices;
  if (!Array.isArray(choices) || !isRecord(choices[0])) {
    throw new ProviderCanaryError("malformed-response");
  }
  const message = choices[0].message;
  if (!isRecord(message) || typeof message.content !== "string" || !message.content.trim()) {
    throw new ProviderCanaryError("empty-response");
  }
  const usage = isRecord(input.usage) ? input.usage : {};
  return {
    modelId: typeof input.model === "string" ? input.model : "",
    inputTokens: integerOrZero(usage.prompt_tokens),
    outputTokens: integerOrZero(usage.completion_tokens)
  };
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}

function integerOrZero(input: unknown): number {
  return typeof input === "number" && Number.isInteger(input) && input >= 0 ? input : 0;
}
