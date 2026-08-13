import { randomUUID } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { createControlPlaneServer } from "./control-plane.js";
import { LocalProjectRegistry } from "./local-project-registry.js";
import { NativePicker } from "./native-picker.js";
import { IntegrationConnectionService } from "./integration-connection-service.js";
import { ProjectContextService } from "./project-context-service.js";
import { ProjectIntakeCoordinator } from "./project-intake-coordinator.js";
import { ProjectIntakeStore } from "./project-intake-store.js";
import { FreeProviderProjectKindAssistant } from "./free-provider-project-kind-assistant.js";
import { AgentCanvasModelGateway } from "./agent-canvas-model-gateway.js";
import { ProviderCapacityStore } from "./provider-capacity-store.js";
import { ProjectSolutionService } from "./project-solution-service.js";
import { ProjectSolutionOrchestrator } from "./project-solution-orchestrator.js";
import { FreeProviderSolutionModel } from "./free-provider-solution-model.js";
import { ProjectSolutionCoordinator } from "./project-solution-coordinator.js";
import { ProjectDeliveryPlanService } from "./project-delivery-plan-service.js";
import { ProjectDeliveryPlanOrchestrator } from "./project-delivery-plan-orchestrator.js";
import { ProjectDeliveryPlanCoordinator } from "./project-delivery-plan-coordinator.js";
import { JiraDeliveryService } from "./jira-delivery-service.js";
import { ProjectExecutionService } from "./project-execution-service.js";
import { ProjectExecutionJiraObserver } from "./project-execution-jira-observer.js";
import { ProjectExecutionCoordinator } from "./project-execution-coordinator.js";
import { ProjectExecutionWorker } from "./project-execution-worker.js";
import { ProjectExecutionRuntimeAdapters } from "./project-execution-runtime-adapters.js";
import { ProjectTaskWorkspaceService } from "./project-task-workspace.js";
import { FreeProviderExecutionModel } from "./free-provider-execution-model.js";
import { ProjectEgressPolicyService } from "./project-egress-policy-service.js";
import { ProjectLifecycleService, ProjectLifecycleServiceError } from "./project-lifecycle-service.js";
import { ProjectLifecycleCoordinator } from "./project-lifecycle-coordinator.js";
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
import { LocalAutonomyService } from "./local-autonomy-service.js";
import { buildActivitySnapshot } from "./activity-explorer.js";
import { buildDecisionSnapshot } from "./decision-inbox.js";
import { buildUniversalSearchSnapshot } from "./universal-search.js";
import { LocalAttentionService } from "./attention-center.js";
import { ProjectPortfolioService } from "./project-portfolio-service.js";
import { TelegramOwnerChannelService } from "./telegram-owner-channel-service.js";

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
const projectContexts = new ProjectContextService(localProjects);
const projectSolutions = new ProjectSolutionService(localProjects);
const projectDeliveryPlans = new ProjectDeliveryPlanService(localProjects);
const projectLifecycles = new ProjectLifecycleService(stateDirectory);
const projectIntakes = new ProjectIntakeStore(stateDirectory);
const nativePicker = new NativePicker();
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
const integrationConnections = new IntegrationConnectionService(undefined, credentialVault);
const adapterCache = new Map<string, ReturnType<typeof createOpenAiCompatibleAdapter>>();
const adapterRegistry = {
  adapter(providerId: string) {
    try {
      const current = adapterCache.get(providerId);
      if (current) return current;
      const adapter = createOpenAiCompatibleAdapter({ providerId });
      adapterCache.set(providerId, adapter);
      return adapter;
    } catch { return null; }
  },
};
const proposalGenerator = new LocalProposalGenerator(
  stateDirectory,
  localRequests,
  providerConnections,
  credentialVault,
  adapterRegistry
);
const providerConnectionService = new ProviderConnectionService(
  providerConnections,
  credentialVault,
  adapterRegistry
);
const intakeCapacity = new ProviderCapacityStore(resolve(stateDirectory, "provider-capacity.json"));
const intakeGateway = new AgentCanvasModelGateway(
  providerConnections,
  credentialVault,
  adapterRegistry,
  async () => {
    const connections = await providerConnections.list();
    return intakeCapacity.snapshot(connections.map((connection) => connection.id), Date.now());
  },
  Date.now,
  undefined,
  async (attempt) => intakeCapacity.recordGatewayAttempt({ ...attempt, now: Date.now() })
);
const projectIntake = new ProjectIntakeCoordinator(
  projectContexts,
  projectLifecycles,
  localProjects,
  new FreeProviderProjectKindAssistant(intakeGateway)
);
const projectEgress = new ProjectEgressPolicyService(stateDirectory);
const solutionModel = new FreeProviderSolutionModel(stateDirectory, providerConnections, credentialVault, adapterRegistry);
const solutionCoordinator = new ProjectSolutionCoordinator(stateDirectory, new ProjectSolutionOrchestrator(projectLifecycles, projectSolutions, projectContexts, projectEgress, solutionModel));
const jiraDelivery = new JiraDeliveryService(stateDirectory, localProjects, projectDeliveryPlans, projectLifecycles, credentialVault);
const projectExecutions = new ProjectExecutionService(stateDirectory, projectDeliveryPlans, jiraDelivery, Date.now, projectLifecycles);
const projectPortfolio = new ProjectPortfolioService(localProjects, projectLifecycles, projectExecutions, credentialVault);
const projectExecutionJira = new ProjectExecutionJiraObserver(stateDirectory, projectExecutions, jiraDelivery, credentialVault);
const executionModel = new FreeProviderExecutionModel(stateDirectory, providerConnections, credentialVault, adapterRegistry);
const executionWorkspaces = new ProjectTaskWorkspaceService(stateDirectory);
const executionAdapters = new ProjectExecutionRuntimeAdapters(localProjects, projectDeliveryPlans, projectContexts, projectEgress, executionModel, executionWorkspaces, projectExecutionJira);
const executionWorker = new ProjectExecutionWorker(projectExecutions, executionAdapters, `controller-${instanceId}`);
const executionCoordinator = new ProjectExecutionCoordinator(
  stateDirectory,
  projectExecutions,
  executionWorker,
  Date.now,
  300_000,
  async (projectId) => {
    await projectLifecycles.completeDelivery(projectId);
    await projectExecutionJira.synchronize(projectId);
  }
);
const deliveryPlanCoordinator = new ProjectDeliveryPlanCoordinator(
  stateDirectory,
  new ProjectDeliveryPlanOrchestrator(
    projectLifecycles,
    projectDeliveryPlans,
    projectContexts,
    projectSolutions,
    projectEgress,
    solutionModel
  ),
  Date.now,
  async (projectId) => {
    await jiraDelivery.synchronize(projectId);
    await projectExecutions.initialize(projectId);
    await projectExecutionJira.synchronize(projectId);
    await executionCoordinator.schedule(projectId);
  }
);
const lifecycleCoordinator = new ProjectLifecycleCoordinator(
  stateDirectory,
  projectLifecycles,
  {
    solution: (projectId) => solutionCoordinator.schedule(projectId),
    deliveryPlan: (projectId) => deliveryPlanCoordinator.schedule(projectId),
    execution: async (projectId) => executionCoordinator.schedule(projectId),
  },
  `control-plane-${instanceId}`
);
const telegramOwnerChannel = new TelegramOwnerChannelService(stateDirectory, localProjects, {
  list: () => projectLifecycles.list(),
  get: (projectId) => projectLifecycles.get(projectId),
  answer: async (projectId, input, idempotencyKey) => {
    const updated = await projectLifecycles.answer(
      projectId,
      input,
      idempotencyKey,
      (questions, answers) => projectContexts.applyClarifications(projectId, questions, answers).then(() => undefined),
    );
    return updated;
  },
  decideSolution: async (projectId, input, idempotencyKey) => {
    const lifecycle = await projectLifecycles.decideSolution(projectId, input, idempotencyKey, () => projectSolutions.recordDecision(projectId, input, idempotencyKey).then(() => undefined));
    if (lifecycle.stage === "backlog_design") void deliveryPlanCoordinator.schedule(projectId);
    return lifecycle;
  },
}, credentialVault);
void telegramOwnerChannel.synchronize().catch(() => undefined);
setInterval(() => void telegramOwnerChannel.synchronize().catch(() => undefined), 15_000).unref();
const autonomy = new LocalAutonomyService(
  stateDirectory,
  () => localRequests.list(),
  {
    ground_request: async (requestId) =>
      localRequests.ground(
        requestId,
        await localProjects.grounding(
          (await localRequests.list()).requests.find((request) => request.id === requestId)?.projectId ?? ""
        )
      ),
    claim_lease: (requestId) => localRequests.claim(requestId),
    checkpoint_lease: (requestId) => localRequests.checkpoint(requestId),
    release_lease: (requestId) => localRequests.release(requestId),
    prepare_execution: (requestId) => localRequests.prepareExecution(requestId),
    start_execution: (requestId) => localRequests.startExecution(requestId),
    validate_execution: (requestId) => localRequests.validateExecution(requestId),
    reconcile_execution: (requestId) => localRequests.reconcileExecution(requestId),
    reconcile_expired_lease: (requestId) => localRequests.reconcile(requestId),
  }
);
const attention = new LocalAttentionService(stateDirectory);

