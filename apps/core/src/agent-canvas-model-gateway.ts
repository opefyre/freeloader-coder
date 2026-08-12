import { createHash, randomUUID } from "node:crypto";

import type { ProviderConnection } from "../../../packages/schemas/src/index.js";
import type { ProviderAdapterResponse } from "../../../packages/schemas/src/index.js";
import type {
  ProviderAdapter,
  ProviderChatRequest,
} from "../../../packages/providers/src/adapter.js";
import type {
  CredentialVault,
  ProviderConnectionRepository,
} from "../../../packages/providers/src/lifecycle.js";
import {
  resolveAdmittedProviderCandidates,
  routeProviders,
  type ProviderCapacityUsage,
} from "../../../packages/providers/src/index.js";

export const AGENT_CANVAS_AUTO_MODEL = "pipeline/auto";

export type AgentCanvasWorkKind =
  | "discovery"
  | "planning"
  | "implementation"
  | "review"
  | "general";

export interface AgentCanvasGatewayRequest {
  readonly model: string;
  readonly messages: readonly {
    readonly role: "system" | "user" | "assistant";
    readonly content: string;
  }[];
  readonly max_tokens?: number | undefined;
  readonly temperature?: number | undefined;
  readonly tools?: readonly {
    readonly type: "function";
    readonly function: {
      readonly name: string;
      readonly description?: string | undefined;
      readonly parameters?: Readonly<Record<string, unknown>> | undefined;
    };
  }[] | undefined;
}

export interface AgentCanvasGatewayResult {
  readonly id: string;
  readonly providerId: string;
  readonly modelId: string;
  readonly workKind: AgentCanvasWorkKind;
  readonly attemptedProviderIds: readonly string[];
  readonly response: ProviderAdapterResponse;
}

export interface AgentCanvasProviderAttempt {
  readonly connectionId: string;
  readonly attemptId: string;
  readonly succeeded: boolean;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly failureCode?: string | undefined;
  readonly retryAt?: number | null | undefined;
}

/** Normalize Agent Canvas's full OpenAI history to provider-neutral text. */
export function normalizeAgentCanvasMessages(value: unknown): AgentCanvasGatewayRequest["messages"] {
  if (!Array.isArray(value)) {
    throw new AgentCanvasGatewayError("invalid_request", 400, "Messages must be an array.");
  }
  return value.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new AgentCanvasGatewayError("invalid_request", 400, `Message ${index} is invalid.`);
    }
    const message = entry as Record<string, unknown>;
    const rawRole = String(message.role);
    if (!["system", "developer", "user", "assistant", "tool"].includes(rawRole)) {
      throw new AgentCanvasGatewayError("invalid_request", 400, `Message ${index} has an unsupported role.`);
    }
    const content = textFromOpenAiContent(message.content);
    const toolCalls = serializeToolCalls(message.tool_calls);
    const role = rawRole === "system" || rawRole === "developer"
      ? "system"
      : rawRole === "assistant"
        ? "assistant"
        : "user";
    const pieces = [content];
    if (toolCalls) pieces.push(`<assistant_tool_calls>\n${toolCalls}\n</assistant_tool_calls>`);
    if (rawRole === "tool") {
      const toolCallId = typeof message.tool_call_id === "string" ? message.tool_call_id : "unknown";
      pieces.unshift(`<tool_result id="${escapeTag(toolCallId)}">`);
      pieces.push("</tool_result>");
    }
    const normalized = pieces.filter(Boolean).join("\n").trim();
    if (!normalized) {
      throw new AgentCanvasGatewayError("invalid_request", 400, `Message ${index} has no supported content.`);
    }
    return { role, content: normalized };
  });
}

export class AgentCanvasModelGateway {
  public constructor(
    private readonly connections: Pick<ProviderConnectionRepository, "list">,
    private readonly vault: Pick<CredentialVault, "read">,
    private readonly adapters: { adapter(providerId: string): ProviderAdapter | null },
    private readonly capacity: () => Promise<{
      readonly usageByConnectionId: Readonly<Record<string, ProviderCapacityUsage>>;
      readonly circuitOpenUntilByConnectionId?: Readonly<Record<string, number>> | undefined;
    }>,
    private readonly now: () => number = Date.now,
    private readonly refreshConnection?: ((connectionId: string) => Promise<void>) | undefined,
    private readonly recordAttempt?: ((attempt: AgentCanvasProviderAttempt) => Promise<void>) | undefined,
  ) {}

