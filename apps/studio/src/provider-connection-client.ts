import {
  providerConnectionMutationResponseSchema,
  publicProviderConnectionCollectionSchema,
  type ProviderConnectionMutationResponse,
  type PublicProviderConnectionCollection
} from "../../../packages/runtime/src/provider-connections.js";

const MAX_RESPONSE_BYTES = 262_144;

export async function listProviderConnections(input: {
  endpoint: string;
  signal?: AbortSignal;
  fetcher?: typeof fetch;
}): Promise<PublicProviderConnectionCollection> {
  return publicProviderConnectionCollectionSchema.parse(
    await request({
      endpoint: input.endpoint,
      path: "/api/v1/provider-connections",
      method: "GET",
      ...(input.signal ? { signal: input.signal } : {}),
      ...(input.fetcher ? { fetcher: input.fetcher } : {})
    })
  );
}

export async function connectProvider(input: {
  endpoint: string;
  connection: unknown;
  idempotencyKey: string;
  signal?: AbortSignal;
  fetcher?: typeof fetch;
}): Promise<ProviderConnectionMutationResponse> {
  return providerConnectionMutationResponseSchema.parse(
    await request({
      endpoint: input.endpoint,
      path: "/api/v1/provider-connections",
      method: "POST",
      body: input.connection,
      idempotencyKey: input.idempotencyKey,
      ...(input.signal ? { signal: input.signal } : {}),
      ...(input.fetcher ? { fetcher: input.fetcher } : {})
    })
  );
}

export async function mutateProviderConnection(input: {
  endpoint: string;
  connectionId: string;
  action: "reprobe" | "model" | "revoke" | "delete";
  modelId?: string;
  idempotencyKey: string;
  signal?: AbortSignal;
  fetcher?: typeof fetch;
}): Promise<ProviderConnectionMutationResponse> {
  assertConnectionId(input.connectionId);
  const deleting = input.action === "delete";
  return providerConnectionMutationResponseSchema.parse(
    await request({
      endpoint: input.endpoint,
      path: `/api/v1/provider-connections/${input.connectionId}/${deleting ? "registration" : input.action}`,
      method: deleting ? "DELETE" : "POST",
      ...(input.action === "model"
        ? { body: { schemaVersion: 1, modelId: input.modelId } }
        : {}),
      idempotencyKey: input.idempotencyKey,
      ...(input.signal ? { signal: input.signal } : {}),
      ...(input.fetcher ? { fetcher: input.fetcher } : {})
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
      ...(input.idempotencyKey ? { "Idempotency-Key": input.idempotencyKey } : {})
    },
    ...(input.body ? { body: JSON.stringify(input.body) } : {}),
    ...(input.signal ? { signal: input.signal } : {})
  });
  const declaredLength = Number(response.headers.get("content-length") ?? 0);
  if (declaredLength > MAX_RESPONSE_BYTES) throw new Error("Provider connection response is too large.");
  const text = await response.text();
  if (text.length > MAX_RESPONSE_BYTES) throw new Error("Provider connection response is too large.");
  if (!response.ok) {
    let message = "The provider connection request could not be completed.";
    try {
      const parsed = JSON.parse(text) as { error?: unknown };
      if (typeof parsed.error === "string" && parsed.error.length <= 500) message = parsed.error;
    } catch {
      // Keep the bounded generic error.
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

function assertConnectionId(value: string): void {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,119}$/.test(value)) {
    throw new Error("Provider connection identity is invalid.");
  }
}
