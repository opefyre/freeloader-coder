import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  ProviderConnectionLifecycle,
  resolveAdmittedProviderCandidates,
  type CredentialVault,
  type ProviderConnectionProbes,
  type ProviderConnectionRepository
} from "../packages/providers/src/lifecycle.js";
import {
  costEvidenceFromAccount,
  quotaEvidenceFromHeaders
} from "../packages/providers/src/connection.js";
import type { ProviderConnection } from "../packages/schemas/src/index.js";
import { JsonProviderConnectionRepository } from "../packages/storage/src/provider-connections.js";

const now = 1_800_000_000_000;
const secret = "provider-lifecycle-test-key";
const usage = {
  requestsToday: 0,
  tokensToday: 0,
  inputTokensToday: 0,
  outputTokensToday: 0,
  requestTimestamps: [],
  tokenSamples: []
};

class MemoryVault implements CredentialVault {
  public readonly values = new Map<string, string>();

  public async write(reference: string, value: string): Promise<void> {
    this.values.set(reference, value);
  }

  public async read(reference: string): Promise<string | null> {
    return this.values.get(reference) ?? null;
  }

  public async delete(reference: string): Promise<void> {
    this.values.delete(reference);
  }
}

class MemoryRepository implements ProviderConnectionRepository {
  public readonly values = new Map<string, ProviderConnection>();

  public async read(id: string): Promise<ProviderConnection | null> {
    return this.values.get(id) ?? null;
  }

  public async write(connection: ProviderConnection): Promise<void> {
    this.values.set(connection.id, structuredClone(connection));
  }

  public async delete(id: string): Promise<void> {
    this.values.delete(id);
  }

  public async list(): Promise<readonly ProviderConnection[]> {
    return [...this.values.values()].map((connection) => structuredClone(connection));
  }
}

function probes(canaryExpiresAt = now + 60_000): ProviderConnectionProbes {
  return {
    async cost(input) {
      return costEvidenceFromAccount({
        providerId: input.providerId,
        plan: "Free",
        billingEnabled: false,
        now: input.now,
        source: "account_api"
      });
    },
    async quota(input) {
      return quotaEvidenceFromHeaders({
        headers: {
          "x-ratelimit-limit-requests": "7",
          "x-ratelimit-remaining-requests": "6",
          "x-ratelimit-reset-at": String(Math.floor((input.now + 60_000) / 1_000))
        },
        documented: { requestsPerMinute: 5, requestsPerDay: 2_400 },
        now: input.now
      });
    },
    async canary(input) {
      return {
        status: "passed",
        observedAt: input.now,
        expiresAt: canaryExpiresAt,
        modelId: input.modelId,
        capabilities: [...input.capabilities],
        inputTokens: 12,
        outputTokens: 4,
        failureCode: null
      };
    }
  };
}

test("connection lifecycle persists only a reference and admits current zero-cost evidence", async () => {
  const vault = new MemoryVault();
  const repository = new MemoryRepository();
  const lifecycle = new ProviderConnectionLifecycle(vault, repository, probes());
  const result = await lifecycle.connect({
    id: "cerebras-primary",
    providerId: "cerebras",
    modelId: "gpt-oss-120b",
    secret,
    now,
    capabilities: ["chat", "structured_output"]
  });
  assert.equal(result.admission.admitted, true);
  assert.equal(result.connection.state, "ready");
  assert.equal(result.connection.quota.requestsPerMinute, 7);
  assert.equal(result.connection.quota.source, "response_headers");
  assert.equal(JSON.stringify(await repository.list()).includes(secret), false);
  assert.equal(vault.values.get(result.connection.credentialReference), secret);

  const resolution = resolveAdmittedProviderCandidates({
    connections: await repository.list(),
    now,
    requiredCapabilities: ["chat"],
    priorityByConnectionId: { "cerebras-primary": 1 },
    usageByConnectionId: { "cerebras-primary": usage }
  });
  assert.equal(resolution.candidates.length, 1);
  assert.equal(resolution.candidates[0]?.capacity.requestsPerMinute, 7);
});

test("restart re-probe uses the vault reference without exposing the key", async () => {
  const vault = new MemoryVault();
  const repository = new MemoryRepository();
  const first = new ProviderConnectionLifecycle(vault, repository, probes());
  await first.connect({
    id: "cerebras-primary",
    providerId: "cerebras",
    modelId: "gpt-oss-120b",
    secret,
    now,
    capabilities: ["chat"]
  });

  const restarted = new ProviderConnectionLifecycle(vault, repository, probes(now + 120_000));
  const result = await restarted.reProbe({
    id: "cerebras-primary",
    now: now + 30_000,
    capabilities: ["chat"]
  });
  assert.equal(result.admission.admitted, true);
  assert.equal(result.connection.canary.expiresAt, now + 120_000);
  assert.equal(JSON.stringify(result).includes(secret), false);
});