  public async models(): Promise<readonly { id: string; object: "model"; owned_by: string }[]> {
    const eligible = await this.eligibleConnections("general");
    return eligible.length
      ? [{ id: AGENT_CANVAS_AUTO_MODEL, object: "model", owned_by: "pipeline-studio" }]
      : [];
  }

  public async chat(input: AgentCanvasGatewayRequest): Promise<AgentCanvasGatewayResult> {
    if (input.model !== AGENT_CANVAS_AUTO_MODEL) {
      throw new AgentCanvasGatewayError("model_not_found", 404, "Use the pipeline/auto model.");
    }
    if (!input.messages.length || input.messages.some((message) => !message.content.trim())) {
      throw new AgentCanvasGatewayError("invalid_request", 400, "Messages must contain text.");
    }
    const prompt = [...input.messages].reverse().find((message) =>
      message.role === "user" && !message.content.startsWith("<tool_result"),
    )?.content ?? input.messages.at(-1)?.content ?? "";
    const workKind = classifyAgentCanvasWork(prompt);
    const routedMessages = compactAgentCanvasMessages(input.messages);
    const routedTools = selectAgentCanvasTools(input.tools ?? [], workKind, prompt);
    const localPreview = createLocalPreviewResponse(prompt, routedMessages, routedTools);
    if (localPreview) {
      return {
        id: localPreview.requestId,
        providerId: localPreview.providerId,
        modelId: localPreview.modelId,
        workKind,
        attemptedProviderIds: [],
        response: localPreview,
      };
    }
    const estimatedInputTokens = estimateTokens(routedMessages, routedTools);
    const requestedOutputTokens = outputBudgetForFreeTier(
      input.max_tokens ?? 8_192,
      routedMessages,
      routedTools,
    );
    const connections = await this.eligibleConnections(workKind, estimatedInputTokens, requestedOutputTokens);
    if (!connections.length) {
      throw new AgentCanvasGatewayError(
        "free_capacity_unavailable",
        429,
        "No verified free provider is currently eligible. Paid usage remains disabled.",
      );
    }
    const attemptedProviderIds: string[] = [];
    const requestId = `canvas-${randomUUID()}`;
    const providerRequest: Omit<ProviderChatRequest, "modelId"> = {
      requestId,
      messages: routedMessages,
      maxOutputTokens: requestedOutputTokens,
      temperature: Math.max(0, Math.min(input.temperature ?? 0, 1)),
      tools: routedTools.map((tool) => ({
        name: tool.function.name,
        description: tool.function.description ?? "",
        inputSchema: tool.function.parameters ?? { type: "object" },
      })),
      timeoutMs: 180_000,
    };

    for (const connection of connections) {
      attemptedProviderIds.push(connection.providerId);
      const adapter = this.adapters.adapter(connection.providerId);
      const secret = await this.vault.read(connection.credentialReference);
      if (!adapter || !secret) continue;
      try {
        const rawResponse = await chatWithOutputRecovery(
          adapter,
          secret,
          { ...providerRequest, modelId: connection.modelId },
          connection.maxOutputTokens,
        );
        const response = ensureRequestedPreviewAction(
          normalizeTextualToolEnvelope(rawResponse, routedTools),
          prompt,
          routedMessages,
          routedTools,
        );
        await this.recordAttempt?.({
          connectionId: connection.id,
          attemptId: `${requestId}:${connection.id}`,
          succeeded: true,
          inputTokens: response.usage.inputTokens,
          outputTokens: response.usage.outputTokens,
        });
        return {
          id: requestId,
          providerId: connection.providerId,
          modelId: connection.modelId,
          workKind,
          attemptedProviderIds,
          response,
        };
      } catch (error) {
        reportSafeProviderFailure(connection.providerId, connection.modelId, providerRequest, error);
        const candidate = error && typeof error === "object" ? error as Record<string, unknown> : {};
        await this.recordAttempt?.({
          connectionId: connection.id,
          attemptId: `${requestId}:${connection.id}`,
          succeeded: false,
          inputTokens: estimatedInputTokens,
          outputTokens: 0,
          ...(typeof candidate.code === "string" ? { failureCode: candidate.code } : {}),
          ...(typeof candidate.retryAt === "number" || candidate.retryAt === null ? { retryAt: candidate.retryAt as number | null } : {}),
        });
        if (!isRetryableProviderFailure(error)) throw error;
      }
    }
    throw new AgentCanvasGatewayError(
      "free_providers_failed",
      503,
      "All eligible free providers failed or deferred this request. No paid route was attempted.",
    );
  }

