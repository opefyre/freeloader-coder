import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { z, ZodError } from "zod";

import {
  controlPlaneHealthSchema,
  validateControlPlaneSnapshot,
  type ControlPlaneHealth,
  type ControlPlaneSnapshot,
} from "../../../packages/runtime/src/control-plane.js";
import {
  localProjectMutationResponseSchema,
  localProjectCreationSchema,
  localProjectRegistrationSchema,
  projectResourceSelectionSchema,
  localProjectFileImportSchema,
  localProjectContentImportSchema,
  localProjectFileImportResponseSchema,
  projectContextSnapshotSchema,
  validateLocalProjectCollection,
  type LocalProjectCollection,
  type LocalProjectSnapshot,
} from "../../../packages/runtime/src/local-projects.js";
import { LocalProjectError } from "./local-project-registry.js";
import {
  localPlanApprovalSchema,
  localPlanEditSchema,
  localExecutionAuthorizationRequestSchema,
  localPatchApprovalRequestSchema,
  localPatchPreviewRequestSchema,
  localCommitApprovalRequestSchema,
  localCommitPreviewRequestSchema,
  localIntegrationApprovalRequestSchema,
  localIntegrationPreviewRequestSchema,
  localChangeSetApprovalRequestSchema,
  localChangeSetPreviewRequestSchema,
  localProposalRequestSchema,
  localProposalImportSchema,
  localProposalDecisionRequestSchema,
  localRequestCreationSchema,
  localRequestMutationResponseSchema,
  validateLocalRequestCollection,
  type LocalRequest,
  type LocalRequestCollection,
} from "../../../packages/runtime/src/local-requests.js";
import { LocalRequestError } from "./local-request-store.js";
import { LocalExecutionError } from "./local-execution.js";
import {
  providerConnectRequestSchema,
  providerModelChangeRequestSchema,
  publicProviderConnectionCollectionSchema,
  providerConnectionMutationResponseSchema,
  type PublicProviderConnectionCollection,
  type ProviderConnectionMutationResponse
} from "../../../packages/runtime/src/provider-connections.js";
import { ProviderConnectionLifecycleError } from "../../../packages/providers/src/lifecycle.js";
import { ProviderConnectionServiceError } from "./provider-connection-service.js";
import {
  liveOperationsSnapshotSchema,
  type LiveOperationsSnapshot,
} from "../../../packages/runtime/src/live-operations.js";
import {
  autonomyAdvanceRequestSchema,
  autonomyModeChangeSchema,
  autonomyMutationResponseSchema,
  autonomyPauseChangeSchema,
  autonomySnapshotSchema,
  type AutonomyMutationResponse,
  type AutonomySnapshot,
} from "../../../packages/runtime/src/autonomy.js";
import { LocalAutonomyError } from "./local-autonomy-service.js";
import {
  activityKindSchema,
  activityQuerySchema,
  activitySeveritySchema,
  activitySnapshotSchema,
  type ActivityQuery,
  type ActivitySnapshot,
} from "../../../packages/runtime/src/activity.js";
import {
  decisionAgeSchema,
  decisionCategorySchema,
  decisionOwnerSchema,
  decisionPrioritySchema,
  decisionQuerySchema,
  decisionSnapshotSchema,
  type DecisionQuery,
  type DecisionSnapshot,
} from "../../../packages/runtime/src/decisions.js";
import {
  searchQuerySchema,
  searchScopeSchema,
  universalSearchSnapshotSchema,
  type SearchQuery,
  type UniversalSearchSnapshot,
} from "../../../packages/runtime/src/universal-search.js";
import {
  attentionActionSchema,
  attentionCategorySchema,
  attentionDispositionSchema,
  attentionMutationResponseSchema,
  attentionPreviewSchema,
  attentionQuerySchema,
  attentionSeveritySchema,
  attentionSnapshotSchema,
  quietHoursUpdateSchema,
  type AttentionMutationResponse,
  type AttentionPreview,
  type AttentionQuery,
  type AttentionSnapshot,
} from "../../../packages/runtime/src/attention.js";
import { AttentionError } from "./attention-center.js";
import { projectLifecycleRecordSchema, type ProjectLifecycleRecord } from "../../../packages/orchestration/src/project-lifecycle.js";
import { eligibilityDecisionSchema, type EligibilityDecision } from "../../../packages/orchestration/src/eligibility-gate.js";
import { ProjectLifecycleServiceError } from "./project-lifecycle-service.js";
import { ProjectIntakeStoreError } from "./project-intake-store.js";
import { projectIntakeCancelSchema, projectIntakeCollectionSchema, projectIntakeCreateSchema, projectIntakeDraftSchema, projectIntakeResourcesSchema, projectIntakeRevisionSchema, projectIntakeSchema, type ProjectIntake } from "../../../packages/runtime/src/project-intakes.js";
import { solutionDocumentSchema, solutionHistorySchema, type SolutionDocument } from "../../../packages/orchestration/src/solution-design.js";
import { projectEgressPermitSchema, type ProjectEgressPermit } from "./project-egress-policy-service.js";
import { solutionRunSchema, type SolutionRun } from "./project-solution-coordinator.js";
import { deliveryPlanDocumentSchema, deliveryPlanRunSchema, type DeliveryPlanDocument, type DeliveryPlanRun } from "../../../packages/orchestration/src/delivery-plan.js";
import { projectExecutionRecordSchema, type ProjectExecutionRecord } from "../../../packages/orchestration/src/project-execution.js";
import {
  nativePickerResponseSchema,
  type NativePickerResponse,
} from "../../../packages/runtime/src/native-picker.js";
import {
  withDiscoveryEvidence,
  type PublicIntegrationConnectionCollection,
} from "../../../packages/runtime/src/integration-connections.js";

const MAX_CONCURRENT_REQUESTS = 16;
const MAX_REQUEST_BYTES = 900_000;
const REQUEST_TIMEOUT_MS = 5_000;

