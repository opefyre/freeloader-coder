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
  localRequestCollectionSchema,
  localRequestMutationResponseSchema,
  type LocalRequestCollection,
  type LocalRequestMutationResponse,
} from "../../../packages/runtime/src/local-requests.js";

const MAX_RESPONSE_BYTES = 256_000;

export async function listLocalRequests(input: {
  endpoint: string;
  signal?: AbortSignal;
  fetcher?: typeof fetch;
}): Promise<LocalRequestCollection> {
  return localRequestCollectionSchema.parse(
    await request({ ...input, path: "/api/v1/requests", method: "GET" })
  );
}

export async function createLocalRequest(input: {
  endpoint: string;
  projectId: string;
  outcome: string;
  idempotencyKey: string;
  fetcher?: typeof fetch;
}): Promise<LocalRequestMutationResponse> {
  return localRequestMutationResponseSchema.parse(
    await request({
      endpoint: input.endpoint,
      path: "/api/v1/requests",
      method: "POST",
      body: { schemaVersion: 1, projectId: input.projectId, outcome: input.outcome },
      idempotencyKey: input.idempotencyKey,
      ...(input.fetcher ? { fetcher: input.fetcher } : {}),
    })
  );
}

export async function cancelLocalRequest(input: {
  endpoint: string;
  requestId: string;
  idempotencyKey: string;
  fetcher?: typeof fetch;
}): Promise<LocalRequestMutationResponse> {
  assertRequestId(input.requestId);
  return localRequestMutationResponseSchema.parse(
    await request({
      endpoint: input.endpoint,
      path: `/api/v1/requests/${input.requestId}/cancel`,
      method: "POST",
      idempotencyKey: input.idempotencyKey,
      ...(input.fetcher ? { fetcher: input.fetcher } : {}),
    })
  );
}

export async function advanceLocalRequest(input: {
  endpoint: string;
  requestId: string;
  action: "approve" | "ground" | "claim" | "checkpoint" | "release" | "reconcile";
  idempotencyKey: string;
  fetcher?: typeof fetch;
}): Promise<LocalRequestMutationResponse> {
  assertRequestId(input.requestId);
  return localRequestMutationResponseSchema.parse(
    await request({
      endpoint: input.endpoint,
      path: `/api/v1/requests/${input.requestId}/${input.action}`,
      method: "POST",
      idempotencyKey: input.idempotencyKey,
      ...(input.fetcher ? { fetcher: input.fetcher } : {}),
    })
  );
}

export async function updateLocalPlan(input: {
  endpoint: string;
  requestId: string;
  edit: unknown;
  idempotencyKey: string;
  fetcher?: typeof fetch;
}): Promise<LocalRequestMutationResponse> {
  assertRequestId(input.requestId);
  return localRequestMutationResponseSchema.parse(
    await request({
      endpoint: input.endpoint,
      path: `/api/v1/requests/${input.requestId}/plan-edit`,
      method: "POST",
      body: localPlanEditSchema.parse(input.edit),
      idempotencyKey: input.idempotencyKey,
      ...(input.fetcher ? { fetcher: input.fetcher } : {}),
    })
  );
}

export async function approveLocalPlan(input: {
  endpoint: string;
  requestId: string;
  approval: unknown;
  idempotencyKey: string;
  fetcher?: typeof fetch;
}): Promise<LocalRequestMutationResponse> {
  assertRequestId(input.requestId);
  return localRequestMutationResponseSchema.parse(
    await request({
      endpoint: input.endpoint,
      path: `/api/v1/requests/${input.requestId}/plan-approve`,
      method: "POST",
      body: localPlanApprovalSchema.parse(input.approval),
      idempotencyKey: input.idempotencyKey,
      ...(input.fetcher ? { fetcher: input.fetcher } : {}),
    })
  );
}

export async function authorizeLocalExecution(input: {
  endpoint: string;
  requestId: string;
  authorization: unknown;
  idempotencyKey: string;
  fetcher?: typeof fetch;
}): Promise<LocalRequestMutationResponse> {
  assertRequestId(input.requestId);
  return localRequestMutationResponseSchema.parse(
    await request({
      endpoint: input.endpoint,
      path: `/api/v1/requests/${input.requestId}/execution-authorize`,
      method: "POST",
      body: localExecutionAuthorizationRequestSchema.parse(input.authorization),
      idempotencyKey: input.idempotencyKey,
      ...(input.fetcher ? { fetcher: input.fetcher } : {}),
    })
  );
}

export async function advanceLocalExecution(input: {
  endpoint: string;
  requestId: string;
  action: "prepare" | "start" | "validate" | "cancel" | "reconcile";
  idempotencyKey: string;
  fetcher?: typeof fetch;
}): Promise<LocalRequestMutationResponse> {
  assertRequestId(input.requestId);
  return localRequestMutationResponseSchema.parse(
    await request({
      endpoint: input.endpoint,
      path: `/api/v1/requests/${input.requestId}/execution-${input.action}`,
      method: "POST",
      idempotencyKey: input.idempotencyKey,
      ...(input.fetcher ? { fetcher: input.fetcher } : {}),
    })
  );
}

