import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ProviderRuntimeService } from "../apps/core/src/provider-service.js";
import {
  executeProviderTask,
  providerIdempotencyKey,
  type ProviderExecutor
} from "../packages/orchestration/src/provider-runtime.js";
import type {
  ProviderCandidate,
  RouteRequest
} from "../packages/providers/src/router.js";
import { routeProviders } from "../packages/providers/src/router.js";
import {
  appendProviderEvent,
  JsonProviderJournalStore,
  replayProviderJournal
} from "../packages/storage/src/provider-journal.js";

const now = 1_800_000_000_000;
const usage = {
  requestsToday: 0,
  tokensToday: 0,
  inputTokensToday: 0,
  outputTokensToday: 0,
  requestTimestamps: [],
  tokenSamples: []
};
const base: ProviderCandidate = {
  id: "provider-a-code",
  providerId: "provider-a",
  modelId: "model-a",
  priority: 10,
  configured: true,
  privacy: "training_eligible",
  location: "external",
  paid: false,
  costClass: "free",
  billingMode: "free_tier",
  roles: ["implementer"],
  kinds: ["code"],
  dataClasses: ["source_code"],
  contextWindowTokens: 64_000,
  maxOutputTokens: 8_000,
  capacity: { unit: "provider_reported" },
  usage,
  circuitOpenUntil: 0
};
const fallback: ProviderCandidate = {
  ...base,
  id: "provider-b-code",
  providerId: "provider-b",
  modelId: "model-b",
  priority: 20
};
const routeRequest: RouteRequest = {
  role: "implementer",
  kind: "code",
  dataClass: "source_code",
  minimumPrivacy: "training_eligible",
  estimatedInputTokens: 2_000,
  requestedOutputTokens: 1_000,
  allowPaid: false,
  now
};
const identity = {
  taskId: "PIPE-50",
  workUnitId: "route-runtime",
  requestDigest: "a".repeat(64)
};
const digest = (character: string): string => `sha256:${character.repeat(64)}`;

test("fallback keeps one canonical task and does not execute again after restart", async () => {
  const root = await mkdtemp(join(tmpdir(), "provider-runtime-"));
  const repository = new JsonProviderJournalStore(join(root, "journal.json"));
  const calls: string[] = [];
  const executor: ProviderExecutor = {
    execute: async ({ candidate }) => {
      calls.push(candidate.id);
      if (candidate.id === base.id) {
        throw Object.assign(new Error("temporary"), { status: 503 });
      }
      return { outputDigest: digest("b"), inputTokens: 2_000, outputTokens: 600 };
    }
  };

  const first = await executeProviderTask({
    ...identity,
    candidates: [base, fallback],
    routeRequest,
    repository,
    executor
  });
  assert.equal(first.projection.status, "succeeded");
  assert.equal(first.projection.taskId, identity.taskId);
  assert.equal(first.projection.selectedCandidateId, fallback.id);
  assert.deepEqual(calls, [base.id, fallback.id]);
  assert.deepEqual(first.projection.attempts.map((attempt) => attempt.status), [
    "failed",
    "succeeded"
  ]);
  assert.equal(new Set(first.projection.attempts.map((attempt) => attempt.runNumber)).size, 1);
  const persisted = await repository.load(identity);
  const routeEvent = persisted.events.find(
    (event) => event.type === "provider.route_recorded"
  );
  assert.equal(routeEvent?.type, "provider.route_recorded");
  if (routeEvent?.type !== "provider.route_recorded") {
    throw new Error("Recorded route evidence is missing.");
  }
  const replayedRoute = routeProviders(routeEvent.candidates, routeEvent.request);
  assert.equal(replayedRoute.selected?.id, first.route.selected?.id);
  assert.deepEqual(
    replayedRoute.rejected.map((rejection) => rejection.reason),
    first.route.rejected.map((rejection) => rejection.reason)
  );

  const afterRestart = await executeProviderTask({
    ...identity,
    candidates: [base, fallback],
    routeRequest: { ...routeRequest, now: now + 10_000 },
    repository: new JsonProviderJournalStore(join(root, "journal.json")),
    executor
  });
  assert.equal(afterRestart.resumed, true);
  assert.equal(afterRestart.projection.outputDigest, digest("b"));
  assert.deepEqual(afterRestart.executedCandidateIds, []);
  assert.deepEqual(calls, [base.id, fallback.id]);
});

test("all-free exhaustion defers until reset without calling or poisoning the task", async () => {
  const root = await mkdtemp(join(tmpdir(), "provider-capacity-"));
  const repository = new JsonProviderJournalStore(join(root, "journal.json"));
  let calls = 0;
  const executor: ProviderExecutor = {
    execute: async () => {
      calls += 1;
      return { outputDigest: digest("c"), inputTokens: 10, outputTokens: 10 };
    }
  };
  const exhausted = {
    ...base,
    usage: {
      ...usage,
      providerRemainingRequests: 0,
      providerResetAt: now + 60_000
    }
  };

  const deferred = await executeProviderTask({
    ...identity,
    candidates: [exhausted],
    routeRequest,
    repository,
    executor
  });
  assert.equal(deferred.projection.status, "deferred");
  assert.equal(deferred.projection.retryAt, now + 60_000);
  assert.equal(deferred.projection.attempts.length, 0);
  assert.equal(calls, 0);

  const tooEarly = await executeProviderTask({
    ...identity,
    candidates: [base],
    routeRequest: { ...routeRequest, now: now + 30_000 },
    repository,
    executor
  });
  assert.equal(tooEarly.projection.runNumber, 1);
  assert.equal(calls, 0);

  const resumed = await executeProviderTask({
    ...identity,
    candidates: [base],
    routeRequest: { ...routeRequest, now: now + 60_000 },
    repository,
    executor
  });
  assert.equal(resumed.projection.status, "succeeded");
  assert.equal(resumed.projection.runNumber, 2);
  assert.equal(calls, 1);
});

