import assert from "node:assert/strict";
import test from "node:test";
import {
  createAdmittedProviderCandidate,
  evaluateProviderAdmission,
  ProviderCanaryError,
  runOpenAiCompatibleChatCanary
} from "../packages/providers/src/connection.js";
import { providerConnectionSchema } from "../packages/schemas/src/index.js";

const now = 1_800_000_000_000;
const emptyUsage = {
  requestsToday: 0,
  tokensToday: 0,
  inputTokensToday: 0,
  outputTokensToday: 0,
  requestTimestamps: [],
  tokenSamples: []
};

function readyConnection(overrides: Record<string, unknown> = {}) {
  return providerConnectionSchema.parse({
    schemaVersion: 1,
    id: "connection-cerebras",
    providerId: "cerebras",
    modelId: "gpt-oss-120b",
    apiBaseUrl: "https://api.cerebras.ai/v1",
    credentialReference: "vault:providers/cerebras/primary",
    credentialFingerprint: "012345abcdef",
    credentialState: "active",
    state: "ready",
    cost: {
      access: "account_limited_free",
      plan: "Free",
      zeroCost: true,
      billingEnabled: false,
      observedAt: now - 1_000,
      expiresAt: now + 86_400_000,
      source: "account_api"
    },
    quota: {
      source: "account_api",
      observedAt: now - 1_000,
      expiresAt: now + 86_400_000,
      requestsPerMinute: 5,
      requestsPerDay: 2_400,
      tokensPerMinute: 30_000,
      tokensPerDay: 1_000_000,
      remainingRequests: 2_399,
      remainingTokens: 999_980,
      resetAt: now + 43_200_000
    },
    canary: {
      status: "passed",
      observedAt: now - 1_000,
      expiresAt: now + 86_400_000,
      modelId: "gpt-oss-120b",
      capabilities: ["chat", "structured_output"],
      inputTokens: 12,
      outputTokens: 4,
      failureCode: null
    },
    updatedAt: now - 1_000,
    ...overrides
  });
}

test("provider connection schema accepts references but rejects embedded credentials", () => {
  assert.equal(readyConnection().credentialReference, "vault:providers/cerebras/primary");
  assert.throws(
    () => readyConnection({ credentialReference: "embedded-credential-value" }),
    /Invalid string/
  );
  assert.throws(
    () => providerConnectionSchema.parse({
      ...readyConnection(),
      apiKey: "secret"
    }),
    /Unrecognized key/
  );
});

test("admission requires current endpoint, cost, quota, canary, and capability evidence", () => {
  const admitted = evaluateProviderAdmission({
    connection: readyConnection(),
    now,
    requiredCapabilities: ["chat", "structured_output"]
  });
  assert.equal(admitted.admitted, true);

  const staleCost = readyConnection({
    cost: {
      ...readyConnection().cost,
      expiresAt: now
    }
  });
  assert.equal(
    evaluateProviderAdmission({ connection: staleCost, now }).reason,
    "cost-evidence-stale"
  );

  assert.equal(
    evaluateProviderAdmission({
      connection: readyConnection(),
      now,
      requiredCapabilities: ["tool_calling"]
    }).reason,
    "capability-unproven"
  );
});

test("an admitted candidate uses account limits and provider remaining capacity", () => {
  const candidate = createAdmittedProviderCandidate({
    connection: readyConnection(),
    now,
    priority: 10,
    usage: emptyUsage
  });
  assert.equal(candidate.configured, true);
  assert.equal(candidate.providerConnectionId, "connection-cerebras");
  assert.equal(candidate.capacity.requestsPerDay, 2_400);
  assert.equal(candidate.usage.providerRemainingRequests, 2_399);
  assert.equal(candidate.reservation?.requestsPerDay, 240);
});

test("promotional credit and billing-enabled connections cannot enter permanent free routing", () => {
  const deepseek = providerConnectionSchema.parse({
    ...readyConnection(),
    id: "connection-deepseek",
    providerId: "deepseek",
    modelId: "deepseek-v4-flash",
    apiBaseUrl: "https://api.deepseek.com",
    cost: {
      ...readyConnection().cost,
      access: "promotional_credit",
      plan: "Granted balance",
      zeroCost: true
    },
    canary: {
      ...readyConnection().canary,
      modelId: "deepseek-v4-flash"
    }
  });
  assert.equal(
    evaluateProviderAdmission({ connection: deepseek, now }).reason,
    "not-permanent-free"
  );

  const billed = readyConnection({
    cost: {
      ...readyConnection().cost,
      billingEnabled: true
    }
  });
  assert.equal(
    evaluateProviderAdmission({ connection: billed, now }).reason,
    "billing-enabled"
  );
});

test("OpenAI-compatible canary sends a bounded request and returns sanitized evidence", async () => {
  let observedAuthorization = "";
  let observedBody = "";
  const evidence = await runOpenAiCompatibleChatCanary({
    providerId: "cerebras",
    modelId: "gpt-oss-120b",
    apiKey: "provider-test-value",
    now,
    transport: async (_url, init) => {
      observedAuthorization = init.headers.authorization ?? "";
      observedBody = init.body;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          model: "gpt-oss-120b",
          choices: [{ message: { content: "PIPELINE_STUDIO_CANARY" } }],
          usage: { prompt_tokens: 12, completion_tokens: 4 }
        })
      };
    }
  });
  assert.equal(observedAuthorization, "Bearer provider-test-value");
  assert.match(observedBody, /"max_tokens":16/);
  assert.deepEqual(evidence.capabilities, ["chat"]);
  assert.equal(evidence.inputTokens, 12);
  assert.equal(JSON.stringify(evidence).includes("secret"), false);
});

test("canary errors expose only safe classifications", async () => {
  await assert.rejects(
    runOpenAiCompatibleChatCanary({
      providerId: "cerebras",
      modelId: "gpt-oss-120b",
      apiKey: "provider-test-value",
      now,
      transport: async () => ({
        ok: false,
        status: 429,
        json: async () => ({ message: "raw provider detail" })
      })
    }),
    (error: unknown) =>
      error instanceof ProviderCanaryError &&
      error.safeCode === "rate-limited" &&
      !error.message.includes("raw provider detail")
  );
});
