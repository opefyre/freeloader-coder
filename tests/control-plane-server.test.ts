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

test("project endpoints require origin, schema, idempotency, and bounded semantics", async () => {
  const project = {
    schemaVersion: 1 as const,
    id: "project_0123456789abcdef",
    displayName: "Sample",
    workspaceLabel: "sample",
    lifecycleStage: "intake" as const,
    resources: [],
    latestUpdate: null,
    progress: null,
    state: "warning" as const,
    observedAt,
    validForMs: 60_000,
    facts: [],
    inferences: [],
    decisions: [],
    warnings: ["Git status was not evaluated."],
  };
  const calls: string[] = [];
  const controlPlane = createControlPlaneServer({
    host: "127.0.0.1",
    port: 0,
    allowedOrigins: ["http://127.0.0.1:4310"],
    health: () => health,
    snapshot: () => snapshot,
    projects: {
      list: () => ({
        schemaVersion: 1,
        provenance: "local_observation",
        observedAt,
        projects: [project],
      }),
      register: (input) => {
        calls.push(`register:${JSON.stringify(input)}`);
        return project;
      },
      create: (input, idempotencyKey) => {
        calls.push(`create:${idempotencyKey}:${JSON.stringify(input)}`);
        return project;
      },
      rescan: (projectId) => {
        calls.push(`rescan:${projectId}`);
        return project;
      },
      setResources: (projectId, input) => {
        calls.push(`resources:${projectId}:${JSON.stringify(input)}`);
        return project;
      },
      addFiles: (projectId, input) => {
        calls.push(`files:${projectId}:${JSON.stringify(input)}`);
        return { schemaVersion: 1, outcome: "imported", files: [{ label: "brief.pdf", projectRelativePath: ".pipeline/inputs/brief-01234567.pdf", bytes: 42 }] };
      },
      forget: (projectId) => {
        calls.push(`forget:${projectId}`);
      },
    },
  });
  const port = await controlPlane.listen();
  const base = `http://127.0.0.1:${port}`;
  const origin = "http://127.0.0.1:4310";
  try {
    const list = await fetch(`${base}/api/v1/projects`, {
      headers: { Origin: origin },
    });
    assert.equal(list.status, 200);
    assert.equal((await list.json() as { projects: unknown[] }).projects.length, 1);

    const missingKey = await fetch(`${base}/api/v1/projects`, {
      method: "POST",
      headers: { Origin: origin, "Content-Type": "application/json" },
      body: JSON.stringify({ schemaVersion: 1, path: "/tmp/project" }),
    });
    assert.equal(missingKey.status, 400);
    assert.deepEqual(await missingKey.json(), {
      error: "A valid idempotency key is required.",
    });

    const register = await fetch(`${base}/api/v1/projects`, {
      method: "POST",
      headers: {
        Origin: origin,
        "Content-Type": "application/json",
        "Idempotency-Key": "register:0123456789",
      },
      body: JSON.stringify({ schemaVersion: 1, path: "/tmp/project" }),
    });
    assert.equal(register.status, 200);

    const create = await fetch(`${base}/api/v1/projects/new`, {
      method: "POST",
      headers: {
        Origin: origin,
        "Content-Type": "application/json",
        "Idempotency-Key": "create:0123456789",
      },
      body: JSON.stringify({ schemaVersion: 1, idea: "Build a garden planner", workspacePath: "/Users/example/projects/garden-planner" }),
    });
    assert.equal(create.status, 200);
    const resources = await fetch(`${base}/api/v1/projects/${project.id}/resources`, {
      method: "PUT",
      headers: { Origin: origin, "Content-Type": "application/json", "Idempotency-Key": "resources:0123456789" },
      body: JSON.stringify({
        schemaVersion: 1,
        resources: [{
          kind: "jira_project",
          connectionId: "jira-main",
          resourceId: "10000",
          label: "PIPE",
          url: "https://example.atlassian.net/jira/software/projects/PIPE",
          role: "primary",
        }],
      }),
    });
    assert.equal(resources.status, 200);
    const files = await fetch(`${base}/api/v1/projects/${project.id}/files`, {
      method: "POST",
      headers: { Origin: origin, "Content-Type": "application/json", "Idempotency-Key": "files:0123456789" },
      body: JSON.stringify({ schemaVersion: 1, paths: ["/Users/example/brief.pdf"] }),
    });
    assert.equal(files.status, 200);
    assert.equal((await create.json() as { outcome: string }).outcome, "created");

    const rescan = await fetch(
      `${base}/api/v1/projects/project_0123456789abcdef/rescan`,
      { method: "POST", headers: { Origin: origin } }
    );
    assert.equal(rescan.status, 200);

    const forget = await fetch(
      `${base}/api/v1/projects/project_0123456789abcdef/registration`,
      { method: "DELETE", headers: { Origin: origin } }
    );
    assert.equal(forget.status, 200);
    assert.equal(calls.length, 6);

    assert.equal(
      (
        await fetch(`${base}/api/v1/projects`, {
          headers: { Origin: "https://example.com" },
        })
      ).status,
      403
    );
  } finally {
    await controlPlane.close();
  }
});

