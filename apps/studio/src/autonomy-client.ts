import {
  autonomyAdvanceRequestSchema,
  autonomyModeChangeSchema,
  autonomyMutationResponseSchema,
  autonomyPauseChangeSchema,
  validateAutonomySnapshot,
  type AutonomyMode,
  type AutonomyMutationResponse,
  type AutonomySnapshot,
} from "../../../packages/runtime/src/autonomy.js";

const MAX_RESPONSE_BYTES = 400_000;

export async function fetchAutonomySnapshot(input: {
  endpoint: string;
  signal?: AbortSignal;
  fetcher?: typeof fetch;
}): Promise<AutonomySnapshot> {
  return validateAutonomySnapshot(await request({
    endpoint: input.endpoint,
    path: "/api/v1/autonomy",
    method: "GET",
    ...(input.signal ? { signal: input.signal } : {}),
    ...(input.fetcher ? { fetcher: input.fetcher } : {}),
  }));
}

export async function changeProjectAutonomyMode(input: {
  endpoint: string;
  projectId: string;
  mode: AutonomyMode;
  confirmBroaderAutomation: boolean;
  idempotencyKey: string;
  fetcher?: typeof fetch;
}): Promise<AutonomyMutationResponse> {
  assertProjectId(input.projectId);
  return autonomyMutationResponseSchema.parse(await request({
    endpoint: input.endpoint,
    path: `/api/v1/autonomy/projects/${input.projectId}/mode`,
    method: "POST",
    body: autonomyModeChangeSchema.parse({ schemaVersion: 1, mode: input.mode, confirmBroaderAutomation: input.confirmBroaderAutomation }),
    idempotencyKey: input.idempotencyKey,
    ...(input.fetcher ? { fetcher: input.fetcher } : {}),
  }));
}

export async function changeProjectAutonomyPause(input: {
  endpoint: string;
  projectId: string;
  paused: boolean;
  idempotencyKey: string;
  fetcher?: typeof fetch;
}): Promise<AutonomyMutationResponse> {
  assertProjectId(input.projectId);
  return autonomyMutationResponseSchema.parse(await request({
    endpoint: input.endpoint,
    path: `/api/v1/autonomy/projects/${input.projectId}/pause`,
    method: "POST",
    body: autonomyPauseChangeSchema.parse({ schemaVersion: 1, paused: input.paused }),
    idempotencyKey: input.idempotencyKey,
    ...(input.fetcher ? { fetcher: input.fetcher } : {}),
  }));
}

export async function advanceSafeStep(input: {
  endpoint: string;
  requestId: string;
  expectedUpdatedAt: number;
  idempotencyKey: string;
  fetcher?: typeof fetch;
}): Promise<AutonomyMutationResponse> {
  assertRequestId(input.requestId);
  return autonomyMutationResponseSchema.parse(await request({
    endpoint: input.endpoint,
    path: `/api/v1/autonomy/requests/${input.requestId}/advance`,
    method: "POST",
    body: autonomyAdvanceRequestSchema.parse({ schemaVersion: 1, expectedUpdatedAt: input.expectedUpdatedAt }),
    idempotencyKey: input.idempotencyKey,
    ...(input.fetcher ? { fetcher: input.fetcher } : {}),
  }));
}

async function request(input: {
  endpoint: string;
  path: string;
  method: "GET" | "POST";
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
  const declaredLength = Number(response.headers.get("content-length") ?? 0);
  if (declaredLength > MAX_RESPONSE_BYTES) throw new Error("Coordinator response is too large.");
  const text = await response.text();
  if (text.length > MAX_RESPONSE_BYTES) throw new Error("Coordinator response is too large.");
  const value = text ? JSON.parse(text) as unknown : {};
  if (!response.ok) {
    const error = value && typeof value === "object" && "error" in value
      ? String((value as { error: unknown }).error)
      : "Coordinator request failed.";
    throw new Error(error);
  }
  return value;
}

function validateEndpoint(value: string): URL {
  const endpoint = new URL(value);
  if (endpoint.protocol !== "http:" || !["127.0.0.1", "localhost", "::1"].includes(endpoint.hostname) || endpoint.username || endpoint.password || endpoint.pathname !== "/" || endpoint.search || endpoint.hash) {
    throw new Error("Coordinator endpoint must be an origin-only loopback HTTP URL.");
  }
  return endpoint;
}
function assertProjectId(value: string): void { if (!/^project_[a-f0-9]{16}$/.test(value)) throw new Error("Project identity is invalid."); }
function assertRequestId(value: string): void { if (!/^request_[a-f0-9]{20}$/.test(value)) throw new Error("Request identity is invalid."); }
