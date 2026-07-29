import {
  validateLiveOperationsSnapshot,
  type LiveOperationsSnapshot,
} from "../../../packages/runtime/src/live-operations.js";

const MAX_RESPONSE_BYTES = 250_000;

export async function fetchLiveOperations(input: {
  endpoint: string;
  signal?: AbortSignal;
  fetcher?: typeof fetch;
}): Promise<LiveOperationsSnapshot> {
  const endpoint = validateEndpoint(input.endpoint);
  const response = await (input.fetcher ?? fetch)(
    new URL("/api/v1/live-operations", endpoint),
    {
      method: "GET",
      cache: "no-store",
      credentials: "omit",
      headers: { Accept: "application/json" },
      ...(input.signal ? { signal: input.signal } : {}),
    }
  );
  if (!response.ok) throw new Error("Live operations are unavailable.");
  const declaredLength = Number(response.headers.get("content-length") ?? 0);
  if (declaredLength > MAX_RESPONSE_BYTES) {
    throw new Error("Live operations response is too large.");
  }
  const text = await response.text();
  if (text.length > MAX_RESPONSE_BYTES) {
    throw new Error("Live operations response is too large.");
  }
  return validateLiveOperationsSnapshot(JSON.parse(text) as unknown);
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
