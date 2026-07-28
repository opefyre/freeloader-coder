import assert from "node:assert/strict";
import test from "node:test";
import {
  buildProviderTelemetry,
  routeProviders,
  summarizeProviderAttempts,
  type ProviderCandidate
} from "../packages/providers/src/index.js";

const candidate: ProviderCandidate = {
  id: "groq-code",
  providerId: "groq",
  modelId: "gpt-oss",
  priority: 1,
  configured: true,
  privacy: "training_eligible",
  location: "external",
  paid: false,
  costClass: "free",
  billingMode: "free_tier",
  roles: ["implementer"],
  kinds: ["code"],
  dataClasses: ["source_code"],
  contextWindowTokens: 128_000,
  maxOutputTokens: 64_000,
  capacity: { unit: "provider_reported" },
  usage: {
    requestsToday: 4,
    tokensToday: 1_500,
    inputTokensToday: 1_000,
    outputTokensToday: 500,
    requestTimestamps: [],
    tokenSamples: [],
    providerRemainingRequests: 0,
    providerResetAt: 5_000
  },
  circuitOpenUntil: 0
};

test("provider telemetry distinguishes configured status from proven successful execution", () => {
  const route = routeProviders([candidate], {
    role: "implementer",
    kind: "code",
    dataClass: "source_code",
    minimumPrivacy: "training_eligible",
    estimatedInputTokens: 100,
    requestedOutputTokens: 100,
    allowPaid: false,
    now: 1_000
  });
  const telemetry = buildProviderTelemetry({
    candidate,
    route,
    runtime: {
      successfulCalls: 0,
      failedCalls: 2,
      lastSuccessAt: null,
      lastFailureAt: 900
    },
    now: 1_000
  });
  assert.equal(telemetry.health, "limited");
  assert.equal(telemetry.successfulCalls, 0);
  assert.equal(telemetry.failedCalls, 2);
  assert.equal(telemetry.retryAt, 5_000);
  assert.match(telemetry.statusDetail, /free allowance is exhausted/);
});

test("telemetry totals are projected from terminal attempt evidence", () => {
  const runtime = summarizeProviderAttempts([
    {
      providerId: "groq",
      status: "succeeded",
      startedAt: 100,
      finishedAt: 200
    },
    {
      providerId: "groq",
      status: "failed",
      startedAt: 300,
      finishedAt: 400
    },
    {
      providerId: "other",
      status: "succeeded",
      startedAt: 500,
      finishedAt: 600
    }
  ], "groq");
  assert.deepEqual(runtime, {
    successfulCalls: 1,
    failedCalls: 1,
    lastSuccessAt: 200,
    lastFailureAt: 400
  });
});
