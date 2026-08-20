import {
  infrastructureApprovalSchema,
  infrastructureDeliveryStatusSchema,
  infrastructureMutationPreviewSchema,
  infrastructureReceiptSchema,
  type InfrastructureDeliveryStatus,
  type InfrastructureMutationPreview,
  type InfrastructureReceipt,
} from "../../../packages/orchestration/src/infrastructure-delivery-contracts.js";

const MAX_RESPONSE_BYTES = 1_100_000;

export async function getInfrastructureDeliveryStatus(input: {
  endpoint: string;
  projectId: string;
  fetcher?: typeof fetch;
}): Promise<InfrastructureDeliveryStatus> {
  assertProjectId(input.projectId);
  return infrastructureDeliveryStatusSchema.parse(await request({ ...input, path: `/api/v1/projects/${input.projectId}/infrastructure/status`, method: "GET" }));
}

export async function createInfrastructurePreview(input: {
  endpoint: string;
  projectId: string;
  body: unknown;
  idempotencyKey: string;
  fetcher?: typeof fetch;
}): Promise<InfrastructureMutationPreview> {
  assertProjectId(input.projectId);
  return infrastructureMutationPreviewSchema.parse(await request({ ...input, path: `/api/v1/projects/${input.projectId}/infrastructure/previews`, method: "POST" }));
}

export async function approveInfrastructurePreview(input: {
  endpoint: string;
  projectId: string;
  previewId: string;
  idempotencyKey: string;
  fetcher?: typeof fetch;
}): Promise<void> {
  assertIdentities(input.projectId, input.previewId);
  infrastructureApprovalSchema.parse(await request({ ...input, path: `/api/v1/projects/${input.projectId}/infrastructure/approvals/${input.previewId}`, method: "POST" }));
}

export async function executeInfrastructurePreview(input: {
  endpoint: string;
  projectId: string;
  previewId: string;
  idempotencyKey: string;
  fetcher?: typeof fetch;
}): Promise<InfrastructureReceipt> {
  assertIdentities(input.projectId, input.previewId);
  return infrastructureReceiptSchema.parse(await request({ ...input, path: `/api/v1/projects/${input.projectId}/infrastructure/executions/${input.previewId}`, method: "POST" }));
}

export async function rollbackInfrastructurePreview(input: {
  endpoint: string;
  projectId: string;
  previewId: string;
  idempotencyKey: string;
  fetcher?: typeof fetch;
}): Promise<InfrastructureReceipt> {
  assertIdentities(input.projectId, input.previewId);
  return infrastructureReceiptSchema.parse(await request({ ...input, path: `/api/v1/projects/${input.projectId}/infrastructure/rollbacks/${input.previewId}`, method: "POST" }));
}

async function request(input: {
  endpoint: string;
  path: string;
  method: "GET" | "POST";
  body?: unknown;
  idempotencyKey?: string;
  fetcher?: typeof fetch;
}): Promise<unknown> {
  const endpoint = validateEndpoint(input.endpoint);
  const response = await (input.fetcher ?? fetch)(new URL(input.path, endpoint), {
    method: input.method,
    cache: "no-store",
    credentials: "omit",
    headers: { Accept: "application/json", ...(input.body ? { "Content-Type": "application/json" } : {}), ...(input.idempotencyKey ? { "Idempotency-Key": input.idempotencyKey } : {}) },
    ...(input.body ? { body: JSON.stringify(input.body) } : {}),
  });
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (declared > MAX_RESPONSE_BYTES) throw new Error("Infrastructure response is too large.");
  const text = await response.text();
  if (text.length > MAX_RESPONSE_BYTES) throw new Error("Infrastructure response is too large.");
  if (!response.ok) {
    try {
      const parsed = JSON.parse(text) as { error?: unknown };
      if (typeof parsed.error === "string" && parsed.error.length <= 500) throw new Error(parsed.error);
    } catch (error) {
      if (error instanceof Error && error.message !== "Unexpected end of JSON input") throw error;
    }
    throw new Error("Infrastructure action could not be completed safely.");
  }
  return JSON.parse(text) as unknown;
}

function validateEndpoint(value: string): URL {
  const endpoint = new URL(value);
  if (endpoint.protocol !== "http:" || !["127.0.0.1", "localhost", "::1"].includes(endpoint.hostname) || endpoint.username || endpoint.password || endpoint.pathname !== "/" || endpoint.search || endpoint.hash) throw new Error("Infrastructure endpoint must be loopback-only.");
  return endpoint;
}

function assertProjectId(value: string): void { if (!/^project_[a-f0-9]{16}$/.test(value)) throw new Error("Project identity is invalid."); }
function assertIdentities(projectId: string, previewId: string): void { assertProjectId(projectId); if (!/^infra_preview_[a-f0-9]{20}$/.test(previewId)) throw new Error("Infrastructure preview identity is invalid."); }
