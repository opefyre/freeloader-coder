import {
  providerAdapterManifestSchema,
  providerAdapterModelSchema,
  providerAdapterResponseSchema,
  providerQuotaEvidenceSchema,
  type ProviderAdapterModel,
  type ProviderAdapterResponse,
} from "../../schemas/src/index.js";
import { catalogProvider } from "./catalog.js";
import {
  normalizeProviderFailure,
  ProviderAdapterFailure,
  type ProviderAdapter,
  type ProviderChatRequest,
  type ProviderCredentialInput,
} from "./adapter.js";

const MAX_RESPONSE_BYTES = 768_000;

export function createOpenAiCompatibleAdapter(input: {
  providerId: string;
  fetch?: typeof fetch;
}): ProviderAdapter {
  const provider = catalogProvider(input.providerId);
  if (provider.protocol !== "openai_compatible") {
    throw new Error("Provider protocol is not OpenAI compatible.");
  }
  const apiBaseUrl = canonicalBaseUrl(provider.apiBaseUrl);
  const request = input.fetch ?? fetch;
  const manifest = providerAdapterManifestSchema.parse({
    schemaVersion: 1,
    providerId: provider.id,
    adapterVersion: "1.0.0",
    protocol: "openai_compatible",
    capabilities: [
      "chat",
      "streaming",
      "structured_output",
      "usage",
      "model_discovery",
      "quota_discovery",
    ],
    defaultTimeoutMs: 120_000,
    sourceUrls: [...provider.sourceUrls],
    extensions: [],
  });

  async function authorizedJson(
    credential: ProviderCredentialInput,
    path: string,
    init: RequestInit,
    timeoutMs: number
  ): Promise<{ value: unknown; headers: Headers }> {
    assertCredential(credential);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    timer.unref?.();
    try {
      if (!/^\/[a-z0-9_./-]+$/i.test(path) || path.includes("..")) {
        throw new Error("Provider adapter path is not catalog-safe.");
      }
      const response = await request(`${apiBaseUrl}${path}`, {
        ...init,
        redirect: "error",
        signal: controller.signal,
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${credential.secret}`,
          ...(init.body ? { "Content-Type": "application/json" } : {}),
        },
      });
      if (!response.ok) {
        throw new ProviderAdapterFailure(
          normalizeProviderFailure({
            status: response.status,
            retryAt: parseRetryAt(response.headers),
            providerRequestId: safeRequestId(response.headers),
          })
        );
      }
      const contentType = response.headers.get("content-type") ?? "";
      if (!contentType.toLowerCase().includes("application/json")) {
        throw failure("malformed_response", false, safeRequestId(response.headers));
      }
      const length = Number(response.headers.get("content-length") ?? 0);
      if (Number.isFinite(length) && length > MAX_RESPONSE_BYTES) {
        throw failure("malformed_response", false, safeRequestId(response.headers));
      }
      const text = await readBoundedBody(response, MAX_RESPONSE_BYTES);
      try {
        return { value: JSON.parse(text), headers: response.headers };
      } catch {
        throw failure("malformed_response", false, safeRequestId(response.headers));
      }
    } catch (error) {
      if (error instanceof ProviderAdapterFailure) throw error;
      if (controller.signal.aborted) {
        throw new ProviderAdapterFailure(
          normalizeProviderFailure({ status: null, timedOut: true })
        );
      }
      throw new ProviderAdapterFailure(
        normalizeProviderFailure({ status: null })
      );
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    manifest,
    async validateCredential(credential) {
      try {
        await authorizedJson(
          credential,
          provider.modelsPath ?? "/models",
          { method: "GET" },
          15_000
        );
        return { valid: true, accountLabel: provider.label, error: null };
      } catch (error) {
        if (!(error instanceof ProviderAdapterFailure)) throw error;
        return { valid: false, accountLabel: null, error: error.detail };
      }
    },
    async discoverModels(credential) {
      const { value } = await authorizedJson(
        credential,
        provider.modelsPath ?? "/models",
        { method: "GET" },
        20_000
      );
      const discovered = modelIds(value);
      return provider.models
        .filter((model) => discovered.has(model.id))
        .map((model) =>
          providerAdapterModelSchema.parse({
            id: model.id,
            label: model.label,
            contextWindowTokens: model.contextWindowTokens,
            maxOutputTokens: model.maxOutputTokens,
            capabilities: ["chat", "streaming", "structured_output", "usage"],
            lifecycle: model.preview ? "retiring" : "active",
            retiresAt: null,
            extensions: [],
          })
        );
    },
    async discoverQuota(_credential, now) {
      return providerQuotaEvidenceSchema.parse({
        source: "conservative_default",
        observedAt: now,
        expiresAt: now + 15 * 60_000,
        requestsPerMinute: provider.documentedCapacity.requestsPerMinute ?? null,
        requestsPerDay: provider.documentedCapacity.requestsPerDay ?? null,
        tokensPerMinute: provider.documentedCapacity.tokensPerMinute ?? null,
        tokensPerDay: provider.documentedCapacity.tokensPerDay ?? null,
        remainingRequests: null,
        remainingTokens: null,
        resetAt: null,
      });
    },
    async chat(credential, chatRequest) {
      const { value, headers } = await authorizedJson(
        credential,
        provider.chatCompletionsPath ?? "/chat/completions",
        {
          method: "POST",
          body: JSON.stringify(toProviderRequest(chatRequest)),
        },
        chatRequest.timeoutMs
      );
      return normalizeResponse({
        providerId: provider.id,
        requestId: chatRequest.requestId,
        requestedModelId: chatRequest.modelId,
        value,
        providerRequestId: safeRequestId(headers),
      });
    },
    async *stream(credential, chatRequest) {
      const response = await this.chat(credential, chatRequest);
      if (response.content) {
        yield { type: "content_delta", content: response.content, response: null };
      }
      yield { type: "completed", content: "", response };
    },
  };
}

function canonicalBaseUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
    throw new Error("Provider API base URL must be a credential-free HTTPS origin path.");
  }
  return url.toString().replace(/\/$/, "");
}

function assertCredential(input: ProviderCredentialInput): void {
  if (input.secret.trim().length < 8 || input.secret.length > 16_384) {
    throw failure("authentication_denied", false, null);
  }
}

function toProviderRequest(request: ProviderChatRequest): Record<string, unknown> {
  return {
    model: request.modelId,
    messages: request.messages,
    max_tokens: request.maxOutputTokens,
    temperature: request.temperature,
    stream: false,
    ...(request.responseSchema
      ? {
          response_format: {
            type: "json_schema",
            json_schema: {
              name: "pipeline_studio_response",
              strict: true,
              schema: request.responseSchema,
            },
          },
        }
      : {}),
    ...(request.tools && request.tools.length > 0
      ? {
          tools: request.tools.map((tool) => ({
            type: "function",
            function: {
              name: tool.name,
              description: tool.description,
              parameters: tool.inputSchema,
            },
          })),
        }
      : {}),
  };
}

function normalizeResponse(input: {
  providerId: string;
  requestId: string;
  requestedModelId: string;
  value: unknown;
  providerRequestId: string | null;
}): ProviderAdapterResponse {
  const root = record(input.value);
  const choices = Array.isArray(root.choices) ? root.choices : [];
  const choice = record(choices[0]);
  const message = record(choice.message);
  const usage = record(root.usage);
  const inputTokens = integer(usage.prompt_tokens);
  const outputTokens = integer(usage.completion_tokens);
  const content = typeof message.content === "string" ? message.content : "";
  const finishReason = normalizeFinishReason(choice.finish_reason);
  if (!content && finishReason !== "tool_call") {
    throw failure("malformed_response", false, input.providerRequestId);
  }
  return providerAdapterResponseSchema.parse({
    schemaVersion: 1,
    providerId: input.providerId,
    modelId: typeof root.model === "string" ? root.model : input.requestedModelId,
    requestId: input.requestId,
    content,
    finishReason,
    usage: {
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
      estimated: !Number.isInteger(usage.prompt_tokens) || !Number.isInteger(usage.completion_tokens),
      extensions: [],
    },
    toolCalls: normalizeToolCalls(message.tool_calls),
    extensions: input.providerRequestId
      ? [{ schemaVersion: 1, namespace: "provider.request", payload: { id: input.providerRequestId } }]
      : [],
    verified: false,
  });
}

function normalizeToolCalls(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map((entry, index) => {
    const item = record(entry);
    const fn = record(item.function);
    return {
      id: typeof item.id === "string" ? item.id : `tool-${index + 1}`,
      name: typeof fn.name === "string" ? fn.name : "unknown",
      argumentsJson: typeof fn.arguments === "string" ? fn.arguments : "{}",
    };
  });
}

function normalizeFinishReason(value: unknown): ProviderAdapterResponse["finishReason"] {
  if (value === "stop") return "stop";
  if (value === "length") return "length";
  if (value === "tool_calls" || value === "function_call") return "tool_call";
  if (value === "content_filter") return "content_filter";
  return "unknown";
}

async function readBoundedBody(response: Response, limit: number): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  while (true) {
    const result = await reader.read();
    if (result.done) break;
    bytes += result.value.byteLength;
    if (bytes > limit) {
      await reader.cancel();
      throw failure("malformed_response", false, safeRequestId(response.headers));
    }
    chunks.push(result.value);
  }
  const combined = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(combined);
}

function modelIds(value: unknown): Set<string> {
  const root = record(value);
  const data = Array.isArray(value)
    ? value
    : Array.isArray(root.data)
      ? root.data
      : Array.isArray(root.models)
        ? root.models
        : [];
  return new Set(
    data.flatMap((item) => {
      const id = record(item).id;
      return typeof id === "string" ? [id] : [];
    })
  );
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};
}

function integer(value: unknown): number {
  return Number.isInteger(value) && Number(value) >= 0 ? Number(value) : 0;
}

function parseRetryAt(headers: Headers): number | null {
  const retryAfter = headers.get("retry-after");
  if (!retryAfter) return null;
  const seconds = Number(retryAfter);
  if (Number.isFinite(seconds) && seconds >= 0) return Date.now() + seconds * 1_000;
  const timestamp = Date.parse(retryAfter);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function safeRequestId(headers: Headers): string | null {
  const value =
    headers.get("x-request-id") ??
    headers.get("request-id") ??
    headers.get("cf-ray");
  return value && /^[a-zA-Z0-9._:-]{1,200}$/.test(value) ? value : null;
}

function failure(
  code: "authentication_denied" | "malformed_response",
  retryable: boolean,
  providerRequestId: string | null
): ProviderAdapterFailure {
  return new ProviderAdapterFailure({
    schemaVersion: 1,
    code,
    safeMessage:
      code === "authentication_denied"
        ? "The provider rejected this credential."
        : "The provider returned an invalid or oversized response.",
    retryable,
    retryAt: null,
    providerRequestId,
    extensions: [],
  });
}
