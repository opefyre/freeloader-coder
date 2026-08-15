interface KVNamespace { get(key: string, type: "json"): Promise<unknown>; put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>; delete(key: string): Promise<void> }
interface Env {
  OAUTH_STATE: KVNamespace;
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
  JIRA_CLIENT_ID: string;
  JIRA_CLIENT_SECRET: string;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  SLACK_CLIENT_ID: string;
  SLACK_CLIENT_SECRET: string;
  DISCORD_CLIENT_ID: string;
  DISCORD_CLIENT_SECRET: string;
  OAUTH_SEAL_KEY: string;
}

type Provider = "github" | "jira" | "google" | "slack" | "discord";
type StoredState = { provider: Provider; verifier: string; returnTo: string; createdAt: number };

const headers = {
  "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") {
      const origin = request.headers.get("Origin");
      if (!isLocalOrigin(origin)) return new Response(null, { status: 403 });
      return new Response(null, { status: 204, headers: { ...headers, "Access-Control-Allow-Origin": origin!, "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type", Vary: "Origin" } });
    }
    if (request.method === "GET" && url.pathname === "/health") {
      return json({ status: "ready", providers: configuredProviders(env) });
    }
    if (request.method === "POST" && url.pathname === "/v1/oauth/start") {
      const origin = request.headers.get("Origin");
      if (!isLocalOrigin(origin)) return json({ error: "Local Pipeline Studio origin required." }, 403);
      const input = await request.json().catch(() => null) as { provider?: unknown; returnTo?: unknown } | null;
      if (!input || !isProvider(input.provider) || typeof input.returnTo !== "string" || !isLocalReturn(input.returnTo)) return json({ error: "Invalid authorization request." }, 400);
      if (!providerConfigured(env, input.provider)) return json({ error: `${label(input.provider)} connection is temporarily unavailable.` }, 503);
      const state = randomToken(); const verifier = randomToken();
      await env.OAUTH_STATE.put(`state:${state}`, JSON.stringify({ provider: input.provider, verifier, returnTo: input.returnTo, createdAt: Date.now() } satisfies StoredState), { expirationTtl: 600 });
      return json({ schemaVersion: 1, provider: input.provider, authorizationUrl: await authorizationUrl(url.origin, input.provider, state, verifier, env), expiresAt: Date.now() + 600_000 }, 200, origin);
    }
    if (request.method === "GET" && url.pathname.startsWith("/callback/")) {
      const provider = url.pathname.slice("/callback/".length);
      const code = url.searchParams.get("code"); const state = url.searchParams.get("state");
      if (!isProvider(provider) || !code || !state) return page("Connection was not approved", "Return to Pipeline Studio and try again.", 400);
      const stored = await env.OAUTH_STATE.get(`state:${state}`, "json") as StoredState | null;
      await env.OAUTH_STATE.delete(`state:${state}`);
      if (!stored || stored.provider !== provider || Date.now() - stored.createdAt > 600_000) return page("Connection expired", "Return to Pipeline Studio and try again.", 400);
      try {
        const credential = await exchangeCode(url.origin, provider, code, stored.verifier, env);
        if ((provider === "jira" || provider === "google") && typeof credential.refresh_token === "string") {
          credential.refresh_grant = await sealRefreshGrant(provider, credential.refresh_token, env.OAUTH_SEAL_KEY);
          delete credential.refresh_token;
        }
        const ticket = randomToken();
        await env.OAUTH_STATE.put(`ticket:${ticket}`, JSON.stringify({ provider, credential }), { expirationTtl: 120 });
        const destination = new URL(stored.returnTo); destination.searchParams.set("ticket", ticket); destination.searchParams.set("provider", provider);
        return Response.redirect(destination.toString(), 302);
      } catch (error) {
        console.error("oauth_callback_failed", provider, error instanceof Error ? error.message : "unknown");
        return page("Connection failed", "No access was saved. Return to Pipeline Studio and try again.", 502);
      }
    }
    if (request.method === "POST" && url.pathname === "/v1/oauth/exchange") {
      const origin = request.headers.get("Origin");
      if (!isLocalOrigin(origin)) return json({ error: "Local Pipeline Studio origin required." }, 403);
      const input = await request.json().catch(() => null) as { ticket?: unknown } | null;
      if (!input || typeof input.ticket !== "string" || input.ticket.length < 32) return json({ error: "Invalid connection ticket." }, 400);
      const key = `ticket:${input.ticket}`; const result = await env.OAUTH_STATE.get(key, "json"); await env.OAUTH_STATE.delete(key);
      return result ? json(result, 200, origin) : json({ error: "Connection ticket expired or was already used." }, 410, origin);
    }
    if (request.method === "POST" && url.pathname === "/v1/oauth/refresh") {
      const origin = request.headers.get("Origin");
      if (!isLocalOrigin(origin)) return json({ error: "Local Pipeline Studio origin required." }, 403);
      const input = await request.json().catch(() => null) as { provider?: unknown; refreshGrant?: unknown; refreshToken?: unknown } | null;
      if (!input || (input.provider !== "google" && input.provider !== "jira")) return json({ error: "Invalid refresh request." }, 400, origin);
      try {
        const refreshToken = typeof input.refreshGrant === "string"
          ? (await openRefreshGrant(input.refreshGrant, env.OAUTH_SEAL_KEY, input.provider)).refreshToken
          : typeof input.refreshToken === "string" && input.refreshToken.length >= 20 ? input.refreshToken : null;
        if (!refreshToken) throw new Error("invalid_grant");
        const endpoint = input.provider === "jira" ? "https://auth.atlassian.com/oauth/token" : "https://oauth2.googleapis.com/token";
        const clientId = input.provider === "jira" ? env.JIRA_CLIENT_ID : env.GOOGLE_CLIENT_ID;
        const clientSecret = input.provider === "jira" ? env.JIRA_CLIENT_SECRET : env.GOOGLE_CLIENT_SECRET;
        const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ grant_type: "refresh_token", client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken }) });
        const credential = await checkedToken(response);
        credential.refresh_grant = await sealRefreshGrant(input.provider, typeof credential.refresh_token === "string" ? credential.refresh_token : refreshToken, env.OAUTH_SEAL_KEY);
        delete credential.refresh_token;
        return json({ credential }, 200, origin);
      } catch { return json({ error: `${label(input.provider)} connection must be authorized again.` }, 401, origin); }
    }
    return json({ error: "Not found." }, 404);
  },
};