test("restart reconciles an interrupted call and continues to the next provider", async () => {
  const root = await mkdtemp(join(tmpdir(), "provider-restart-"));
  const repository = new JsonProviderJournalStore(join(root, "journal.json"));
  let document = await repository.load(identity);
  document = appendProviderEvent(document, {
    type: "provider.task_initialized",
    occurredAt: now,
    workUnitId: identity.workUnitId,
    requestDigest: identity.requestDigest
  });
  document = appendProviderEvent(document, {
    type: "provider.run_started",
    occurredAt: now,
    runNumber: 1
  });
  document = appendProviderEvent(document, {
    type: "provider.call_started",
    occurredAt: now,
    attempt: {
      idempotencyKey: providerIdempotencyKey({
        ...identity,
        candidateId: base.id,
        runNumber: 1
      }),
      runNumber: 1,
      candidateId: base.id,
      providerId: base.providerId,
      modelId: base.modelId,
      status: "started",
      startedAt: now,
      finishedAt: null,
      failureClass: null,
      failureCode: null,
      retryAt: null,
      outputDigest: null,
      inputTokens: null,
      outputTokens: null
    }
  });
  await repository.save(document);

  const calls: string[] = [];
  const recovered = await executeProviderTask({
    ...identity,
    candidates: [base, fallback],
    routeRequest: { ...routeRequest, now: now + 5_000 },
    repository,
    executor: {
      execute: async ({ candidate }) => {
        calls.push(candidate.id);
        return { outputDigest: digest("d"), inputTokens: 100, outputTokens: 50 };
      }
    }
  });
  assert.equal(recovered.projection.status, "succeeded");
  assert.equal(recovered.projection.attempts[0]?.failureCode, "runtime-restarted");
  assert.equal(recovered.projection.selectedCandidateId, fallback.id);
  assert.deepEqual(calls, [fallback.id]);
});

test("journal refuses to reuse persisted state for changed work identity", async () => {
  const root = await mkdtemp(join(tmpdir(), "provider-identity-"));
  const repository = new JsonProviderJournalStore(join(root, "journal.json"));
  let document = await repository.load(identity);
  document = appendProviderEvent(document, {
    type: "provider.task_initialized",
    occurredAt: now,
    workUnitId: identity.workUnitId,
    requestDigest: identity.requestDigest
  });
  await repository.save(document);
  await assert.rejects(
    repository.load({ ...identity, requestDigest: "b".repeat(64) }),
    /identity does not match/
  );
  assert.equal(replayProviderJournal(document).taskId, identity.taskId);
});

test("core service isolates task journals and rejects traversal-shaped identifiers", async () => {
  const root = await mkdtemp(join(tmpdir(), "provider-service-"));
  const service = new ProviderRuntimeService(root);
  const executor: ProviderExecutor = {
    execute: async () => ({
      outputDigest: digest("e"),
      inputTokens: 10,
      outputTokens: 5
    })
  };
  const first = await service.execute({
    ...identity,
    candidates: [base],
    routeRequest,
    executor
  });
  const second = await service.execute({
    ...identity,
    taskId: "PIPE-51",
    candidates: [base],
    routeRequest,
    executor
  });
  assert.equal(first.projection.taskId, "PIPE-50");
  assert.equal(second.projection.taskId, "PIPE-51");
  await assert.rejects(
    service.execute({
      ...identity,
      taskId: "../unsafe",
      candidates: [base],
      routeRequest,
      executor
    }),
    /identifier is unsafe/
  );
});

test("core service lease prevents concurrent duplicate provider execution", async () => {
  const root = await mkdtemp(join(tmpdir(), "provider-concurrency-"));
  const firstService = new ProviderRuntimeService(root);
  const competingService = new ProviderRuntimeService(root);
  let releaseExecution: (() => void) | undefined;
  let announceStarted: (() => void) | undefined;
  const started = new Promise<void>((resolve) => {
    announceStarted = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    releaseExecution = resolve;
  });
  let calls = 0;
  const first = firstService.execute({
    ...identity,
    candidates: [base],
    routeRequest,
    executor: {
      execute: async () => {
        calls += 1;
        announceStarted?.();
        await gate;
        return { outputDigest: digest("f"), inputTokens: 10, outputTokens: 5 };
      }
    }
  });
  await started;
  await assert.rejects(
    competingService.execute({
      ...identity,
      candidates: [base],
      routeRequest,
      executor: {
        execute: async () => {
          calls += 1;
          return { outputDigest: digest("1"), inputTokens: 10, outputTokens: 5 };
        }
      }
    }),
    /active execution lease/
  );
  releaseExecution?.();
  assert.equal((await first).projection.status, "succeeded");
  assert.equal(calls, 1);
});
