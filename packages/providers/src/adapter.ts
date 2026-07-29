import {
  providerAdapterErrorSchema,
  providerAdapterManifestSchema,
  providerAdapterModelSchema,
  providerAdapterResponseSchema,
  providerQuotaEvidenceSchema,
  type ProviderAdapterError,
  type ProviderAdapterManifest,
  type ProviderAdapterModel,
  type ProviderAdapterResponse,
  type ProviderQuotaEvidence
} from "../../schemas/src/index.js";

export interface ProviderCredentialInput {
  readonly secret: string;
}

export interface ProviderCredentialResult {
  readonly valid: boolean;
  readonly accountLabel: string | null;
  readonly error: ProviderAdapterError | null;
}

export interface ProviderChatRequest {
  readonly requestId: string;
  readonly modelId: string;
  readonly messages: readonly {
    readonly role: "system" | "user" | "assistant";
    readonly content: string;
  }[];
  readonly maxOutputTokens: number;
  readonly temperature: number;
  readonly responseSchema?: Readonly<Record<string, unknown>> | undefined;
  readonly tools?: readonly {
    readonly name: string;
    readonly description: string;
    readonly inputSchema: Readonly<Record<string, unknown>>;
  }[] | undefined;
  readonly timeoutMs: number;
}

export interface ProviderStreamEvent {
  readonly type: "content_delta" | "tool_call_delta" | "usage" | "completed";
  readonly content: string;
  readonly response: ProviderAdapterResponse | null;
}

export interface ProviderAdapter {
  readonly manifest: ProviderAdapterManifest;
  validateCredential(input: ProviderCredentialInput): Promise<ProviderCredentialResult>;
  discoverModels(input: ProviderCredentialInput): Promise<readonly ProviderAdapterModel[]>;
  discoverQuota(input: ProviderCredentialInput, now: number): Promise<ProviderQuotaEvidence>;
  chat(
    credential: ProviderCredentialInput,
    request: ProviderChatRequest
  ): Promise<ProviderAdapterResponse>;
  stream(
    credential: ProviderCredentialInput,
    request: ProviderChatRequest
  ): AsyncIterable<ProviderStreamEvent>;
}

export interface ProviderAdapterFixture {
  readonly manifest: ProviderAdapterManifest;
  readonly models: readonly ProviderAdapterModel[];
  readonly credential: ProviderCredentialResult;
  readonly quota: ProviderQuotaEvidence;
  readonly response: ProviderAdapterResponse;
  readonly stream: readonly ProviderStreamEvent[];
}

export interface ProviderCompatibilityEvidence {
  readonly schemaVersion: 1;
  readonly providerId: string;
  readonly adapterVersion: string;
  readonly checks: readonly {
    readonly name: string;
    readonly passed: true;
  }[];
}

export class ProviderAdapterFailure extends Error {
  public readonly detail: ProviderAdapterError;
  public readonly code: string;
  public readonly retryAt: number | null;
  public readonly status: number | null;

  public constructor(detail: ProviderAdapterError) {
    const parsed = providerAdapterErrorSchema.parse(detail);
    super(parsed.safeMessage);
    this.name = "ProviderAdapterFailure";
    this.detail = parsed;
    this.code = parsed.code;
    this.retryAt = parsed.retryAt;
    this.status = statusForCode(parsed.code);
  }
}

function statusForCode(code: ProviderAdapterError["code"]): number | null {
  if (code === "authentication_denied") return 401;
  if (code === "permission_denied") return 403;
  if (code === "model_unavailable" || code === "model_retired") return 404;
  if (code === "quota_exhausted" || code === "rate_limited") return 429;
  if (code === "provider_unavailable") return 503;
  if (["unsupported_schema", "malformed_response", "request_rejected"].includes(code)) {
    return 400;
  }
  return null;
}

export function createRecordedProviderAdapter(fixture: ProviderAdapterFixture): ProviderAdapter {
  const manifest = providerAdapterManifestSchema.parse(fixture.manifest);
  const models = fixture.models.map((model) => providerAdapterModelSchema.parse(model));
  const quota = providerQuotaEvidenceSchema.parse(fixture.quota);
  const response = providerAdapterResponseSchema.parse(fixture.response);
  const credential = parseCredentialResult(fixture.credential);
  const stream = fixture.stream.map(parseStreamEvent);

  return {
    manifest,
    async validateCredential() {
      return credential;
    },
    async discoverModels() {
      return models;
    },
    async discoverQuota() {
      return quota;
    },
    async chat(_credential, request) {
      if (request.modelId !== response.modelId) {
        throw normalizedFailure("model_unavailable", false);
      }
      return response;
    },
    async *stream(_credential, request) {
      if (request.modelId !== response.modelId) {
        throw normalizedFailure("model_unavailable", false);
      }
      for (const event of stream) yield event;
    }
  };
}

