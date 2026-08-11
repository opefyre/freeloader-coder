import assert from "node:assert/strict";
import test from "node:test";

import {
  createRecordedProviderAdapter,
  normalizeProviderFailure,
  runProviderCompatibilitySuite,
  type ProviderAdapterFixture,
  type ProviderChatRequest
} from "../packages/providers/src/adapter.js";
import { catalogProvider } from "../packages/providers/src/catalog.js";
import {
  providerAdapterManifestSchema,
  providerAdapterResponseSchema
} from "../packages/schemas/src/index.js";

const now = 1_800_000_000_000;
const secret = "fixture-credential-value";
const request: ProviderChatRequest = {
  requestId: "request-contract",
  modelId: "fixture-model",
  messages: [{ role: "user", content: "Return a contract fixture." }],
  maxOutputTokens: 32,
  temperature: 0,
  timeoutMs: 5_000
};

function fixture(): ProviderAdapterFixture {
  const response = {
    schemaVersion: 1 as const,
    providerId: "fixture-provider",
    modelId: "fixture-model",
    requestId: request.requestId,
    content: "fixture response",
    finishReason: "stop" as const,
    usage: {
      inputTokens: 8,
      outputTokens: 2,
      totalTokens: 10,
      estimated: false,
      extensions: []
    },
    toolCalls: [],
    extensions: [],
    verified: false as const
  };
  return {
    manifest: {
      schemaVersion: 1,
      providerId: "fixture-provider",
      adapterVersion: "1.0.0",
      protocol: "openai_compatible",
      capabilities: [
        "chat",
        "streaming",
        "usage",
        "model_discovery",
        "quota_discovery"
      ],
      defaultTimeoutMs: 15_000,
      sourceUrls: ["https://example.com/provider-docs"],
      extensions: []
    },
    models: [{
      id: "fixture-model",
      label: "Fixture Model",
      contextWindowTokens: 32_000,
      maxOutputTokens: 4_000,
      capabilities: ["chat", "streaming", "usage"],
      lifecycle: "active",
      retiresAt: null,
      extensions: []
    }],
    credential: {
      valid: true,
      accountLabel: "Fixture account",
      error: null
    },
    quota: {
      source: "account_api",
      observedAt: now - 1_000,
      expiresAt: now + 60_000,
      requestsPerMinute: 5,
      requestsPerDay: 100,
      tokensPerMinute: 10_000,
      tokensPerDay: 100_000,
      remainingRequests: 99,
      remainingTokens: 99_000,
      resetAt: now + 60_000
    },
    response,
    stream: [
      { type: "content_delta", content: "fixture ", response: null },
      { type: "content_delta", content: "response", response: null },
      { type: "completed", content: "", response }
    ]
  };
}

test("all adapters pass the same versioned compatibility suite", async () => {
  const evidence = await runProviderCompatibilitySuite({
    adapter: createRecordedProviderAdapter(fixture()),
    credential: { secret },
    request,
    now
  });
  assert.equal(evidence.providerId, "fixture-provider");
  assert.deepEqual(
    evidence.checks.map((check) => check.name),
    [
      "credential-validation",
      "model-discovery",
      "quota-discovery",
      "normalized-response",
      "normalized-stream",
      "secret-redaction"
    ]
  );
  assert.equal(JSON.stringify(evidence).includes(secret), false);
});

test("the four verified free OpenAI-compatible endpoints share one conformance contract", async () => {
  for (const providerId of ["groq", "mistral", "zhipu", "sambanova"]) {
    const provider = catalogProvider(providerId);
    const model = provider.models[0]!;
    const base = fixture();
    const response = {
      ...base.response,
      providerId,
      modelId: model.id
    };
    const adapter = createRecordedProviderAdapter({
      ...base,
      manifest: {
        ...base.manifest,
        providerId,
        sourceUrls: [...provider.sourceUrls]
      },
      models: [{
        ...base.models[0]!,
        id: model.id,
        label: model.label,
        contextWindowTokens: model.contextWindowTokens,
        maxOutputTokens: model.maxOutputTokens
      }],
      response,
      stream: [
        { type: "content_delta", content: "fixture response", response: null },
        { type: "completed", content: "", response }
      ]
    });
    const evidence = await runProviderCompatibilitySuite({
      adapter,
      credential: { secret },
      request: { ...request, modelId: model.id },
      now
    });
    assert.equal(evidence.providerId, providerId);
    assert.equal(evidence.checks.every((check) => check.passed), true);
  }
});

test("provider-specific fields require a versioned extension envelope", () => {
  assert.throws(
    () => providerAdapterManifestSchema.parse({
      ...fixture().manifest,
      proprietaryRegion: "west"
    }),
    /Unrecognized key/
  );
  assert.doesNotThrow(() => providerAdapterManifestSchema.parse({
    ...fixture().manifest,
    extensions: [{
      schemaVersion: 1,
      namespace: "fixture.region",
      payload: { region: "west" }
    }]
  }));
  assert.throws(
    () => providerAdapterResponseSchema.parse({
      ...fixture().response,
      rawProviderPayload: { secret: "leak" }
    }),
    /Unrecognized key/
  );
});

test("provider failure details normalize into safe retry semantics", () => {
  assert.deepEqual(normalizeProviderFailure({
    status: 429,
    retryAt: now + 60_000,
    providerRequestId: "provider-request"
  }), {
    schemaVersion: 1,
    code: "rate_limited",
    safeMessage: "The provider rate limit is temporarily exhausted.",
    retryable: true,
    retryAt: now + 60_000,
    providerRequestId: "provider-request",
    extensions: []
  });
  assert.equal(normalizeProviderFailure({ status: 401 }).retryable, false);
  assert.equal(normalizeProviderFailure({ status: null, timedOut: true }).code, "timeout");
});

test("malformed recorded adapters fail before entering orchestration", () => {
  assert.throws(
    () => createRecordedProviderAdapter({
      ...fixture(),
      response: {
        ...fixture().response,
        usage: {
          ...fixture().response.usage,
          totalTokens: 99
        }
      }
    }),
    /Provider usage total/
  );
});
