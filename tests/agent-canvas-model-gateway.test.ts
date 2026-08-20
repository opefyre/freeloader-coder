import assert from "node:assert/strict";
import test from "node:test";

import {
  AGENT_CANVAS_AUTO_MODEL,
  AgentCanvasModelGateway,
  classifyAgentCanvasWork,
  compactAgentCanvasMessages,
  ensureRequestedPreviewAction,
  normalizeAgentCanvasMessages,
  selectAgentCanvasTools,
  normalizeTextualToolEnvelope,
  toOpenAiChatCompletion,
} from "../apps/core/src/agent-canvas-model-gateway.js";
import { createRecordedProviderAdapter } from "../packages/providers/src/adapter.js";
import type { ProviderConnection } from "../packages/schemas/src/index.js";

const now = 10_000;
const connection: ProviderConnection = {
  schemaVersion: 1 as const,
  id: "groq-main",
  providerId: "groq",
  modelId: "openai/gpt-oss-120b",
  apiBaseUrl: "https://api.groq.com/openai/v1",
  credentialReference: "vault:groq/groq-main",
  credentialFingerprint: "123456789abc",
  credentialState: "active" as const,
  privacyClass: "training_eligible" as const,
  capabilityRoles: ["implementer", "reviewer"],
  state: "ready" as const,
  contextWindowTokens: 131_072,
  maxOutputTokens: 65_536,
  cost: { access: "permanent_free" as const, plan: "free", zeroCost: true, billingEnabled: false, observedAt: now, expiresAt: now + 100_000, source: "account_api" as const },
  quota: { source: "account_api" as const, observedAt: now, expiresAt: now + 100_000, requestsPerMinute: 30, requestsPerDay: 1_000, tokensPerMinute: 30_000, tokensPerDay: 1_000_000, remainingRequests: 500, remainingTokens: 500_000, resetAt: null },
  canary: { status: "passed" as const, observedAt: now, expiresAt: now + 100_000, modelId: "openai/gpt-oss-120b", capabilities: ["chat", "tool_calling"], inputTokens: 1, outputTokens: 1, failureCode: null },
  updatedAt: now,
};

const recordedResponse = { schemaVersion: 1 as const, providerId: "groq", modelId: connection.modelId, requestId: "fixture", content: "done", finishReason: "stop" as const, usage: { inputTokens: 4, outputTokens: 1, totalTokens: 5, estimated: false, extensions: [] }, toolCalls: [], extensions: [], verified: false as const };

const adapter = createRecordedProviderAdapter({
  manifest: { schemaVersion: 1, providerId: "groq", adapterVersion: "1.0.0", protocol: "openai_compatible", capabilities: ["chat"], defaultTimeoutMs: 1_000, sourceUrls: ["https://console.groq.com/docs"], extensions: [] },
  models: [{ id: connection.modelId, label: "GPT OSS", contextWindowTokens: 131_072, maxOutputTokens: 65_536, capabilities: ["chat"], lifecycle: "active", retiresAt: null, extensions: [] }],
  credential: { valid: true, accountLabel: "test", error: null },
  quota: connection.quota,
  response: recordedResponse,
  stream: [{ type: "completed", content: "", response: recordedResponse }],
});

