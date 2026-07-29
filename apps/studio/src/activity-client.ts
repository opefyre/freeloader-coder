import {
  activityExportSchema,
  activityQuerySchema,
  validateActivitySnapshot,
  type ActivityExport,
  type ActivityQuery,
  type ActivitySnapshot,
} from "../../../packages/runtime/src/activity.js";

const MAX_RESPONSE_BYTES = 700_000;

export async function fetchActivity(input: {
  endpoint: string;
  query?: Partial<ActivityQuery>;
  signal?: AbortSignal;
  fetcher?: typeof fetch;
}): Promise<ActivitySnapshot> {
  const endpoint = validateEndpoint(input.endpoint);
  const query = activityQuerySchema.parse(input.query ?? {});
  const url = new URL("/api/v1/activity", endpoint);
  url.searchParams.set("range", query.range);
  query.kinds.forEach((value) => url.searchParams.append("kind", value));
  query.severities.forEach((value) => url.searchParams.append("severity", value));
  if (query.projectId) url.searchParams.set("project", query.projectId);
  if (query.providerId) url.searchParams.set("provider", query.providerId);
  if (query.search) url.searchParams.set("search", query.search);
  const response = await (input.fetcher ?? fetch)(url, {
    method: "GET",
    cache: "no-store",
    credentials: "omit",
    headers: { Accept: "application/json" },
    ...(input.signal ? { signal: input.signal } : {}),
  });
  if (!response.ok) throw new Error(response.status === 400 ? "Activity filters are invalid." : "Local activity is unavailable.");
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (declared > MAX_RESPONSE_BYTES) throw new Error("Activity response is too large.");
  const text = await response.text();
  if (text.length > MAX_RESPONSE_BYTES) throw new Error("Activity response is too large.");
  return validateActivitySnapshot(JSON.parse(text) as unknown);
}

export function createActivityExport(snapshot: ActivitySnapshot, generatedAt = Date.now()): ActivityExport {
  return activityExportSchema.parse({
    schemaVersion: 1,
    provenance: "pipeline_studio_local_activity_export",
    generatedAt,
    sourceObservedAt: snapshot.observedAt,
    redaction: "credentials, personal paths, prompts, source content, and provider bodies excluded",
    query: snapshot.query,
    events: snapshot.events,
  });
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
  ) throw new Error("Control-plane endpoint must be an origin-only loopback HTTP URL.");
  return endpoint;
}
