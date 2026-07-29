import assert from "node:assert/strict";
import test from "node:test";

import {
  buildOptionalPaidRequest,
  disconnectedOptionalProviders,
  optionalPaidProviderSchema,
} from "../packages/providers/src/index.js";

const digest = "c".repeat(64);

test("OpenAI and Anthropic remain disabled without credentials or budgets", () => {
  for (const connection of disconnectedOptionalProviders) {
    const decision = buildOptionalPaidRequest({
      connection,
      authorization: null,
      proposal: {
        providerId: connection.providerId,
        connectionId: connection.connectionId,
        projectId: connection.projectId,
        modelId: connection.modelId,
        role: "analysis",
        estimatedCostMinor: 1,
        confirmationDigest: digest,
      },
      requestId: `request-${connection.providerId}`,
      maxOutputTokens: 500,
      timeoutMs: 30_000,
      now: 200,
    });
    assert.equal(decision.allowed, false);
  }
});

test("authorized descriptors use fixed official surfaces and no secret value", () => {
  const connection = {
    ...disconnectedOptionalProviders[0]!,
    state: "ready" as const,
    credentialRef: "vault://providers/openai",
    allowedRoles: ["analysis" as const],
  };
  const decision = buildOptionalPaidRequest({
    connection,
    authorization: {
      schemaVersion: 1,
      authorizationId: "authorization-1",
      providerId: "openai",
      connectionId: connection.connectionId,
      projectId: connection.projectId,
      modelId: connection.modelId,
      roles: ["analysis"],
      currency: "USD",
      perRequestMinor: 5,
      perTaskMinor: 10,
      dailyMinor: 20,
      monthlyMinor: 50,
      taskSpentMinor: 0,
      dailySpentMinor: 0,
      monthlySpentMinor: 0,
      approvedAt: 100,
      expiresAt: 1_000,
      revokedAt: null,
      emergencyDisabled: false,
      confirmationDigest: digest,
    },
    proposal: {
      providerId: "openai",
      connectionId: connection.connectionId,
      projectId: connection.projectId,
      modelId: connection.modelId,
      role: "analysis",
      estimatedCostMinor: 1,
      confirmationDigest: digest,
    },
    requestId: "request-openai",
    maxOutputTokens: 500,
    timeoutMs: 30_000,
    now: 200,
  });
  assert.equal(decision.allowed, true);
  if (decision.allowed) {
    assert.equal(decision.request.apiSurface, "responses");
    assert.equal(decision.request.storeProviderSide, false);
    assert.equal(JSON.stringify(decision.request).includes("sk-"), false);
  }
});

test("optional provider schemas reject browser sessions and unknown fields", () => {
  assert.throws(() =>
    optionalPaidProviderSchema.parse({
      ...disconnectedOptionalProviders[0],
      copiedBrowserSession: true,
    })
  );
});