test("repairs a provider textual tool envelope only for offered tools with object arguments", () => {
  const response = {
    schemaVersion: 1 as const,
    providerId: "gemini",
    modelId: "gemini-3.5-flash-lite",
    requestId: "request-tool-envelope",
    content: '<assistant_tool_calls>{"id":"call-1","name":"file_editor","arguments":{"command":"create"}}</assistant_tool_calls>',
    toolCalls: [],
    finishReason: "stop" as const,
    usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15, estimated: false, extensions: [] },
    extensions: [],
    verified: false as const,
  };
  const tools = [{ type: "function" as const, function: { name: "file_editor", parameters: { type: "object" } } }];
  const repaired = normalizeTextualToolEnvelope(response, tools);
  assert.equal(repaired.finishReason, "tool_call");
  assert.equal(repaired.content, "");
  assert.equal(repaired.toolCalls[0]?.name, "file_editor");
  assert.equal(normalizeTextualToolEnvelope({ ...response, content: `${response.content} Task complete.` }, tools).finishReason, "tool_call");
  assert.throws(
    () => normalizeTextualToolEnvelope({ ...response, content: response.content.replace("file_editor", "unknown") }, tools),
    /malformed tool action/i,
  );
  assert.throws(
    () => normalizeTextualToolEnvelope({ ...response, content: `${response.content}<unsafe>` }, tools),
    /malformed tool action/i,
  );
  assert.throws(
    () => normalizeTextualToolEnvelope({ ...response, content: '<assistant_tool_calls>{"name":"terminal","arguments":{command:ls}}' }, tools),
    /malformed tool action/i,
  );
  assert.throws(
    () => normalizeTextualToolEnvelope({ ...response, content: `<foreign_tool_call>${response.content}</foreign_tool_call>` }, tools),
    /malformed tool action/i,
  );
  const mixed = normalizeTextualToolEnvelope({
    ...response,
    toolCalls: [{ id: "native-1", name: "file_editor", argumentsJson: '{"command":"view"}' }],
  }, tools);
  assert.equal(mixed.content, "");
  assert.deepEqual(mixed.toolCalls.map((call) => call.id), ["native-1", "call-1"]);

  const recoveredThink = normalizeTextualToolEnvelope({
    ...response,
    content: '<assistant_tool_calls>{"id":"think-1","name":"think","arguments":{"thought":"Plan the implementation"}}</assistant_tool_calls>',
  }, [
    { type: "function" as const, function: { name: "terminal", parameters: { type: "object" } } },
    { type: "function" as const, function: { name: "file_editor", parameters: { type: "object" } } },
  ]);
  assert.equal(recoveredThink.content, "");
  assert.equal(recoveredThink.finishReason, "tool_call");
  assert.equal(recoveredThink.toolCalls[0]?.name, "terminal");
  assert.deepEqual(JSON.parse(recoveredThink.toolCalls[0]?.argumentsJson ?? "{}"), {
    command: "true",
    summary: "Continue after internal planning",
  });

  const wrapped = normalizeTextualToolEnvelope({
    ...response,
    content: '<tool_call>```json\n{"id":"wrapped-1","type":"function","function":{"name":"file_editor","arguments":"{\\"command\\":\\"create\\"}"}}\n```</tool_call>',
  }, tools);
  assert.equal(wrapped.toolCalls[0]?.name, "file_editor");
  assert.deepEqual(JSON.parse(wrapped.toolCalls[0]?.argumentsJson ?? "{}"), { command: "create" });
});

test("automatic gateway exposes one model and routes review work through a verified free connection", async () => {
  const gateway = new AgentCanvasModelGateway(
    { list: async () => [connection] },
    { read: async () => "test-secret-value" },
    { adapter: () => adapter },
    async () => ({ usageByConnectionId: { "groq-main": { activeRequests: 0, requestsToday: 0, tokensToday: 0, inputTokensToday: 0, outputTokensToday: 0, requestTimestamps: [], tokenSamples: [] } } }),
    () => now,
  );

  assert.deepEqual(await gateway.models(), [{ id: AGENT_CANVAS_AUTO_MODEL, object: "model", owned_by: "pipeline-studio" }]);
  const result = await gateway.chat({ model: AGENT_CANVAS_AUTO_MODEL, messages: [{ role: "user", content: "Audit this implementation." }] });
  assert.equal(result.workKind, "review");
  assert.equal(result.providerId, "groq");
  assert.equal(toOpenAiChatCompletion(result).pipeline.paid_usage, false);
});

test("work classifier gives review precedence and paid or stale connections never expose auto", async () => {
  assert.equal(classifyAgentCanvasWork("Review and fix this feature"), "review");
  const gateway = new AgentCanvasModelGateway(
    { list: async () => [{ ...connection, cost: { ...connection.cost, billingEnabled: true } }] },
    { read: async () => "test-secret-value" },
    { adapter: () => adapter },
    async () => ({ usageByConnectionId: {} }),
    () => now,
  );
  assert.deepEqual(await gateway.models(), []);
});

test("normalizes Agent Canvas content parts and preserves tool-call history", () => {
  assert.deepEqual(normalizeAgentCanvasMessages([
    { role: "developer", content: [{ type: "text", text: "Follow the workspace rules." }] },
    { role: "assistant", content: null, tool_calls: [{ id: "call-1", type: "function", function: { name: "terminal", arguments: '{"command":"pwd"}' } }] },
    { role: "tool", tool_call_id: "call-1", content: [{ type: "text", text: "/workspace" }] },
  ]), [
    { role: "system", content: "Follow the workspace rules." },
    { role: "assistant", content: '<assistant_tool_calls>\n{"id":"call-1","name":"terminal","arguments":"{\\"command\\":\\"pwd\\"}"}\n</assistant_tool_calls>' },
    { role: "user", content: '<tool_result id="call-1">\n/workspace\n</tool_result>' },
  ]);
});

