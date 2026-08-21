import { randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { JsonProviderConnectionRepository } from "../../../packages/storage/src/provider-connections.js";
import { createOpenAiCompatibleAdapter } from "../../../packages/providers/src/openai-compatible.js";
import { createOperatingSystemCredentialBackend } from "../../../packages/vault/src/backends.js";
import { SqliteCredentialMetadataRepository } from "../../../packages/vault/src/repository.js";
import {
  OperatingSystemCredentialVault,
  ProviderCredentialVaultBridge,
} from "../../../packages/vault/src/vault.js";
import { LocalSensitiveCommandRunner } from "./sensitive-command-runner.js";
import { ProviderCapacityStore } from "./provider-capacity-store.js";
import {
  AGENT_CANVAS_AUTO_MODEL,
  AgentCanvasGatewayError,
  AgentCanvasModelGateway,
  normalizeAgentCanvasMessages,
  toOpenAiChatCompletion,
  type AgentCanvasGatewayRequest,
} from "./agent-canvas-model-gateway.js";

const host = "127.0.0.1";
const port = parsePort(process.env.PIPELINE_AGENT_GATEWAY_PORT);
const stateDirectory = resolve(process.env.PIPELINE_STUDIO_STATE_DIR ?? ".pipeline-studio");
await mkdir(stateDirectory, { recursive: true, mode: 0o700 });

const repository = new JsonProviderConnectionRepository(
  resolve(stateDirectory, "provider-connections.json"),
);
const credentialBackend = createOperatingSystemCredentialBackend({
  platform: process.platform === "darwin" ? "darwin" : process.platform === "win32" ? "win32" : "linux",
  available: true,
  runner: new LocalSensitiveCommandRunner(),
});
const vault = new ProviderCredentialVaultBridge(
  new OperatingSystemCredentialVault(
    credentialBackend,
    new SqliteCredentialMetadataRepository(resolve(stateDirectory, "credential-metadata.sqlite")),
  ),
  Date.now,
);
const adapters = new Map<string, ReturnType<typeof createOpenAiCompatibleAdapter>>();
const capacity = new ProviderCapacityStore(resolve(stateDirectory, "provider-capacity.json"));
const refreshes = new Map<string, Promise<void>>();
const gateway = new AgentCanvasModelGateway(
  repository,
  vault,
  {
    adapter(providerId) {
      try {
        const cached = adapters.get(providerId);
        if (cached) return cached;
        const adapter = createOpenAiCompatibleAdapter({ providerId });
        adapters.set(providerId, adapter);
        return adapter;
      } catch {
        return null;
      }
    },
  },
  async () => {
    const connections = await repository.list();
    return capacity.snapshot(connections.map((connection) => connection.id), Date.now());
  },
  Date.now,
  refreshProviderConnection,
  async (attempt) => capacity.recordGatewayAttempt({ ...attempt, now: Date.now() }),
);
const apiKey = await loadOrCreateGatewayKey(resolve(stateDirectory, "agent-canvas-gateway-key.txt"));

const server = createServer(async (request, response) => {
  try {
    setSecurityHeaders(response);
    if (request.method === "GET" && request.url === "/health") {
      return json(response, 200, { status: "ready", paid_usage: false });
    }
    if (!authorized(request, apiKey)) {
      return json(response, 401, openAiError("invalid_api_key", "Gateway authentication failed."));
    }
    if (request.method === "GET" && request.url === "/v1/models") {
      return json(response, 200, { object: "list", data: await gateway.models() });
    }
    if (request.method === "POST" && request.url === "/v1/chat/completions") {
      const input = parseChatRequest(await readJson(request));
      const result = await gateway.chat(input);
      const completion = toOpenAiChatCompletion(result);
      if ((input as AgentCanvasGatewayRequest & { stream?: boolean }).stream) {
        return streamCompletion(response, completion);
      }
      return json(response, 200, completion);
    }
    return json(response, 404, openAiError("not_found", "Gateway route was not found."));
  } catch (error) {
    const status = error instanceof AgentCanvasGatewayError ? error.status : 500;
    const code = error instanceof AgentCanvasGatewayError ? error.code : "gateway_error";
    const message = error instanceof Error ? error.message : "The model gateway failed safely.";
    return json(response, status, openAiError(code, message));
  }
});

server.listen(port, host, () => {
  process.stdout.write(`Pipeline Agent Canvas model gateway ready at http://${host}:${port}\n`);
  process.stdout.write(`Model: ${AGENT_CANVAS_AUTO_MODEL}; paid usage: disabled\n`);
});

function parsePort(value: string | undefined): number {
  const parsed = Number(value ?? 4313);
  if (!Number.isInteger(parsed) || parsed < 1024 || parsed > 65_535) {
    throw new Error("PIPELINE_AGENT_GATEWAY_PORT must be a non-privileged TCP port.");
  }
  return parsed;
}

async function loadOrCreateGatewayKey(path: string): Promise<string> {
  try {
    const existing = (await readFile(path, "utf8")).trim();
    if (existing.length >= 32) return existing;
  } catch (error) {
    if (!hasCode(error, "ENOENT")) throw error;
  }
  const generated = randomBytes(32).toString("hex");
  await writeFile(path, `${generated}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
  return generated;
}

function authorized(request: IncomingMessage, apiKey: string): boolean {
  return request.headers.authorization === `Bearer ${apiKey}`;
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 2_000_000) throw new AgentCanvasGatewayError("request_too_large", 413, "Request exceeds the gateway limit.");
    chunks.push(buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new AgentCanvasGatewayError("invalid_json", 400, "Request body must be valid JSON.");
  }
}

function parseChatRequest(value: unknown): AgentCanvasGatewayRequest & { stream?: boolean } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AgentCanvasGatewayError("invalid_request", 400, "Request body must be an object.");
  }
  const raw = value as Record<string, unknown>;
  if (typeof raw.model !== "string" || !Array.isArray(raw.messages)) {
    throw new AgentCanvasGatewayError("invalid_request", 400, "Model and messages are required.");
  }
  const messages = normalizeAgentCanvasMessages(raw.messages);
  return {
    model: raw.model,
    messages,
    ...(typeof raw.max_tokens === "number" ? { max_tokens: raw.max_tokens } : {}),
    ...(typeof raw.temperature === "number" ? { temperature: raw.temperature } : {}),
    ...(Array.isArray(raw.tools) ? { tools: raw.tools as AgentCanvasGatewayRequest["tools"] } : {}),
    ...(raw.stream === true ? { stream: true } : {}),
  };
}

function streamCompletion(response: ServerResponse, completion: ReturnType<typeof toOpenAiChatCompletion>): void {
  response.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
  });
  const choice = completion.choices[0];
  const message = choice?.message;
  const delta = {
    role: "assistant",
    ...(message?.content ? { content: message.content } : {}),
    ...(message && "tool_calls" in message && Array.isArray(message.tool_calls)
      ? {
          tool_calls: message.tool_calls.map((call, index) => ({
            index,
            id: call.id,
            type: call.type,
            function: call.function,
          })),
        }
      : {}),
  };
  response.write(`data: ${JSON.stringify({ ...completion, object: "chat.completion.chunk", choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`);
  response.write(`data: ${JSON.stringify({ ...completion, object: "chat.completion.chunk", choices: [{ index: 0, delta: {}, finish_reason: choice?.finish_reason ?? "stop" }] })}\n\n`);
  response.end("data: [DONE]\n\n");
}

function setSecurityHeaders(response: ServerResponse): void {
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "no-referrer");
}

function json(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(`${JSON.stringify(value)}\n`);
}

function openAiError(code: string, message: string) {
  return { error: { message, type: "pipeline_gateway_error", code } };
}

function hasCode(error: unknown, code: string): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === code);
}

async function refreshProviderConnection(connectionId: string): Promise<void> {
  const existing = refreshes.get(connectionId);
  if (existing) return existing;
  const refresh = (async () => {
    const response = await fetch(
      `http://127.0.0.1:4312/api/v1/provider-connections/${encodeURIComponent(connectionId)}/reprobe`,
      {
        method: "POST",
        headers: {
          "Idempotency-Key": `agent-canvas-refresh-${connectionId}-${Math.floor(Date.now() / 60_000)}`,
        },
        signal: AbortSignal.timeout(90_000),
      },
    );
    if (!response.ok) throw new Error(`Provider refresh failed safely (${response.status}).`);
  })().finally(() => refreshes.delete(connectionId));
  refreshes.set(connectionId, refresh);
  return refresh;
}
