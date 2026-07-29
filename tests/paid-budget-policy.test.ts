import assert from "node:assert/strict";
import test from "node:test";

import {
  authorizePaidCall,
  recordPaidUsage,
  type PaidBudgetAuthorization,
} from "../packages/policy/src/paid-budget.js";

const digest = "a".repeat(64);
const authorization: PaidBudgetAuthorization = {
  schemaVersion: 1,
  authorizationId: "auth-openai-1",
  providerId: "openai",
  connectionId: "openai-api",
  projectId: "project-main",
  modelId: "model-user-selected",
  roles: ["analysis"],
  currency: "USD",
  perRequestMinor: 10,
  perTaskMinor: 20,
  dailyMinor: 50,
  monthlyMinor: 100,
  taskSpentMinor: 2,
  dailySpentMinor: 5,
  monthlySpentMinor: 10,
  approvedAt: 100,
  expiresAt: 1_000,
  revokedAt: null,
  emergencyDisabled: false,
  confirmationDigest: digest,
};
const proposal = {
  providerId: "openai" as const,
  connectionId: "openai-api",
  projectId: "project-main",
  modelId: "model-user-selected",
  role: "analysis" as const,
  estimatedCostMinor: 5,
  confirmationDigest: digest,
};

test("paid calls require an exact live authorization and every hard budget", () => {
  const allowed = authorizePaidCall(authorization, proposal, 200);
  assert.equal(allowed.allowed, true);
  if (allowed.allowed) {
    assert.equal(allowed.remainingRequestMinor, 5);
    assert.equal(allowed.remainingMonthlyMinor, 85);
  }
  for (const decision of [
    authorizePaidCall(null, proposal, 200),
    authorizePaidCall({ ...authorization, emergencyDisabled: true }, proposal, 200),
    authorizePaidCall({ ...authorization, revokedAt: 150 }, proposal, 200),
    authorizePaidCall({ ...authorization, expiresAt: 199 }, proposal, 200),
    authorizePaidCall(authorization, { ...proposal, modelId: "different" }, 200),
    authorizePaidCall(authorization, { ...proposal, role: "review" }, 200),
    authorizePaidCall(authorization, { ...proposal, confirmationDigest: "b".repeat(64) }, 200),
    authorizePaidCall(authorization, { ...proposal, estimatedCostMinor: 11 }, 200),
  ]) assert.equal(decision.allowed, false);
});

test("usage evidence is attributable and cannot contain prompt content", () => {
  const record = recordPaidUsage({
    callId: "call-1",
    authorizationId: authorization.authorizationId,
    providerId: "openai",
    modelId: authorization.modelId,
    projectId: authorization.projectId,
    taskId: "task-1",
    purpose: "analysis",
    estimatedCostMinor: 5,
    actualCostMinor: 4,
    inputTokens: 100,
    outputTokens: 40,
    occurredAt: 250,
  });
  assert.equal(record.containsPromptContent, false);
  assert.equal("prompt" in record, false);
});

test("invalid budget hierarchy is rejected", () => {
  assert.throws(() =>
    authorizePaidCall({ ...authorization, perRequestMinor: 30 }, proposal, 200)
  );
});
