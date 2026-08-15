interface KVNamespace {
  get(key: string, type: "json"): Promise<unknown>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
  list(options?: { prefix?: string; limit?: number }): Promise<{ keys: Array<{ name: string }> }>;
}
interface Env { OWNER_RESPONSES: KVNamespace; CHANNEL_RELAY_TOKEN: string; SLACK_SIGNING_SECRET: string; DISCORD_PUBLIC_KEY: string }

const securityHeaders = { "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" };
type RelayResponse = { schemaVersion: 1; relayId: string; provider: "slack" | "discord"; deliveryId: string; channelId: string; actorId: string; receivedAt: number };

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health") return json({ status: "ready" });
    if (request.method === "POST" && url.pathname === "/v1/channels/slack/interactions") return receiveSlack(request, env);
    if (request.method === "POST" && url.pathname === "/v1/channels/discord/interactions") return receiveDiscord(request, env);
    if (request.method === "POST" && url.pathname === "/v1/channels/responses/pull") return pull(request, env);
    if (request.method === "POST" && url.pathname === "/v1/channels/responses/ack") return acknowledge(request, env);
    return json({ error: "Not found." }, 404);
  },
};

async function receiveSlack(request: Request, env: Env) {
  const raw = await boundedText(request); const timestamp = request.headers.get("X-Slack-Request-Timestamp") ?? ""; const signature = request.headers.get("X-Slack-Signature") ?? "";
  if (!await verifySlack(raw, timestamp, signature, env.SLACK_SIGNING_SECRET)) return json({ error: "Invalid signature." }, 401);
  let payload: any; try { payload = JSON.parse(new URLSearchParams(raw).get("payload") ?? "null"); } catch { return json({ error: "Invalid payload." }, 400); }
  const action = Array.isArray(payload?.actions) && payload.actions.length === 1 ? payload.actions[0] : null;
  if (payload?.type !== "block_actions" || !/^codkesh_owner_response:(approve|decline)$/.test(action?.action_id ?? "") || !decisionId(action.value) || typeof payload?.channel?.id !== "string" || typeof payload?.user?.id !== "string") return json({ error: "Unsupported interaction." }, 400);
  await enqueue(env, { schemaVersion: 1, provider: "slack", deliveryId: action.value, channelId: payload.channel.id, actorId: payload.user.id, receivedAt: Date.now() });
  // Acknowledge visibly without storing the short-lived response URL. The
  // durable relay still applies the decision locally before acknowledging its
  // queue entry, while Slack immediately removes buttons that were clicked.
  await updateSlackSourceMessage(payload.response_url).catch(() => undefined);
  return new Response("", { status: 200, headers: securityHeaders });
}

async function receiveDiscord(request: Request, env: Env) {
  const raw = await boundedText(request); const timestamp = request.headers.get("X-Signature-Timestamp") ?? ""; const signature = request.headers.get("X-Signature-Ed25519") ?? "";
  if (!await verifyDiscord(raw, timestamp, signature, env.DISCORD_PUBLIC_KEY)) return json({ error: "Invalid signature." }, 401);
  let payload: any; try { payload = JSON.parse(raw); } catch { return json({ error: "Invalid payload." }, 400); }
  if (payload?.type === 1) return json({ type: 1 });
  const deliveryId = typeof payload?.data?.custom_id === "string" && payload.data.custom_id.startsWith("codkesh:") ? payload.data.custom_id.slice(8) : ""; const actorId = payload?.member?.user?.id ?? payload?.user?.id;
  if (payload?.type !== 3 || !decisionId(deliveryId) || typeof payload?.channel_id !== "string" || typeof actorId !== "string") return json({ error: "Unsupported interaction." }, 400);
  await enqueue(env, { schemaVersion: 1, provider: "discord", deliveryId, channelId: payload.channel_id, actorId, receivedAt: Date.now() });
  return json({ type: 4, data: { content: "Decision received by Codkesh.", flags: 64 } });
}

async function pull(request: Request, env: Env) {
  if (!authorized(request, env)) return json({ error: "Unauthorized." }, 401);
  const listed = await env.OWNER_RESPONSES.list({ prefix: "response:", limit: 50 }); const responses: RelayResponse[] = [];
  for (const key of listed.keys) { const item = await env.OWNER_RESPONSES.get(key.name, "json"); if (item && typeof item === "object") responses.push(item as RelayResponse); }
  responses.sort((a, b) => a.receivedAt - b.receivedAt || a.deliveryId.localeCompare(b.deliveryId));
  return json({ schemaVersion: 1, responses });
}