  private async eligibleConnections(
    workKind: AgentCanvasWorkKind,
    estimatedInputTokens = 1,
    requestedOutputTokens = 1,
  ): Promise<readonly ProviderConnection[]> {
    const now = this.now();
    let connections = await this.connections.list();
    let capacity = await this.capacity();
    const role = workKind === "review" ? "reviewer" : "implementer";
    let admitted = resolveAdmittedProviderCandidates({
      connections,
      now,
      requiredCapabilities: ["chat", "tool_calling"],
      priorityByConnectionId: Object.fromEntries(
        connections.map((connection, index) => [
          connection.id,
          connection.capabilityRoles.includes(role) ? index : index + 10_000,
        ]),
      ),
      usageByConnectionId: capacity.usageByConnectionId,
      circuitOpenUntilByConnectionId: capacity.circuitOpenUntilByConnectionId,
    });
    if (!admitted.candidates.length && this.refreshConnection) {
      const refreshable = admitted.excluded
        .filter(({ decision }) => ["quota-evidence-stale", "canary-stale", "cost-evidence-stale"].includes(decision.reason))
        .map(({ connectionId }) => connectionId);
      if (refreshable.length) {
        await Promise.allSettled(refreshable.map((connectionId) => this.refreshConnection?.(connectionId)));
        connections = await this.connections.list();
        capacity = await this.capacity();
        admitted = resolveAdmittedProviderCandidates({
          connections,
          now: this.now(),
          requiredCapabilities: ["chat", "tool_calling"],
          priorityByConnectionId: Object.fromEntries(
            connections.map((connection, index) => [
              connection.id,
              connection.capabilityRoles.includes(role) ? index : index + 10_000,
            ]),
          ),
          usageByConnectionId: capacity.usageByConnectionId,
          circuitOpenUntilByConnectionId: capacity.circuitOpenUntilByConnectionId,
        });
      }
    }
    const freeCandidates = admitted.candidates
        .filter((candidate) =>
          candidate.roles.includes(role) &&
          !candidate.paid &&
          candidate.billingMode === "free_tier" &&
          candidate.costClass === "free",
        );
    const route = freeCandidates.length ? routeProviders(freeCandidates, {
      role,
      kind: workKind === "planning" || workKind === "discovery" ? "plan" : workKind === "review" ? "review" : "code",
      dataClass: "source_code",
      minimumPrivacy: "training_eligible",
      estimatedInputTokens,
      requestedOutputTokens,
      allowPaid: false,
      now: this.now(),
    }) : null;
    const admittedIds = new Set((route?.eligible ?? []).map((candidate) => candidate.providerConnectionId));
    return connections
      .filter((connection) => admittedIds.has(connection.id))
      .sort((left, right) => {
        const leftRole = Number(!left.capabilityRoles.includes(role));
        const rightRole = Number(!right.capabilityRoles.includes(role));
        return leftRole - rightRole || left.id.localeCompare(right.id);
      });
  }
}

