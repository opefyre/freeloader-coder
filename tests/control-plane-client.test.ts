import assert from "node:assert/strict";
import test from "node:test";

import {
  failedControlPlaneState,
  fetchControlPlaneSnapshot,
  liveControlPlaneState,
} from "../apps/studio/src/control-plane-client.js";
import type { ControlPlaneSnapshot } from "../packages/runtime/src/control-plane.js";

const snapshot: ControlPlaneSnapshot = {
  schemaVersion: 1,
  instanceId: "0f86b913-7600-4c6f-a102-2fc6e4250c6f",
  provenance: "local_observation",
  featureDataMode: "synthetic_fixture",
  observedAt: 10_000,
  validForMs: 15_000,
  setup: { state: "ready", requiredChecksReady: 6, requiredChecksTotal: 6 },
  services: [
    {
      id: "control_plane",
      state: "available",
      required: true,
      observedAt: 10_000,
    },
  ],
};

test("client transitions from live to offline, stale, and recovered live", () => {
  const live = liveControlPlaneState(snapshot, 10_001);
  assert.equal(live.status, "live");
  const offline = failedControlPlaneState({
    previous: live,
    reason: "network",
    now: 20_000,
  });
  assert.equal(offline.status, "offline");
  assert.deepEqual(offline.snapshot, snapshot);
  const stale = failedControlPlaneState({
    previous: offline,
    reason: "timeout",
    now: 30_000,
  });
  assert.equal(stale.status, "stale");
  assert.equal(liveControlPlaneState({ ...snapshot, observedAt: 30_000 }, 30_001).status, "live");
});

test("malformed snapshots and unsafe endpoints never become live", async () => {
  assert.throws(() => liveControlPlaneState({ ok: true }, 10_000));
  await assert.rejects(() =>
    fetchControlPlaneSnapshot({
      endpoint: "https://example.com",
      timeoutMs: 100,
      fetcher: fetch,
    })
  );
  await assert.rejects(() =>
    fetchControlPlaneSnapshot({
      endpoint: "http://user:password@127.0.0.1:4312",
      timeoutMs: 100,
      fetcher: fetch,
    })
  );
});

test("client rejects oversized response bodies before parsing", async () => {
  await assert.rejects(() =>
    fetchControlPlaneSnapshot({
      endpoint: "http://127.0.0.1:4312",
      timeoutMs: 100,
      fetcher: async () =>
        new Response("{}", {
          status: 200,
          headers: { "Content-Length": "65537" },
        }),
    })
  );
});