export type ControlPlaneServerOptions = {
  host: "127.0.0.1" | "::1";
  port: number;
  allowedOrigins: readonly string[];
  health: () => ControlPlaneHealth | Promise<ControlPlaneHealth>;
  snapshot: () => ControlPlaneSnapshot | Promise<ControlPlaneSnapshot>;
  liveOperations?: () => LiveOperationsSnapshot | Promise<LiveOperationsSnapshot>;
  activity?: (query: ActivityQuery) => ActivitySnapshot | Promise<ActivitySnapshot>;
  decisions?: (query: DecisionQuery) => DecisionSnapshot | Promise<DecisionSnapshot>;
  search?: (query: SearchQuery) => UniversalSearchSnapshot | Promise<UniversalSearchSnapshot>;
  attention?: {
    snapshot: (query: AttentionQuery) => AttentionSnapshot | Promise<AttentionSnapshot>;
    preview: (input: unknown) => AttentionPreview | Promise<AttentionPreview>;
    apply: (input: unknown, idempotencyKey: string) => AttentionMutationResponse | Promise<AttentionMutationResponse>;
    previewQuietHours: (input: unknown) => AttentionPreview | Promise<AttentionPreview>;
    setQuietHours: (input: unknown, expectedRevision: number, idempotencyKey: string) => AttentionMutationResponse | Promise<AttentionMutationResponse>;
  };
  autonomy?: {
    snapshot: () => AutonomySnapshot | Promise<AutonomySnapshot>;
    setProjectMode: (projectId: string, input: unknown) => AutonomyMutationResponse | Promise<AutonomyMutationResponse>;
    setProjectPaused: (projectId: string, input: unknown) => AutonomyMutationResponse | Promise<AutonomyMutationResponse>;
    setRequestMode: (requestId: string, input: unknown) => AutonomyMutationResponse | Promise<AutonomyMutationResponse>;
    advance: (requestId: string, input: unknown) => AutonomyMutationResponse | Promise<AutonomyMutationResponse>;
  };
  providerConnections?: {
    list: () => PublicProviderConnectionCollection | Promise<PublicProviderConnectionCollection>;
    connect: (input: unknown) => ProviderConnectionMutationResponse | Promise<ProviderConnectionMutationResponse>;
    reProbe: (connectionId: string) => ProviderConnectionMutationResponse | Promise<ProviderConnectionMutationResponse>;
    replaceModel: (connectionId: string, input: unknown) => ProviderConnectionMutationResponse | Promise<ProviderConnectionMutationResponse>;
    revoke: (connectionId: string) => ProviderConnectionMutationResponse | Promise<ProviderConnectionMutationResponse>;
    disconnect: (connectionId: string) => ProviderConnectionMutationResponse | Promise<ProviderConnectionMutationResponse>;
  };
  projects?: {
    list: () => LocalProjectCollection | Promise<LocalProjectCollection>;
    create?: (input: unknown, idempotencyKey: string) => LocalProjectSnapshot | Promise<LocalProjectSnapshot>;
    register: (input: unknown) => LocalProjectSnapshot | Promise<LocalProjectSnapshot>;
    rescan: (projectId: string) => LocalProjectSnapshot | Promise<LocalProjectSnapshot>;
    setResources?: (projectId: string, input: unknown) => LocalProjectSnapshot | Promise<LocalProjectSnapshot>;
    addFiles?: (projectId: string, input: unknown) => unknown | Promise<unknown>;
    addFileContent?: (projectId: string, input: unknown) => unknown | Promise<unknown>;
    generateContext?: (projectId: string, input: unknown) => unknown | Promise<unknown>;
    artifacts?: (projectId: string) => unknown | Promise<unknown>;
    openArtifact?: (projectId: string, kind: "context" | "memory" | "research" | "product" | "design" | "delivery_plan" | "ops_rules" | "infra" | "security" | "decisions" | "status") => unknown | Promise<unknown>;
    forget: (projectId: string) => void | Promise<void>;
  };
  projectIntakes?: {
    list: () => readonly ProjectIntake[] | Promise<readonly ProjectIntake[]>;
    create: (input: unknown) => ProjectIntake | Promise<ProjectIntake>;
    saveDraft: (intakeId: string, input: unknown) => ProjectIntake | Promise<ProjectIntake>;
    selectResources: (intakeId: string, input: unknown) => ProjectIntake | Promise<ProjectIntake>;
    submit: (intakeId: string, input: unknown, idempotencyKey: string) => ProjectIntake | Promise<ProjectIntake>;
    cancel: (intakeId: string, expectedRevision: number, reason: string) => ProjectIntake | Promise<ProjectIntake>;
  };
  projectLifecycles?: {
    get: (projectId: string) => ProjectLifecycleRecord | Promise<ProjectLifecycleRecord>;
    answer: (projectId: string, input: unknown, idempotencyKey: string) => ProjectLifecycleRecord | Promise<ProjectLifecycleRecord>;
    eligibility: (projectId: string) => EligibilityDecision | Promise<EligibilityDecision>;
    assess: (projectId: string, input: unknown, idempotencyKey: string) => { lifecycle: ProjectLifecycleRecord; decision: EligibilityDecision } | Promise<{ lifecycle: ProjectLifecycleRecord; decision: EligibilityDecision }>;
    override?: (projectId: string, input: unknown, idempotencyKey: string) => { lifecycle: ProjectLifecycleRecord; decision: EligibilityDecision } | Promise<{ lifecycle: ProjectLifecycleRecord; decision: EligibilityDecision }>;
    publishSolution: (projectId: string, input: unknown) => ProjectLifecycleRecord | Promise<ProjectLifecycleRecord>;
    getSolution: (projectId: string) => SolutionDocument | Promise<SolutionDocument>;
    getSolutionHistory?: (projectId: string) => readonly SolutionDocument[] | Promise<readonly SolutionDocument[]>;
    decideSolution: (projectId: string, input: unknown, idempotencyKey: string) => ProjectLifecycleRecord | Promise<ProjectLifecycleRecord>;
    reopen?: (projectId: string, input: unknown, idempotencyKey: string) => ProjectLifecycleRecord | Promise<ProjectLifecycleRecord>;
    solutionRun?: (projectId: string) => SolutionRun | null | Promise<SolutionRun | null>;
    generateSolution?: (projectId: string) => SolutionRun | Promise<SolutionRun>;
    getBacklog?: (projectId: string) => DeliveryPlanDocument | Promise<DeliveryPlanDocument>;
    backlogRun?: (projectId: string) => DeliveryPlanRun | null | Promise<DeliveryPlanRun | null>;
    generateBacklog?: (projectId: string) => DeliveryPlanRun | Promise<DeliveryPlanRun>;
    getExecution?: (projectId: string) => ProjectExecutionRecord | null | Promise<ProjectExecutionRecord | null>;
    getEgressConsent?: (projectId: string) => ProjectEgressPermit | null | Promise<ProjectEgressPermit | null>;
    grantEgressConsent?: (projectId: string, input: unknown) => ProjectEgressPermit | Promise<ProjectEgressPermit>;
    revokeEgressConsent?: (projectId: string) => void | Promise<void>;
  };
  nativePicker?: {
    folder: () => NativePickerResponse | Promise<NativePickerResponse>;
    files: () => NativePickerResponse | Promise<NativePickerResponse>;
  };
  integrationConnections?: {
    list: () => PublicIntegrationConnectionCollection | Promise<PublicIntegrationConnectionCollection>;
    probeGitHub: () => PublicIntegrationConnectionCollection | Promise<PublicIntegrationConnectionCollection>;
    connectJira: (input: unknown) => PublicIntegrationConnectionCollection | Promise<PublicIntegrationConnectionCollection>;
    disconnectJira: () => PublicIntegrationConnectionCollection | Promise<PublicIntegrationConnectionCollection>;
    connectTelegram?: (input: unknown) => PublicIntegrationConnectionCollection | Promise<PublicIntegrationConnectionCollection>;
    disconnectTelegram?: () => PublicIntegrationConnectionCollection | Promise<PublicIntegrationConnectionCollection>;
    configureOAuth?: (input: unknown) => PublicIntegrationConnectionCollection | Promise<PublicIntegrationConnectionCollection>;
    beginOAuth?: (provider: "github" | "jira", redirectUri: string) => unknown | Promise<unknown>;
    completeJiraOAuth?: (input: { code: string; state: string }) => void | Promise<void>;
    completeBrokerOAuth?: (provider: "github" | "jira" | "google" | "slack" | "discord" | "vercel", ticket: string) => void | Promise<void>;
    connectToken?: (input: unknown) => PublicIntegrationConnectionCollection | Promise<PublicIntegrationConnectionCollection>;
    disconnectService?: (provider: "google" | "slack" | "discord" | "cloudflare" | "aws" | "vercel") => PublicIntegrationConnectionCollection | Promise<PublicIntegrationConnectionCollection>;
  };
  requests?: {
    list: () => LocalRequestCollection | Promise<LocalRequestCollection>;
    create: (input: unknown, idempotencyKey: string) => LocalRequest | Promise<LocalRequest>;
    cancel: (requestId: string) => LocalRequest | Promise<LocalRequest>;
    approve?: (requestId: string) => LocalRequest | Promise<LocalRequest>;
    claim?: (requestId: string) => LocalRequest | Promise<LocalRequest>;
    checkpoint?: (requestId: string) => LocalRequest | Promise<LocalRequest>;
    release?: (requestId: string) => LocalRequest | Promise<LocalRequest>;
    reconcile?: (requestId: string) => LocalRequest | Promise<LocalRequest>;
    ground?: (requestId: string) => LocalRequest | Promise<LocalRequest>;
    updatePlan?: (requestId: string, input: unknown) => LocalRequest | Promise<LocalRequest>;
    approvePlan?: (requestId: string, input: unknown) => LocalRequest | Promise<LocalRequest>;
    authorizeExecution?: (requestId: string, input: unknown) => LocalRequest | Promise<LocalRequest>;
    prepareExecution?: (requestId: string) => LocalRequest | Promise<LocalRequest>;
    cancelExecution?: (requestId: string) => LocalRequest | Promise<LocalRequest>;
    reconcileExecution?: (requestId: string) => LocalRequest | Promise<LocalRequest>;
    startExecution?: (requestId: string) => LocalRequest | Promise<LocalRequest>;
    validateExecution?: (requestId: string) => LocalRequest | Promise<LocalRequest>;
    previewPatch?: (requestId: string, input: unknown) => LocalRequest | Promise<LocalRequest>;
    approvePatch?: (requestId: string, input: unknown) => LocalRequest | Promise<LocalRequest>;
    applyPatch?: (requestId: string) => LocalRequest | Promise<LocalRequest>;
    rollbackPatch?: (requestId: string) => LocalRequest | Promise<LocalRequest>;
    reconcilePatch?: (requestId: string) => LocalRequest | Promise<LocalRequest>;
    previewCommit?: (requestId: string, input: unknown) => LocalRequest | Promise<LocalRequest>;
    approveCommit?: (requestId: string, input: unknown) => LocalRequest | Promise<LocalRequest>;
    createCommit?: (requestId: string) => LocalRequest | Promise<LocalRequest>;
    undoCommit?: (requestId: string) => LocalRequest | Promise<LocalRequest>;
    reconcileCommit?: (requestId: string) => LocalRequest | Promise<LocalRequest>;
    previewIntegration?: (requestId: string, input: unknown) => LocalRequest | Promise<LocalRequest>;
    approveIntegration?: (requestId: string, input: unknown) => LocalRequest | Promise<LocalRequest>;
    createIntegration?: (requestId: string) => LocalRequest | Promise<LocalRequest>;
    undoIntegration?: (requestId: string) => LocalRequest | Promise<LocalRequest>;
    reconcileIntegration?: (requestId: string) => LocalRequest | Promise<LocalRequest>;
    previewChangeSet?: (requestId: string, input: unknown) => LocalRequest | Promise<LocalRequest>;
    approveChangeSet?: (requestId: string, input: unknown) => LocalRequest | Promise<LocalRequest>;
    applyChangeSet?: (requestId: string) => LocalRequest | Promise<LocalRequest>;
    rollbackChangeSet?: (requestId: string) => LocalRequest | Promise<LocalRequest>;
    reconcileChangeSet?: (requestId: string) => LocalRequest | Promise<LocalRequest>;
    requestProposal?: (requestId: string, input: unknown) => LocalRequest | Promise<LocalRequest>;
    beginProposalGeneration?: (requestId: string) => LocalRequest | Promise<LocalRequest>;
    generateProposal?: (requestId: string) => LocalRequest | Promise<LocalRequest>;
    importProposal?: (requestId: string, input: unknown) => LocalRequest | Promise<LocalRequest>;
    decideProposal?: (requestId: string, input: unknown) => LocalRequest | Promise<LocalRequest>;
    reconcileProposal?: (requestId: string) => LocalRequest | Promise<LocalRequest>;
    archive: (requestId: string) => void | Promise<void>;
  };
};

