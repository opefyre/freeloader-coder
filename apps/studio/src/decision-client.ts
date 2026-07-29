import {
  decisionExportSchema,
  decisionQuerySchema,
  decisionSnapshotSchema,
  type DecisionExport,
  type DecisionQuery,
  type DecisionSnapshot,
} from "../../../packages/runtime/src/decisions.js";

const MAX_RESPONSE_BYTES = 700_000;

export async function fetchDecisions(input: {
  endpoint: string;
  query?: Partial<DecisionQuery>;
  signal?: AbortSignal;
  fetcher?: typeof fetch;
}): Promise<DecisionSnapshot> {
  const endpoint = validateEndpoint(input.endpoint);
  const query = decisionQuerySchema.parse(input.query ?? {});
  const url = new URL("/api/v1/decisions", endpoint);
  url.searchParams.set("range", query.range);
  query.categories.forEach((value) => url.searchParams.append("category", value));
  query.priorities.forEach((value) => url.searchParams.append("priority", value));
  query.owners.forEach((value) => url.searchParams.append("owner", value));
  query.ages.forEach((value) => url.searchParams.append("age", value));
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
  if (!response.ok) throw new Error(response.status === 400 ? "Decision filters are invalid." : "Local decisions are unavailable.");
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (declared > MAX_RESPONSE_BYTES) throw new Error("Decision response is too large.");
  const text = await response.text();
  if (text.length > MAX_RESPONSE_BYTES) throw new Error("Decision response is too large.");
  return decisionSnapshotSchema.parse(JSON.parse(text) as unknown);
}

export function createDecisionExport(snapshot: DecisionSnapshot, generatedAt = Date.now()): DecisionExport {
  return decisionExportSchema.parse({
    schemaVersion: 1,
    generatedAt,
    provenance: "local_decision_inbox_export",
    privacy: "redacted_displayed_records_only",
    completeness: "bounded_current_state",
    query: snapshot.query,
    items: snapshot.items,
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
