import { randomUUID } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { createControlPlaneServer } from "./control-plane.js";
import { LocalProjectRegistry } from "./local-project-registry.js";
import { LocalRequestError, LocalRequestStore } from "./local-request-store.js";
import { LocalProposalGenerator } from "./local-proposal-generator.js";
import { LocalSensitiveCommandRunner } from "./sensitive-command-runner.js";
import { ProviderConnectionService } from "./provider-connection-service.js";
import { JsonProviderConnectionRepository } from "../../../packages/storage/src/provider-connections.js";
import { createOpenAiCompatibleAdapter } from "../../../packages/providers/src/openai-compatible.js";
import {
  createOperatingSystemCredentialBackend,
} from "../../../packages/vault/src/backends.js";
import { SqliteCredentialMetadataRepository } from "../../../packages/vault/src/repository.js";
import {
  OperatingSystemCredentialVault,
  ProviderCredentialVaultBridge,
} from "../../../packages/vault/src/vault.js";
import { buildLiveOperationsSnapshot } from "./live-operations.js";

const host = parseHost(process.env.PIPELINE_STUDIO_CONTROL_HOST);
const port = parsePort(process.env.PIPELINE_STUDIO_CONTROL_PORT);
const allowedOrigins = parseOrigins(process.env.PIPELINE_STUDIO_ALLOWED_ORIGINS);
const stateDirectory = resolve(
  process.env.PIPELINE_STUDIO_STATE_DIR ?? ".pipeline-studio"
);
await mkdir(stateDirectory, { recursive: true, mode: 0o700 });
const setupStatePath = resolve(stateDirectory, "setup-state.json");
const instanceId = randomUUID();
const startedAt = Date.now();
const localProjects = new LocalProjectRegistry(stateDirectory);
const localRequests = new LocalRequestStore(
  stateDirectory,
  (projectId) => localProjects.has(projectId),
  (projectId) => localProjects.canonicalRoot(projectId)
);
const providerConnections = new JsonProviderConnectionRepository(
  resolve(stateDirectory, "provider-connections.json")
);
const credentialBackend = createOperatingSystemCredentialBackend({
  platform:
    process.platform === "darwin"
      ? "darwin"
      : process.platform === "win32"
        ? "win32"
        : "linux",
  available: true,
  runner: new LocalSensitiveCommandRunner(),
});
const credentialVault = new ProviderCredentialVaultBridge(
  new OperatingSystemCredentialVault(
    credentialBackend,
    new SqliteCredentialMetadataRepository(
      resolve(stateDirectory, "credential-metadata.sqlite")
    )
  ),
  Date.now
);
const adapterCache = new Map<string, ReturnType<typeof createOpenAiCompatibleAdapter>>();
const proposalGenerator = new LocalProposalGenerator(
  stateDirectory,
  localRequests,
  providerConnections,
  credentialVault,
  {
    adapter(providerId) {
      try {
        const current = adapterCache.get(providerId);
        if (current) return current;
        const adapter = createOpenAiCompatibleAdapter({ providerId });
        adapterCache.set(providerId, adapter);
        return adapter;
      } catch {
        return null;
      }
    },
  }
);
const providerConnectionService = new ProviderConnectionService(
  providerConnections,
  credentialVault,
  {
    adapter(providerId) {
      try {
        const current = adapterCache.get(providerId);
        if (current) return current;
        const adapter = createOpenAiCompatibleAdapter({ providerId });
        adapterCache.set(providerId, adapter);
        return adapter;
      } catch {
        return null;
      }
    }
  }
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
  liveOperations: async () =>
    buildLiveOperationsSnapshot({
      projects: await localProjects.list(),
      requests: await localRequests.list(),
      providers: await providerConnectionService.list(),
    }),
  providerConnections: {
    list: () => providerConnectionService.list(),
    connect: (input) => providerConnectionService.connect(input),
    reProbe: (connectionId) => providerConnectionService.reProbe(connectionId),
    replaceModel: (connectionId, input) =>
      providerConnectionService.replaceModel(connectionId, input),
    revoke: (connectionId) => providerConnectionService.revoke(connectionId),
    disconnect: (connectionId) => providerConnectionService.disconnect(connectionId)
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
    authorizeExecution: (requestId, input) =>
      localRequests.authorizeExecution(requestId, input),
    prepareExecution: (requestId) => localRequests.prepareExecution(requestId),
    startExecution: (requestId) => localRequests.startExecution(requestId),
    validateExecution: (requestId) => localRequests.validateExecution(requestId),
    previewPatch: (requestId, input) => localRequests.previewPatch(requestId, input),
    approvePatch: (requestId, input) => localRequests.approvePatch(requestId, input),
    applyPatch: (requestId) => localRequests.applyPatch(requestId),
    rollbackPatch: (requestId) => localRequests.rollbackPatch(requestId),
    reconcilePatch: (requestId) => localRequests.reconcilePatch(requestId),
    previewCommit: (requestId, input) => localRequests.previewCommit(requestId, input),
    approveCommit: (requestId, input) => localRequests.approveCommit(requestId, input),
    createCommit: (requestId) => localRequests.createCommit(requestId),
    undoCommit: (requestId) => localRequests.undoCommit(requestId),
    reconcileCommit: (requestId) => localRequests.reconcileCommit(requestId),
    previewIntegration: (requestId, input) => localRequests.previewIntegration(requestId, input),
    approveIntegration: (requestId, input) => localRequests.approveIntegration(requestId, input),
    createIntegration: (requestId) => localRequests.createIntegration(requestId),
    undoIntegration: (requestId) => localRequests.undoIntegration(requestId),
    reconcileIntegration: (requestId) => localRequests.reconcileIntegration(requestId),
    previewChangeSet: (requestId, input) => localRequests.previewChangeSet(requestId, input),
    approveChangeSet: (requestId, input) => localRequests.approveChangeSet(requestId, input),
    applyChangeSet: (requestId) => localRequests.applyChangeSet(requestId),
    rollbackChangeSet: (requestId) => localRequests.rollbackChangeSet(requestId),
    reconcileChangeSet: (requestId) => localRequests.reconcileChangeSet(requestId),
    requestProposal: (requestId, input) => localRequests.requestProposal(requestId, input),
    beginProposalGeneration: (requestId) => localRequests.beginProposalGeneration(requestId),
    generateProposal: (requestId) => proposalGenerator.schedule(requestId),
    importProposal: (requestId, input) => localRequests.importProposal(requestId, input),
    decideProposal: (requestId, input) => localRequests.decideProposal(requestId, input),
    reconcileProposal: (requestId) => localRequests.reconcileProposal(requestId),
    cancelExecution: (requestId) => localRequests.cancelExecution(requestId),
    reconcileExecution: (requestId) => localRequests.reconcileExecution(requestId),
    archive: (requestId) => localRequests.archive(requestId),
  },
});

const boundPort = await controlPlane.listen();
await proposalGenerator.resumePending();
console.log(`Pipeline Studio control plane: http://${host}:${boundPort}`);
console.log(
  "Loopback API. Project registration, grounded plans, and isolated-worktree preparation use real local state."
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