test("disk-backed restart persists masked connection evidence and excludes the secret", async () => {
  const root = await mkdtemp(join(tmpdir(), "provider-connections-"));
  const path = join(root, "connections.json");
  const vault = new MemoryVault();
  const first = new ProviderConnectionLifecycle(
    vault,
    new JsonProviderConnectionRepository(path),
    probes()
  );
  await first.connect({
    id: "cerebras-primary",
    providerId: "cerebras",
    modelId: "gpt-oss-120b",
    secret,
    now,
    capabilities: ["chat"]
  });
  assert.equal((await readFile(path, "utf8")).includes(secret), false);

  const restartedRepository = new JsonProviderConnectionRepository(path);
  const restarted = new ProviderConnectionLifecycle(vault, restartedRepository, probes());
  const result = await restarted.reProbe({
    id: "cerebras-primary",
    now: now + 1_000,
    capabilities: ["chat"]
  });
  assert.equal(result.admission.admitted, true);
  assert.equal((await restartedRepository.list()).length, 1);
});

test("stale evidence removes a route without mutating queued runtime state", async () => {
  const vault = new MemoryVault();
  const repository = new MemoryRepository();
  const lifecycle = new ProviderConnectionLifecycle(vault, repository, probes(now + 1));
  const result = await lifecycle.connect({
    id: "cerebras-primary",
    providerId: "cerebras",
    modelId: "gpt-oss-120b",
    secret,
    now,
    capabilities: ["chat"]
  });
  const queuedWork = ["task-a", "task-b"];
  const resolution = resolveAdmittedProviderCandidates({
    connections: [result.connection],
    now: now + 2,
    requiredCapabilities: ["chat"],
    priorityByConnectionId: { "cerebras-primary": 1 },
    usageByConnectionId: { "cerebras-primary": usage }
  });
  assert.equal(resolution.candidates.length, 0);
  assert.equal(resolution.excluded[0]?.decision.reason, "canary-stale");
  assert.deepEqual(queuedWork, ["task-a", "task-b"]);
});

test("revoke and disconnect remove credential access deterministically", async () => {
  const vault = new MemoryVault();
  const repository = new MemoryRepository();
  const lifecycle = new ProviderConnectionLifecycle(vault, repository, probes());
  const connected = await lifecycle.connect({
    id: "cerebras-primary",
    providerId: "cerebras",
    modelId: "gpt-oss-120b",
    secret,
    now,
    capabilities: ["chat"]
  });
  const revoked = await lifecycle.revoke("cerebras-primary", now + 1);
  assert.equal(revoked.state, "revoked");
  assert.equal(await vault.read(connected.connection.credentialReference), null);

  await lifecycle.connect({
    id: "cerebras-primary",
    providerId: "cerebras",
    modelId: "gpt-oss-120b",
    secret,
    now: now + 2,
    capabilities: ["chat"]
  });
  await lifecycle.disconnect("cerebras-primary");
  assert.equal(await repository.read("cerebras-primary"), null);
  assert.equal(vault.values.size, 0);
});

test("promotional credit connection remains stored but never becomes free-only runnable", async () => {
  const vault = new MemoryVault();
  const repository = new MemoryRepository();
  const lifecycle = new ProviderConnectionLifecycle(vault, repository, probes());
  const result = await lifecycle.connect({
    id: "deepseek-trial",
    providerId: "deepseek",
    modelId: "deepseek-v4-flash",
    secret,
    now,
    capabilities: ["chat"]
  });
  assert.equal(result.admission.admitted, false);
  assert.equal(result.admission.reason, "not-permanent-free");
  assert.equal(result.connection.state, "limited");
  assert.match(result.admission.detail, /permanent free-only/);
});

test("failed initial probes remove the newly supplied secret and expose only safe guidance", async () => {
  const vault = new MemoryVault();
  const repository = new MemoryRepository();
  const broken: ProviderConnectionProbes = {
    ...probes(),
    async canary() {
      throw new Error(`raw provider response containing ${secret}`);
    }
  };
  const lifecycle = new ProviderConnectionLifecycle(vault, repository, broken);
  await assert.rejects(
    lifecycle.connect({
      id: "cerebras-primary",
      providerId: "cerebras",
      modelId: "gpt-oss-120b",
      secret,
      now,
      capabilities: ["chat"]
    }),
    (error: unknown) =>
      error instanceof Error &&
      error.message === "The provider checks did not complete. The key was not retained; retry the connection." &&
      !error.message.includes(secret)
  );
  assert.equal(vault.values.size, 0);
  assert.equal((await repository.list()).length, 0);
});
