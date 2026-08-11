import assert from "node:assert/strict";
import test from "node:test";
import {
  createAdmittedProviderCandidate,
  costEvidenceFromAccount,
  evaluateProviderAdmission,
  ProviderCanaryError,
  quotaEvidenceFromHeaders,
  runOpenAiCompatibleCapabilityCanary,
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
    id: "connection-groq",
    providerId: "groq",
    modelId: "openai/gpt-oss-120b",
    apiBaseUrl: "https://api.groq.com/openai/v1",
    credentialReference: "vault:providers/groq/primary",
    credentialFingerprint: "012345abcdef",
    credentialState: "active",
    state: "ready",
    privacyClass: "training_eligible",
    capabilityRoles: ["planner", "implementer", "reviewer"],
    contextWindowTokens: 131_072,
    maxOutputTokens: 65_536,
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
      modelId: "openai/gpt-oss-120b",
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
  assert.equal(readyConnection().credentialReference, "vault:providers/groq/primary");
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

test("failed canaries expose specific safe repair guidance", () => {
  const wrongProject = readyConnection({
    canary: {
      ...readyConnection().canary,
      status: "failed",
      failureCode: "wrong-project"
    }
  });
  const decision = evaluateProviderAdmission({ connection: wrongProject, now });
  assert.equal(decision.reason, "canary-failed");
  assert.match(decision.detail, /different project/);
  assert.equal(decision.detail.includes("provider-test-value"), false);
});

test("an admitted candidate uses account limits and provider remaining capacity", () => {
  const candidate = createAdmittedProviderCandidate({
    connection: readyConnection(),
    now,
    priority: 10,
    usage: emptyUsage
  });
  assert.equal(candidate.configured, true);
  assert.equal(candidate.providerConnectionId, "connection-groq");
  assert.equal(candidate.capacity.requestsPerDay, 2_400);
  assert.equal(candidate.usage.providerRemainingRequests, 2_399);
  assert.equal(candidate.reservation?.requestsPerDay, 240);
});

test("promotional credit and billing-enabled connections cannot enter permanent free routing", () => {
  const cohere = providerConnectionSchema.parse({
    ...readyConnection(),
    id: "connection-cohere",
    providerId: "cohere",
    modelId: "command-a-03-2025",
    apiBaseUrl: "https://api.cohere.ai/compatibility/v1",
    contextWindowTokens: 256_000,
    maxOutputTokens: 8_192,
    cost: {
      ...readyConnection().cost,
      access: "promotional_credit",
      plan: "Granted balance",
      zeroCost: true
    },
    canary: {
      ...readyConnection().canary,
      modelId: "command-a-03-2025"
    }
  });
  assert.equal(
    evaluateProviderAdmission({ connection: cohere, now }).reason,
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
    providerId: "groq",
    modelId: "openai/gpt-oss-120b",
    apiKey: "provider-test-value",
    now,
    transport: async (_url, init) => {
      observedAuthorization = init.headers.authorization ?? "";
      observedBody = init.body;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          model: "openai/gpt-oss-120b",
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
      providerId: "groq",
      modelId: "openai/gpt-oss-120b",
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

test("capability canary proves chat, structured output, and tool calling independently", async () => {
  const requestedBodies: unknown[] = [];
  const evidence = await runOpenAiCompatibleCapabilityCanary({
    providerId: "groq",
    modelId: "openai/gpt-oss-120b",
    apiKey: "provider-test-value",
    now,
    capabilities: ["chat", "structured_output", "tool_calling"],
    transport: async (_url, init) => {
      const body: unknown = JSON.parse(init.body);
      requestedBodies.push(body);
      const record = body as Record<string, unknown>;
      const structured = "response_format" in record;
      const tools = "tools" in record;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          model: "openai/gpt-oss-120b",
          choices: [{
            message: tools
              ? {
                  content: null,
                  tool_calls: [{
                    function: {
                      name: "pipeline_canary",
                      arguments: "{\"status\":\"ready\"}"
                    }
                  }]
                }
              : {
                  content: structured
                    ? "{\"status\":\"PIPELINE_STUDIO_CANARY\"}"
                    : "PIPELINE_STUDIO_CANARY"
                }
          }],
          usage: { prompt_tokens: 2, completion_tokens: 1 }
        })
      };
    }
  });
  assert.deepEqual(evidence.capabilities, ["chat", "structured_output", "tool_calling"]);
  assert.equal(evidence.inputTokens, 6);
  assert.equal(requestedBodies.length, 3);
});

test("capability canary cancellation becomes a safe timeout", async () => {
  await assert.rejects(
    runOpenAiCompatibleCapabilityCanary({
      providerId: "groq",
      modelId: "openai/gpt-oss-120b",
      apiKey: "provider-test-value",
      now,
      timeoutMs: 5,
      capabilities: ["chat"],
      transport: async (_url, init) => new Promise((_resolve, reject) => {
        init.signal.addEventListener("abort", () => reject(new Error("aborted")));
      })
    }),
    (error: unknown) =>
      error instanceof ProviderCanaryError && error.safeCode === "timeout"
  );
});

test("account response headers override documentation and expire quickly", () => {
  const evidence = quotaEvidenceFromHeaders({
    headers: {
      "X-RateLimit-Limit-Requests": "17",
      "x-ratelimit-remaining-requests": "3",
      "x-ratelimit-reset-at": String(Math.floor((now + 60_000) / 1_000))
    },
    documented: {
      requestsPerMinute: 5,
      tokensPerDay: 1_000_000
    },
    now
  });
  assert.equal(evidence.source, "response_headers");
  assert.equal(evidence.requestsPerMinute, 17);
  assert.equal(evidence.remainingRequests, 3);
  assert.equal(evidence.tokensPerDay, 1_000_000);
  assert.equal(evidence.resetAt, now + 60_000);
});

test("catalog cost evidence follows the verified access class and never ignores billing", () => {
  assert.deepEqual(costEvidenceFromAccount({
    providerId: "cohere",
    plan: "Granted balance",
    billingEnabled: false,
    now,
    source: "account_api"
  }).access, "account_limited_free");
  assert.equal(costEvidenceFromAccount({
    providerId: "groq",
    plan: "Free",
    billingEnabled: true,
    now,
    source: "account_api"
  }).zeroCost, false);
});