test("native picker endpoints expose only validated local selections", async () => {
  const controlPlane = createControlPlaneServer({
    host: "127.0.0.1", port: 0,
    allowedOrigins: ["http://127.0.0.1:4310"],
    health: () => health, snapshot: () => snapshot,
    nativePicker: {
      folder: () => ({ schemaVersion: 1, outcome: "selected", selections: [{ path: "/Users/example/project", label: "project" }] }),
      files: () => ({ schemaVersion: 1, outcome: "cancelled", selections: [] }),
    },
  });
  const port = await controlPlane.listen();
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/v1/system/pick-folder`, { method: "POST", headers: { Origin: "http://127.0.0.1:4310" } });
    assert.equal(response.status, 200);
    assert.equal((await response.json() as { selections: unknown[] }).selections.length, 1);
  } finally {
    await controlPlane.close();
  }
});

test("project listing remains available when project creation is not configured", async () => {
  const controlPlane = createControlPlaneServer({
    host: "127.0.0.1",
    port: 0,
    allowedOrigins: ["http://127.0.0.1:4310"],
    health: () => health,
    snapshot: () => snapshot,
    projects: {
      list: () => ({
        schemaVersion: 1,
        provenance: "local_observation",
        observedAt,
        projects: [],
      }),
      register: () => { throw new Error("not used"); },
      rescan: () => { throw new Error("not used"); },
      forget: () => { throw new Error("not used"); },
    },
  });
  const port = await controlPlane.listen();
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/v1/projects`, {
      headers: { Origin: "http://127.0.0.1:4310" },
    });
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json() as { projects: unknown[] }).projects, []);
  } finally {
    await controlPlane.close();
  }
});

