import assert from "node:assert/strict";
import test from "node:test";
import { freshnessState, providerExecutionShare } from "../packages/control-center/src/metrics.js";

test("provider share includes external and local calls in the selected range", () => {
  const share = providerExecutionShare({
    from: "2026-07-28T00:00:00.000Z", to: "2026-07-29T00:00:00.000Z",
    events: [
      { id: "1", providerId: "groq", locality: "external", occurredAt: "2026-07-28T01:00:00.000Z", outcome: "succeeded" },
      { id: "2", providerId: "local-engine", locality: "local", occurredAt: "2026-07-28T02:00:00.000Z", outcome: "succeeded" },
      { id: "3", providerId: "groq", locality: "external", occurredAt: "2026-07-28T03:00:00.000Z", outcome: "failed" },
      { id: "4", providerId: "old", locality: "external", occurredAt: "2026-07-27T03:00:00.000Z", outcome: "succeeded" },
    ],
  });
  assert.deepEqual(share.map((item) => [item.providerId, item.calls]), [["groq", 2], ["local-engine", 1]]);
  assert.equal(share.reduce((sum, item) => sum + item.share, 0), 1);
});

test("missing and stale evidence remain explicit", () => {
  assert.equal(freshnessState({ observedAt: null, now: "2026-07-28T02:00:00Z", staleAfterMs: 60_000 }), "missing");
  assert.equal(freshnessState({ observedAt: "2026-07-28T00:00:00Z", now: "2026-07-28T02:00:00Z", staleAfterMs: 60_000 }), "stale");
});
