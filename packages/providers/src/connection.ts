import {
  providerConnectionSchema,
  type ProviderCanaryEvidence,
  type ProviderConnection,
  type ProviderCostEvidence,
  type ProviderQuotaEvidence
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
  | "model-capacity-mismatch"
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
    connection.contextWindowTokens !== model.contextWindowTokens ||
    connection.maxOutputTokens !== model.maxOutputTokens
  ) {
    return denied(
      "model-capacity-mismatch",
      "The connection model limits do not match the verified catalog.",
      null
    );
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
      canaryRepairGuidance(connection.canary.failureCode),
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
  readonly circuitOpenUntil?: number | undefined;
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
    id: `${input.connection.id}:${input.connection.providerId}:${input.connection.modelId}`,
    providerId: input.connection.providerId,
    modelId: input.connection.modelId,
    priority: input.priority,
    configured: true,
    privacy: input.connection.privacyClass,
    location: "external",
    paid: false,
    costClass: "free",
    billingMode: "free_tier",
    providerConnectionId: input.connection.id,
    roles: input.connection.capabilityRoles,
    kinds: ["plan", "code", "review"],
    dataClasses: ["public_test", "non_personal_test", "source_code"],
    contextWindowTokens: input.connection.contextWindowTokens,
    maxOutputTokens: input.connection.maxOutputTokens,
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
    circuitOpenUntil: input.circuitOpenUntil ?? 0
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

export async function runOpenAiCompatibleCapabilityCanary(input: {
  readonly providerId: string;
  readonly modelId: string;
  readonly apiKey: string;
  readonly now: number;
  readonly capabilities: readonly ProviderCapability[];
  readonly ttlMs?: number | undefined;
  readonly timeoutMs?: number | undefined;
  readonly transport: CanaryTransport;
}): Promise<ProviderCanaryEvidence> {
  const uniqueCapabilities = [...new Set(input.capabilities)];
  if (uniqueCapabilities.length === 0 || uniqueCapabilities.includes("long_context")) {
    throw new ProviderCanaryError("unsupported-canary");
  }
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
    input.timeoutMs ?? 20_000
  );
  let inputTokens = 0;
  let outputTokens = 0;
  try {
    for (const capability of uniqueCapabilities) {
      const response = await input.transport(
        `${normalizeUrl(provider.apiBaseUrl)}/chat/completions`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${input.apiKey}`,
            "content-type": "application/json"
          },
          body: JSON.stringify(capabilityRequest(input.modelId, capability)),
          signal: controller.signal
        }
      );
      if (!response.ok) throw new ProviderCanaryError(statusCode(response.status));
      const payload = await response.json();
      const usage = validateCapabilityPayload(payload, capability);
      inputTokens += usage.inputTokens;
      outputTokens += usage.outputTokens;
    }
    return {
      status: "passed",
      observedAt: input.now,
      expiresAt: input.now + (input.ttlMs ?? 86_400_000),
      modelId: input.modelId,
      capabilities: uniqueCapabilities,
      inputTokens,
      outputTokens,
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

export function quotaEvidenceFromHeaders(input: {
  readonly headers: Readonly<Record<string, string | undefined>>;
  readonly now: number;
  readonly documented?: {
    readonly requestsPerMinute?: number | undefined;
    readonly requestsPerDay?: number | undefined;
    readonly tokensPerMinute?: number | undefined;
    readonly tokensPerDay?: number | undefined;
  } | undefined;
  readonly ttlMs?: number | undefined;
}): ProviderQuotaEvidence {
  const headers = Object.fromEntries(
    Object.entries(input.headers).map(([key, value]) => [key.toLowerCase(), value])
  );
  const account = {
    requestsPerMinute: positiveInteger(headers["x-ratelimit-limit-requests"]),
    requestsPerDay: positiveInteger(headers["x-ratelimit-limit-requests-day"]),
    tokensPerMinute: positiveInteger(headers["x-ratelimit-limit-tokens"]),
    tokensPerDay: positiveInteger(headers["x-ratelimit-limit-tokens-day"]),
    remainingRequests: nonnegativeInteger(headers["x-ratelimit-remaining-requests"]),
    remainingTokens: nonnegativeInteger(headers["x-ratelimit-remaining-tokens"]),
    resetAt: epochMilliseconds(headers["x-ratelimit-reset-at"])
  };
  const observed = Object.values(account).some((value) => value !== null);
  return {
    source: observed ? "response_headers" : "conservative_default",
    observedAt: input.now,
    expiresAt: input.now + (input.ttlMs ?? (observed ? 900_000 : 300_000)),
    requestsPerMinute:
      account.requestsPerMinute ?? input.documented?.requestsPerMinute ?? null,
    requestsPerDay: account.requestsPerDay ?? input.documented?.requestsPerDay ?? null,
    tokensPerMinute: account.tokensPerMinute ?? input.documented?.tokensPerMinute ?? null,
    tokensPerDay: account.tokensPerDay ?? input.documented?.tokensPerDay ?? null,
    remainingRequests: account.remainingRequests,
    remainingTokens: account.remainingTokens,
    resetAt: account.resetAt
  };
}

export function costEvidenceFromAccount(input: {
  readonly providerId: string;
  readonly plan: string;
  readonly billingEnabled: boolean;
  readonly now: number;
  readonly source: "account_api" | "user_attestation";
  readonly ttlMs?: number | undefined;
}): ProviderCostEvidence {
  const provider = catalogProvider(input.providerId);
  const access = provider.freeAccess === "permanent"
    ? "permanent_free"
    : provider.freeAccess === "account_limited"
      ? "account_limited_free"
      : provider.freeAccess === "promotional_credit"
        ? "promotional_credit"
        : "unknown";
  return {
    access,
    plan: input.plan.trim() || "Unknown",
    zeroCost: provider.zeroCostEligible && !input.billingEnabled,
    billingEnabled: input.billingEnabled,
    observedAt: input.now,
    expiresAt: input.now + (input.ttlMs ?? 3_600_000),
    source: input.source
  };
}

function denied(
  reason: Exclude<ProviderAdmissionReason, "ready">,
  detail: string,
  retryAt: number | null
): ProviderAdmissionDecision {
  return { admitted: false, reason, detail, retryAt };
}

function canaryRepairGuidance(code: string | null): string {
  const guidance: Readonly<Record<string, string>> = {
    "authentication-denied": "The key was rejected. Create or copy a valid key and re-probe.",
    "wrong-project": "The key belongs to a different project. Select the intended project and create a matching key.",
    "wrong-region": "The endpoint and account region do not match. Select the account region shown by the provider.",
    "model-or-endpoint-unavailable": "The selected model or endpoint is unavailable. Choose a verified replacement model.",
    "schema-unproven": "Structured output did not match the required schema. Choose a compatible model or disable that capability.",
    "tool-call-unproven": "Tool calling could not be proven. Choose a compatible model or disable that capability.",
    "credit-unavailable": "The account has no eligible free balance. Permanent free routing remains disabled."
  };
  return code ? guidance[code] ?? "The latest live provider canary failed. Re-probe the connection." :
    "The latest live provider canary failed. Re-probe the connection.";
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

function capabilityRequest(modelId: string, capability: ProviderCapability): object {
  const base = {
    model: modelId,
    messages: [{
      role: "user",
      content: capability === "tool_calling"
        ? "Call the pipeline_canary tool with status ready."
        : "Return the requested canary value."
    }],
    max_tokens: 32,
    temperature: 0
  };
  if (capability === "structured_output") {
    return {
      ...base,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "pipeline_canary",
          strict: true,
          schema: {
            type: "object",
            properties: { status: { const: "PIPELINE_STUDIO_CANARY" } },
            required: ["status"],
            additionalProperties: false
          }
        }
      }
    };
  }
  if (capability === "tool_calling") {
    return {
      ...base,
      tools: [{
        type: "function",
        function: {
          name: "pipeline_canary",
          description: "Proves bounded tool calling.",
          parameters: {
            type: "object",
            properties: { status: { const: "ready" } },
            required: ["status"],
            additionalProperties: false
          }
        }
      }],
      tool_choice: {
        type: "function",
        function: { name: "pipeline_canary" }
      }
    };
  }
  return {
    ...base,
    messages: [{
      role: "user",
      content: "Reply with exactly: PIPELINE_STUDIO_CANARY"
    }]
  };
}

function validateCapabilityPayload(
  input: unknown,
  capability: ProviderCapability
): { readonly inputTokens: number; readonly outputTokens: number } {
  if (!isRecord(input) || !Array.isArray(input.choices) || !isRecord(input.choices[0])) {
    throw new ProviderCanaryError("malformed-response");
  }
  const message = input.choices[0].message;
  if (!isRecord(message)) throw new ProviderCanaryError("malformed-response");
  if (capability === "tool_calling") {
    const calls = message.tool_calls;
    if (!Array.isArray(calls) || !isRecord(calls[0]) || !isRecord(calls[0].function)) {
      throw new ProviderCanaryError("tool-call-unproven");
    }
    if (calls[0].function.name !== "pipeline_canary") {
      throw new ProviderCanaryError("tool-call-unproven");
    }
    try {
      const argumentsValue: unknown = JSON.parse(String(calls[0].function.arguments));
      if (!isRecord(argumentsValue) || argumentsValue.status !== "ready") {
        throw new ProviderCanaryError("tool-call-unproven");
      }
    } catch (error) {
      if (error instanceof ProviderCanaryError) throw error;
      throw new ProviderCanaryError("tool-call-unproven");
    }
  } else {
    if (typeof message.content !== "string" || !message.content.trim()) {
      throw new ProviderCanaryError("empty-response");
    }
    if (capability === "structured_output") {
      try {
        const value: unknown = JSON.parse(message.content);
        if (!isRecord(value) || value.status !== "PIPELINE_STUDIO_CANARY") {
          throw new ProviderCanaryError("schema-unproven");
        }
      } catch (error) {
        if (error instanceof ProviderCanaryError) throw error;
        throw new ProviderCanaryError("schema-unproven");
      }
    } else if (message.content.trim() !== "PIPELINE_STUDIO_CANARY") {
      throw new ProviderCanaryError("chat-unproven");
    }
  }
  const usage = isRecord(input.usage) ? input.usage : {};
  return {
    inputTokens: integerOrZero(usage.prompt_tokens),
    outputTokens: integerOrZero(usage.completion_tokens)
  };
}

function positiveInteger(input: string | undefined): number | null {
  if (input === undefined || !/^\d+$/.test(input)) return null;
  const value = Number(input);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

function nonnegativeInteger(input: string | undefined): number | null {
  if (input === undefined || !/^\d+$/.test(input)) return null;
  const value = Number(input);
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function epochMilliseconds(input: string | undefined): number | null {
  const value = nonnegativeInteger(input);
  if (value === null) return null;
  return value < 10_000_000_000 ? value * 1_000 : value;
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}

function integerOrZero(input: unknown): number {
  return typeof input === "number" && Number.isInteger(input) && input >= 0 ? input : 0;
}