export function normalizeTextualToolEnvelope(
  response: ProviderAdapterResponse,
  tools: NonNullable<AgentCanvasGatewayRequest["tools"]>,
): ProviderAdapterResponse {
  const trimmedContent = response.content.trim();
  if (!trimmedContent) return response;
  const containsToolProtocolMarkup = /<[^>]*tool_calls?[^>]*>/iu.test(trimmedContent);
  if (!containsToolProtocolMarkup) return response;
  const malformedEnvelope = () => new AgentCanvasGatewayError(
    "malformed_tool_envelope",
    502,
    "The provider returned a malformed tool action. Trying another free provider.",
  );
  const match = trimmedContent.match(/^<(?:assistant_)?tool_calls?>\s*(?:```(?:json)?\s*)?([\s\S]+?)(?:\s*```)?\s*<\/(?:assistant_)?tool_calls?>([\s\S]*)$/i);
  if (!match?.[1]) throw malformedEnvelope();
  const trailing = (match[2] ?? "").trim();
  if (trailing.length > 1_000 || trailing.includes("<")) throw malformedEnvelope();
  let parsed: unknown;
  try { parsed = JSON.parse(match[1]); } catch { throw malformedEnvelope(); }
  const calls = Array.isArray(parsed) ? parsed : [parsed];
  const allowed = new Set(tools.map((tool) => tool.function.name));
  const normalized = calls.flatMap((value, index) => {
    if (!value || typeof value !== "object") return [];
    const item = value as Record<string, unknown>;
    const wrappedFunction = item.function && typeof item.function === "object" && !Array.isArray(item.function)
      ? item.function as Record<string, unknown>
      : null;
    const name = typeof item.name === "string"
      ? item.name
      : typeof wrappedFunction?.name === "string"
        ? wrappedFunction.name
        : null;
    if (!name) return [];
    // Some free-tier models emit OpenHands' internal `think` action even on a
    // turn where the runtime did not advertise that action as a callable tool.
    // Returning that envelope as assistant text ends the agent loop and leaks
    // protocol markup into the UI.  Turn it into a harmless, advertised
    // terminal action so OpenHands receives a tool result and continues to the
    // actual implementation step.  Never synthesize arbitrary unoffered tools.
    if (name === "think" && !allowed.has("think") && allowed.has("terminal")) {
      return [{
        id: typeof item.id === "string" && item.id ? item.id : `recovered-think-${index + 1}`,
        name: "terminal",
        argumentsJson: JSON.stringify({
          command: "true",
          summary: "Continue after internal planning",
        }),
      }];
    }
    if (!allowed.has(name)) return [];
    const rawArguments = wrappedFunction?.arguments ?? item.arguments ?? item.input;
    let argumentsJson: string;
    if (typeof rawArguments === "string") {
      try {
        const decoded = JSON.parse(rawArguments);
        if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) return [];
        argumentsJson = JSON.stringify(decoded);
      } catch { return []; }
    } else if (rawArguments && typeof rawArguments === "object" && !Array.isArray(rawArguments)) {
      argumentsJson = JSON.stringify(rawArguments);
    } else return [];
    return [{
      id: typeof item.id === "string" && item.id ? item.id : `recovered-tool-${index + 1}`,
      name,
      argumentsJson,
    }];
  });
  if (normalized.length !== calls.length || normalized.length === 0) throw malformedEnvelope();
  const existing = new Set(response.toolCalls.map((call) => `${call.name}\0${call.argumentsJson}`));
  const merged = [
    ...response.toolCalls,
    ...normalized.filter((call) => !existing.has(`${call.name}\0${call.argumentsJson}`)),
  ];
  return {
    ...response,
    content: "",
    toolCalls: merged,
    finishReason: "tool_call",
  };
}

export function ensureRequestedPreviewAction(
  response: ProviderAdapterResponse,
  prompt: string,
  messages: AgentCanvasGatewayRequest["messages"],
  tools: NonNullable<AgentCanvasGatewayRequest["tools"]>,
): ProviderAdapterResponse {
  if (!/\b(?:show|open|display|render)\b[\s\S]{0,40}\bpreview\b|\bpreview\b[\s\S]{0,40}\b(?:show|open|display|render)\b/i.test(prompt)) return response;
  if (!tools.some((tool) => tool.function.name === "canvas_ui_control")) return response;
  const path = inferPreviewPath(messages);
  if (!path) return response;
  return {
    ...response,
    content: "",
    toolCalls: [
      {
        id: `preview-${createHash("sha256").update(path).digest("hex").slice(0, 12)}`,
        name: "canvas_ui_control",
        argumentsJson: JSON.stringify({ command: "show_preview", path }),
      },
      ...response.toolCalls.filter((call) => call.name !== "finish" && call.name !== "canvas_ui_control"),
    ],
    finishReason: "tool_call",
  };
}

