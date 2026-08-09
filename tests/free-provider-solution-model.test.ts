import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { FreeProviderSolutionModel } from "../apps/core/src/free-provider-solution-model.js";
import type { ProviderAdapter } from "../packages/providers/src/index.js";
import type { ProviderConnection } from "../packages/schemas/src/index.js";

const now = 1_800_000_000_000;
const projectId = "project_abcdef0123456789";
const contextDigest = "a".repeat(64);

test("solution model uses only consented free providers and replays durable output", async () => {
  const root = await mkdtemp(join(tmpdir(), "solution-model-"));
  try {
    let calls = 0;
    const connections = [connection("cerebras", "gpt-oss-120b"), connection("mistral", "mistral-small-latest")];
    const model = new FreeProviderSolutionModel(root, { list: async () => connections } as any, { read: async () => "safe-test-credential" }, {
      adapter: (providerId) => ({ manifest: { providerId }, chat: async (_credential: unknown, request: any) => { calls += 1; return { schemaVersion: 1, providerId, modelId: request.modelId, requestId: request.requestId, content: JSON.stringify({ findings: ["Grounded product finding."] }), finishReason: "stop", usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15, estimated: false, extensions: [] }, toolCalls: [], extensions: [], verified: false }; } }) as unknown as ProviderAdapter,
    }, () => now);
    const input = { projectId, role: "product_research" as const, contextDigest, instruction: "Analyze product behavior.", sources: [{ name: "CONTEXT.md", content: "# Context\n\nNon-personal test source." }], permit: { schemaVersion: 1 as const, projectId, contextDigest, dataClass: "source_code" as const, providerIds: ["cerebras"], approvedAt: now - 1, expiresAt: now + 60_000 } };
    const first = await model.run(input);
    assert.equal(first.providerId, "cerebras");
    assert.equal(calls, 1);
    await model.run(input);
    assert.equal(calls, 1);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("solution model rejects mismatched consent and personal or secret content before dispatch", async () => {
  const root = await mkdtemp(join(tmpdir(), "solution-model-denied-"));
  try {
    let calls = 0;
    const model = new FreeProviderSolutionModel(root, { list: async () => [connection("cerebras", "gpt-oss-120b")] } as any, { read: async () => "safe-test-credential" }, { adapter: () => ({ chat: async () => { calls += 1; throw new Error("must not dispatch"); } }) as unknown as ProviderAdapter }, () => now);
    const permit = { schemaVersion: 1 as const, projectId, contextDigest, dataClass: "source_code" as const, providerIds: ["cerebras"], approvedAt: now - 1, expiresAt: now + 60_000 };
    await assert.rejects(() => model.run({ projectId, role: "product_research", contextDigest: "b".repeat(64), instruction: "Analyze.", sources: [{ name: "CONTEXT.md", content: "safe" }], permit }), /invalid or expired/);
    await assert.rejects(() => model.run({ projectId, role: "product_research", contextDigest, instruction: "Analyze.", sources: [{ name: "CONTEXT.md", content: "Owner: person@example.com" }], permit }), /must remain local/);
    assert.equal(calls, 0);
  } finally { await rm(root, { recursive: true, force: true }); }
});

function connection(providerId: "cerebras" | "mistral", modelId: string): ProviderConnection {
  const limits = providerId === "cerebras" ? { context: 131_000, output: 40_000, url: "https://api.cerebras.ai/v1" } : { context: 256_000, output: 32_000, url: "https://api.mistral.ai/v1" };
  return { schemaVersion: 1, id: `connection-${providerId}`, providerId, modelId, apiBaseUrl: limits.url, credentialReference: `vault:providers/${providerId}/primary`, credentialFingerprint: "012345abcdef", credentialState: "active", state: "ready", privacyClass: "training_eligible", capabilityRoles: ["implementer"], contextWindowTokens: limits.context, maxOutputTokens: limits.output, cost: { access: "account_limited_free", plan: "Free", zeroCost: true, billingEnabled: false, observedAt: now - 1, expiresAt: now + 60_000, source: "account_api" }, quota: { source: "account_api", observedAt: now - 1, expiresAt: now + 60_000, requestsPerMinute: 5, requestsPerDay: 100, tokensPerMinute: 30_000, tokensPerDay: 1_000_000, remainingRequests: 90, remainingTokens: 900_000, resetAt: now + 60_000 }, canary: { status: "passed", observedAt: now - 1, expiresAt: now + 60_000, modelId, capabilities: ["chat", "structured_output"], inputTokens: 1, outputTokens: 1, failureCode: null }, updatedAt: now - 1 };
}
