import assert from "node:assert/strict";
import test from "node:test";
import {
  routeProviders,
  type ProviderCandidate,
  type RouteRequest
} from "../packages/providers/src/router.js";

const now = 1_800_000_000_000;
const base: ProviderCandidate = {
  id: "free-a",
  priority: 10,
  privacy: "no_training",
  location: "external",
  paid: false,
  roles: ["implementer"],
  kinds: ["code"],
  dataClasses: ["public_test", "non_personal_test", "source_code"],
  dailyTokenLimit: 100_000,
  usedTokens: 1_000,
  circuitOpenUntil: 0
};
const request: RouteRequest = {
  role: "implementer",
  kind: "code",
  dataClass: "source_code",
  minimumPrivacy: "no_training",
  estimatedTokens: 2_000,
  allowPaid: false,
  now
};

test("router deterministically prefers an explicitly preferred eligible provider", () => {
  const second = { ...base, id: "free-b", priority: 20 };
  const result = routeProviders([base, second], {
    ...request,
    preferredProviderIds: ["free-b"]
  });
  assert.equal(result.selected?.id, "free-b");
});

test("router falls back around open circuits and exhausted quota", () => {
  const open = { ...base, circuitOpenUntil: now + 60_000 };
  const exhausted = { ...base, id: "free-b", usedTokens: 99_500 };
  const fallback = { ...base, id: "free-c", priority: 30 };
  const result = routeProviders([open, exhausted, fallback], request);
  assert.equal(result.selected?.id, "free-c");
  assert.deepEqual(result.rejected.map((item) => item.reason), [
    "circuit-open",
    "daily-token-limit"
  ]);
});

test("paid candidates remain ineligible unless the request explicitly enables them", () => {
  const result = routeProviders([{ ...base, paid: true }], request);
  assert.equal(result.selected, null);
  assert.equal(result.rejected[0]?.reason, "paid-disabled");
});

test("sensitive data stays local regardless of external privacy claim", () => {
  const external = {
    ...base,
    privacy: "zero_retention" as const,
    dataClasses: ["credential" as const]
  };
  const local = {
    ...base,
    id: "local-a",
    privacy: "local" as const,
    location: "local" as const,
    dataClasses: ["credential" as const]
  };
  const result = routeProviders([external, local], {
    ...request,
    dataClass: "credential",
    minimumPrivacy: "zero_retention"
  });
  assert.equal(result.selected?.id, "local-a");
  assert.equal(result.rejected[0]?.reason, "sensitive-data-requires-local");
});