async function authorizationUrl(origin: string, provider: Provider, state: string, verifier: string, env: Env) {
  const callback = `${origin}/callback/${provider}`;
  if (provider === "github") return `https://github.com/login/oauth/authorize?${new URLSearchParams({ client_id: env.GITHUB_CLIENT_ID, redirect_uri: callback, scope: "repo read:user user:email", state })}`;
  const challenge = await base64UrlSha256(verifier);
  if (provider === "jira") return `https://auth.atlassian.com/authorize?${new URLSearchParams({ audience: "api.atlassian.com", client_id: env.JIRA_CLIENT_ID, scope: "read:jira-work read:jira-user write:jira-work offline_access", redirect_uri: callback, state, response_type: "code", prompt: "consent", code_challenge: challenge, code_challenge_method: "S256" })}`;
  if (provider === "google") return `https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID, redirect_uri: callback, response_type: "code", scope: "openid email profile https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/cloud-platform.read-only", access_type: "offline", prompt: "consent", state, code_challenge: challenge, code_challenge_method: "S256" })}`;
  if (provider === "slack") return `https://slack.com/oauth/v2/authorize?${new URLSearchParams({ client_id: env.SLACK_CLIENT_ID, redirect_uri: callback, scope: "chat:write,channels:read,groups:read,users:read,channels:history,groups:history", state })}`;
  return `https://discord.com/oauth2/authorize?${new URLSearchParams({ client_id: env.DISCORD_CLIENT_ID, redirect_uri: callback, response_type: "code", scope: "identify guilds", state })}`;
}

async function exchangeCode(origin: string, provider: Provider, code: string, verifier: string, env: Env) {
  const redirectUri = `${origin}/callback/${provider}`;
  if (provider === "github") {
    const response = await fetch("https://github.com/login/oauth/access_token", { method: "POST", headers: { Accept: "application/json", "Content-Type": "application/json" }, body: JSON.stringify({ client_id: env.GITHUB_CLIENT_ID, client_secret: env.GITHUB_CLIENT_SECRET, code, redirect_uri: redirectUri }) });
    return checkedToken(response);
  }
  if (provider === "slack") {
    const response = await fetch("https://slack.com/api/oauth.v2.access", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: env.SLACK_CLIENT_ID, client_secret: env.SLACK_CLIENT_SECRET, code, redirect_uri: redirectUri }) });
    return checkedToken(response);
  }
  if (provider === "discord") {
    const response = await fetch("https://discord.com/api/oauth2/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: env.DISCORD_CLIENT_ID, client_secret: env.DISCORD_CLIENT_SECRET, grant_type: "authorization_code", code, redirect_uri: redirectUri }) });
    return checkedToken(response);
  }
  const endpoint = provider === "jira" ? "https://auth.atlassian.com/oauth/token" : "https://oauth2.googleapis.com/token";
  const body = provider === "jira"
    ? { grant_type: "authorization_code", client_id: env.JIRA_CLIENT_ID, client_secret: env.JIRA_CLIENT_SECRET, code, redirect_uri: redirectUri, code_verifier: verifier }
    : { grant_type: "authorization_code", client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, code, redirect_uri: redirectUri, code_verifier: verifier };
  return checkedToken(await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));
}

