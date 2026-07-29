import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { ZodError } from "zod";

import {
  controlPlaneHealthSchema,
  validateControlPlaneSnapshot,
  type ControlPlaneHealth,
  type ControlPlaneSnapshot,
} from "../../../packages/runtime/src/control-plane.js";
import {
  localProjectMutationResponseSchema,
  localProjectRegistrationSchema,
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
  localRequestCreationSchema,
  localRequestMutationResponseSchema,
  validateLocalRequestCollection,
  type LocalRequest,
  type LocalRequestCollection,
} from "../../../packages/runtime/src/local-requests.js";
import { LocalRequestError } from "./local-request-store.js";
import { LocalExecutionError } from "./local-execution.js";

const MAX_CONCURRENT_REQUESTS = 16;
const MAX_REQUEST_BYTES = 98_304;
const REQUEST_TIMEOUT_MS = 5_000;

export type ControlPlaneServerOptions = {
  host: "127.0.0.1" | "::1";
  port: number;
  allowedOrigins: readonly string[];
  health: () => ControlPlaneHealth | Promise<ControlPlaneHealth>;
  snapshot: () => ControlPlaneSnapshot | Promise<ControlPlaneSnapshot>;
  projects?: {
    list: () => LocalProjectCollection | Promise<LocalProjectCollection>;
    register: (input: unknown) => LocalProjectSnapshot | Promise<LocalProjectSnapshot>;
    rescan: (projectId: string) => LocalProjectSnapshot | Promise<LocalProjectSnapshot>;
    forget: (projectId: string) => void | Promise<void>;
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
        response.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
        response.setHeader(
          "Access-Control-Allow-Headers",
          "Content-Type, Idempotency-Key"
        );
        response.statusCode = 204;
        response.end();
        return;
      }
      const url = new URL(request.url ?? "/", `http://${options.host}`);
      if (
        ["/api/v1/health", "/api/v1/snapshot"].includes(url.pathname) &&
        request.method !== "GET"
      ) {
        sendJson(response, 405, { error: "Method is not allowed." });
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
        /^\/api\/v1\/requests\/(request_[a-f0-9]{20})\/(approve|ground|plan-edit|plan-approve|execution-authorize|execution-prepare|execution-start|execution-validate|execution-cancel|execution-reconcile|patch-preview|patch-approve|patch-apply|patch-rollback|patch-reconcile|change-set-preview|change-set-approve|change-set-apply|change-set-rollback|change-set-reconcile|commit-preview|commit-approve|commit-create|commit-undo|commit-reconcile|integration-preview|integration-approve|integration-create|integration-undo|integration-reconcile|claim|checkpoint|release|reconcile|cancel|archive)$/
      );
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
        /^\/api\/v1\/projects\/(project_[a-f0-9]{16})\/(rescan|registration)$/
      );
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

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const contentType = request.headers["content-type"]?.split(";")[0]?.trim();
  if (contentType !== "application/json") {
    throw new ControlPlaneRequestError("Content-Type must be application/json.");
  }
  const declared = Number(request.headers["content-length"] ?? 0);
  if (!Number.isSafeInteger(declared) || declared < 1 || declared > MAX_REQUEST_BYTES) {
    throw new ControlPlaneRequestError("Request body is invalid.");
  }
  let value = "";
  for await (const chunk of request) {
    value += Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);
    if (Buffer.byteLength(value, "utf8") > MAX_REQUEST_BYTES) {
      throw new ControlPlaneRequestError("Request body is too large.");
    }
  }
  return JSON.parse(value) as unknown;
}

class ControlPlaneRequestError extends Error {}

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
