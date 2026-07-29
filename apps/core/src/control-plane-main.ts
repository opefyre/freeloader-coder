import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { createControlPlaneServer } from "./control-plane.js";

const host = parseHost(process.env.PIPELINE_STUDIO_CONTROL_HOST);
const port = parsePort(process.env.PIPELINE_STUDIO_CONTROL_PORT);
const allowedOrigins = parseOrigins(process.env.PIPELINE_STUDIO_ALLOWED_ORIGINS);
const stateDirectory = resolve(
  process.env.PIPELINE_STUDIO_STATE_DIR ?? ".pipeline-studio"
);
const setupStatePath = resolve(stateDirectory, "setup-state.json");
const instanceId = randomUUID();
const startedAt = Date.now();

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
});

const boundPort = await controlPlane.listen();
console.log(`Pipeline Studio control plane: http://${host}:${boundPort}`);
console.log("Read-only loopback API. Feature surfaces remain synthetic fixtures.");

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
