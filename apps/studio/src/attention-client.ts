import {
  attentionMutationResponseSchema,
  attentionPreviewSchema,
  attentionQuerySchema,
  attentionSnapshotSchema,
  type AttentionAction,
  type AttentionMutationResponse,
  type AttentionPreview,
  type AttentionQuery,
  type AttentionSnapshot,
  type QuietHours,
} from "../../../packages/runtime/src/attention.js";

const MAX_RESPONSE_BYTES = 700_000;

export async function fetchAttention(input: { endpoint: string; query?: Partial<AttentionQuery>; signal?: AbortSignal }): Promise<AttentionSnapshot> {
  const endpoint = validateEndpoint(input.endpoint);
  const query = attentionQuerySchema.parse(input.query ?? {});
  const url = new URL("/api/v1/attention", endpoint);
  for (const value of query.severities) url.searchParams.append("severity", value);
  for (const value of query.categories) url.searchParams.append("category", value);
  for (const value of query.dispositions) url.searchParams.append("disposition", value);
  if (query.projectId) url.searchParams.set("project", query.projectId);
  if (query.providerId) url.searchParams.set("provider", query.providerId);
  if (query.search) url.searchParams.set("search", query.search);
  if (!query.includeSuppressed) url.searchParams.set("suppressed", "false");
  return attentionSnapshotSchema.parse(await request(url, { method: "GET", ...(input.signal ? { signal: input.signal } : {}) }));
}

export async function previewAttentionAction(endpoint: string, action: AttentionAction): Promise<AttentionPreview> {
  return attentionPreviewSchema.parse(await request(new URL("/api/v1/attention/preview", validateEndpoint(endpoint)), json(action)));
}
export async function applyAttentionAction(endpoint: string, action: AttentionAction, idempotencyKey: string): Promise<AttentionMutationResponse> {
  return attentionMutationResponseSchema.parse(await request(new URL("/api/v1/attention/actions", validateEndpoint(endpoint)), json(action, idempotencyKey)));
}
export async function previewQuietHours(endpoint: string, preference: QuietHours): Promise<AttentionPreview> {
  return attentionPreviewSchema.parse(await request(new URL("/api/v1/attention/quiet-hours/preview", validateEndpoint(endpoint)), json(preference)));
}
export async function updateQuietHours(endpoint: string, preference: QuietHours, expectedRevision: number, idempotencyKey: string): Promise<AttentionMutationResponse> {
  return attentionMutationResponseSchema.parse(await request(new URL("/api/v1/attention/quiet-hours", validateEndpoint(endpoint)), json({ preference, expectedRevision }, idempotencyKey)));
}

function json(body: unknown, idempotencyKey?: string): RequestInit {
  return { method: "POST", headers: { "Content-Type": "application/json", ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}) }, body: JSON.stringify(body) };
}
async function request(url: URL, init: RequestInit): Promise<unknown> {
  const response = await fetch(url, { ...init, cache: "no-store", credentials: "omit" });
  const length = Number(response.headers.get("content-length") ?? 0);
  if (Number.isFinite(length) && length > MAX_RESPONSE_BYTES) throw new AttentionClientError("Attention response is too large.", "oversized");
  const text = await response.text();
  if (new TextEncoder().encode(text).byteLength > MAX_RESPONSE_BYTES) throw new AttentionClientError("Attention response is too large.", "oversized");
  if (!response.ok) {
    let message = "Attention request failed.";
    try { const body = JSON.parse(text) as { error?: unknown }; if (typeof body.error === "string") message = body.error; } catch { /* keep safe message */ }
    throw new AttentionClientError(message, response.status === 409 ? "conflict" : response.status === 404 ? "not_found" : "unavailable");
  }
  try { return JSON.parse(text) as unknown; } catch { throw new AttentionClientError("Attention response is malformed.", "malformed"); }
}
function validateEndpoint(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== "http:" || !["127.0.0.1", "[::1]", "localhost"].includes(url.hostname) || url.username || url.password) throw new AttentionClientError("Attention endpoint must use loopback HTTP.", "remote");
  return url;
}
export class AttentionClientError extends Error {
  constructor(message: string, readonly code: "remote" | "oversized" | "malformed" | "conflict" | "not_found" | "unavailable") { super(message); }
}