test("refreshes stale free-tier evidence once before declaring capacity unavailable", async () => {
  let current = { ...connection, quota: { ...connection.quota, observedAt: now - 1_000, expiresAt: now - 1 } };
  let refreshCount = 0;
  const gateway = new AgentCanvasModelGateway(
    { list: async () => [current] },
    { read: async () => "test-secret-value" },
    { adapter: () => adapter },
    async () => ({ usageByConnectionId: { "groq-main": { activeRequests: 0, requestsToday: 0, tokensToday: 0, inputTokensToday: 0, outputTokensToday: 0, requestTimestamps: [], tokenSamples: [] } } }),
    () => now,
    async () => {
      refreshCount += 1;
      current = { ...current, quota: { ...current.quota, expiresAt: now + 10_000 } };
    },
  );
  assert.equal((await gateway.models()).length, 1);
  assert.equal(refreshCount, 1);
});

test("self-heals stale providers in the background while a healthy provider keeps serving", async () => {
  const stale = {
    ...connection,
    id: "stale-provider",
    quota: { ...connection.quota, observedAt: now - 1_000, expiresAt: now - 1 },
  };
  let refreshCount = 0;
  let releaseRefresh!: () => void;
  const refreshStarted = new Promise<void>((resolve) => { releaseRefresh = resolve; });
  const gateway = new AgentCanvasModelGateway(
    { list: async () => [connection, stale] },
    { read: async () => "test-secret-value" },
    { adapter: () => adapter },
    async () => ({
      usageByConnectionId: {
        "groq-main": { activeRequests: 0, requestsToday: 0, tokensToday: 0, inputTokensToday: 0, outputTokensToday: 0, requestTimestamps: [], tokenSamples: [] },
        "stale-provider": { activeRequests: 0, requestsToday: 0, tokensToday: 0, inputTokensToday: 0, outputTokensToday: 0, requestTimestamps: [], tokenSamples: [] },
      },
    }),
    () => now,
    async () => {
      refreshCount += 1;
      await refreshStarted;
    },
  );

  assert.equal((await gateway.models()).length, 1);
  assert.equal(refreshCount, 1);
  assert.equal((await gateway.models()).length, 1);
  assert.equal(refreshCount, 1, "the cooldown prevents a probe storm");
  releaseRefresh();
});

test("free-tier routing compacts oversized system context without dropping security or grounding", () => {
  const filler = "irrelevant skill text ".repeat(1_000);
  const [message] = compactAgentCanvasMessages([{ role: "system", content: [
    "<SOUL>agent</SOUL>",
    "<ROLE>builder</ROLE>",
    `<UNRELATED>${filler}</UNRELATED>`,
    "<SECURITY>never expose credentials</SECURITY>",
    "<PIPELINE_WORKSPACE_CONTEXT>Workspace: /safe/project</PIPELINE_WORKSPACE_CONTEXT>",
  ].join("\n") }]);
  assert.ok(message);
  assert.match(message.content, /never expose credentials/);
  assert.match(message.content, /Workspace: \/safe\/project/);
  assert.doesNotMatch(message.content, /irrelevant skill text/);
  assert.ok(message.content.length < 2_000);
});

test("free-tier routing removes huge historical edit payloads while keeping recent evidence", () => {
  const messages = compactAgentCanvasMessages([
    { role: "system", content: "<SECURITY>never expose credentials</SECURITY>" },
    { role: "user", content: "Create the landing page." },
    { role: "assistant", content: `<assistant_tool_calls>{"name":"file_editor","arguments":{"content":"${"x".repeat(50_000)}"}}</assistant_tool_calls>` },
    { role: "user", content: '<tool_result id="edit">File created successfully at index.html</tool_result>' },
    { role: "assistant", content: '<assistant_tool_calls>{"name":"terminal","arguments":{"command":"head index.html"}}</assistant_tool_calls>' },
    { role: "user", content: '<tool_result id="check">index.html is valid</tool_result>' },
  ]);
  const serialized = JSON.stringify(messages);
  assert.ok(serialized.length < 20_000);
  assert.doesNotMatch(serialized, /x{100}/);
  assert.match(serialized, /file_editor completed/);
  assert.match(serialized, /index\.html is valid/);
  assert.match(serialized, /never expose credentials/);
});

