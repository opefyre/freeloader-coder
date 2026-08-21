import assert from "node:assert/strict";
import test from "node:test";
import {
  catalogProvider,
  createFreeCatalogCandidate,
  verifiedProviderCatalog
} from "../packages/providers/src/catalog.js";
import { routeProviders } from "../packages/providers/src/router.js";

const emptyUsage = {
  requestsToday: 0,
  tokensToday: 0,
  inputTokensToday: 0,
  outputTokensToday: 0,
  requestTimestamps: [],
  tokenSamples: []
};

test("only verified permanent or account-limited providers enter free routing", () => {
  const eligible = verifiedProviderCatalog
    .filter((provider) => provider.zeroCostEligible)
    .map((provider) => provider.id);
  assert.deepEqual(eligible, [
    "groq",
    "gemini",
    "openrouter",
    "github-models",
    "nvidia-nim",
    "huggingface",
    "aion",
    "kilo",
    "cohere",
    "mistral",
    "zhipu",
    "sambanova"
  ]);
  assert.throws(() => catalogProvider("deepseek"), /Unknown provider catalog entry/);
  assert.throws(() => catalogProvider("cerebras"), /Unknown provider catalog entry/);
});

test("NVIDIA candidate remains conservative until live account limits are observed", () => {
  const candidate = createFreeCatalogCandidate({
    providerId: "nvidia-nim",
    modelId: "meta/llama-3.1-8b-instruct",
    configured: true,
    priority: 10,
    usage: emptyUsage
  });
  assert.equal(candidate.capacity.maxConcurrentRequests, 1);
  assert.equal(candidate.capacity.requestsPerDay, undefined);
});

test("unconfigured catalog providers remain visible but cannot receive work", () => {
  const candidate = createFreeCatalogCandidate({
    providerId: "sambanova",
    modelId: "DeepSeek-V3.1",
    configured: false,
    priority: 10,
    usage: emptyUsage
  });
  const route = routeProviders([candidate], {
    role: "implementer",
    kind: "code",
    dataClass: "source_code",
    minimumPrivacy: "training_eligible",
    estimatedInputTokens: 2_000,
    requestedOutputTokens: 1_000,
    allowPaid: false,
    now: 1_800_000_000_000
  });
  assert.equal(route.state, "blocked");
  assert.equal(route.rejected[0]?.reason, "provider-not-configured");
});