export async function previewLocalPatch(input: {
  endpoint: string;
  requestId: string;
  proposal: unknown;
  idempotencyKey: string;
  fetcher?: typeof fetch;
}): Promise<LocalRequestMutationResponse> {
  assertRequestId(input.requestId);
  return localRequestMutationResponseSchema.parse(
    await request({
      endpoint: input.endpoint,
      path: `/api/v1/requests/${input.requestId}/patch-preview`,
      method: "POST",
      body: localPatchPreviewRequestSchema.parse(input.proposal),
      idempotencyKey: input.idempotencyKey,
      ...(input.fetcher ? { fetcher: input.fetcher } : {}),
    })
  );
}

export async function approveLocalPatch(input: {
  endpoint: string;
  requestId: string;
  approval: unknown;
  idempotencyKey: string;
  fetcher?: typeof fetch;
}): Promise<LocalRequestMutationResponse> {
  assertRequestId(input.requestId);
  return localRequestMutationResponseSchema.parse(
    await request({
      endpoint: input.endpoint,
      path: `/api/v1/requests/${input.requestId}/patch-approve`,
      method: "POST",
      body: localPatchApprovalRequestSchema.parse(input.approval),
      idempotencyKey: input.idempotencyKey,
      ...(input.fetcher ? { fetcher: input.fetcher } : {}),
    })
  );
}

export async function advanceLocalPatch(input: {
  endpoint: string;
  requestId: string;
  action: "apply" | "rollback" | "reconcile";
  idempotencyKey: string;
  fetcher?: typeof fetch;
}): Promise<LocalRequestMutationResponse> {
  assertRequestId(input.requestId);
  return localRequestMutationResponseSchema.parse(
    await request({
      endpoint: input.endpoint,
      path: `/api/v1/requests/${input.requestId}/patch-${input.action}`,
      method: "POST",
      idempotencyKey: input.idempotencyKey,
      ...(input.fetcher ? { fetcher: input.fetcher } : {}),
    })
  );
}

export async function previewLocalCommit(input: {
  endpoint: string;
  requestId: string;
  proposal: unknown;
  idempotencyKey: string;
  fetcher?: typeof fetch;
}): Promise<LocalRequestMutationResponse> {
  assertRequestId(input.requestId);
  return localRequestMutationResponseSchema.parse(await request({
    endpoint: input.endpoint,
    path: `/api/v1/requests/${input.requestId}/commit-preview`,
    method: "POST",
    body: localCommitPreviewRequestSchema.parse(input.proposal),
    idempotencyKey: input.idempotencyKey,
    ...(input.fetcher ? { fetcher: input.fetcher } : {}),
  }));
}

export async function approveLocalCommit(input: {
  endpoint: string;
  requestId: string;
  approval: unknown;
  idempotencyKey: string;
  fetcher?: typeof fetch;
}): Promise<LocalRequestMutationResponse> {
  assertRequestId(input.requestId);
  return localRequestMutationResponseSchema.parse(await request({
    endpoint: input.endpoint,
    path: `/api/v1/requests/${input.requestId}/commit-approve`,
    method: "POST",
    body: localCommitApprovalRequestSchema.parse(input.approval),
    idempotencyKey: input.idempotencyKey,
    ...(input.fetcher ? { fetcher: input.fetcher } : {}),
  }));
}

export async function advanceLocalCommit(input: {
  endpoint: string;
  requestId: string;
  action: "create" | "undo" | "reconcile";
  idempotencyKey: string;
  fetcher?: typeof fetch;
}): Promise<LocalRequestMutationResponse> {
  assertRequestId(input.requestId);
  return localRequestMutationResponseSchema.parse(await request({
    endpoint: input.endpoint,
    path: `/api/v1/requests/${input.requestId}/commit-${input.action}`,
    method: "POST",
    idempotencyKey: input.idempotencyKey,
    ...(input.fetcher ? { fetcher: input.fetcher } : {}),
  }));
}

export async function previewLocalIntegration(input: {
  endpoint: string; requestId: string; proposal: unknown; idempotencyKey: string; fetcher?: typeof fetch;
}): Promise<LocalRequestMutationResponse> {
  assertRequestId(input.requestId);
  return localRequestMutationResponseSchema.parse(await request({
    endpoint: input.endpoint, path: `/api/v1/requests/${input.requestId}/integration-preview`,
    method: "POST", body: localIntegrationPreviewRequestSchema.parse(input.proposal),
    idempotencyKey: input.idempotencyKey, ...(input.fetcher ? { fetcher: input.fetcher } : {}),
  }));
}

export async function approveLocalIntegration(input: {
  endpoint: string; requestId: string; approval: unknown; idempotencyKey: string; fetcher?: typeof fetch;
}): Promise<LocalRequestMutationResponse> {
  assertRequestId(input.requestId);
  return localRequestMutationResponseSchema.parse(await request({
    endpoint: input.endpoint, path: `/api/v1/requests/${input.requestId}/integration-approve`,
    method: "POST", body: localIntegrationApprovalRequestSchema.parse(input.approval),
    idempotencyKey: input.idempotencyKey, ...(input.fetcher ? { fetcher: input.fetcher } : {}),
  }));
}

