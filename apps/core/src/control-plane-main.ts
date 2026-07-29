import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { createControlPlaneServer } from "./control-plane.js";
import { LocalProjectRegistry } from "./local-project-registry.js";
import { LocalRequestError, LocalRequestStore } from "./local-request-store.js";

const host = parseHost(process.env.PIPELINE_STUDIO_CONTROL_HOST);
const port = parsePort(process.env.PIPELINE_STUDIO_CONTROL_PORT);
const allowedOrigins = parseOrigins(process.env.PIPELINE_STUDIO_ALLOWED_ORIGINS);
const stateDirectory = resolve(
  process.env.PIPELINE_STUDIO_STATE_DIR ?? ".pipeline-studio"
);
const setupStatePath = resolve(stateDirectory, "setup-state.json");
const instanceId = randomUUID();
const startedAt = Date.now();
const localProjects = new LocalProjectRegistry(stateDirectory);
const localRequests = new LocalRequestStore(
  stateDirectory,
  (projectId) => localProjects.has(projectId)
);

async function setupObservation() {
  try {
    const value: unknown = JSON.parse(await readFile(setupStatePath, "utf8"));
    if (!value || typeof value !== "object") throw new Error("invalid");
    const record = value as Record<string, unknown>;
    const rawChecks = Array.isArray(record.checks) ? record.checks : [];
    const ready = rawChecks.filter(
      (check) =>
        check &&
        typeof check === "object" &&
        (check as Record<string, unknown>).ready === true
    ).length;
    const state =
      record.status === "ready"
        ? "ready"
        : record.status === "needs_action"
          ? "needs_action"
          : "unknown";
    return {
      state,
      requiredChecksReady: ready,
      requiredChecksTotal: rawChecks.length,
    } as const;
  } catch {
    return {
      state: "unknown",
      requiredChecksReady: 0,
      requiredChecksTotal: 0,
    } as const;
  }
}

const controlPlane = createControlPlaneServer({
  host,
  port,
  allowedOrigins,
  health: async () => {
    const setup = await setupObservation();
    return {
      schemaVersion: 1,
      instanceId,
      status: setup.state === "ready" ? "ready" : "needs_attention",
      observedAt: Date.now(),
      uptimeSeconds: Math.floor((Date.now() - startedAt) / 1_000),
    };
  },
  snapshot: async () => {
    const observedAt = Date.now();
    const setup = await setupObservation();
    return {
      schemaVersion: 1,
      instanceId,
      provenance: "local_observation",
      featureDataMode: "synthetic_fixture",
      observedAt,
      validForMs: 15_000,
      setup,
      services: [
        {
          id: "control_plane",
          state: "available",
          required: true,
          observedAt,
        },
      ],
    };
  },
  projects: {
    list: () => localProjects.list(),
    register: (input) => localProjects.register(input),
    rescan: (projectId) => localProjects.rescan(projectId),
    forget: (projectId) => localProjects.forget(projectId),
  },
  requests: {
    list: () => localRequests.list(),
    create: (input, idempotencyKey) => localRequests.create(input, idempotencyKey),
    cancel: (requestId) => localRequests.cancel(requestId),
    approve: (requestId) => localRequests.approve(requestId),
    claim: (requestId) => localRequests.claim(requestId),
    checkpoint: (requestId) => localRequests.checkpoint(requestId),
    release: (requestId) => localRequests.release(requestId),
    reconcile: (requestId) => localRequests.reconcile(requestId),
    ground: async (requestId) => {
      const request = (await localRequests.list()).requests.find(
        (candidate) => candidate.id === requestId
      );
      if (!request) throw new LocalRequestError("not_found", "Request was not found.");
      const snapshot = await localProjects.grounding(request.projectId);
      return localRequests.ground(requestId, snapshot);
    },
    updatePlan: (requestId, input) => localRequests.updatePlan(requestId, input),
    approvePlan: (requestId, input) => localRequests.approvePlan(requestId, input),
    archive: (requestId) => localRequests.archive(requestId),
  },
});

const boundPort = await controlPlane.listen();
console.log(`Pipeline Studio control plane: http://${host}:${boundPort}`);
console.log(
  "Loopback API. Project registration and request queue are real local metadata; execution surfaces remain synthetic fixtures."
);

let closing = false;
async function close(signal: string) {
  if (closing) return;
  closing = true;
  console.log(`Stopping local control plane (${signal}).`);
  await controlPlane.close();
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void close(signal).then(
      () => {
        process.exit(0);
      },
      () => {
        process.exit(1);
      }
    );
  });
}

function parseHost(value: string | undefined): "127.0.0.1" | "::1" {
  if (!value || value === "127.0.0.1") return "127.0.0.1";
  if (value === "::1") return "::1";
  throw new Error("PIPELINE_STUDIO_CONTROL_HOST must be an explicit loopback host.");
}

function parsePort(value: string | undefined): number {
  const portValue = value ? Number(value) : 4312;
  if (!Number.isInteger(portValue) || portValue < 1_024 || portValue > 65_535) {
    throw new Error("PIPELINE_STUDIO_CONTROL_PORT is invalid.");
  }
  return portValue;
}

function parseOrigins(value: string | undefined): readonly string[] {
  return (value ?? "http://127.0.0.1:4310,http://127.0.0.1:4311")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}
