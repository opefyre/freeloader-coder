import assert from "node:assert/strict";
import test from "node:test";

import {
  ProviderConnectionService,
  ProviderConnectionServiceError
} from "../apps/core/src/provider-connection-service.js";
import type { ProviderAdapter } from "../packages/providers/src/adapter.js";
import { createRecordedProviderAdapter } from "../packages/providers/src/adapter.js";
import type {
  CredentialVault,
  ProviderConnectionRepository
} from "../packages/providers/src/lifecycle.js";
import type { ProviderConnection } from "../packages/schemas/src/index.js";

const now = 1_800_000_000_000;
const secret = "provider-service-secret";

class MemoryVault implements CredentialVault {
  readonly values = new Map<string, string>();
  async write(reference: string, value: string) { this.values.set(reference, value); }
  async read(reference: string) { return this.values.get(reference) ?? null; }
  async delete(reference: string) { this.values.delete(reference); }
}

class MemoryRepository implements ProviderConnectionRepository {
  readonly values = new Map<string, ProviderConnection>();
  async read(id: string) { return this.values.get(id) ?? null; }
  async write(connection: ProviderConnection) { this.values.set(connection.id, structuredClone(connection)); }
  async delete(id: string) { this.values.delete(id); }
  async list() { return [...this.values.values()].map((connection) => structuredClone(connection)); }
}

function adapter(): ProviderAdapter {
  const recorded = createRecordedProviderAdapter({
    manifest: {
      schemaVersion: 1,
      providerId: "groq",
      adapterVersion: "1.0.0",
      protocol: "openai_compatible",
      capabilities: ["chat", "structured_output", "usage", "model_discovery", "quota_discovery"],
      defaultTimeoutMs: 45_000,
      sourceUrls: ["https://inference-docs.cerebras.ai/"],
      extensions: []
    },
    models: [{
      id: "openai/gpt-oss-120b",
      label: "GPT OSS 120B",
      contextWindowTokens: 131_000,
      maxOutputTokens: 40_000,
      capabilities: ["chat", "structured_output", "usage"],
      lifecycle: "active",
      retiresAt: null,
      extensions: []
    }],
    credential: { valid: true, accountLabel: "Free test", error: null },
    quota: {
      source: "conservative_default",
      observedAt: now,
      expiresAt: now + 900_000,
      requestsPerMinute: 5,
      requestsPerDay: 2_400,
      tokensPerMinute: 30_000,
      tokensPerDay: 1_000_000,
      remainingRequests: null,
      remainingTokens: null,
      resetAt: null
    },
    response: {
      schemaVersion: 1,
      providerId: "groq",
      modelId: "openai/gpt-oss-120b",
      requestId: `connection-canary-groq-${now}`,
      content: "{\"ok\":true}",
      finishReason: "stop",
      usage: { inputTokens: 10, outputTokens: 3, totalTokens: 13, estimated: false, extensions: [] },
      toolCalls: [],
      extensions: [],
      verified: false
    },
    stream: []
  });
  return {
    ...recorded,
    async chat(credential, request) {
      if (request.tools?.some((tool) => tool.name === "pipeline_capability_canary")) {
        return {
          schemaVersion: 1,
          providerId: "groq",
          modelId: "openai/gpt-oss-120b",
          requestId: request.requestId,
          content: "",
          finishReason: "tool_call",
          usage: { inputTokens: 11, outputTokens: 4, totalTokens: 15, estimated: false, extensions: [] },
          toolCalls: [{ id: "call_canary", name: "pipeline_capability_canary", argumentsJson: "{\"ok\":true}" }],
          extensions: [],
          verified: false
        };
      }
      return recorded.chat(credential, request);
    }
  };
}

function connectionInput(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    id: "groq-primary",
    providerId: "groq",
    modelId: "openai/gpt-oss-120b",
    secret,
    freeOnlyAttestation: true,
    billingEnabled: false,
    privacyClass: "training_eligible",
    capabilityRoles: ["planner", "implementer", "reviewer"],
    ...overrides
  };
}

test("live connection service admits only sanitized current free evidence", async () => {
  const vault = new MemoryVault();
  const repository = new MemoryRepository();
  const service = new ProviderConnectionService(repository, vault, {
    adapter: (providerId) => providerId === "groq" ? adapter() : null
  });
  const result = await service.connect(connectionInput(), now);
  assert.equal(result.connection?.admission.admitted, true);
  assert.equal(result.connection?.maskedCredential, "vault:••••");
  assert.equal(JSON.stringify(result).includes(secret), false);
  const collection = await service.list(now + 1);
  assert.equal(collection.automaticSpendLimitUsd, 0);
  assert.equal(collection.connections.length, 1);
  assert.equal(collection.catalog.some((provider) => provider.id === "deepseek"), false);
  assert.equal(collection.catalog.some((provider) => provider.id === "groq"), true);
  assert.equal(JSON.stringify(collection).includes("credentialReference"), false);
  assert.equal(JSON.stringify(collection).includes("credentialFingerprint"), false);
});

test("connection identity is idempotent for the same secret and conflicts on replacement", async () => {
  const vault = new MemoryVault();
  const repository = new MemoryRepository();
  const service = new ProviderConnectionService(repository, vault, { adapter: () => adapter() });
  await service.connect(connectionInput(), now);
  const replay = await service.connect(connectionInput(), now + 1);
  assert.equal(replay.connection?.updatedAt, now);
  await assert.rejects(
    service.connect(connectionInput({ secret: "different-valid-secret" }), now + 2),
    (error: unknown) =>
      error instanceof ProviderConnectionServiceError &&
      error.code === "connection-conflict"
  );
  assert.equal(vault.values.size, 1);
});

test("paid and promotional inputs fail before any credential is stored", async () => {
  const vault = new MemoryVault();
  const repository = new MemoryRepository();
  const service = new ProviderConnectionService(repository, vault, { adapter: () => adapter() });
  await assert.rejects(service.connect(connectionInput({ billingEnabled: true }), now));
  await assert.rejects(service.connect(connectionInput({
    id: "deepseek",
    providerId: "deepseek",
    modelId: "deepseek-v4-flash"
  }), now));
  assert.equal(vault.values.size, 0);
  assert.equal(repository.values.size, 0);
});

test("revoke and delete remove runtime eligibility and credential material", async () => {
  const vault = new MemoryVault();
  const repository = new MemoryRepository();
  const service = new ProviderConnectionService(repository, vault, { adapter: () => adapter() });
  await service.connect(connectionInput(), now);
  const revoked = await service.revoke("groq-primary", now + 1);
  assert.equal(revoked.connection?.admission.admitted, false);
  assert.equal(revoked.connection?.credentialState, "revoked");
  assert.equal(vault.values.size, 0);
  const deleted = await service.disconnect("groq-primary");
  assert.equal(deleted.connection, null);
  assert.equal(repository.values.size, 0);
});
