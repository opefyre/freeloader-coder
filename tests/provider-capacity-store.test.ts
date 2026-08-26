import assert from "node:assert/strict";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { ProviderCapacityStore } from "../apps/core/src/provider-capacity-store.js";
import type { ProviderJournalProjection } from "../packages/storage/src/provider-journal.js";

test("capacity and circuits persist exactly once across restart", async () => {
  const root = await mkdtemp(join(tmpdir(), "provider-capacity-store-"));
  const path = join(root, "provider-capacity.json");
  try {
    const now = 1_800_000_000_000;
    const store = new ProviderCapacityStore(path);
    const failed = projection([
      attempt("attempt-1", "transient_provider"),
      attempt("attempt-2", "transient_provider"),
    ]);
    await store.record(failed, { candidate: "connection-a" }, now);
    const first = await store.snapshot(["connection-a"], now);
    assert.equal(first.usageByConnectionId["connection-a"]?.requestsToday, 2);
    assert.equal(
      first.circuitOpenUntilByConnectionId["connection-a"],
      now + 60_000
    );
    assert.equal((await stat(path)).mode & 0o777, 0o600);

    const restarted = new ProviderCapacityStore(path);
    await restarted.record(failed, { candidate: "connection-a" }, now + 1);
    const replay = await restarted.snapshot(["connection-a"], now + 1);
    assert.equal(replay.usageByConnectionId["connection-a"]?.requestsToday, 2);

    await restarted.record(
      projection([
        ...failed.attempts,
        {
          ...attempt("attempt-3", null),
          status: "succeeded",
          failureClass: null,
          failureCode: null,
          inputTokens: 20,
          outputTokens: 10,
          outputDigest: `sha256:${"f".repeat(64)}`,
        },
      ]),
      { candidate: "connection-a" },
      now + 2
    );
    const recovered = await restarted.snapshot(["connection-a"], now + 2);
    assert.equal(recovered.usageByConnectionId["connection-a"]?.requestsToday, 3);
    assert.equal(recovered.usageByConnectionId["connection-a"]?.tokensToday, 30);
    assert.equal(recovered.circuitOpenUntilByConnectionId["connection-a"], 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Agent Canvas gateway attempts update durable usage and open the circuit on repeated rate limits", async () => {
  const root = await mkdtemp(join(tmpdir(), "provider-gateway-capacity-"));
  try {
    const path = join(root, "provider-capacity.json");
    const store = new ProviderCapacityStore(path);
    const now = 1_800_000_000_000;
    for (const attemptId of ["gateway-1", "gateway-2"]) {
      await store.recordGatewayAttempt({
        connectionId: "groq-main",
        attemptId,
        now,
        succeeded: false,
        inputTokens: 500,
        outputTokens: 0,
        failureCode: "rate_limited",
        retryAt: now + 90_000,
      });
    }
    await store.recordGatewayAttempt({
      connectionId: "groq-main",
      attemptId: "gateway-2",
      now,
      succeeded: false,
      inputTokens: 500,
      outputTokens: 0,
      failureCode: "rate_limited",
      retryAt: now + 90_000,
    });
    const snapshot = await new ProviderCapacityStore(path).snapshot(["groq-main"], now);
    assert.equal(snapshot.usageByConnectionId["groq-main"]?.requestsToday, 2);
    assert.equal(snapshot.usageByConnectionId["groq-main"]?.tokensToday, 1_000);
    assert.equal(snapshot.circuitOpenUntilByConnectionId["groq-main"], now + 90_000);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a deterministic request rejection immediately cools down the incompatible route", async () => {
  const root = await mkdtemp(join(tmpdir(), "provider-policy-cooldown-"));
  try {
    const path = join(root, "provider-capacity.json");
    const now = 1_800_000_000_000;
    const rejected = {
      ...attempt("policy-1", "policy"),
      failureCode: "request_rejected",
      retryAt: null,
    };
    await new ProviderCapacityStore(path).record(projection([rejected]), { candidate: "cohere" }, now);

    const snapshot = await new ProviderCapacityStore(path).snapshot(["cohere"], now);
    assert.equal(snapshot.circuitOpenUntilByConnectionId.cohere, now + 10 * 60_000);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a role-specific response contract failure does not disable the provider globally", async () => {
  const root = await mkdtemp(join(tmpdir(), "provider-contract-local-"));
  try {
    const path = join(root, "provider-capacity.json");
    const now = 1_800_000_000_000;
    const rejected = {
      ...attempt("contract-1", "policy"),
      failureCode: "unsafe-citation",
      retryAt: null,
    };
    const store = new ProviderCapacityStore(path);
    await store.record(projection([rejected]), { candidate: "gemini" }, now);
    await store.record(projection([rejected]), { candidate: "gemini" }, now + 1);

    const snapshot = await new ProviderCapacityStore(path).snapshot(["gemini"], now + 1);
    assert.equal(snapshot.circuitOpenUntilByConnectionId.gemini, 0);
    assert.equal(snapshot.usageByConnectionId.gemini?.requestsToday, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a successful explicit provider probe heals a stale runtime circuit", async () => {
  const root = await mkdtemp(join(tmpdir(), "provider-probe-healing-"));
  try {
    const path = join(root, "provider-capacity.json");
    const now = 1_800_000_000_000;
    const store = new ProviderCapacityStore(path);
    await store.record(
      projection([{ ...attempt("policy-1", "policy"), failureCode: "request_rejected", retryAt: null }]),
      { candidate: "cohere" },
      now,
    );
    assert.equal((await store.snapshot(["cohere"], now)).circuitOpenUntilByConnectionId.cohere, now + 10 * 60_000);

    await store.recordProbeSuccess("cohere", now + 1);
    const healed = await new ProviderCapacityStore(path).snapshot(["cohere"], now + 1);
    assert.equal(healed.circuitOpenUntilByConnectionId.cohere, 0);
    assert.equal(healed.usageByConnectionId.cohere?.requestsToday, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

function projection(
  attempts: ProviderJournalProjection["attempts"]
): ProviderJournalProjection {
  return {
    taskId: "request-a",
    workUnitId: "proposal-a",
    requestDigest: "a".repeat(64),
    lastSequence: 1,
    runNumber: 1,
    status: "deferred",
    attempts,
    selectedCandidateId: null,
    outputDigest: null,
    retryAt: null,
    statusReason: "Deferred.",
  };
}

function attempt(
  idempotencyKey: string,
  failureClass: ProviderJournalProjection["attempts"][number]["failureClass"]
): ProviderJournalProjection["attempts"][number] {
  return {
    idempotencyKey,
    runNumber: 1,
    candidateId: "candidate",
    providerId: "cerebras",
    modelId: "gpt-oss-120b",
    status: "failed",
    startedAt: 1_800_000_000_000,
    finishedAt: 1_800_000_000_000,
    failureClass,
    failureCode: failureClass ? "provider_unavailable" : null,
    retryAt: failureClass ? 1_800_000_060_000 : null,
    outputDigest: null,
    inputTokens: null,
    outputTokens: null,
  };
}