async function acknowledge(request: Request, env: Env) {
  if (!authorized(request, env)) return json({ error: "Unauthorized." }, 401);
  const input = await request.json().catch(() => null) as { relayIds?: unknown } | null;
  if (!input || !Array.isArray(input.relayIds) || input.relayIds.length > 50 || !input.relayIds.every((item) => typeof item === "string" && /^[0-9a-f-]{36}$/.test(item))) return json({ error: "Invalid acknowledgement." }, 400);
  await Promise.all(input.relayIds.map((id) => env.OWNER_RESPONSES.delete(`response:${id}`)));
  return json({ acknowledged: input.relayIds.length });
}

async function enqueue(env: Env, response: Omit<RelayResponse, "relayId">) { const relayId = crypto.randomUUID(); await env.OWNER_RESPONSES.put(`response:${relayId}`, JSON.stringify({ ...response, relayId }), { expirationTtl: 600 }); }
async function boundedText(request: Request) { const length = Number(request.headers.get("Content-Length") ?? 0); if (length > 64_000) throw new Error("Payload too large."); const text = await request.text(); if (text.length > 64_000) throw new Error("Payload too large."); return text; }
async function verifySlack(body: string, timestamp: string, signature: string, secret: string) { if (!/^\d{10}$/.test(timestamp) || Math.abs(Date.now() / 1000 - Number(timestamp)) > 300 || !/^v0=[a-f0-9]{64}$/.test(signature) || secret.length < 16) return false; const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]); const digest = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`v0:${timestamp}:${body}`)); return constantTimeEqual(signature, `v0=${hex(new Uint8Array(digest))}`); }
async function verifyDiscord(body: string, timestamp: string, signature: string, publicKey: string) { if (!/^\d{10,13}$/.test(timestamp) || !/^[a-f0-9]{128}$/.test(signature) || !/^[a-f0-9]{64}$/.test(publicKey)) return false; const at = timestamp.length === 10 ? Number(timestamp) * 1000 : Number(timestamp); if (Math.abs(Date.now() - at) > 300_000) return false; try { const key = await crypto.subtle.importKey("raw", bytes(publicKey), { name: "Ed25519" }, false, ["verify"]); return crypto.subtle.verify("Ed25519", key, bytes(signature), new TextEncoder().encode(`${timestamp}${body}`)); } catch { return false; } }
function decisionId(value: unknown): value is string { return typeof value === "string" && /^decision_[a-f0-9]{16}$/.test(value); }
export async function updateSlackSourceMessage(input: unknown, fetcher: typeof fetch = fetch) {
  if (typeof input !== "string") return false;
  let url: URL;
  try { url = new URL(input); } catch { return false; }
  if (url.protocol !== "https:" || url.hostname !== "hooks.slack.com" || !url.pathname.startsWith("/actions/") || url.username || url.password || url.search || url.hash) return false;
  const response = await fetcher(url.toString(), {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    redirect: "error",
    body: JSON.stringify({ replace_original: true, text: "Decision received by Codkesh. The signed response is queued for local verification." }),
  });
  return response.ok;
}
function authorized(request: Request, env: Env) { return Boolean(env.CHANNEL_RELAY_TOKEN) && constantTimeEqual(request.headers.get("Authorization") ?? "", `Bearer ${env.CHANNEL_RELAY_TOKEN}`); }
function constantTimeEqual(left: string, right: string) { if (left.length !== right.length) return false; let difference = 0; for (let index = 0; index < left.length; index += 1) difference |= left.charCodeAt(index) ^ right.charCodeAt(index); return difference === 0; }
function bytes(value: string) { return Uint8Array.from(value.match(/.{2}/g)?.map((item) => Number.parseInt(item, 16)) ?? []); }
function hex(value: Uint8Array) { return [...value].map((item) => item.toString(16).padStart(2, "0")).join(""); }
function json(value: unknown, status = 200) { return new Response(JSON.stringify(value), { status, headers: { ...securityHeaders, "Content-Type": "application/json" } }); }