async function checkedToken(response: Response) { const value = await response.json() as Record<string, unknown>; if (!response.ok || typeof value.access_token !== "string") throw new Error(`Token exchange failed (${response.status}, ${typeof value.error === "string" ? value.error : "invalid_response"}).`); return value; }
function configuredProviders(env: Env) { return (["github", "jira", "google", "slack", "discord"] as const).filter((provider) => providerConfigured(env, provider)); }
function providerConfigured(env: Env, provider: Provider) { return provider === "github" ? Boolean(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET) : provider === "jira" ? Boolean(env.JIRA_CLIENT_ID && env.JIRA_CLIENT_SECRET) : provider === "google" ? Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) : provider === "slack" ? Boolean(env.SLACK_CLIENT_ID && env.SLACK_CLIENT_SECRET) : Boolean(env.DISCORD_CLIENT_ID && env.DISCORD_CLIENT_SECRET); }
function isProvider(value: unknown): value is Provider { return value === "github" || value === "jira" || value === "google" || value === "slack" || value === "discord"; }
function label(provider: Provider) { return provider === "jira" ? "Jira" : provider === "github" ? "GitHub" : provider === "google" ? "Google" : provider === "slack" ? "Slack" : "Discord"; }
function isLocalOrigin(value: string | null) { if (!value) return false; try { const url = new URL(value); return url.protocol === "http:" && ["127.0.0.1", "localhost", "::1"].includes(url.hostname); } catch { return false; } }
function isLocalReturn(value: string) { try { const url = new URL(value); return url.protocol === "http:" && ["127.0.0.1", "localhost", "::1"].includes(url.hostname) && url.pathname === "/oauth/broker/callback"; } catch { return false; } }
function randomToken() { const bytes = crypto.getRandomValues(new Uint8Array(32)); return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", ""); }
async function sealRefreshGrant(provider: "jira" | "google", refreshToken: string, encodedKey: string) {
  const key = await crypto.subtle.importKey("raw", base64UrlBytes(encodedKey), "AES-GCM", false, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify({ provider, refreshToken, expiresAt: Date.now() + 90 * 24 * 60 * 60 * 1000 }));
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext));
  return `${bytesBase64Url(iv)}.${bytesBase64Url(ciphertext)}`;
}
async function openRefreshGrant(value: string, encodedKey: string, expectedProvider: "jira" | "google") {
  const [encodedIv, encodedCiphertext, extra] = value.split(".");
  if (!encodedIv || !encodedCiphertext || extra) throw new Error("invalid_grant");
  const key = await crypto.subtle.importKey("raw", base64UrlBytes(encodedKey), "AES-GCM", false, ["decrypt"]);
  const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: base64UrlBytes(encodedIv) }, key, base64UrlBytes(encodedCiphertext));
  const parsed = JSON.parse(new TextDecoder().decode(plaintext)) as Record<string, unknown>;
  if (parsed.provider !== expectedProvider || typeof parsed.refreshToken !== "string" || typeof parsed.expiresAt !== "number" || parsed.expiresAt < Date.now()) throw new Error("invalid_grant");
  return { refreshToken: parsed.refreshToken };
}
function bytesBase64Url(value: Uint8Array) { return btoa(String.fromCharCode(...value)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", ""); }
function base64UrlBytes(value: string) { const normalized = value.replaceAll("-", "+").replaceAll("_", "/"); const decoded = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=")); return Uint8Array.from(decoded, (character) => character.charCodeAt(0)); }
async function base64UrlSha256(value: string) { const buffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)); return btoa(String.fromCharCode(...new Uint8Array(buffer))).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", ""); }
function json(value: unknown, status = 200, origin?: string | null) { return new Response(JSON.stringify(value), { status, headers: { ...headers, "Content-Type": "application/json", ...(origin ? { "Access-Control-Allow-Origin": origin, Vary: "Origin" } : {}) } }); }
function page(title: string, message: string, status: number) { return new Response(`<!doctype html><meta charset="utf-8"><title>${title}</title><main><h1>${title}</h1><p>${message}</p></main>`, { status, headers: { ...headers, "Content-Type": "text/html; charset=utf-8" } }); }
