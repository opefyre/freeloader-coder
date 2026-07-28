import assert from "node:assert/strict";
import test from "node:test";
import {
  planProviderSchedule,
  type ProviderWorkItem
} from "../packages/orchestration/src/provider-scheduler.js";
import type {
  ProviderCandidate,
  RouteRequest
} from "../packages/providers/src/router.js";

const now = 1_800_000_000_000;
const usage = {
  activeRequests: 0,
  requestsToday: 0,
  tokensToday: 0,
  inputTokensToday: 0,
  outputTokensToday: 0,
  requestTimestamps: [],
  tokenSamples: []
};
const candidate: ProviderCandidate = {
  id: "groq-code",
  providerId: "groq",
  modelId: "openai/gpt-oss-120b",
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
  contextWindowTokens: 128_000,
  maxOutputTokens: 8_000,
  capacity: { unit: "requests", maxConcurrentRequests: 1 },
  usage,
  circuitOpenUntil: 0
};
const request: RouteRequest = {
  role: "implementer",
  kind: "code",
  dataClass: "source_code",
  minimumPrivacy: "training_eligible",
  estimatedInputTokens: 2_000,
  requestedOutputTokens: 1_000,
  allowPaid: false,
  now
};

function work(id: string, priority: number, candidates = [candidate]): ProviderWorkItem {
  return {
    id,
    taskId: `PIPE-${id}`,
    workUnitId: "implementation",
    priority,
    enqueuedAt: now,
    candidates,
    request
  };
}

test("scheduler dispatches only safe provider slots and queues the rest deterministically", () => {
  const schedule = planProviderSchedule([work("2", 20), work("1", 10)], { now });
  assert.deepEqual(schedule.dispatches.map((dispatch) => dispatch.item.id), ["1"]);
  assert.deepEqual(schedule.waiting.map((entry) => entry.item.id), ["2"]);
  assert.equal(schedule.waiting[0]?.reason, "provider-concurrency");
  assert.equal(schedule.nextWakeAt, now + 5_000);
  assert.deepEqual(schedule.queues[0]?.itemIds, ["1", "2"]);
});

test("scheduler separates capacity waits from permanently blocked work", () => {
  const exhausted = {
    ...candidate,
    id: "gemini-code",
    providerId: "gemini",
    usage: {
      ...usage,
      providerRemainingRequests: 0,
      providerResetAt: now + 60_000
    }
  };
  const unconfigured = { ...candidate, id: "missing", providerId: "missing", configured: false };
  const schedule = planProviderSchedule([
    work("waiting", 10, [exhausted]),
    work("blocked", 20, [unconfigured])
  ], { now });

  assert.equal(schedule.dispatches.length, 0);
  assert.deepEqual(schedule.waiting.map((entry) => entry.item.id), ["waiting"]);
  assert.deepEqual(schedule.blocked.map((entry) => entry.item.id), ["blocked"]);
  assert.equal(schedule.nextWakeAt, now + 60_000);
});