export async function advanceLocalIntegration(input: {
  endpoint: string; requestId: string; action: "create" | "undo" | "reconcile";
  idempotencyKey: string; fetcher?: typeof fetch;
}): Promise<LocalRequestMutationResponse> {
  assertRequestId(input.requestId);
  return localRequestMutationResponseSchema.parse(await request({
    endpoint: input.endpoint, path: `/api/v1/requests/${input.requestId}/integration-${input.action}`,
    method: "POST", idempotencyKey: input.idempotencyKey,
    ...(input.fetcher ? { fetcher: input.fetcher } : {}),
  }));
}

export async function previewLocalChangeSet(input: {
  endpoint: string; requestId: string; proposal: unknown; idempotencyKey: string; fetcher?: typeof fetch;
}): Promise<LocalRequestMutationResponse> {
  assertRequestId(input.requestId);
  return localRequestMutationResponseSchema.parse(await request({
    endpoint: input.endpoint, path: `/api/v1/requests/${input.requestId}/change-set-preview`,
    method: "POST", body: localChangeSetPreviewRequestSchema.parse(input.proposal),
    idempotencyKey: input.idempotencyKey, ...(input.fetcher ? { fetcher: input.fetcher } : {}),
  }));
}

export async function approveLocalChangeSet(input: {
  endpoint: string; requestId: string; approval: unknown; idempotencyKey: string; fetcher?: typeof fetch;
}): Promise<LocalRequestMutationResponse> {
  assertRequestId(input.requestId);
  return localRequestMutationResponseSchema.parse(await request({
    endpoint: input.endpoint, path: `/api/v1/requests/${input.requestId}/change-set-approve`,
    method: "POST", body: localChangeSetApprovalRequestSchema.parse(input.approval),
    idempotencyKey: input.idempotencyKey, ...(input.fetcher ? { fetcher: input.fetcher } : {}),
  }));
}

export async function advanceLocalChangeSet(input: {
  endpoint: string; requestId: string; action: "apply" | "rollback" | "reconcile";
  idempotencyKey: string; fetcher?: typeof fetch;
}): Promise<LocalRequestMutationResponse> {
  assertRequestId(input.requestId);
  return localRequestMutationResponseSchema.parse(await request({
    endpoint: input.endpoint, path: `/api/v1/requests/${input.requestId}/change-set-${input.action}`,
    method: "POST", idempotencyKey: input.idempotencyKey,
    ...(input.fetcher ? { fetcher: input.fetcher } : {}),
  }));
}

export async function archiveLocalRequest(input: {
  endpoint: string;
  requestId: string;
  idempotencyKey: string;
  fetcher?: typeof fetch;
}): Promise<LocalRequestMutationResponse> {
  assertRequestId(input.requestId);
  return localRequestMutationResponseSchema.parse(
    await request({
      endpoint: input.endpoint,
      path: `/api/v1/requests/${input.requestId}/archive`,
      method: "DELETE",
      idempotencyKey: input.idempotencyKey,
      ...(input.fetcher ? { fetcher: input.fetcher } : {}),
    })
  );
}

async function request(input: {
  endpoint: string;
  path: string;
  method: "GET" | "POST" | "DELETE";
  body?: unknown;
  idempotencyKey?: string;
  signal?: AbortSignal;
  fetcher?: typeof fetch;
}): Promise<unknown> {
  const endpoint = validateEndpoint(input.endpoint);
  const response = await (input.fetcher ?? fetch)(new URL(input.path, endpoint), {
    method: input.method,
    cache: "no-store",
    credentials: "omit",
    headers: {
      Accept: "application/json",
      ...(input.body ? { "Content-Type": "application/json" } : {}),
      ...(input.idempotencyKey ? { "Idempotency-Key": input.idempotencyKey } : {}),
    },
    ...(input.body ? { body: JSON.stringify(input.body) } : {}),
    ...(input.signal ? { signal: input.signal } : {}),
  });
  const text = await response.text();
  if (text.length > MAX_RESPONSE_BYTES) throw new Error("Local request response is too large.");
  if (!response.ok) {
    let message = "The local request could not be completed.";
    try {
      const parsed = JSON.parse(text) as { error?: unknown };
      if (typeof parsed.error === "string" && parsed.error.length <= 500) message = parsed.error;
    } catch {
      // Keep the safe message.
    }
    throw new Error(message);
  }
  return JSON.parse(text) as unknown;
}

function validateEndpoint(value: string): URL {
  const endpoint = new URL(value);
  if (
    endpoint.protocol !== "http:" ||
    !["127.0.0.1", "localhost", "::1"].includes(endpoint.hostname) ||
    endpoint.username ||
    endpoint.password ||
    endpoint.pathname !== "/" ||
    endpoint.search ||
    endpoint.hash
  ) {
    throw new Error("Control-plane endpoint must be an origin-only loopback HTTP URL.");
  }
  return endpoint;
}

function assertRequestId(value: string): void {
  if (!/^request_[a-f0-9]{20}$/.test(value)) {
    throw new Error("Local request identity is invalid.");
  }
}
