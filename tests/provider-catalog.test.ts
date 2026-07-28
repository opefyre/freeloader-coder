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
  assert.deepEqual(eligible, ["cerebras", "mistral", "zhipu", "sambanova"]);
  assert.equal(catalogProvider("deepseek").freeAccess, "promotional_credit");
  assert.throws(
    () => createFreeCatalogCandidate({
      providerId: "deepseek",
      modelId: "deepseek-v4-flash",
      configured: true,
      priority: 10,
      usage: emptyUsage
    }),
    /not eligible for automatic zero-cost routing/
  );
});

test("Cerebras candidate uses observed account limits and protects review capacity", () => {
  const candidate = createFreeCatalogCandidate({
    providerId: "cerebras",
    modelId: "gpt-oss-120b",
    configured: true,
    priority: 10,
    usage: emptyUsage
  });
  assert.equal(candidate.capacity.requestsPerMinute, 5);
  assert.equal(candidate.capacity.requestsPerDay, 2_400);
  assert.equal(candidate.capacity.tokensPerMinute, 30_000);
  assert.equal(candidate.capacity.tokensPerDay, 1_000_000);
  assert.equal(candidate.reservation?.requestsPerDay, 240);
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