function createLocalPreviewResponse(
  prompt: string,
  messages: AgentCanvasGatewayRequest["messages"],
  tools: NonNullable<AgentCanvasGatewayRequest["tools"]>,
): ProviderAdapterResponse | null {
  const normalizedPrompt = prompt.trim().replace(/[.!?]+$/, "").trim();
  if (!/^(?:(?:please\s+)?(?:show|open|display|render)(?:\s+me)?\s+(?:the\s+)?preview|preview)$/i.test(normalizedPrompt)) {
    return null;
  }
  if (!tools.some((tool) => tool.function.name === "canvas_ui_control")) return null;

  const requestId = `local-preview-${randomUUID()}`;
  const lastMessage = messages.at(-1)?.content ?? "";
  const previewCompleted = /^<tool_result id="preview-[^"]+">/i.test(lastMessage);
  if (previewCompleted) {
    return {
      schemaVersion: 1,
      providerId: "pipeline-studio",
      modelId: "local-ui",
      requestId,
      content: "Preview opened.",
      finishReason: "stop",
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, estimated: false, extensions: [] },
      toolCalls: [],
      extensions: [],
      verified: false,
    };
  }

  const path = inferPreviewPath(messages);
  if (!path) return null;
  return {
    schemaVersion: 1,
    providerId: "pipeline-studio",
    modelId: "local-ui",
    requestId,
    content: "",
    finishReason: "tool_call",
    usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, estimated: false, extensions: [] },
    toolCalls: [{
      id: `preview-${createHash("sha256").update(path).digest("hex").slice(0, 12)}`,
      name: "canvas_ui_control",
      argumentsJson: JSON.stringify({ command: "show_preview", path }),
    }],
    extensions: [],
    verified: false,
  };
}