async function attentionInputs() {
  const live = buildLiveOperationsSnapshot({
    projects: await localProjects.list(),
    requests: await localRequests.list(),
    providers: await providerConnectionService.list(),
  });
  const autonomySnapshot = await autonomy.snapshot();
  const decisions = buildDecisionSnapshot({ live, autonomy: autonomySnapshot, lifecycles: await projectLifecycles.list(), query: { range: "all" } });
  return { live, decisions };
}

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
  activity: async (query) =>
    buildActivitySnapshot({
      live: buildLiveOperationsSnapshot({
        projects: await localProjects.list(),
        requests: await localRequests.list(),
        providers: await providerConnectionService.list(),
      }),
      autonomy: await autonomy.snapshot(),
      query,
    }),
  decisions: async (query) =>
    buildDecisionSnapshot({
      live: buildLiveOperationsSnapshot({
        projects: await localProjects.list(),
        requests: await localRequests.list(),
        providers: await providerConnectionService.list(),
      }),
      autonomy: await autonomy.snapshot(),
      lifecycles: await projectLifecycles.list(),
      query,
    }),
  search: async (query) => {
    const live = buildLiveOperationsSnapshot({
      projects: await localProjects.list(),
      requests: await localRequests.list(),
      providers: await providerConnectionService.list(),
    });
    const autonomySnapshot = await autonomy.snapshot();
    const decisions = buildDecisionSnapshot({ live, autonomy: autonomySnapshot, lifecycles: await projectLifecycles.list(), query: { range: "all" } });
    return buildUniversalSearchSnapshot({
      live,
      activity: buildActivitySnapshot({ live, autonomy: autonomySnapshot, query: { range: "all" } }),
      decisions,
      attention: await attention.snapshot(decisions, live, {}),
      query,
    });
  },
  attention: {
    snapshot: async (query) => {
      const input = await attentionInputs();
      return attention.snapshot(input.decisions, input.live, query);
    },
    preview: async (body) => {
      const input = await attentionInputs();
      return attention.preview(body, input.decisions, input.live);
    },
    apply: async (body, idempotencyKey) => {
      const input = await attentionInputs();
      return attention.apply(body, idempotencyKey, input.decisions, input.live);
    },
    previewQuietHours: (body) => attention.previewQuietHours(body),
    setQuietHours: async (body, expectedRevision, idempotencyKey) => {
      const input = await attentionInputs();
      return attention.setQuietHours(body, expectedRevision, idempotencyKey, input.decisions, input.live);
    },
  },
  autonomy: {
    snapshot: () => autonomy.snapshot(),
    setProjectMode: (projectId, input) => autonomy.setProjectMode(projectId, input),
    setProjectPaused: (projectId, input) => autonomy.setProjectPaused(projectId, input),
    setRequestMode: (requestId, input) => autonomy.setRequestMode(requestId, input),
    advance: (requestId, input) => autonomy.advance(requestId, input),
  },
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
    list: () => projectPortfolio.list(),
    create: (input, idempotencyKey) => {
      const request = input as Record<string, unknown>;
      return localProjects.create({ ...request, workspacePath: nativePicker.resolveFolder(String(request.workspacePath)) }, idempotencyKey);
    },
    register: (input) => {
      const request = input as Record<string, unknown>;
      return localProjects.register({ ...request, path: nativePicker.resolveFolder(String(request.path)) });
    },
    rescan: (projectId) => localProjects.rescan(projectId),
    setResources: (projectId, input) => localProjects.setResources(projectId, input),
    addFiles: (projectId, input) => {
      const request = input as Record<string, unknown>;
      return localProjects.addFiles(projectId, { ...request, paths: nativePicker.resolveFiles(Array.isArray(request.paths) ? request.paths.map(String) : []) });
    },
    addFileContent: (projectId, input) => localProjects.addFileContent(projectId, input),
    generateContext: (projectId, input) => projectIntake.generate(projectId, input),
    artifacts: (projectId) => localProjects.artifacts(projectId),
    openArtifact: (projectId, kind) => localProjects.openArtifact(projectId, kind),
    forget: (projectId) => localProjects.forget(projectId),
  },
  projectLifecycles: {
    get: async (projectId) => {
      const record = await projectLifecycles.get(projectId);
      if (!record) throw new ProjectLifecycleServiceError("not_found", "Project lifecycle was not found.");
      return record;
    },
    answer: async (projectId, input, idempotencyKey) => {
      const updated = await projectLifecycles.answer(
        projectId,
        input,
        idempotencyKey,
        (questions, answers) => projectContexts.applyClarifications(projectId, questions, answers).then(() => undefined),
      );
      return updated;
    },
    eligibility: async (projectId) => {
      const decision = await projectLifecycles.eligibility(projectId);
      if (!decision) throw new ProjectLifecycleServiceError("not_found", "Project eligibility decision was not found.");
      return decision;
    },
    assess: (projectId, input, idempotencyKey) => projectLifecycles.assess(projectId, input, idempotencyKey),
    override: (projectId, input, idempotencyKey) => projectLifecycles.override(projectId, input, idempotencyKey),
    publishSolution: async (projectId, input) => {
      const artifact = await projectSolutions.publish(projectId, input);
      return projectLifecycles.publishSolution(projectId, artifact);
    },
    getSolution: (projectId) => projectSolutions.read(projectId),
    getSolutionHistory: (projectId) => projectSolutions.history(projectId),
    decideSolution: async (projectId, input, idempotencyKey) => {
      const lifecycle = await projectLifecycles.decideSolution(projectId, input, idempotencyKey, () => projectSolutions.recordDecision(projectId, input, idempotencyKey).then(() => undefined));
      if (lifecycle.stage === "backlog_design") void deliveryPlanCoordinator.schedule(projectId);
      return lifecycle;
    },
    reopen: async (projectId, input, idempotencyKey) => {
      const before = await projectLifecycles.get(projectId);
      if (!before || (before.stage !== "complete" && before.stage !== "cancelled")) throw new Error("Only a terminal project can be reopened.");
      const lifecycle = await projectLifecycles.reopen(projectId, input, idempotencyKey);
      await lifecycleCoordinator.acknowledgeReopen(projectId, before.stage, lifecycle.revision);
      return lifecycle;
    },
    solutionRun: (projectId) => solutionCoordinator.get(projectId),
    generateSolution: (projectId) => solutionCoordinator.schedule(projectId),
    getBacklog: (projectId) => projectDeliveryPlans.read(projectId),
    backlogRun: (projectId) => deliveryPlanCoordinator.get(projectId),
    generateBacklog: (projectId) => deliveryPlanCoordinator.schedule(projectId),
    getExecution: (projectId) => projectExecutions.get(projectId),
    getEgressConsent: (projectId) => projectEgress.get(projectId),
    grantEgressConsent: (projectId, input) => projectEgress.grant(projectId, input),
    revokeEgressConsent: (projectId) => projectEgress.revoke(projectId),
  },
  nativePicker: {
    folder: () => nativePicker.folder(),
    files: () => nativePicker.files(),
  },
  projectIntakes: {
    list: () => projectIntakes.list(), create: (input) => projectIntakes.create(input),
    saveDraft: (id, input) => projectIntakes.saveDraft(id, input), selectResources: (id, input) => projectIntakes.selectResources(id, input),
    submit: (id, input, key) => projectIntakes.submit(id, input, key), cancel: (id, revision, reason) => projectIntakes.cancel(id, revision, reason),
  },
  integrationConnections: {
    list: () => integrationConnections.list(),
    probeGitHub: () => integrationConnections.probeGitHub(),
    connectJira: (input) => integrationConnections.connectJira(input),
    disconnectJira: () => integrationConnections.disconnectJira(),
    connectTelegram: (input) => integrationConnections.connectTelegram(input),
    disconnectTelegram: () => integrationConnections.disconnectTelegram(),
    configureOAuth: (input) => integrationConnections.configureOAuth(input),
    beginOAuth: (provider, redirectUri) => integrationConnections.beginOAuth(provider, redirectUri),
    completeJiraOAuth: (input) => integrationConnections.completeJiraOAuth(input),
    completeBrokerOAuth: (provider, ticket) => integrationConnections.completeBrokerOAuth(provider, ticket),
    connectToken: (input) => integrationConnections.connectToken(input),
    disconnectService: (provider) => integrationConnections.disconnectService(provider),
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
await solutionCoordinator.resumePending();
await deliveryPlanCoordinator.resumePending();
await executionCoordinator.resumePending();
lifecycleCoordinator.start();
autonomy.start();
const executionJiraTimer = setInterval(() => {
  void localProjects.list().then(async ({ projects }) => {
    for (const project of projects) {
      if (await projectExecutions.get(project.id)) await projectExecutionJira.synchronize(project.id).catch(() => undefined);
    }
  }).catch(() => undefined);
}, 60_000);
executionJiraTimer.unref();
console.log(`Pipeline Studio control plane: http://${host}:${boundPort}`);
console.log(
  "Loopback API. Project registration, grounded plans, and isolated-worktree preparation use real local state."
);

let closing = false;
async function close(signal: string) {
  if (closing) return;
  closing = true;
  autonomy.stop();
  lifecycleCoordinator.stop();
  executionCoordinator.stop();
  clearInterval(executionJiraTimer);
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