export async function runProviderCompatibilitySuite(input: {
  readonly adapter: ProviderAdapter;
  readonly credential: ProviderCredentialInput;
  readonly request: ProviderChatRequest;
  readonly now: number;
}): Promise<ProviderCompatibilityEvidence> {
  const manifest = providerAdapterManifestSchema.parse(input.adapter.manifest);
  const checks: { name: string; passed: true }[] = [];
  const mark = (name: string): void => {
    checks.push({ name, passed: true });
  };

  const credential = parseCredentialResult(
    await input.adapter.validateCredential(input.credential)
  );
  if (!credential.valid || credential.error) {
    throw new Error("Compatibility credential fixture must be valid.");
  }
  mark("credential-validation");

  const models = (await input.adapter.discoverModels(input.credential)).map((model) =>
    providerAdapterModelSchema.parse(model)
  );
  if (!models.some((model) => model.id === input.request.modelId)) {
    throw new Error("Compatibility model discovery omitted the requested model.");
  }
  mark("model-discovery");

  const quota = providerQuotaEvidenceSchema.parse(
    await input.adapter.discoverQuota(input.credential, input.now)
  );
  if (quota.observedAt > input.now || quota.expiresAt <= input.now) {
    throw new Error("Compatibility quota evidence is not current.");
  }
  mark("quota-discovery");

  const response = providerAdapterResponseSchema.parse(
    await input.adapter.chat(input.credential, input.request)
  );
  if (response.providerId !== manifest.providerId || response.requestId !== input.request.requestId) {
    throw new Error("Compatibility response identity does not match the request.");
  }
  mark("normalized-response");

  const streamed: ProviderStreamEvent[] = [];
  for await (const event of input.adapter.stream(input.credential, input.request)) {
    streamed.push(parseStreamEvent(event));
  }
  if (streamed.length === 0 || streamed.at(-1)?.type !== "completed") {
    throw new Error("Compatibility stream did not terminate deterministically.");
  }
  mark("normalized-stream");

  if (JSON.stringify({ manifest, models, quota, response, streamed }).includes(input.credential.secret)) {
    throw new Error("Compatibility evidence contained credential material.");
  }
  mark("secret-redaction");

  return {
    schemaVersion: 1,
    providerId: manifest.providerId,
    adapterVersion: manifest.adapterVersion,
    checks
  };
}

export function normalizeProviderFailure(input: {
  readonly status: number | null;
  readonly timedOut?: boolean | undefined;
  readonly retryAt?: number | null | undefined;
  readonly providerRequestId?: string | null | undefined;
}): ProviderAdapterError {
  const code = input.timedOut
    ? "timeout"
    : input.status === 401
      ? "authentication_denied"
      : input.status === 403
        ? "permission_denied"
        : input.status === 404
          ? "model_unavailable"
          : input.status === 429
            ? "rate_limited"
            : input.status !== null && input.status >= 500
              ? "provider_unavailable"
              : input.status !== null
                ? "request_rejected"
                : "unknown";
  const retryable = ["timeout", "rate_limited", "provider_unavailable"].includes(code);
  return providerAdapterErrorSchema.parse({
    schemaVersion: 1,
    code,
    safeMessage: safeMessage(code),
    retryable,
    retryAt: input.retryAt ?? null,
    providerRequestId: input.providerRequestId ?? null,
    extensions: []
  });
}

function normalizedFailure(
  code: ProviderAdapterError["code"],
  retryable: boolean
): ProviderAdapterFailure {
  return new ProviderAdapterFailure({
    schemaVersion: 1,
    code,
    safeMessage: safeMessage(code),
    retryable,
    retryAt: null,
    providerRequestId: null,
    extensions: []
  });
}

function parseCredentialResult(input: ProviderCredentialResult): ProviderCredentialResult {
  if (typeof input.valid !== "boolean") throw new Error("Invalid credential result.");
  if (input.accountLabel !== null && !input.accountLabel.trim()) {
    throw new Error("Credential account label cannot be empty.");
  }
  const error = input.error === null ? null : providerAdapterErrorSchema.parse(input.error);
  if (input.valid === (error !== null)) {
    throw new Error("Credential result validity and error disagree.");
  }
  return {
    valid: input.valid,
    accountLabel: input.accountLabel,
    error
  };
}

function parseStreamEvent(input: ProviderStreamEvent): ProviderStreamEvent {
  if (!["content_delta", "tool_call_delta", "usage", "completed"].includes(input.type)) {
    throw new Error("Unknown provider stream event.");
  }
  if (input.response !== null) providerAdapterResponseSchema.parse(input.response);
  if (input.type === "completed" && input.response === null) {
    throw new Error("Completed provider stream event requires a response.");
  }
  if (input.type !== "completed" && input.response !== null) {
    throw new Error("Only completed provider stream events can contain a response.");
  }
  return input;
}

function safeMessage(code: ProviderAdapterError["code"]): string {
  const messages: Readonly<Record<ProviderAdapterError["code"], string>> = {
    authentication_denied: "The provider rejected this credential.",
    permission_denied: "The provider account does not permit this operation.",
    quota_exhausted: "The provider account quota is exhausted.",
    rate_limited: "The provider rate limit is temporarily exhausted.",
    model_retired: "The selected model has retired.",
    model_unavailable: "The selected model is unavailable.",
    unsupported_schema: "The provider cannot satisfy the requested schema.",
    timeout: "The provider request timed out.",
    provider_unavailable: "The provider is temporarily unavailable.",
    malformed_response: "The provider returned an invalid response.",
    request_rejected: "The provider rejected the request.",
    unknown: "The provider request failed."
  };
  return messages[code];
}
