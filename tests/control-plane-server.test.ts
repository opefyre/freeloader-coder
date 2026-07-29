import assert from "node:assert/strict";
import { request } from "node:http";
import test from "node:test";

import { createControlPlaneServer } from "../apps/core/src/control-plane.js";
import type {
  ControlPlaneHealth,
  ControlPlaneSnapshot,
} from "../packages/runtime/src/control-plane.js";

const instanceId = "0f86b913-7600-4c6f-a102-2fc6e4250c6f";
const observedAt = 10_000;
const health: ControlPlaneHealth = {
  schemaVersion: 1,
  instanceId,
  status: "ready",
  observedAt,
  uptimeSeconds: 5,
};
const snapshot: ControlPlaneSnapshot = {
  schemaVersion: 1,
  instanceId,
  provenance: "local_observation",
  featureDataMode: "synthetic_fixture",
  observedAt,
  validForMs: 15_000,
  setup: { state: "ready", requiredChecksReady: 6, requiredChecksTotal: 6 },
  services: [
    {
      id: "control_plane",
      state: "available",
      required: true,
      observedAt,
    },
  ],
};

test("loopback server exposes only validated read-only health and snapshot data", async () => {
  const controlPlane = createControlPlaneServer({
    host: "127.0.0.1",
    port: 0,
    allowedOrigins: ["http://127.0.0.1:4310"],
    health: () => health,
    snapshot: () => snapshot,
  });
  const port = await controlPlane.listen();
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/v1/snapshot`, {
      headers: { Origin: "http://127.0.0.1:4310" },
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(response.headers.get("access-control-allow-origin"), "http://127.0.0.1:4310");
    assert.deepEqual(await response.json(), snapshot);

    const healthResponse = await fetch(`http://127.0.0.1:${port}/api/v1/health`);
    assert.equal(healthResponse.status, 200);
    assert.deepEqual(await healthResponse.json(), health);
  } finally {
    await controlPlane.close();
  }
});

test("server rejects foreign origins, writes, bodies, and unknown endpoints", async () => {
  const controlPlane = createControlPlaneServer({
    host: "127.0.0.1",
    port: 0,
    allowedOrigins: ["http://127.0.0.1:4310"],
    health: () => health,
    snapshot: () => snapshot,
  });
  const port = await controlPlane.listen();
  const base = `http://127.0.0.1:${port}`;
  try {
    assert.equal(
      (
        await fetch(`${base}/api/v1/snapshot`, {
          headers: { Origin: "https://example.com" },
        })
      ).status,
      403
    );
    assert.equal(
      (await fetch(`${base}/api/v1/snapshot`, { method: "POST" })).status,
      405
    );
    assert.equal(await rawStatus(`${base}/api/v1/snapshot`, { "Content-Length": "1" }), 413);
    assert.equal((await fetch(`${base}/api/v1/unknown`)).status, 404);
  } finally {
    await controlPlane.close();
  }
});

function rawStatus(url: string, headers: Record<string, string>): Promise<number> {
  return new Promise((resolvePromise, reject) => {
    const outgoing = request(url, { method: "GET", headers }, (response) => {
      response.resume();
      response.once("end", () => resolvePromise(response.statusCode ?? 0));
    });
    outgoing.once("error", reject);
    outgoing.end();
  });
}

test("server refuses wildcard hosts and non-loopback allowed origins", () => {
  assert.throws(() =>
    createControlPlaneServer({
      host: "0.0.0.0" as "127.0.0.1",
      port: 4_312,
      allowedOrigins: ["http://127.0.0.1:4310"],
      health: () => health,
      snapshot: () => snapshot,
    })
  );
  assert.throws(() =>
    createControlPlaneServer({
      host: "127.0.0.1",
      port: 4_312,
      allowedOrigins: ["https://example.com"],
      health: () => health,
      snapshot: () => snapshot,
    })
  );
});
