import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { FreeProviderExecutionModel } from "../apps/core/src/free-provider-execution-model.js";
import type { ProviderAdapter } from "../packages/providers/src/index.js";
import type { ProviderConnection } from "../packages/schemas/src/index.js";

const now = 1_800_000_000_000;
const projectId = "project_abcdef0123456789";
const taskId = "plan_1111111111111111";

test("execution model admits an exact free assignment, records it, and replays durable output", async () => {
  const root = await mkdtemp(join(tmpdir(), "execution-model-"));
  try {
    let calls = 0;
    const stored = connection();
    const repository = { list: async () => [stored], read: async (id: string) => id === stored.id ? stored : null };
    const model = new FreeProviderExecutionModel(root, repository, { read: async () => "safe-test-credential" }, { adapter: (providerId) => ({ manifest: { providerId }, chat: async (_credential: unknown, request: any) => { calls += 1; return { schemaVersion: 1, providerId, modelId: request.modelId, requestId: request.requestId, content: JSON.stringify({ summary: "Bounded change", operations: [] }), finishReason: "stop", usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15, estimated: false, extensions: [] }, toolCalls: [], extensions: [], verified: false }; } }) as unknown as ProviderAdapter }, () => now);
    const permit = { schemaVersion: 1 as const, projectId, contextDigest: "a".repeat(64), dataClass: "source_code" as const, providerIds: ["groq"], approvedAt: now - 1, expiresAt: now + 60_000 };
    const candidates = await model.candidates(permit, "implementer");
    assert.equal(candidates.length, 1);
    assert.equal(candidates[0]?.billingEnabled, false);
    const input = { projectId, taskId, assignment: { providerId: "groq", modelId: "openai/gpt-oss-120b", deviceId: `provider:${stored.id}` }, role: "implementer" as const, permit, system: "Return JSON.", instruction: "Propose bounded changes.", sources: [{ name: "src/feature.ts", content: "export const value = 1;" }], responseSchema: { type: "object" } };
    assert.equal((await model.run(input)).providerId, "groq");
    assert.equal((await model.run(input)).providerId, "groq");
    assert.equal(calls, 1);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("execution model blocks billing, stale consent, and assignment drift before dispatch", async () => {
  const root = await mkdtemp(join(tmpdir(), "execution-model-denied-"));
  try {
    let calls = 0;
    const billed = connection({ cost: { ...connection().cost, billingEnabled: true, zeroCost: false } });
    const repository = { list: async () => [billed], read: async () => billed };
    const model = new FreeProviderExecutionModel(root, repository, { read: async () => "safe-test-credential" }, { adapter: () => ({ chat: async () => { calls += 1; throw new Error("must not dispatch"); } }) as unknown as ProviderAdapter }, () => now);
    const permit = { schemaVersion: 1 as const, projectId, contextDigest: "a".repeat(64), dataClass: "source_code" as const, providerIds: ["groq"], approvedAt: now - 1, expiresAt: now + 60_000 };
    assert.equal((await model.candidates(permit, "implementer")).length, 0);
    await assert.rejects(() => model.run({ projectId, taskId, assignment: { providerId: "groq", modelId: "wrong", deviceId: `provider:${billed.id}` }, role: "implementer", permit, system: "Return JSON.", instruction: "Work.", sources: [], responseSchema: {} }), /changed before execution/);
    assert.equal(calls, 0);
  } finally { await rm(root, { recursive: true, force: true }); }
});

function connection(overrides: Partial<ProviderConnection> = {}): ProviderConnection { return { schemaVersion: 1, id: "connection-groq", providerId: "groq", modelId: "openai/gpt-oss-120b", apiBaseUrl: "https://api.groq.com/openai/v1", credentialReference: "vault:providers/groq/primary", credentialFingerprint: "012345abcdef", credentialState: "active", state: "ready", privacyClass: "training_eligible", capabilityRoles: ["implementer", "reviewer"], contextWindowTokens: 131_072, maxOutputTokens: 65_536, cost: { access: "account_limited_free", plan: "Free", zeroCost: true, billingEnabled: false, observedAt: now - 1, expiresAt: now + 60_000, source: "account_api" }, quota: { source: "account_api", observedAt: now - 1, expiresAt: now + 60_000, requestsPerMinute: 5, requestsPerDay: 100, tokensPerMinute: 30_000, tokensPerDay: 1_000_000, remainingRequests: 90, remainingTokens: 900_000, resetAt: now + 60_000 }, canary: { status: "passed", observedAt: now - 1, expiresAt: now + 60_000, modelId: "openai/gpt-oss-120b", capabilities: ["chat", "structured_output"], inputTokens: 1, outputTokens: 1, failureCode: null }, updatedAt: now - 1, ...overrides }; }