function inferPreviewPath(messages: AgentCanvasGatewayRequest["messages"]): string | null {
  const absolutePattern = /(\/[^\s<>"']+\.(?:html?|svg|png|jpe?g|gif|webp|pdf|md))(?=$|[\s"'<])/gi;
  const relativePattern = /(?:^|[\s"'=:])((?:[A-Za-z0-9_.-]+\/)*[A-Za-z0-9_.-]+\.(?:html?|svg|png|jpe?g|gif|webp|pdf|md))(?=$|[\s"'<])/gi;
  for (const message of [...messages].reverse()) {
    const absolute = [...message.content.matchAll(absolutePattern)].at(-1)?.[1];
    if (absolute) return absolute.split("/").filter(Boolean).at(-1) ?? null;
    const candidate = [...message.content.matchAll(relativePattern)].at(-1)?.[1]?.trim();
    if (!candidate) continue;
    const normalized = candidate.replace(/^\.\//, "");
    if (!normalized.startsWith("../") && !normalized.includes("/../")) return normalized;
  }
  return null;
}

async function chatWithOutputRecovery(
  adapter: ProviderAdapter,
  secret: string,
  request: ProviderChatRequest,
  providerMaximum: number,
): Promise<ProviderAdapterResponse> {
  try {
    return await adapter.chat({ secret }, request);
  } catch (error) {
    const candidate = error && typeof error === "object" ? error as Record<string, unknown> : {};
    if (candidate.code !== "malformed_response") throw error;
    const recoveredBudget = Math.min(providerMaximum, 16_384);
    if (request.maxOutputTokens >= recoveredBudget) throw error;
    return adapter.chat({ secret }, { ...request, maxOutputTokens: recoveredBudget });
  }
}

function reportSafeProviderFailure(
  providerId: string,
  modelId: string,
  request: Omit<ProviderChatRequest, "modelId">,
  error: unknown,
): void {
  const candidate = error && typeof error === "object" ? error as Record<string, unknown> : {};
  const code = typeof candidate.code === "string" ? candidate.code : "unknown";
  const status = typeof candidate.status === "number" ? candidate.status : null;
  const retryAt = typeof candidate.retryAt === "number" ? candidate.retryAt : null;
  process.stderr.write(`${JSON.stringify({
    event: "agent_canvas_provider_failed",
    providerId,
    modelId,
    code,
    status,
    retryAt,
    messageCount: request.messages.length,
    messageCharacters: request.messages.reduce((sum, message) => sum + message.content.length, 0),
    toolCount: request.tools?.length ?? 0,
    toolSchemaCharacters: request.tools?.reduce((sum, tool) => sum + JSON.stringify(tool.inputSchema).length, 0) ?? 0,
    toolNames: request.tools?.map((tool) => tool.name) ?? [],
    maxOutputTokens: request.maxOutputTokens,
  })}\n`);
}

export class AgentCanvasGatewayError extends Error {
  public constructor(
    public readonly code: string,
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "AgentCanvasGatewayError";
  }
}

export function classifyAgentCanvasWork(prompt: string): AgentCanvasWorkKind {
  if (/\b(review|audit|critique|qa)\b/i.test(prompt)) return "review";
  if (/\b(build|code|implement|fix|refactor|test|create|write|change|edit)\b/i.test(prompt)) return "implementation";
  if (/\b(verify|validate)\b/i.test(prompt)) return "review";
  if (/\b(plan|architect|design|decompose|break down|backlog|story)\b/i.test(prompt)) return "planning";
  if (/\b(research|discover|market|competitor|analy[sz]e)\b/i.test(prompt)) return "discovery";
  return "general";
}

export function compactAgentCanvasMessages(
  messages: AgentCanvasGatewayRequest["messages"],
): AgentCanvasGatewayRequest["messages"] {
  const compacted = messages.map((message) => {
    if (message.role !== "system" || message.content.length < 8_000) return message;
    const retained = ["SOUL", "ROLE", "SECURITY", "PIPELINE_WORKSPACE_CONTEXT"]
      .map((tag) => extractTaggedSection(message.content, tag))
      .filter(Boolean);
    return {
      role: "system" as const,
      content: [
        ...retained,
        "<PIPELINE_EXECUTION_RULES>Use the available tools to inspect and modify only the selected workspace. Read canonical context before acting. Make the smallest correct change, verify it, never expose credentials, and stop for user authority when an action is destructive, external, paid, or ambiguous.</PIPELINE_EXECUTION_RULES>",
      ].join("\n\n"),
    };
  });

  const normalized = compacted.map((message, index) => {
    if (message.role === "assistant" && message.content.length > 4_000 && /<assistant_tool_calls>/i.test(message.content)) {
      const names = [...message.content.matchAll(/"name"\s*:\s*"([a-z0-9_-]+)"/gi)]
        .map((match) => match[1])
        .filter((name): name is string => Boolean(name));
      return {
        role: "assistant" as const,
        content: `<historical_tool_action>${names.length ? names.join(", ") : "workspace edit"} completed. Inspect the workspace for the authoritative current file contents.</historical_tool_action>`,
      };
    }
    if (message.content.length > 6_000 && index < compacted.length - 2) {
      return {
        ...message,
        content: `${message.content.slice(0, 2_000)}\n<history_compacted>Older verbose output omitted. Inspect the workspace for current evidence.</history_compacted>`,
      };
    }
    return message;
  });

  // Keep the request comfortably below the smallest verified free route's
  // practical prompt budget. System/security context is retained, then the
  // newest interaction history is selected from the end.
  const systems = normalized.filter((message) => message.role === "system");
  const history = normalized.filter((message) => message.role !== "system");
  const systemCharacters = systems.reduce((sum, message) => sum + message.content.length, 0);
  let remaining = Math.max(8_000, 18_000 - systemCharacters);
  const recent: AgentCanvasGatewayRequest["messages"][number][] = [];
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const message = history[index];
    if (!message) continue;
    if (message.content.length > remaining && recent.length >= 2) break;
    const content = message.content.length > remaining
      ? `${message.content.slice(0, Math.max(1_000, remaining))}\n<history_compacted />`
      : message.content;
    recent.unshift({ ...message, content });
    remaining -= content.length;
    if (remaining <= 0) break;
  }
  return [...systems, ...recent];
}

export function selectAgentCanvasTools(
  tools: NonNullable<AgentCanvasGatewayRequest["tools"]>,
  workKind: AgentCanvasWorkKind,
  prompt: string,
): NonNullable<AgentCanvasGatewayRequest["tools"]> {
  const names = new Set(["terminal", "file_editor", "task_tracker", "canvas_ui_control", "finish", "think"]);
  // Building a webpage does not require ten browser-control schemas on every
  // coding turn. Browser actions are only useful for an explicit visual check
  // or navigation request; the agent can ask for them on a later review turn.
  if (workKind === "review" || /\b(browser|preview|visual(?:ly)?|screenshot|inspect (?:the )?ui|open (?:the )?(?:site|page|url))\b/i.test(prompt)) {
    for (const name of ["browser_navigate", "browser_click", "browser_get_state", "browser_get_content", "browser_type", "browser_scroll", "browser_go_back", "browser_list_tabs", "browser_switch_tab", "browser_close_tab"]) names.add(name);
  }
  if (/\b(parallel|sub-?agent|delegate)\b/i.test(prompt)) names.add("launch_child_conversation");
  if (/\b(skill)\b/i.test(prompt)) names.add("invoke_skill");
  if (/\b(pipeline|project status|integration|action cent(?:er|re))\b/i.test(prompt)) {
    for (const tool of tools) if (tool.function.name.startsWith("pipeline_")) names.add(tool.function.name);
  }
  return tools.filter((tool) => names.has(tool.function.name));
}

function outputBudgetForFreeTier(
  requested: number,
  messages: AgentCanvasGatewayRequest["messages"],
  tools: NonNullable<AgentCanvasGatewayRequest["tools"]>,
): number {
  const estimatedInput = estimateTokens(messages, tools);
  return Math.max(256, Math.min(requested, 4_096, 7_500 - estimatedInput));
}

function estimateTokens(
  messages: AgentCanvasGatewayRequest["messages"],
  tools: NonNullable<AgentCanvasGatewayRequest["tools"]>,
): number {
  return Math.ceil((
    messages.reduce((sum, message) => sum + message.content.length, 0) +
    tools.reduce((sum, tool) => sum + JSON.stringify(tool).length, 0)
  ) / 4);
}

function extractTaggedSection(content: string, tag: string): string {
  const match = content.match(new RegExp(`<${tag}>[\\s\\S]*?</${tag}>`, "i"));
  return match?.[0] ?? "";
}

export function toOpenAiChatCompletion(result: AgentCanvasGatewayResult) {
  const { response } = result;
  return {
    id: result.id,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1_000),
    model: AGENT_CANVAS_AUTO_MODEL,
    choices: [{
      index: 0,
      message: {
        role: "assistant",
        content: response.content || null,
        ...(response.toolCalls.length
          ? {
              tool_calls: response.toolCalls.map((call) => ({
                id: call.id,
                type: "function",
                function: { name: call.name, arguments: call.argumentsJson },
              })),
            }
          : {}),
      },
      finish_reason: response.finishReason === "tool_call" ? "tool_calls" : response.finishReason,
    }],
    usage: {
      prompt_tokens: response.usage.inputTokens,
      completion_tokens: response.usage.outputTokens,
      total_tokens: response.usage.totalTokens,
    },
    pipeline: {
      provider: result.providerId,
      provider_model: result.modelId,
      work_kind: result.workKind,
      attempted_providers: result.attemptedProviderIds,
      paid_usage: false,
    },
  };
}

export function gatewayRequestDigest(input: AgentCanvasGatewayRequest): string {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

function isRetryableProviderFailure(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      ("retryAt" in error ||
        ("status" in error &&
          typeof error.status === "number" &&
          [408, 409, 429, 500, 502, 503, 504].includes(error.status))),
  );
}

function textFromOpenAiContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (content == null || !Array.isArray(content)) return "";
  return content.map((part) => {
    if (typeof part === "string") return part;
    if (!part || typeof part !== "object" || Array.isArray(part)) return "";
    const record = part as Record<string, unknown>;
    if (["text", "input_text", "output_text"].includes(String(record.type)) && typeof record.text === "string") return record.text;
    if (record.type === "image_url" || record.type === "input_image") return "[image attachment supplied]";
    return "";
  }).filter(Boolean).join("\n");
}

function serializeToolCalls(value: unknown): string {
  if (!Array.isArray(value)) return "";
  return value.map((call) => {
    if (!call || typeof call !== "object" || Array.isArray(call)) return "";
    const record = call as Record<string, unknown>;
    const fn = record.function && typeof record.function === "object" && !Array.isArray(record.function)
      ? record.function as Record<string, unknown>
      : {};
    return JSON.stringify({
      id: typeof record.id === "string" ? record.id : "unknown",
      name: typeof fn.name === "string" ? fn.name : "unknown",
      arguments: typeof fn.arguments === "string" ? fn.arguments : "{}",
    });
  }).filter(Boolean).join("\n");
}

function escapeTag(value: string): string {
  return value.replace(/[&"<>]/g, (character) => ({ "&": "&amp;", '"': "&quot;", "<": "&lt;", ">": "&gt;" })[character] ?? character);
}