test("an explicit preview request cannot be skipped by a model that jumps to finish", () => {
  const response = ensureRequestedPreviewAction(
    {
      ...recordedResponse,
      content: "The page is complete.",
      toolCalls: [{ id: "finish-1", name: "finish", argumentsJson: '{"message":"Done"}' }],
      finishReason: "tool_call",
    },
    "Show me the preview and summarize it.",
    [
      { role: "user", content: "Create the page." },
      { role: "user", content: '<tool_result id="edit">File created successfully at: /safe/workspace/index.html</tool_result>' },
    ],
    [{ type: "function", function: { name: "canvas_ui_control", parameters: { type: "object" } } }],
  );
  assert.equal(response.finishReason, "tool_call");
  assert.equal(response.toolCalls.length, 1);
  assert.equal(response.toolCalls[0]?.name, "canvas_ui_control");
  assert.deepEqual(JSON.parse(response.toolCalls[0]?.argumentsJson ?? "{}"), {
    command: "show_preview",
    path: "index.html",
  });
});

test("an explicit preview request repairs provider-specific preview arguments", () => {
  const response = ensureRequestedPreviewAction(
    {
      ...recordedResponse,
      content: "",
      toolCalls: [{ id: "preview-wrong", name: "canvas_ui_control", argumentsJson: '{"command":"show","path":"/safe/workspace/index.html"}' }],
      finishReason: "tool_call",
    },
    "Show the preview.",
    [{ role: "user", content: "File created successfully at: /safe/workspace/index.html" }],
    [{ type: "function", function: { name: "canvas_ui_control", parameters: { type: "object" } } }],
  );
  assert.equal(response.toolCalls.length, 1);
  assert.deepEqual(JSON.parse(response.toolCalls[0]?.argumentsJson ?? "{}"), {
    command: "show_preview",
    path: "index.html",
  });
});

test("a preview-only command is handled locally without provider capacity", async () => {
  const gateway = new AgentCanvasModelGateway(
    { list: async () => [] },
    { read: async () => null },
    { adapter: () => null },
    async () => ({ usageByConnectionId: {} }),
    () => now,
  );
  const tools = [{
    type: "function" as const,
    function: { name: "canvas_ui_control", parameters: { type: "object" } },
  }];
  const first = await gateway.chat({
    model: AGENT_CANVAS_AUTO_MODEL,
    messages: [
      { role: "user", content: "File created successfully at: /safe/workspace/index.html" },
      { role: "user", content: "Show the preview" },
    ],
    tools,
  });
  assert.equal(first.providerId, "pipeline-studio");
  assert.deepEqual(first.attemptedProviderIds, []);
  assert.equal(first.response.toolCalls[0]?.name, "canvas_ui_control");
  assert.deepEqual(JSON.parse(first.response.toolCalls[0]?.argumentsJson ?? "{}"), {
    command: "show_preview",
    path: "index.html",
  });

  const second = await gateway.chat({
    model: AGENT_CANVAS_AUTO_MODEL,
    messages: [
      { role: "user", content: "File created successfully at: /safe/workspace/index.html" },
      { role: "user", content: "Show the preview" },
      { role: "assistant", content: '<assistant_tool_calls>{"id":"preview-test","name":"canvas_ui_control","arguments":"{}"}</assistant_tool_calls>' },
      { role: "user", content: '<tool_result id="preview-test">Workspace view updated.</tool_result>' },
    ],
    tools,
  });
  assert.equal(second.response.finishReason, "stop");
  assert.equal(second.response.content, "Preview opened.");
  assert.equal(second.response.toolCalls.length, 0);
});

test("automatic action selection sends only tools needed for the current work", () => {
  const tools = ["terminal", "file_editor", "canvas_ui_control", "browser_navigate", "launch_child_conversation", "pipeline_status", "finish"].map((name) => ({
    type: "function" as const,
    function: { name, parameters: { type: "object" } },
  }));
  assert.deepEqual(
    selectAgentCanvasTools(tools, "implementation", "Create a file").map((tool) => tool.function.name),
    ["terminal", "file_editor", "canvas_ui_control", "finish"],
  );
  assert.deepEqual(
    selectAgentCanvasTools(tools, "implementation", "Create a landing page and its UI").map((tool) => tool.function.name),
    ["terminal", "file_editor", "canvas_ui_control", "finish"],
  );
  assert.deepEqual(
    selectAgentCanvasTools(tools, "review", "Review the browser UI with a sub-agent").map((tool) => tool.function.name),
    ["terminal", "file_editor", "canvas_ui_control", "browser_navigate", "launch_child_conversation", "finish"],
  );
  assert.equal(
    selectAgentCanvasTools(tools, "general", "Show me the preview").some((tool) => tool.function.name === "canvas_ui_control"),
    true,
  );
});