export function createControlPlaneServer(options: ControlPlaneServerOptions): {
  server: Server;
  listen: () => Promise<number>;
  close: () => Promise<void>;
} {
  if (!["127.0.0.1", "::1"].includes(options.host)) {
    throw new Error("Control plane must bind to an explicit loopback host.");
  }
  if (!Number.isInteger(options.port) || options.port < 0 || options.port > 65_535) {
    throw new Error("Control-plane port is invalid.");
  }
  const allowedOrigins = new Set(options.allowedOrigins.map(validateOrigin));
  let activeRequests = 0;

  const server = createServer(async (request, response) => {
    activeRequests += 1;
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Connection", "close");
    response.setHeader("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
    response.setHeader("Cross-Origin-Resource-Policy", "same-site");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("X-Frame-Options", "DENY");
    response.setHeader("Referrer-Policy", "no-referrer");
    response.setTimeout(REQUEST_TIMEOUT_MS, () => response.destroy());
    try {
      if (activeRequests > MAX_CONCURRENT_REQUESTS) {
        sendJson(response, 503, { error: "Control plane is busy." });
        return;
      }
      const origin = request.headers.origin;
      if (origin && !allowedOrigins.has(origin)) {
        sendJson(response, 403, { error: "Origin is not allowed." });
        return;
      }
      if (origin) {
        response.setHeader("Access-Control-Allow-Origin", origin);
        response.setHeader("Vary", "Origin");
      }
      if (request.method === "OPTIONS") {
        response.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
        response.setHeader(
          "Access-Control-Allow-Headers",
          "Content-Type, Idempotency-Key"
        );
        response.statusCode = 204;
        response.end();
        return;
      }
      const url = new URL(request.url ?? "/", `http://${options.host}`);
      if (url.pathname === "/api/v1/integration-connections" && options.integrationConnections) {
        if (request.method !== "GET") {
          sendJson(response, 405, { error: "Method is not allowed." });
          return;
        }
        if (requestBodyDeclared(request)) {
          sendJson(response, 413, { error: "Request body is not accepted." });
          return;
        }
        sendJson(response, 200, withDiscoveryEvidence(await options.integrationConnections.list(), "cached_metadata"));
        return;
      }
      if (url.pathname === "/api/v1/integration-connections/oauth/configure" && options.integrationConnections?.configureOAuth) {
        if (request.method !== "POST") { sendJson(response, 405, { error: "Method is not allowed." }); return; }
        requireIdempotencyKey(request);
        sendJson(response, 200, withDiscoveryEvidence(await options.integrationConnections.configureOAuth(await readJsonBody(request)), "live_probe"));
        return;
      }
      if (url.pathname === "/api/v1/integration-connections/oauth/start" && options.integrationConnections?.beginOAuth) {
        if (request.method !== "POST") { sendJson(response, 405, { error: "Method is not allowed." }); return; }
        requireIdempotencyKey(request);
        const body = await readJsonBody(request) as { provider?: unknown };
        if (body.provider !== "github" && body.provider !== "jira") { sendJson(response, 400, { error: "OAuth provider is invalid." }); return; }
        const redirectUri = `http://${options.host}:${options.port}/oauth/jira/callback`;
        sendJson(response, 200, await options.integrationConnections.beginOAuth(body.provider, redirectUri));
        return;
      }
      if (url.pathname === "/oauth/jira/callback" && options.integrationConnections?.completeJiraOAuth) {
        const code = url.searchParams.get("code"); const state = url.searchParams.get("state");
        if (!code || !state) { response.statusCode = 400; response.end("Jira authorization was not completed."); return; }
        await options.integrationConnections.completeJiraOAuth({ code, state });
        response.statusCode = 200; response.setHeader("Content-Type", "text/html; charset=utf-8"); response.end("<!doctype html><title>Jira connected</title><body style='font-family:system-ui;background:#111;color:#fff;display:grid;place-items:center;height:100vh'><main><h1>Jira connected</h1><p>You can close this tab and return to Pipeline Studio.</p></main></body>");
        return;
      }
      if (url.pathname === "/oauth/broker/callback" && options.integrationConnections?.completeBrokerOAuth) {
        const ticket = url.searchParams.get("ticket"); const provider = url.searchParams.get("provider");
        if (!ticket || !["github", "jira", "google", "slack", "discord", "vercel"].includes(String(provider))) { response.statusCode = 400; response.end("Connection was not completed."); return; }
        await options.integrationConnections.completeBrokerOAuth(provider as "github" | "jira" | "google" | "slack" | "discord" | "vercel", ticket);
        response.statusCode = 302; response.setHeader("Location", `http://127.0.0.1:4310/settings?connected=${provider}`); response.end();
        return;
      }
      if (url.pathname === "/api/v1/integration-connections/github/probe" && options.integrationConnections) {
        if (request.method !== "POST") {
          sendJson(response, 405, { error: "Method is not allowed." });
          return;
        }
        requireIdempotencyKey(request);
        if (requestBodyDeclared(request)) {
          sendJson(response, 413, { error: "Request body is not accepted." });
          return;
        }
        sendJson(response, 200, withDiscoveryEvidence(await options.integrationConnections.probeGitHub(), "live_probe"));
        return;
      }
      if (url.pathname === "/api/v1/integration-connections/jira" && options.integrationConnections) {
        if (request.method === "POST") {
          requireIdempotencyKey(request);
          const body = await readJsonBody(request);
          sendJson(response, 200, withDiscoveryEvidence(await options.integrationConnections.connectJira(body), "live_probe"));
          return;
        }
        if (request.method === "DELETE") {
          requireIdempotencyKey(request);
          if (requestBodyDeclared(request)) {
            sendJson(response, 413, { error: "Request body is not accepted." });
            return;
          }
          sendJson(response, 200, withDiscoveryEvidence(await options.integrationConnections.disconnectJira(), "live_probe"));
          return;
        }
        sendJson(response, 405, { error: "Method is not allowed." });
        return;
      }
      if (url.pathname === "/api/v1/integration-connections/telegram" && options.integrationConnections?.connectTelegram && options.integrationConnections.disconnectTelegram) {
        requireIdempotencyKey(request);
        if (request.method === "POST") {
          const body = await readJsonBody(request);
          sendJson(response, 200, withDiscoveryEvidence(await options.integrationConnections.connectTelegram(body), "live_probe"));
          return;
        }
        if (request.method === "DELETE") {
          if (requestBodyDeclared(request)) { sendJson(response, 413, { error: "Request body is not accepted." }); return; }
          sendJson(response, 200, withDiscoveryEvidence(await options.integrationConnections.disconnectTelegram(), "live_probe"));
          return;
        }
        sendJson(response, 405, { error: "Method is not allowed." });
        return;
      }
      if (url.pathname === "/api/v1/integration-connections/token" && options.integrationConnections?.connectToken) {
        if (request.method !== "POST") { sendJson(response, 405, { error: "Method is not allowed." }); return; }
        requireIdempotencyKey(request);
        sendJson(response, 200, withDiscoveryEvidence(await options.integrationConnections.connectToken(await readJsonBody(request)), "live_probe"));
        return;
      }
      const serviceDisconnect = url.pathname.match(/^\/api\/v1\/integration-connections\/(google|slack|discord|cloudflare|aws|vercel)$/);
      if (serviceDisconnect && request.method === "DELETE" && options.integrationConnections?.disconnectService) {
        requireIdempotencyKey(request);
        sendJson(response, 200, withDiscoveryEvidence(await options.integrationConnections.disconnectService(serviceDisconnect[1] as "google" | "slack" | "discord" | "cloudflare" | "aws" | "vercel"), "live_probe"));
        return;
      }
      if (
        request.method === "GET" &&
        url.pathname === "/api/v1/provider-connections" &&
        options.providerConnections
      ) {
        if (requestBodyDeclared(request)) {
          sendJson(response, 413, { error: "Request body is not accepted." });
          return;
        }
        sendJson(
          response,
          200,
          publicProviderConnectionCollectionSchema.parse(
            await options.providerConnections.list()
          )
        );
        return;
      }
      if (
        url.pathname === "/api/v1/autonomy" &&
        request.method !== "GET"
      ) {
        sendJson(response, 405, { error: "Method is not allowed." });
        return;
      }
      if (
        request.method === "GET" &&
        url.pathname === "/api/v1/autonomy" &&
        options.autonomy
      ) {
        if (requestBodyDeclared(request)) {
          sendJson(response, 413, { error: "Request body is not accepted." });
          return;
        }
        sendJson(response, 200, autonomySnapshotSchema.parse(await options.autonomy.snapshot()));
        return;
      }
      const autonomyProjectRoute = url.pathname.match(
        /^\/api\/v1\/autonomy\/projects\/(project_[a-f0-9]{16})\/(mode|pause)$/
      );
      if (request.method === "POST" && autonomyProjectRoute && options.autonomy) {
        requireIdempotencyKey(request);
        const result = autonomyProjectRoute[2] === "mode"
          ? await options.autonomy.setProjectMode(
              autonomyProjectRoute[1] ?? "",
              autonomyModeChangeSchema.parse(await readJsonBody(request))
            )
          : await options.autonomy.setProjectPaused(
              autonomyProjectRoute[1] ?? "",
              autonomyPauseChangeSchema.parse(await readJsonBody(request))
            );
        sendJson(response, 200, autonomyMutationResponseSchema.parse(result));
        return;
      }
      const autonomyRequestRoute = url.pathname.match(
        /^\/api\/v1\/autonomy\/requests\/(request_[a-f0-9]{20})\/(mode|advance)$/
      );
      if (request.method === "POST" && autonomyRequestRoute && options.autonomy) {
        requireIdempotencyKey(request);
        const result = autonomyRequestRoute[2] === "mode"
          ? await options.autonomy.setRequestMode(
              autonomyRequestRoute[1] ?? "",
              autonomyModeChangeSchema.parse(await readJsonBody(request))
            )
          : await options.autonomy.advance(
              autonomyRequestRoute[1] ?? "",
              autonomyAdvanceRequestSchema.parse(await readJsonBody(request))
            );
        sendJson(response, 200, autonomyMutationResponseSchema.parse(result));
        return;
      }
      if (
        request.method === "POST" &&
        url.pathname === "/api/v1/provider-connections" &&
        options.providerConnections
      ) {
        requireIdempotencyKey(request);
        response.setTimeout(90_000, () => response.destroy());
        const body = providerConnectRequestSchema.parse(await readJsonBody(request));
        sendJson(
          response,
          200,
          providerConnectionMutationResponseSchema.parse(
            await options.providerConnections.connect(body)
          )
        );
        return;
      }
      const providerConnectionRoute = url.pathname.match(
        /^\/api\/v1\/provider-connections\/([a-zA-Z0-9][a-zA-Z0-9._-]{0,119})\/(reprobe|model|revoke|registration)$/
      );
      if (
        request.method === "POST" &&
        providerConnectionRoute &&
        options.providerConnections
      ) {
        requireIdempotencyKey(request);
        response.setTimeout(90_000, () => response.destroy());
        const id = providerConnectionRoute[1] ?? "";
        const action = providerConnectionRoute[2];
        const result =
          action === "reprobe"
            ? await bodylessProviderAction(request, () => options.providerConnections!.reProbe(id))
            : action === "model"
              ? await options.providerConnections.replaceModel(
                  id,
                  providerModelChangeRequestSchema.parse(await readJsonBody(request))
                )
              : action === "revoke"
                ? await bodylessProviderAction(request, () => options.providerConnections!.revoke(id))
                : null;
        if (result) {
          sendJson(response, 200, providerConnectionMutationResponseSchema.parse(result));
          return;
        }
      }
      if (
        request.method === "DELETE" &&
        providerConnectionRoute?.[2] === "registration" &&
        options.providerConnections
      ) {
        requireIdempotencyKey(request);
        if (requestBodyDeclared(request)) {
          sendJson(response, 413, { error: "Request body is not accepted." });
          return;
        }
        sendJson(
          response,
          200,
          providerConnectionMutationResponseSchema.parse(
            await options.providerConnections.disconnect(providerConnectionRoute[1] ?? "")
          )
        );
        return;
      }
      if (
        ["/api/v1/health", "/api/v1/snapshot"].includes(url.pathname) &&
        request.method !== "GET"
      ) {
        sendJson(response, 405, { error: "Method is not allowed." });
        return;
      }
      if (
        url.pathname === "/api/v1/live-operations" &&
        request.method !== "GET"
      ) {
        sendJson(response, 405, { error: "Method is not allowed." });
        return;
      }
      if (url.pathname === "/api/v1/activity" && request.method !== "GET") {
        sendJson(response, 405, { error: "Method is not allowed." });
        return;
      }
      if (url.pathname === "/api/v1/decisions" && request.method !== "GET") {
        sendJson(response, 405, { error: "Method is not allowed." });
        return;
      }
      if (url.pathname === "/api/v1/search" && request.method !== "GET") {
        sendJson(response, 405, { error: "Method is not allowed." });
        return;
      }
      if (url.pathname === "/api/v1/attention" && request.method !== "GET") {
        sendJson(response, 405, { error: "Method is not allowed." });
        return;
      }
      if (
        request.method === "GET" &&
        url.pathname === "/api/v1/attention" &&
        options.attention
      ) {
        if (requestBodyDeclared(request)) {
          sendJson(response, 413, { error: "Request body is not accepted." });
          return;
        }
        const allowed = new Set(["severity", "category", "disposition", "project", "provider", "search", "suppressed"]);
        if ([...url.searchParams.keys()].some((key) => !allowed.has(key))) {
          sendJson(response, 400, { error: "Unknown attention query parameter." });
          return;
        }
        const query = attentionQuerySchema.parse({
          severities: parseFacet(url.searchParams.getAll("severity"), attentionSeveritySchema),
          categories: parseFacet(url.searchParams.getAll("category"), attentionCategorySchema),
          dispositions: parseFacet(url.searchParams.getAll("disposition"), attentionDispositionSchema),
          projectId: url.searchParams.get("project"),
          providerId: url.searchParams.get("provider"),
          search: url.searchParams.get("search") ?? "",
          includeSuppressed: url.searchParams.get("suppressed") !== "false",
        });
        sendJson(response, 200, attentionSnapshotSchema.parse(await options.attention.snapshot(query)));
        return;
      }
      if (
        request.method === "POST" &&
        url.pathname === "/api/v1/attention/preview" &&
        options.attention
      ) {
        sendJson(response, 200, attentionPreviewSchema.parse(await options.attention.preview(attentionActionSchema.parse(await readJsonBody(request)))));
        return;
      }
      if (
        request.method === "POST" &&
        url.pathname === "/api/v1/attention/actions" &&
        options.attention
      ) {
        sendJson(response, 200, attentionMutationResponseSchema.parse(await options.attention.apply(attentionActionSchema.parse(await readJsonBody(request)), requireIdempotencyKey(request))));
        return;
      }
      if (
        request.method === "POST" &&
        url.pathname === "/api/v1/attention/quiet-hours/preview" &&
        options.attention
      ) {
        sendJson(response, 200, attentionPreviewSchema.parse(await options.attention.previewQuietHours(quietHoursUpdateSchema.parse(await readJsonBody(request)))));
        return;
      }
      if (
        request.method === "POST" &&
        url.pathname === "/api/v1/attention/quiet-hours" &&
        options.attention
      ) {
        const body = await readJsonBody(request);
        if (!body || typeof body !== "object" || Array.isArray(body)) throw new ControlPlaneRequestError("Quiet-hours request is invalid.");
        const record = body as Record<string, unknown>;
        if (Object.keys(record).some((key) => !["preference", "expectedRevision"].includes(key))) throw new ControlPlaneRequestError("Quiet-hours request contains an unknown field.");
        const expectedRevision = record.expectedRevision;
        if (!Number.isInteger(expectedRevision) || (expectedRevision as number) < 0) throw new ControlPlaneRequestError("Expected revision is invalid.");
        sendJson(response, 200, attentionMutationResponseSchema.parse(await options.attention.setQuietHours(quietHoursUpdateSchema.parse(record.preference), expectedRevision as number, requireIdempotencyKey(request))));
        return;
      }
      if (
        request.method === "GET" &&
        url.pathname === "/api/v1/search" &&
        options.search
      ) {
        if (requestBodyDeclared(request)) {
          sendJson(response, 413, { error: "Request body is not accepted." });
          return;
        }
        const allowed = new Set(["q", "scope", "limit"]);
        if ([...url.searchParams.keys()].some((key) => !allowed.has(key))) {
          sendJson(response, 400, { error: "Unknown search query parameter." });
          return;
        }
        const limitValues = url.searchParams.getAll("limit");
        if (limitValues.length > 1) throw new ZodError([]);
        const query = searchQuerySchema.parse({
          query: url.searchParams.get("q") ?? "",
          scopes: parseFacet(url.searchParams.getAll("scope"), searchScopeSchema),
          limit: limitValues.length ? Number(limitValues[0]) : 24,
        });
        sendJson(response, 200, universalSearchSnapshotSchema.parse(await options.search(query)));
        return;
      }
      if (
        request.method === "GET" &&
        url.pathname === "/api/v1/decisions" &&
        options.decisions
      ) {
        if (requestBodyDeclared(request)) {
          sendJson(response, 413, { error: "Request body is not accepted." });
          return;
        }
        const allowed = new Set(["range", "category", "priority", "owner", "age", "project", "provider", "search"]);
        if ([...url.searchParams.keys()].some((key) => !allowed.has(key))) {
          sendJson(response, 400, { error: "Unknown decision query parameter." });
          return;
        }
        const query = decisionQuerySchema.parse({
          range: url.searchParams.get("range") ?? "7d",
          categories: parseFacet(url.searchParams.getAll("category"), decisionCategorySchema),
          priorities: parseFacet(url.searchParams.getAll("priority"), decisionPrioritySchema),
          owners: parseFacet(url.searchParams.getAll("owner"), decisionOwnerSchema),
          ages: parseFacet(url.searchParams.getAll("age"), decisionAgeSchema),
          projectId: url.searchParams.get("project"),
          providerId: url.searchParams.get("provider"),
          search: url.searchParams.get("search") ?? "",
        });
        sendJson(response, 200, decisionSnapshotSchema.parse(await options.decisions(query)));
        return;
      }
      if (
        request.method === "GET" &&
        url.pathname === "/api/v1/activity" &&
        options.activity
      ) {
        if (requestBodyDeclared(request)) {
          sendJson(response, 413, { error: "Request body is not accepted." });
          return;
        }
        const allowed = new Set(["range", "kind", "severity", "project", "provider", "search"]);
        if ([...url.searchParams.keys()].some((key) => !allowed.has(key))) {
          sendJson(response, 400, { error: "Unknown activity query parameter." });
          return;
        }
        const query = activityQuerySchema.parse({
          range: url.searchParams.get("range") ?? "24h",
          kinds: parseFacet(url.searchParams.getAll("kind"), activityKindSchema),
          severities: parseFacet(url.searchParams.getAll("severity"), activitySeveritySchema),
          projectId: url.searchParams.get("project"),
          providerId: url.searchParams.get("provider"),
          search: url.searchParams.get("search") ?? "",
        });
        sendJson(response, 200, activitySnapshotSchema.parse(await options.activity(query)));
        return;
      }
      if (
        request.method === "GET" &&
        url.pathname === "/api/v1/live-operations" &&
        options.liveOperations
      ) {
        if (requestBodyDeclared(request)) {
          sendJson(response, 413, { error: "Request body is not accepted." });
          return;
        }
        sendJson(
          response,
          200,
          liveOperationsSnapshotSchema.parse(await options.liveOperations())
        );
        return;
      }
      if (
        request.method === "GET" &&
        url.pathname === "/api/v1/requests" &&
        options.requests
      ) {
        if (requestBodyDeclared(request)) {
          sendJson(response, 413, { error: "Request body is not accepted." });
          return;
        }
        sendJson(
          response,
          200,
          validateLocalRequestCollection(await options.requests.list())
        );
        return;
      }
      if (
        request.method === "POST" &&
        url.pathname === "/api/v1/requests" &&
        options.requests
      ) {
        const idempotencyKey = requireIdempotencyKey(request);
        const body = localRequestCreationSchema.parse(await readJsonBody(request));
        const created = await options.requests.create(body, idempotencyKey);
        sendJson(
          response,
          200,
          localRequestMutationResponseSchema.parse({
            schemaVersion: 1,
            outcome: "created",
            request: created,
          })
        );
        return;
      }
      const requestRoute = url.pathname.match(
        /^\/api\/v1\/requests\/(request_[a-f0-9]{20})\/(approve|ground|plan-edit|plan-approve|execution-authorize|execution-prepare|execution-start|execution-validate|execution-cancel|execution-reconcile|patch-preview|patch-approve|patch-apply|patch-rollback|patch-reconcile|change-set-preview|change-set-approve|change-set-apply|change-set-rollback|change-set-reconcile|proposal-request|proposal-generate|proposal-import|proposal-decide|proposal-reconcile|commit-preview|commit-approve|commit-create|commit-undo|commit-reconcile|integration-preview|integration-approve|integration-create|integration-undo|integration-reconcile|claim|checkpoint|release|reconcile|cancel|archive)$/
      );
      if (request.method === "POST" && requestRoute?.[2] === "proposal-request" && options.requests?.requestProposal) {
        requireIdempotencyKey(request);
        const changed = await options.requests.requestProposal(requestRoute[1] ?? "", localProposalRequestSchema.parse(await readJsonBody(request)));
        sendJson(response, 200, localRequestMutationResponseSchema.parse({ schemaVersion: 1, outcome: "proposal_requested", request: changed })); return;
      }
      if (request.method === "POST" && requestRoute?.[2] === "proposal-import" && options.requests?.importProposal) {
        requireIdempotencyKey(request);
        const changed = await options.requests.importProposal(requestRoute[1] ?? "", localProposalImportSchema.parse(await readJsonBody(request)));
        sendJson(response, 200, localRequestMutationResponseSchema.parse({ schemaVersion: 1, outcome: "proposal_imported", request: changed })); return;
      }
      if (request.method === "POST" && requestRoute?.[2] === "proposal-decide" && options.requests?.decideProposal) {
        requireIdempotencyKey(request);
        const changed = await options.requests.decideProposal(requestRoute[1] ?? "", localProposalDecisionRequestSchema.parse(await readJsonBody(request)));
        sendJson(response, 200, localRequestMutationResponseSchema.parse({ schemaVersion: 1, outcome: changed.execution?.proposal?.state === "accepted" ? "proposal_accepted" : "proposal_rejected", request: changed })); return;
      }
      const proposalActions = { "proposal-generate": options.requests?.generateProposal ?? options.requests?.beginProposalGeneration, "proposal-reconcile": options.requests?.reconcileProposal } as const;
      const proposalAction = requestRoute?.[2] as keyof typeof proposalActions | undefined;
      if (request.method === "POST" && proposalAction && proposalActions[proposalAction]) {
        requireIdempotencyKey(request); if (requestBodyDeclared(request)) { sendJson(response, 413, { error: "Request body is not accepted." }); return; }
        const changed = await proposalActions[proposalAction]!(requestRoute?.[1] ?? "");
        sendJson(response, 200, localRequestMutationResponseSchema.parse({ schemaVersion: 1, outcome: proposalAction === "proposal-generate" ? "proposal_generating" : "proposal_reconciled", request: changed })); return;
      }
      if (request.method === "POST" && requestRoute?.[2] === "change-set-preview" && options.requests?.previewChangeSet) {
        requireIdempotencyKey(request);
        const changed = await options.requests.previewChangeSet(requestRoute[1] ?? "", localChangeSetPreviewRequestSchema.parse(await readJsonBody(request)));
        sendJson(response, 200, localRequestMutationResponseSchema.parse({ schemaVersion: 1, outcome: "change_set_previewed", request: changed })); return;
      }
      if (request.method === "POST" && requestRoute?.[2] === "change-set-approve" && options.requests?.approveChangeSet) {
        requireIdempotencyKey(request);
        const changed = await options.requests.approveChangeSet(requestRoute[1] ?? "", localChangeSetApprovalRequestSchema.parse(await readJsonBody(request)));
        sendJson(response, 200, localRequestMutationResponseSchema.parse({ schemaVersion: 1, outcome: "change_set_approved", request: changed })); return;
      }
      const changeSetActions = {
        "change-set-apply": options.requests?.applyChangeSet,
        "change-set-rollback": options.requests?.rollbackChangeSet,
        "change-set-reconcile": options.requests?.reconcileChangeSet,
      } as const;
      const changeSetAction = requestRoute?.[2] as keyof typeof changeSetActions | undefined;
      if (request.method === "POST" && changeSetAction && changeSetActions[changeSetAction]) {
        requireIdempotencyKey(request);
        if (requestBodyDeclared(request)) { sendJson(response, 413, { error: "Request body is not accepted." }); return; }
        const changed = await changeSetActions[changeSetAction]!(requestRoute?.[1] ?? "");
        sendJson(response, 200, localRequestMutationResponseSchema.parse({
          schemaVersion: 1,
          outcome: ({ "change-set-apply": "change_set_applied", "change-set-rollback": "change_set_rolled_back", "change-set-reconcile": "change_set_reconciled" } as const)[changeSetAction],
          request: changed,
        })); return;
      }
      if (request.method === "POST" && requestRoute?.[2] === "integration-preview" && options.requests?.previewIntegration) {
        requireIdempotencyKey(request);
        const changed = await options.requests.previewIntegration(requestRoute[1] ?? "", localIntegrationPreviewRequestSchema.parse(await readJsonBody(request)));
        sendJson(response, 200, localRequestMutationResponseSchema.parse({ schemaVersion: 1, outcome: "integration_previewed", request: changed }));
        return;
      }
      if (request.method === "POST" && requestRoute?.[2] === "integration-approve" && options.requests?.approveIntegration) {
        requireIdempotencyKey(request);
        const changed = await options.requests.approveIntegration(requestRoute[1] ?? "", localIntegrationApprovalRequestSchema.parse(await readJsonBody(request)));
        sendJson(response, 200, localRequestMutationResponseSchema.parse({ schemaVersion: 1, outcome: "integration_approved", request: changed }));
        return;
      }
      const integrationActions = {
        "integration-create": options.requests?.createIntegration,
        "integration-undo": options.requests?.undoIntegration,
        "integration-reconcile": options.requests?.reconcileIntegration,
      } as const;
      const integrationAction = requestRoute?.[2] as keyof typeof integrationActions | undefined;
      if (request.method === "POST" && integrationAction && integrationActions[integrationAction]) {
        requireIdempotencyKey(request);
        if (requestBodyDeclared(request)) { sendJson(response, 413, { error: "Request body is not accepted." }); return; }
        const changed = await integrationActions[integrationAction]!(requestRoute?.[1] ?? "");
        sendJson(response, 200, localRequestMutationResponseSchema.parse({
          schemaVersion: 1,
          outcome: ({ "integration-create": "integration_created", "integration-undo": "integration_undone", "integration-reconcile": "integration_reconciled" } as const)[integrationAction],
          request: changed,
        }));
        return;
      }
      if (
        request.method === "POST" &&
        requestRoute?.[2] === "commit-preview" &&
        options.requests?.previewCommit
      ) {
        requireIdempotencyKey(request);
        const changed = await options.requests.previewCommit(
          requestRoute[1] ?? "",
          localCommitPreviewRequestSchema.parse(await readJsonBody(request))
        );
        sendJson(response, 200, localRequestMutationResponseSchema.parse({
          schemaVersion: 1, outcome: "commit_previewed", request: changed,
        }));
        return;
      }
      if (
        request.method === "POST" &&
        requestRoute?.[2] === "commit-approve" &&
        options.requests?.approveCommit
      ) {
        requireIdempotencyKey(request);
        const changed = await options.requests.approveCommit(
          requestRoute[1] ?? "",
          localCommitApprovalRequestSchema.parse(await readJsonBody(request))
        );
        sendJson(response, 200, localRequestMutationResponseSchema.parse({
          schemaVersion: 1, outcome: "commit_approved", request: changed,
        }));
        return;
      }
      const commitActions = {
        "commit-create": options.requests?.createCommit,
        "commit-undo": options.requests?.undoCommit,
        "commit-reconcile": options.requests?.reconcileCommit,
      } as const;
      const commitAction = requestRoute?.[2] as keyof typeof commitActions | undefined;
      if (request.method === "POST" && commitAction && commitActions[commitAction]) {
        requireIdempotencyKey(request);
        if (requestBodyDeclared(request)) {
          sendJson(response, 413, { error: "Request body is not accepted." });
          return;
        }
        const changed = await commitActions[commitAction]!(requestRoute?.[1] ?? "");
        sendJson(response, 200, localRequestMutationResponseSchema.parse({
          schemaVersion: 1,
          outcome: ({
            "commit-create": "commit_created",
            "commit-undo": "commit_undone",
            "commit-reconcile": "commit_reconciled",
          } as const)[commitAction],
          request: changed,
        }));
        return;
      }
      if (
        request.method === "POST" &&
        requestRoute?.[2] === "patch-preview" &&
        options.requests?.previewPatch
      ) {
        requireIdempotencyKey(request);
        const changed = await options.requests.previewPatch(
          requestRoute[1] ?? "",
          localPatchPreviewRequestSchema.parse(await readJsonBody(request))
        );
        sendJson(response, 200, localRequestMutationResponseSchema.parse({
          schemaVersion: 1,
          outcome: "patch_previewed",
          request: changed,
        }));
        return;
      }
      if (
        request.method === "POST" &&
        requestRoute?.[2] === "patch-approve" &&
        options.requests?.approvePatch
      ) {
        requireIdempotencyKey(request);
        const changed = await options.requests.approvePatch(
          requestRoute[1] ?? "",
          localPatchApprovalRequestSchema.parse(await readJsonBody(request))
        );
        sendJson(response, 200, localRequestMutationResponseSchema.parse({
          schemaVersion: 1,
          outcome: "patch_approved",
          request: changed,
        }));
        return;
      }
      const patchActions = {
        "patch-apply": options.requests?.applyPatch,
        "patch-rollback": options.requests?.rollbackPatch,
        "patch-reconcile": options.requests?.reconcilePatch,
      } as const;
      const patchAction = requestRoute?.[2] as keyof typeof patchActions | undefined;
      if (request.method === "POST" && patchAction && patchActions[patchAction]) {
        requireIdempotencyKey(request);
        if (requestBodyDeclared(request)) {
          sendJson(response, 413, { error: "Request body is not accepted." });
          return;
        }
        const changed = await patchActions[patchAction]!(requestRoute?.[1] ?? "");
        sendJson(response, 200, localRequestMutationResponseSchema.parse({
          schemaVersion: 1,
          outcome: ({
            "patch-apply": "patch_applied",
            "patch-rollback": "patch_rolled_back",
            "patch-reconcile": "patch_reconciled",
          } as const)[patchAction],
          request: changed,
        }));
        return;
      }
      if (
        request.method === "POST" &&
        requestRoute?.[2] === "execution-authorize" &&
        options.requests?.authorizeExecution
      ) {
        requireIdempotencyKey(request);
        const changed = await options.requests.authorizeExecution(
          requestRoute[1] ?? "",
          localExecutionAuthorizationRequestSchema.parse(await readJsonBody(request))
        );
        sendJson(response, 200, localRequestMutationResponseSchema.parse({
          schemaVersion: 1,
          outcome: "execution_authorized",
          request: changed,
        }));
        return;
      }
      const executionActions = {
        "execution-prepare": options.requests?.prepareExecution,
        "execution-start": options.requests?.startExecution,
        "execution-validate": options.requests?.validateExecution,
        "execution-cancel": options.requests?.cancelExecution,
        "execution-reconcile": options.requests?.reconcileExecution,
      } as const;
      const executionAction = requestRoute?.[2] as keyof typeof executionActions | undefined;
      if (
        request.method === "POST" &&
        executionAction &&
        executionActions[executionAction]
      ) {
        requireIdempotencyKey(request);
        if (requestBodyDeclared(request)) {
          sendJson(response, 413, { error: "Request body is not accepted." });
          return;
        }
        const changed = await executionActions[executionAction]!(requestRoute?.[1] ?? "");
        sendJson(response, 200, localRequestMutationResponseSchema.parse({
          schemaVersion: 1,
          outcome: ({
            "execution-prepare": "workspace_prepared",
            "execution-start": "execution_started",
            "execution-validate": "execution_validated",
            "execution-cancel": "execution_cancelled",
            "execution-reconcile": "execution_reconciled",
          } as const)[executionAction],
          request: changed,
        }));
        return;
      }
      if (
        request.method === "POST" &&
        requestRoute?.[2] === "plan-edit" &&
        options.requests?.updatePlan
      ) {
        requireIdempotencyKey(request);
        const changed = await options.requests.updatePlan(
          requestRoute[1] ?? "",
          localPlanEditSchema.parse(await readJsonBody(request))
        );
        sendJson(response, 200, localRequestMutationResponseSchema.parse({
          schemaVersion: 1,
          outcome: "plan_updated",
          request: changed,
        }));
        return;
      }
      if (
        request.method === "POST" &&
        requestRoute?.[2] === "plan-approve" &&
        options.requests?.approvePlan
      ) {
        requireIdempotencyKey(request);
        const changed = await options.requests.approvePlan(
          requestRoute[1] ?? "",
          localPlanApprovalSchema.parse(await readJsonBody(request))
        );
        sendJson(response, 200, localRequestMutationResponseSchema.parse({
          schemaVersion: 1,
          outcome: "plan_approved",
          request: changed,
        }));
        return;
      }
      const requestActions = {
        approve: options.requests?.approve,
        claim: options.requests?.claim,
        checkpoint: options.requests?.checkpoint,
        release: options.requests?.release,
        reconcile: options.requests?.reconcile,
        ground: options.requests?.ground,
      } as const;
      const lifecycleAction = requestRoute?.[2] as keyof typeof requestActions | undefined;
      if (
        request.method === "POST" &&
        lifecycleAction &&
        requestActions[lifecycleAction] &&
        options.requests
      ) {
        requireIdempotencyKey(request);
        if (requestBodyDeclared(request)) {
          sendJson(response, 413, { error: "Request body is not accepted." });
          return;
        }
        const changed = await requestActions[lifecycleAction]!(requestRoute?.[1] ?? "");
        sendJson(
          response,
          200,
          localRequestMutationResponseSchema.parse({
            schemaVersion: 1,
            outcome:
              ({
                approve: "approved",
                ground: "grounded",
                claim: "claimed",
                checkpoint: "checkpointed",
                release: "released",
                reconcile: "reconciled",
              } as const)[lifecycleAction],
            request: changed,
          })
        );
        return;
      }
      if (
        request.method === "POST" &&
        requestRoute?.[2] === "cancel" &&
        options.requests
      ) {
        requireIdempotencyKey(request);
        if (requestBodyDeclared(request)) {
          sendJson(response, 413, { error: "Request body is not accepted." });
          return;
        }
        const cancelled = await options.requests.cancel(requestRoute[1] ?? "");
        sendJson(
          response,
          200,
          localRequestMutationResponseSchema.parse({
            schemaVersion: 1,
            outcome: "cancelled",
            request: cancelled,
          })
        );
        return;
      }
      if (
        request.method === "DELETE" &&
        requestRoute?.[2] === "archive" &&
        options.requests
      ) {
        requireIdempotencyKey(request);
        if (requestBodyDeclared(request)) {
          sendJson(response, 413, { error: "Request body is not accepted." });
          return;
        }
        await options.requests.archive(requestRoute[1] ?? "");
        sendJson(
          response,
          200,
          localRequestMutationResponseSchema.parse({
            schemaVersion: 1,
            outcome: "archived",
            request: null,
          })
        );
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/v1/health") {
        if (requestBodyDeclared(request)) {
          sendJson(response, 413, { error: "Request body is not accepted." });
          return;
        }
        sendJson(response, 200, controlPlaneHealthSchema.parse(await options.health()));
        return;
      }
      if (
        request.method === "POST" &&
        (url.pathname === "/api/v1/system/pick-folder" || url.pathname === "/api/v1/system/pick-files") &&
        options.nativePicker
      ) {
        if (requestBodyDeclared(request)) {
          sendJson(response, 413, { error: "Request body is not accepted." });
          return;
        }
        const selection = url.pathname.endsWith("pick-folder")
          ? await options.nativePicker.folder()
          : await options.nativePicker.files();
        sendJson(response, 200, nativePickerResponseSchema.parse(selection));
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/v1/snapshot") {
        if (requestBodyDeclared(request)) {
          sendJson(response, 413, { error: "Request body is not accepted." });
          return;
        }
        sendJson(response, 200, validateControlPlaneSnapshot(await options.snapshot()));
        return;
      }
      if (
        request.method === "GET" &&
        url.pathname === "/api/v1/projects" &&
        options.projects
      ) {
        if (requestBodyDeclared(request)) {
          sendJson(response, 413, { error: "Request body is not accepted." });
          return;
        }
        sendJson(
          response,
          200,
          validateLocalProjectCollection(await options.projects.list())
        );
        return;
      }
      if (url.pathname === "/api/v1/project-intakes" && options.projectIntakes) {
        if (request.method === "GET") {
          if (requestBodyDeclared(request)) { sendJson(response, 413, { error: "Request body is not accepted." }); return; }
          sendJson(response, 200, projectIntakeCollectionSchema.parse({ schemaVersion: 1, intakes: await options.projectIntakes.list() })); return;
        }
        if (request.method === "POST") {
          requireIdempotencyKey(request);
          sendJson(response, 200, projectIntakeSchema.parse(await options.projectIntakes.create(projectIntakeCreateSchema.parse(await readJsonBody(request))))); return;
        }
        sendJson(response, 405, { error: "Method is not allowed." }); return;
      }
      const intakeRoute = url.pathname.match(/^\/api\/v1\/project-intakes\/(intake_[a-f0-9]{20})\/(draft|resources|submit|cancel)$/);
      if (intakeRoute && options.projectIntakes) {
        const intakeId = intakeRoute[1] ?? ""; const action = intakeRoute[2];
        if (action === "draft" && request.method === "PUT") { sendJson(response, 200, projectIntakeSchema.parse(await options.projectIntakes.saveDraft(intakeId, projectIntakeDraftSchema.parse(await readJsonBody(request))))); return; }
        if (action === "resources" && request.method === "PUT") { sendJson(response, 200, projectIntakeSchema.parse(await options.projectIntakes.selectResources(intakeId, projectIntakeResourcesSchema.parse(await readJsonBody(request))))); return; }
        if (action === "submit" && request.method === "POST") { sendJson(response, 200, projectIntakeSchema.parse(await options.projectIntakes.submit(intakeId, projectIntakeRevisionSchema.parse(await readJsonBody(request)), requireIdempotencyKey(request)))); return; }
        if (action === "cancel" && request.method === "POST") { const body = projectIntakeCancelSchema.parse(await readJsonBody(request)); sendJson(response, 200, projectIntakeSchema.parse(await options.projectIntakes.cancel(intakeId, body.expectedRevision, body.reason))); return; }
        sendJson(response, 405, { error: "Method is not allowed." }); return;
      }
      if (
        request.method === "POST" &&
        url.pathname === "/api/v1/projects/new" &&
        options.projects?.create
      ) {
        const idempotencyKey = requireIdempotencyKey(request);
        const body = localProjectCreationSchema.parse(await readJsonBody(request));
        const project = await options.projects.create(body, idempotencyKey);
        sendJson(
          response,
          200,
          localProjectMutationResponseSchema.parse({
            schemaVersion: 1,
            outcome: "created",
            project,
          })
        );
        return;
      }
      if (
        request.method === "POST" &&
        url.pathname === "/api/v1/projects" &&
        options.projects
      ) {
        requireIdempotencyKey(request);
        const body = localProjectRegistrationSchema.parse(await readJsonBody(request));
        const project = await options.projects.register(body);
        sendJson(
          response,
          200,
          localProjectMutationResponseSchema.parse({
            schemaVersion: 1,
            outcome: "registered",
            project,
          })
        );
        return;
      }
      const projectRoute = url.pathname.match(
        /^\/api\/v1\/projects\/(project_[a-f0-9]{16})\/(rescan|registration|resources|files|file-content|context|artifacts)$/
      );
      const projectLifecycleRoute = url.pathname.match(
        /^\/api\/v1\/projects\/(project_[a-f0-9]{16})\/(lifecycle|lifecycle-reopen|clarifications|eligibility|eligibility-override|solution|solution-history|solution-decision|solution-run|solution-generate|backlog|backlog-run|backlog-generate|execution|provider-consent)$/
      );
      const projectArtifactOpenRoute = url.pathname.match(/^\/api\/v1\/projects\/(project_[a-f0-9]{16})\/artifacts\/(context|memory|research|product|design|delivery_plan|ops_rules|infra|security|decisions|status)\/open$/);
      if (request.method === "GET" && projectRoute?.[2] === "artifacts" && options.projects?.artifacts) {
        if (requestBodyDeclared(request)) { sendJson(response, 413, { error: "Request body is not accepted." }); return; }
        sendJson(response, 200, z.array(z.strictObject({
          fileName: z.string().regex(/^[A-Z][A-Z-]+\.md$/),
          kind: z.enum(["context", "memory", "research", "product", "design", "delivery_plan", "ops_rules", "infra", "security", "decisions", "status"]),
          revision: z.number().int().nonnegative(),
          updatedAt: z.string().datetime(),
          producer: z.string().min(3).max(120),
          bodyDigest: z.string().regex(/^[a-f0-9]{64}$/),
          confidence: z.enum(["unknown", "mixed", "verified"]),
          approvalState: z.enum(["not_required", "pending", "approved"]),
          citations: z.strictObject({ verified: z.number().int().nonnegative(), unverified: z.number().int().nonnegative(), invalid: z.number().int().nonnegative() }),
          state: z.enum(["ready", "missing", "conflicted"]),
        })).length(11).parse(await options.projects.artifacts(projectRoute[1] ?? "")));
        return;
      }
      if (request.method === "POST" && projectArtifactOpenRoute && options.projects?.openArtifact) {
        requireIdempotencyKey(request);
        if (requestBodyDeclared(request)) { sendJson(response, 413, { error: "Request body is not accepted." }); return; }
        sendJson(response, 200, z.strictObject({ schemaVersion: z.literal(1), outcome: z.literal("opened"), kind: z.string(), fileName: z.string().regex(/^[A-Z][A-Z-]+\.md$/) }).parse(
          await options.projects.openArtifact(projectArtifactOpenRoute[1] ?? "", projectArtifactOpenRoute[2] as Parameters<NonNullable<typeof options.projects.openArtifact>>[1])
        ));
        return;
      }
      if (request.method === "GET" && projectLifecycleRoute?.[2] === "lifecycle" && options.projectLifecycles) {
        if (requestBodyDeclared(request)) {
          sendJson(response, 413, { error: "Request body is not accepted." });
          return;
        }
        sendJson(response, 200, projectLifecycleRecordSchema.parse(await options.projectLifecycles.get(projectLifecycleRoute[1] ?? "")));
        return;
      }
      if (request.method === "POST" && projectLifecycleRoute?.[2] === "lifecycle-reopen" && options.projectLifecycles?.reopen) {
        sendJson(response, 200, projectLifecycleRecordSchema.parse(await options.projectLifecycles.reopen(projectLifecycleRoute[1] ?? "", await readJsonBody(request), requireIdempotencyKey(request))));
        return;
      }
      if (request.method === "POST" && projectLifecycleRoute?.[2] === "clarifications" && options.projectLifecycles) {
        sendJson(response, 200, projectLifecycleRecordSchema.parse(await options.projectLifecycles.answer(
          projectLifecycleRoute[1] ?? "",
          await readJsonBody(request),
          requireIdempotencyKey(request)
        )));
        return;
      }
      if (request.method === "GET" && projectLifecycleRoute?.[2] === "eligibility" && options.projectLifecycles) {
        if (requestBodyDeclared(request)) { sendJson(response, 413, { error: "Request body is not accepted." }); return; }
        sendJson(response, 200, eligibilityDecisionSchema.parse(await options.projectLifecycles.eligibility(projectLifecycleRoute[1] ?? "")));
        return;
      }
      if (request.method === "POST" && projectLifecycleRoute?.[2] === "eligibility" && options.projectLifecycles) {
        const result = await options.projectLifecycles.assess(projectLifecycleRoute[1] ?? "", await readJsonBody(request), requireIdempotencyKey(request));
        sendJson(response, 200, z.strictObject({ lifecycle: projectLifecycleRecordSchema, decision: eligibilityDecisionSchema }).parse(result));
        return;
      }
      if (request.method === "POST" && projectLifecycleRoute?.[2] === "eligibility-override" && options.projectLifecycles?.override) {
        const result = await options.projectLifecycles.override(projectLifecycleRoute[1] ?? "", await readJsonBody(request), requireIdempotencyKey(request));
        sendJson(response, 200, z.strictObject({ lifecycle: projectLifecycleRecordSchema, decision: eligibilityDecisionSchema }).parse(result));
        return;
      }
      if (request.method === "POST" && projectLifecycleRoute?.[2] === "solution" && options.projectLifecycles) {
        requireIdempotencyKey(request);
        sendJson(response, 200, projectLifecycleRecordSchema.parse(await options.projectLifecycles.publishSolution(projectLifecycleRoute[1] ?? "", await readJsonBody(request))));
        return;
      }
      if (request.method === "GET" && projectLifecycleRoute?.[2] === "solution" && options.projectLifecycles) {
        if (requestBodyDeclared(request)) { sendJson(response, 413, { error: "Request body is not accepted." }); return; }
        sendJson(response, 200, solutionDocumentSchema.parse(await options.projectLifecycles.getSolution(projectLifecycleRoute[1] ?? "")));
        return;
      }
      if (request.method === "GET" && projectLifecycleRoute?.[2] === "solution-history" && options.projectLifecycles?.getSolutionHistory) {
        if (requestBodyDeclared(request)) { sendJson(response, 413, { error: "Request body is not accepted." }); return; }
        sendJson(response, 200, solutionHistorySchema.parse(await options.projectLifecycles.getSolutionHistory(projectLifecycleRoute[1] ?? ""))); return;
      }
      if (request.method === "POST" && projectLifecycleRoute?.[2] === "solution-decision" && options.projectLifecycles) {
        sendJson(response, 200, projectLifecycleRecordSchema.parse(await options.projectLifecycles.decideSolution(projectLifecycleRoute[1] ?? "", await readJsonBody(request), requireIdempotencyKey(request))));
        return;
      }
      if (request.method === "GET" && projectLifecycleRoute?.[2] === "solution-run" && options.projectLifecycles?.solutionRun) {
        if (requestBodyDeclared(request)) { sendJson(response, 413, { error: "Request body is not accepted." }); return; }
        sendJson(response, 200, solutionRunSchema.nullable().parse(await options.projectLifecycles.solutionRun(projectLifecycleRoute[1] ?? ""))); return;
      }
      if (request.method === "POST" && projectLifecycleRoute?.[2] === "solution-generate" && options.projectLifecycles?.generateSolution) {
        requireIdempotencyKey(request); if (requestBodyDeclared(request)) { sendJson(response, 413, { error: "Request body is not accepted." }); return; }
        sendJson(response, 202, solutionRunSchema.parse(await options.projectLifecycles.generateSolution(projectLifecycleRoute[1] ?? ""))); return;
      }
      if (request.method === "GET" && projectLifecycleRoute?.[2] === "backlog" && options.projectLifecycles?.getBacklog) {
        if (requestBodyDeclared(request)) { sendJson(response, 413, { error: "Request body is not accepted." }); return; }
        sendJson(response, 200, deliveryPlanDocumentSchema.parse(await options.projectLifecycles.getBacklog(projectLifecycleRoute[1] ?? ""))); return;
      }
      if (request.method === "GET" && projectLifecycleRoute?.[2] === "backlog-run" && options.projectLifecycles?.backlogRun) {
        if (requestBodyDeclared(request)) { sendJson(response, 413, { error: "Request body is not accepted." }); return; }
        sendJson(response, 200, deliveryPlanRunSchema.nullable().parse(await options.projectLifecycles.backlogRun(projectLifecycleRoute[1] ?? ""))); return;
      }
      if (request.method === "POST" && projectLifecycleRoute?.[2] === "backlog-generate" && options.projectLifecycles?.generateBacklog) {
        requireIdempotencyKey(request); if (requestBodyDeclared(request)) { sendJson(response, 413, { error: "Request body is not accepted." }); return; }
        sendJson(response, 202, deliveryPlanRunSchema.parse(await options.projectLifecycles.generateBacklog(projectLifecycleRoute[1] ?? ""))); return;
      }
      if (request.method === "GET" && projectLifecycleRoute?.[2] === "execution" && options.projectLifecycles?.getExecution) {
        if (requestBodyDeclared(request)) { sendJson(response, 413, { error: "Request body is not accepted." }); return; }
        sendJson(response, 200, projectExecutionRecordSchema.nullable().parse(await options.projectLifecycles.getExecution(projectLifecycleRoute[1] ?? ""))); return;
      }
      if (request.method === "GET" && projectLifecycleRoute?.[2] === "provider-consent" && options.projectLifecycles?.getEgressConsent) {
        if (requestBodyDeclared(request)) { sendJson(response, 413, { error: "Request body is not accepted." }); return; }
        sendJson(response, 200, projectEgressPermitSchema.nullable().parse(await options.projectLifecycles.getEgressConsent(projectLifecycleRoute[1] ?? ""))); return;
      }
      if (request.method === "POST" && projectLifecycleRoute?.[2] === "provider-consent" && options.projectLifecycles?.grantEgressConsent) {
        requireIdempotencyKey(request); sendJson(response, 200, projectEgressPermitSchema.parse(await options.projectLifecycles.grantEgressConsent(projectLifecycleRoute[1] ?? "", await readJsonBody(request)))); return;
      }
      if (request.method === "DELETE" && projectLifecycleRoute?.[2] === "provider-consent" && options.projectLifecycles?.revokeEgressConsent) {
        requireIdempotencyKey(request); if (requestBodyDeclared(request)) { sendJson(response, 413, { error: "Request body is not accepted." }); return; }
        await options.projectLifecycles.revokeEgressConsent(projectLifecycleRoute[1] ?? ""); sendJson(response, 200, { schemaVersion: 1, outcome: "revoked" }); return;
      }
      if (
        request.method === "POST" &&
        projectRoute?.[2] === "context" &&
        options.projects?.generateContext
      ) {
        requireIdempotencyKey(request);
        const body = await readJsonBody(request);
        sendJson(response, 200, projectContextSnapshotSchema.parse(
          await options.projects.generateContext(projectRoute[1] ?? "", body)
        ));
        return;
      }
      if (
        request.method === "POST" &&
        projectRoute?.[2] === "files" &&
        options.projects?.addFiles
      ) {
        requireIdempotencyKey(request);
        const body = localProjectFileImportSchema.parse(await readJsonBody(request));
        sendJson(response, 200, localProjectFileImportResponseSchema.parse(
          await options.projects.addFiles(projectRoute[1] ?? "", body)
        ));
        return;
      }
      if (
        request.method === "POST" &&
        projectRoute?.[2] === "file-content" &&
        options.projects?.addFileContent
      ) {
        requireIdempotencyKey(request);
        const body = localProjectContentImportSchema.parse(await readJsonBody(request, 28_000_000));
        sendJson(response, 200, localProjectFileImportResponseSchema.parse(
          await options.projects.addFileContent(projectRoute[1] ?? "", body)
        ));
        return;
      }
      if (
        request.method === "PUT" &&
        projectRoute?.[2] === "resources" &&
        options.projects?.setResources
      ) {
        requireIdempotencyKey(request);
        const body = projectResourceSelectionSchema.parse(await readJsonBody(request));
        const project = await options.projects.setResources(projectRoute[1] ?? "", body);
        sendJson(
          response,
          200,
          localProjectMutationResponseSchema.parse({
            schemaVersion: 1,
            outcome: "registered",
            project,
          })
        );
        return;
      }
      if (
        request.method === "POST" &&
        projectRoute?.[2] === "rescan" &&
        options.projects
      ) {
        if (requestBodyDeclared(request)) {
          sendJson(response, 413, { error: "Request body is not accepted." });
          return;
        }
        const project = await options.projects.rescan(projectRoute[1] ?? "");
        sendJson(
          response,
          200,
          localProjectMutationResponseSchema.parse({
            schemaVersion: 1,
            outcome: "rescanned",
            project,
          })
        );
        return;
      }
      if (
        request.method === "DELETE" &&
        projectRoute?.[2] === "registration" &&
        options.projects
      ) {
        if (requestBodyDeclared(request)) {
          sendJson(response, 413, { error: "Request body is not accepted." });
          return;
        }
        await options.projects.forget(projectRoute[1] ?? "");
        sendJson(
          response,
          200,
          localProjectMutationResponseSchema.parse({
            schemaVersion: 1,
            outcome: "forgotten",
            project: null,
          })
        );
        return;
      }
      if (!["GET", "POST", "DELETE"].includes(request.method ?? "")) {
        sendJson(response, 405, { error: "Method is not allowed." });
        return;
      }
      sendJson(response, 404, { error: "Endpoint not found." });
    } catch (error) {
      if (error instanceof LocalProjectError) {
        const status =
          error.code === "not_found"
            ? 404
            : error.code === "scan_active" || error.code === "duplicate_name"
              ? 409
              : 400;
        sendJson(response, status, { error: error.message, code: error.code });
      } else if (error instanceof LocalRequestError) {
        const status =
          error.code === "not_found" || error.code === "project_not_found"
            ? 404
            : error.code === "idempotency_conflict" ||
                error.code === "invalid_transition" ||
                error.code === "capacity" ||
                error.code === "lease_expired" ||
                error.code === "lease_active"
              ? 409
              : 400;
        sendJson(response, status, { error: error.message, code: error.code });
      } else if (error instanceof LocalExecutionError) {
        const status =
          error.code === "repository_dirty" ||
          error.code === "repository_mismatch" ||
          error.code === "workspace_conflict"
            ? 409
            : 400;
        sendJson(response, status, { error: error.message, code: error.code });
      } else if (error instanceof LocalAutonomyError) {
        const status =
          error.code === "not_found"
            ? 404
            : ["stale_revision", "lease_active", "confirmation_required"].includes(error.code)
              ? 409
              : error.code === "state_invalid"
                ? 503
                : 400;
        sendJson(response, status, { error: error.message, code: error.code });
      } else if (error instanceof AttentionError) {
        const status = error.code === "not_found" ? 404 : ["stale_revision", "idempotency_conflict"].includes(error.code) ? 409 : 503;
        sendJson(response, status, { error: error.message, code: error.code });
      } else if (error instanceof ProjectLifecycleServiceError) {
        sendJson(response, error.code === "not_found" ? 404 : error.code === "stale_revision" ? 409 : 500, { error: error.message, code: error.code });
      } else if (error instanceof ProjectIntakeStoreError) {
        sendJson(response, error.code === "not_found" ? 404 : ["stale_revision", "invalid_transition"].includes(error.code) ? 409 : 500, { error: error.message, code: error.code });
      } else if (
        error instanceof ProviderConnectionLifecycleError ||
        error instanceof ProviderConnectionServiceError
      ) {
        const status =
          ["connection-missing"].includes(error.code)
            ? 404
            : ["connection-conflict"].includes(error.code)
              ? 409
              : ["probe-failed", "adapter-unavailable"].includes(error.code)
                ? 503
                : 400;
        sendJson(response, status, { error: error.message, code: error.code });
      } else if (error instanceof ControlPlaneRequestError || error instanceof ZodError) {
        sendJson(response, 400, {
          error:
            error instanceof ControlPlaneRequestError
              ? error.message
              : "Request data does not match the local API contract.",
        });
      } else {
        sendJson(response, 500, { error: "Local control-plane request failed." });
      }
    } finally {
      activeRequests -= 1;
    }
  });

  return {
    server,
    listen: () =>
      new Promise((resolvePromise, reject) => {
        server.once("error", reject);
        server.listen({ host: options.host, port: options.port, exclusive: true }, () => {
          server.off("error", reject);
          const address = server.address();
          if (!address || typeof address === "string") {
            reject(new Error("Control-plane address is unavailable."));
            return;
          }
          resolvePromise(address.port);
        });
      }),
    close: () =>
      new Promise((resolvePromise, reject) => {
        server.close((error) => (error ? reject(error) : resolvePromise()));
        server.closeIdleConnections();
      }),
  };
}

function parseFacet<T>(values: string[], schema: { parse(value: unknown): T }): T[] {
  const flattened = values.flatMap((value) => value.split(",")).filter(Boolean);
  if (new Set(flattened).size !== flattened.length) throw new ZodError([]);
  return flattened.map((value) => schema.parse(value));
}

function requireIdempotencyKey(request: IncomingMessage): string {
  const value = request.headers["idempotency-key"];
  if (
    typeof value !== "string" ||
    !/^[a-zA-Z0-9._:-]{16,128}$/.test(value)
  ) {
    throw new ControlPlaneRequestError("A valid idempotency key is required.");
  }
  return value;
}

async function readJsonBody(request: IncomingMessage, maximumBytes = MAX_REQUEST_BYTES): Promise<unknown> {
  const contentType = request.headers["content-type"]?.split(";")[0]?.trim();
  if (contentType !== "application/json") {
    throw new ControlPlaneRequestError("Content-Type must be application/json.");
  }
  const declared = Number(request.headers["content-length"] ?? 0);
  if (!Number.isSafeInteger(declared) || declared < 1 || declared > maximumBytes) {
    throw new ControlPlaneRequestError("Request body is invalid.");
  }
  let value = "";
  for await (const chunk of request) {
    value += Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);
    if (Buffer.byteLength(value, "utf8") > maximumBytes) {
      throw new ControlPlaneRequestError("Request body is too large.");
    }
  }
  return JSON.parse(value) as unknown;
}

class ControlPlaneRequestError extends Error {}

async function bodylessProviderAction(
  request: IncomingMessage,
  action: () => ProviderConnectionMutationResponse | Promise<ProviderConnectionMutationResponse>
): Promise<ProviderConnectionMutationResponse> {
  if (requestBodyDeclared(request)) {
    throw new ControlPlaneRequestError("Request body is not accepted.");
  }
  return action();
}

function validateOrigin(origin: string): string {
  const url = new URL(origin);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    !["127.0.0.1", "localhost", "::1"].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error("Allowed Studio origin must be an origin-only loopback URL.");
  }
  return url.origin;
}

function requestBodyDeclared(request: IncomingMessage): boolean {
  if (request.headers["transfer-encoding"]) return true;
  const rawLength = request.headers["content-length"];
  if (rawLength === undefined) return false;
  const length = Number(rawLength);
  return !Number.isSafeInteger(length) || length < 0 || length > MAX_REQUEST_BYTES || length > 0;
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  if (response.destroyed || response.writableEnded) return;
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(`${JSON.stringify(body)}\n`);
}
