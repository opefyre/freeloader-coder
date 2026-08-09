import {
  publicIntegrationConnectionCollectionSchema,
  type PublicIntegrationConnectionCollection,
} from "../../../packages/runtime/src/integration-connections.js";

export async function listIntegrationConnections(input: { endpoint: string; fetcher?: typeof fetch }) {
  return request({ ...input, path: "/api/v1/integration-connections", method: "GET" });
}

export async function probeGitHubConnection(input: { endpoint: string; idempotencyKey: string; fetcher?: typeof fetch }) {
  return request({ ...input, path: "/api/v1/integration-connections/github/probe", method: "POST" });
}

export async function connectJiraConnection(input: { endpoint: string; siteUrl: string; email: string; apiToken: string; idempotencyKey: string; fetcher?: typeof fetch }) {
  return request({ ...input, path: "/api/v1/integration-connections/jira", method: "POST", body: { schemaVersion: 1, siteUrl: input.siteUrl, email: input.email, apiToken: input.apiToken } });
}

export async function disconnectJiraConnection(input: { endpoint: string; idempotencyKey: string; fetcher?: typeof fetch }) {
  return request({ ...input, path: "/api/v1/integration-connections/jira", method: "DELETE" });
}

async function request(input: { endpoint: string; path: string; method: "GET" | "POST" | "DELETE"; body?: unknown; idempotencyKey?: string; fetcher?: typeof fetch }): Promise<PublicIntegrationConnectionCollection> {
  const endpoint = new URL(input.endpoint);
  if (endpoint.protocol !== "http:" || !["127.0.0.1", "localhost", "::1"].includes(endpoint.hostname)) throw new Error("Connection discovery must remain local.");
  const response = await (input.fetcher ?? fetch)(new URL(input.path, endpoint), { method: input.method, cache: "no-store", credentials: "omit", headers: { Accept: "application/json", ...(input.body ? { "Content-Type": "application/json" } : {}), ...(input.idempotencyKey ? { "Idempotency-Key": input.idempotencyKey } : {}) }, ...(input.body ? { body: JSON.stringify(input.body) } : {}) });
  const text = await response.text();
  if (text.length > 256_000) throw new Error("Connection discovery response is too large.");
  if (!response.ok) throw new Error("Connection discovery could not be completed.");
  return publicIntegrationConnectionCollectionSchema.parse(JSON.parse(text) as unknown);
}
