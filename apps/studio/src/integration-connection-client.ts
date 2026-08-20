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

export async function probeJiraConnection(input: { endpoint: string; idempotencyKey: string; fetcher?: typeof fetch }) {
  return request({ ...input, path: "/api/v1/integration-connections/jira/probe", method: "POST" });
}

export async function configureIntegrationOAuth(input: { endpoint: string; provider: "github" | "jira"; clientId: string; clientSecret?: string; idempotencyKey: string; fetcher?: typeof fetch }) {
  return request({ ...input, path: "/api/v1/integration-connections/oauth/configure", method: "POST", body: { schemaVersion: 1, provider: input.provider, clientId: input.clientId, ...(input.clientSecret ? { clientSecret: input.clientSecret } : {}) } });
}

export async function beginIntegrationOAuth(input: { endpoint: string; provider: "github" | "jira" | "google" | "slack" | "discord" | "vercel"; idempotencyKey: string; fetcher?: typeof fetch }): Promise<{ schemaVersion: 1; provider: "github" | "jira" | "google" | "slack" | "discord" | "vercel"; mode: "device" | "redirect"; authorizationUrl: string; userCode: string | null; expiresAt: number }> {
  const endpoint = new URL(input.endpoint);
  if (endpoint.protocol !== "http:" || !["127.0.0.1", "localhost", "::1"].includes(endpoint.hostname)) throw new Error("Connections must remain local.");
  const broker = "https://pipeline-studio-oauth.opefyre.workers.dev";
  const response = await (input.fetcher ?? fetch)(`${broker}/v1/oauth/start`, { method: "POST", headers: { Accept: "application/json", "Content-Type": "application/json" }, body: JSON.stringify({ provider: input.provider, returnTo: `${endpoint.origin}/oauth/broker/callback` }) });
  if (!response.ok) { const message = await response.json().catch(() => ({})) as { error?: string }; throw new Error(message.error ?? "Browser authorization could not start."); }
  const result = await response.json() as { schemaVersion: 1; provider: "github" | "jira" | "google" | "slack" | "discord" | "vercel"; authorizationUrl: string; expiresAt: number };
  return { ...result, mode: "redirect", userCode: null };
}

export async function connectJiraConnection(input: { endpoint: string; siteUrl: string; email: string; apiToken: string; idempotencyKey: string; fetcher?: typeof fetch }) {
  return request({ ...input, path: "/api/v1/integration-connections/jira", method: "POST", body: { schemaVersion: 1, siteUrl: input.siteUrl, email: input.email, apiToken: input.apiToken } });
}

export async function disconnectJiraConnection(input: { endpoint: string; idempotencyKey: string; fetcher?: typeof fetch }) {
  return request({ ...input, path: "/api/v1/integration-connections/jira", method: "DELETE" });
}

export async function connectTelegramConnection(input: { endpoint: string; botToken: string; chatId: string; ownerUserId: string; idempotencyKey: string; fetcher?: typeof fetch }) {
  return request({ ...input, path: "/api/v1/integration-connections/telegram", method: "POST", body: { schemaVersion: 1, botToken: input.botToken, chatId: input.chatId, ownerUserId: input.ownerUserId } });
}

export async function disconnectTelegramConnection(input: { endpoint: string; idempotencyKey: string; fetcher?: typeof fetch }) {
  return request({ ...input, path: "/api/v1/integration-connections/telegram", method: "DELETE" });
}

export async function connectTokenService(input: { endpoint: string; provider: "cloudflare" | "aws" | "vercel"; secret: string; accountId?: string; accessKeyId?: string; idempotencyKey: string; fetcher?: typeof fetch }) {
  return request({ ...input, path: "/api/v1/integration-connections/token", method: "POST", body: { schemaVersion: 1, provider: input.provider, secret: input.secret, ...(input.accountId ? { accountId: input.accountId } : {}), ...(input.accessKeyId ? { accessKeyId: input.accessKeyId } : {}) } });
}

export async function disconnectServiceConnection(input: { endpoint: string; provider: "google" | "slack" | "discord" | "cloudflare" | "aws" | "vercel"; idempotencyKey: string; fetcher?: typeof fetch }) {
  return request({ ...input, path: `/api/v1/integration-connections/${input.provider}`, method: "DELETE" });
}

async function request(input: { endpoint: string; path: string; method: "GET" | "POST" | "DELETE"; body?: unknown; idempotencyKey?: string; fetcher?: typeof fetch }): Promise<PublicIntegrationConnectionCollection> {
  const endpoint = new URL(input.endpoint);
  if (endpoint.protocol !== "http:" || !["127.0.0.1", "localhost", "::1"].includes(endpoint.hostname)) throw new Error("Connection discovery must remain local.");
  const response = await (input.fetcher ?? fetch)(new URL(input.path, endpoint), { method: input.method, cache: "no-store", credentials: "omit", headers: { Accept: "application/json", ...(input.body ? { "Content-Type": "application/json" } : {}), ...(input.idempotencyKey ? { "Idempotency-Key": input.idempotencyKey } : {}) }, ...(input.body ? { body: JSON.stringify(input.body) } : {}) });
  const text = await response.text();
  if (text.length > 256_000) throw new Error("Connection discovery response is too large.");
  if (!response.ok) {
    try {
      const problem = JSON.parse(text) as { error?: unknown };
      if (typeof problem.error === "string" && problem.error.length <= 500) throw new Error(problem.error);
    } catch (error) {
      if (error instanceof Error && error.message !== "Unexpected end of JSON input") throw error;
    }
    throw new Error("Connection setup could not be completed.");
  }
  return publicIntegrationConnectionCollectionSchema.parse(JSON.parse(text) as unknown);
}
