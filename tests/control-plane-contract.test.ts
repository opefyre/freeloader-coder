import assert from "node:assert/strict";
import test from "node:test";

import {
  assessSnapshotFreshness,
  validateControlPlaneSnapshot,
  type ControlPlaneSnapshot,
} from "../packages/runtime/src/control-plane.js";

const snapshot: ControlPlaneSnapshot = {
  schemaVersion: 1,
  instanceId: "0f86b913-7600-4c6f-a102-2fc6e4250c6f",
  provenance: "local_observation",
  featureDataMode: "synthetic_fixture",
  observedAt: 10_000,
  validForMs: 15_000,
  setup: {
    state: "ready",
    requiredChecksReady: 6,
    requiredChecksTotal: 6,
  },
  services: [
    {
      id: "control_plane",
      state: "available",
      required: true,
      observedAt: 10_000,
    },
  ],
};

test("control-plane snapshot round-trips and derives freshness from evidence time", () => {
  assert.deepEqual(validateControlPlaneSnapshot(snapshot), snapshot);
  assert.equal(assessSnapshotFreshness(snapshot, 24_999), "current");
  assert.equal(assessSnapshotFreshness(snapshot, 25_001), "stale");
  assert.equal(assessSnapshotFreshness(snapshot, 9_999), "invalid");
});

test("snapshot rejects unknown, sensitive-shaped, duplicate, and impossible data", () => {
  assert.throws(() =>
    validateControlPlaneSnapshot({ ...snapshot, apiKey: "not-allowed" })
  );
  assert.throws(() =>
    validateControlPlaneSnapshot({
      ...snapshot,
      services: [...snapshot.services, snapshot.services[0]],
    })
  );
  assert.throws(() =>
    validateControlPlaneSnapshot({
      ...snapshot,
      setup: { ...snapshot.setup, requiredChecksReady: 7 },
    })
  );
  assert.throws(() =>
    validateControlPlaneSnapshot({ ...snapshot, schemaVersion: 2 })
  );
});