test("request endpoints expose only durable queue metadata with guarded mutations", async () => {
  const queued = {
    schemaVersion: 1 as const,
    id: "request_0123456789abcdef0123",
    projectId: "project_0123456789abcdef",
    outcome: "Build request intake.",
    readiness: "ready" as const,
    state: "queued" as const,
    provenance: "local_request" as const,
    createdAt: observedAt,
    updatedAt: observedAt,
    findings: [],
    workPreview: {
      provenance: "deterministic_local_preview" as const,
      title: "Build request intake.",
      outcome: "Build request intake.",
      assumptions: [],
      exclusions: ["No provider selected."],
      checks: ["Run tests"],
      estimatedMinutes: 45,
    },
    run: null,
  };
  const calls: string[] = [];
  const controlPlane = createControlPlaneServer({
    host: "127.0.0.1",
    port: 0,
    allowedOrigins: ["http://127.0.0.1:4310"],
    health: () => health,
    snapshot: () => snapshot,
    requests: {
      list: () => ({
        schemaVersion: 1,
        provenance: "local_observation",
        observedAt,
        requests: [queued],
      }),
      create: (input, key) => {
        calls.push(`create:${key}:${JSON.stringify(input)}`);
        return queued;
      },
      cancel: (id) => {
        calls.push(`cancel:${id}`);
        return { ...queued, state: "cancelled" as const };
      },
      approve: (id) => {
        calls.push(`approve:${id}`);
        return queued;
      },
      updatePlan: (id, input) => {
        calls.push(`plan-edit:${id}:${JSON.stringify(input)}`);
        return queued;
      },
      approvePlan: (id, input) => {
        calls.push(`plan-approve:${id}:${JSON.stringify(input)}`);
        return queued;
      },
      archive: (id) => {
        calls.push(`archive:${id}`);
      },
    },
  });
  const port = await controlPlane.listen();
  const base = `http://127.0.0.1:${port}`;
  const headers = { Origin: "http://127.0.0.1:4310" };
  try {
    assert.equal((await fetch(`${base}/api/v1/requests`, { headers })).status, 200);
    assert.equal(
      (
        await fetch(`${base}/api/v1/requests/${queued.id}/approve`, {
          method: "POST",
          headers: { ...headers, "Idempotency-Key": "approve:01234567" },
        })
      ).status,
      200
    );
    assert.equal(
      (
        await fetch(`${base}/api/v1/requests/${queued.id}/plan-edit`, {
          method: "POST",
          headers: {
            ...headers,
            "Content-Type": "application/json",
            "Idempotency-Key": "plan-edit:01234567",
          },
          body: JSON.stringify({
            schemaVersion: 1,
            type: "edit_task",
            expectedRevision: 1,
            taskId: "task_0123456789ab",
            title: "Review the real plan",
            estimatedMinutes: 45,
          }),
        })
      ).status,
      200
    );
    assert.equal(
      (
        await fetch(`${base}/api/v1/requests/${queued.id}/plan-approve`, {
          method: "POST",
          headers: {
            ...headers,
            "Content-Type": "application/json",
            "Idempotency-Key": "plan-approve:01234567",
          },
          body: JSON.stringify({ schemaVersion: 1, expectedRevision: 1 }),
        })
      ).status,
      200
    );
    assert.equal(
      (
        await fetch(`${base}/api/v1/requests`, {
          method: "POST",
          headers: { ...headers, "Content-Type": "application/json" },
          body: JSON.stringify({
            schemaVersion: 1,
            projectId: queued.projectId,
            outcome: queued.outcome,
          }),
        })
      ).status,
      400
    );
    assert.equal(
      (
        await fetch(`${base}/api/v1/requests`, {
          method: "POST",
          headers: {
            ...headers,
            "Content-Type": "application/json",
            "Idempotency-Key": "request:0123456789",
          },
          body: JSON.stringify({
            schemaVersion: 1,
            projectId: queued.projectId,
            outcome: queued.outcome,
          }),
        })
      ).status,
      200
    );
    assert.equal(
      (
        await fetch(`${base}/api/v1/requests/${queued.id}/cancel`, {
          method: "POST",
          headers: { ...headers, "Idempotency-Key": "cancel:0123456789" },
        })
      ).status,
      200
    );
    assert.equal(
      (
        await fetch(`${base}/api/v1/requests/${queued.id}/archive`, {
          method: "DELETE",
          headers: { ...headers, "Idempotency-Key": "archive:0123456789" },
        })
      ).status,
      200
    );
    assert.equal(calls.length, 6);
    assert.equal(calls.some((call) => call.startsWith(`plan-edit:${queued.id}:`)), true);
    assert.equal(calls.some((call) => call.startsWith(`plan-approve:${queued.id}:`)), true);
  } finally {
    await controlPlane.close();
  }
});
