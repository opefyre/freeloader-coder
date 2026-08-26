import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { FreeProviderSolutionModel, providerIdsForRole } from "../apps/core/src/free-provider-solution-model.js";
import type { ProviderAdapter } from "../packages/providers/src/index.js";
import type { ProviderConnection } from "../packages/schemas/src/index.js";

const now = 1_800_000_000_000;
const projectId = "project_abcdef0123456789";
const contextDigest = "a".repeat(64);

test("solution model uses only consented free providers and replays durable output", async () => {
  const root = await mkdtemp(join(tmpdir(), "solution-model-"));
  try {
    let calls = 0;
    const connections = [connection("groq", "openai/gpt-oss-120b"), connection("mistral", "mistral-small-latest")];
    let responseSchema: any;
    const model = new FreeProviderSolutionModel(root, { list: async () => connections } as any, { read: async () => "safe-test-credential" }, {
      adapter: (providerId) => ({ manifest: { providerId }, chat: async (_credential: unknown, request: any) => { calls += 1; responseSchema = request.responseSchema; return { schemaVersion: 1, providerId, modelId: request.modelId, requestId: request.requestId, content: JSON.stringify(researchResponse("product")), finishReason: "stop", usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15, estimated: false, extensions: [] }, toolCalls: [], extensions: [], verified: false }; } }) as unknown as ProviderAdapter,
    }, () => now);
    const input = { projectId, role: "product_research" as const, contextDigest, instruction: "Analyze product behavior.", sources: [{ name: "CONTEXT.md", content: "# Context\n\nNon-personal test source." }], permit: { schemaVersion: 1 as const, projectId, contextDigest, dataClass: "source_code" as const, providerIds: ["groq"], approvedAt: now - 1, expiresAt: now + 60_000 } };
    const first = await model.run(input);
    assert.equal(first.providerId, "groq");
    assert.equal(calls, 1);
    assert.equal(responseSchema.additionalProperties, false);
    assert.equal(responseSchema.properties.discipline.const, "product");
    assert.deepEqual(responseSchema.required, ["schemaVersion", "discipline", "questions", "sources", "claims", "contradictions", "gaps"]);
    await model.run(input);
    assert.equal(calls, 1);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("solution model rejects mismatched consent and personal or secret content before dispatch", async () => {
  const root = await mkdtemp(join(tmpdir(), "solution-model-denied-"));
  try {
    let calls = 0;
    const model = new FreeProviderSolutionModel(root, { list: async () => [connection("groq", "openai/gpt-oss-120b")] } as any, { read: async () => "safe-test-credential" }, { adapter: () => ({ chat: async () => { calls += 1; throw new Error("must not dispatch"); } }) as unknown as ProviderAdapter }, () => now);
    const permit = { schemaVersion: 1 as const, projectId, contextDigest, dataClass: "source_code" as const, providerIds: ["groq"], approvedAt: now - 1, expiresAt: now + 60_000 };
    await assert.rejects(() => model.run({ projectId, role: "product_research", contextDigest: "b".repeat(64), instruction: "Analyze.", sources: [{ name: "CONTEXT.md", content: "safe" }], permit }), /invalid or expired/);
    await assert.rejects(() => model.run({ projectId, role: "product_research", contextDigest, instruction: "Analyze.", sources: [{ name: "CONTEXT.md", content: "Owner: person@example.com" }], permit }), /must remain local/);
    assert.equal(calls, 0);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("solution model accepts ISO dates while still rejecting international phone numbers", async () => {
  const root = await mkdtemp(join(tmpdir(), "solution-model-date-"));
  try {
    let calls = 0;
    const model = new FreeProviderSolutionModel(root, { list: async () => [connection("groq", "openai/gpt-oss-120b")] } as any, { read: async () => "safe-test-credential" }, {
      adapter: (providerId) => ({ manifest: { providerId }, chat: async (_credential: unknown, request: any) => { calls += 1; return { schemaVersion: 1, providerId, modelId: request.modelId, requestId: request.requestId, content: JSON.stringify(researchResponse("product")), finishReason: "stop", usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15, estimated: false, extensions: [] }, toolCalls: [], extensions: [], verified: false }; } }) as unknown as ProviderAdapter,
    }, () => now);
    const permit = { schemaVersion: 1 as const, projectId, contextDigest, dataClass: "source_code" as const, providerIds: ["groq"], approvedAt: now - 1, expiresAt: now + 60_000 };
    await model.run({ projectId, role: "product_research", contextDigest, instruction: "Analyze.", sources: [{ name: "CONTEXT.md", content: "Last reviewed: 2026-08-12" }], permit });
    assert.equal(calls, 1);
    await assert.rejects(() => model.run({ projectId, role: "technical_research", contextDigest, instruction: "Analyze.", sources: [{ name: "CONTEXT.md", content: "Owner phone: +351 912 345 678" }], permit }), /must remain local/);
    assert.equal(calls, 1);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("solution revision scope uses a portable strict response contract", async () => {
  const root = await mkdtemp(join(tmpdir(), "solution-model-revision-scope-"));
  try {
    let observedSchema: any;
    const model = new FreeProviderSolutionModel(root, { list: async () => [connection("groq", "openai/gpt-oss-120b")] } as any, { read: async () => "safe-test-credential" }, {
      adapter: (providerId) => ({ manifest: { providerId }, chat: async (_credential: unknown, request: any) => {
        observedSchema = request.responseSchema;
        return { schemaVersion: 1, providerId, modelId: request.modelId, requestId: request.requestId, content: JSON.stringify({ schemaVersion: 1, sections: ["architecture", "data"], rationale: "Owner feedback changes storage design." }), finishReason: "stop", usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, estimated: false, extensions: [] }, toolCalls: [], extensions: [], verified: false };
      } }) as unknown as ProviderAdapter,
    }, () => now);
    const permit = { schemaVersion: 1 as const, projectId, contextDigest, dataClass: "source_code" as const, providerIds: ["groq"], approvedAt: now - 1, expiresAt: now + 60_000 };
    const result = await model.run({ projectId, role: "solution_revision_scope", contextDigest, instruction: "Scope the revision.", sources: [{ name: "CONTEXT.md", content: "Safe test context." }], permit });
    assert.deepEqual(result.response, { schemaVersion: 1, sections: ["architecture", "data"], rationale: "Owner feedback changes storage design." });
    assert.equal(observedSchema.additionalProperties, false);
    assert.deepEqual(observedSchema.required, ["schemaVersion", "sections", "rationale"]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("solution model refreshes stale consented provider evidence before routing", async () => {
  const root = await mkdtemp(join(tmpdir(), "solution-model-refresh-"));
  try {
    const fresh = connection("groq", "openai/gpt-oss-120b");
    let current: ProviderConnection = { ...fresh, state: "stale", cost: { ...fresh.cost, expiresAt: now - 1 }, quota: { ...fresh.quota, expiresAt: now - 1 }, canary: { ...fresh.canary, expiresAt: now - 1 } };
    let refreshes = 0;
    const model = new FreeProviderSolutionModel(root, { list: async () => [current] } as any, { read: async () => "safe-test-credential" }, {
      adapter: (providerId) => ({ manifest: { providerId }, chat: async (_credential: unknown, request: any) => ({ schemaVersion: 1, providerId, modelId: request.modelId, requestId: request.requestId, content: JSON.stringify(researchResponse("product")), finishReason: "stop", usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, estimated: false, extensions: [] }, toolCalls: [], extensions: [], verified: false }) }) as unknown as ProviderAdapter,
    }, () => now, { reProbe: async () => { refreshes += 1; current = fresh; } });
    const permit = { schemaVersion: 1 as const, projectId, contextDigest, dataClass: "source_code" as const, providerIds: ["groq"], approvedAt: now - 1, expiresAt: now + 60_000 };
    const result = await model.run({ projectId, role: "product_research", contextDigest, instruction: "Analyze.", sources: [{ name: "CONTEXT.md", content: "Safe test context." }], permit });
    assert.equal(refreshes, 1);
    assert.equal(result.providerId, "groq");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("solution model rejects structurally incomplete research before it becomes durable evidence", async () => {
  const root = await mkdtemp(join(tmpdir(), "solution-model-contract-"));
  try {
    const model = new FreeProviderSolutionModel(root, { list: async () => [connection("groq", "openai/gpt-oss-120b")] } as any, { read: async () => "safe-test-credential" }, {
      adapter: (providerId) => ({ manifest: { providerId }, chat: async (_credential: unknown, request: any) => ({ schemaVersion: 1, providerId, modelId: request.modelId, requestId: request.requestId, content: JSON.stringify({ schemaVersion: 1, discipline: "product", questions: [], sources: [], claims: [], contradictions: [], gaps: [] }), finishReason: "stop", usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, estimated: false, extensions: [] }, toolCalls: [], extensions: [], verified: false }) }) as unknown as ProviderAdapter,
    }, () => now);
    const permit = { schemaVersion: 1 as const, projectId, contextDigest, dataClass: "source_code" as const, providerIds: ["groq"], approvedAt: now - 1, expiresAt: now + 60_000 };
    await assert.rejects(() => model.run({ projectId, role: "product_research", contextDigest, instruction: "Analyze.", sources: [{ name: "CONTEXT.md", content: "Safe test context." }], permit }));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("solution model performs one bounded same-provider repair for invalid structured evidence", async () => {
  const root = await mkdtemp(join(tmpdir(), "solution-model-repair-"));
  try {
    let calls = 0;
    const model = new FreeProviderSolutionModel(root, { list: async () => [connection("groq", "openai/gpt-oss-120b")] } as any, { read: async () => "safe-test-credential" }, {
      adapter: (providerId) => ({ manifest: { providerId }, chat: async (_credential: unknown, request: any) => {
        calls += 1;
        const content = calls === 1 ? JSON.stringify({ schemaVersion: 1, discipline: "wrong" }) : JSON.stringify(researchResponse("technical"));
        return { schemaVersion: 1, providerId, modelId: request.modelId, requestId: request.requestId, content, finishReason: "stop", usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15, estimated: false, extensions: [] }, toolCalls: [], extensions: [], verified: false };
      } }) as unknown as ProviderAdapter,
    }, () => now);
    const permit = { schemaVersion: 1 as const, projectId, contextDigest, dataClass: "source_code" as const, providerIds: ["groq"], approvedAt: now - 1, expiresAt: now + 60_000 };
    const result = await model.run({ projectId, role: "technical_research", contextDigest, instruction: "Analyze.", sources: [{ name: "CONTEXT.md", content: "Safe test context." }], permit });
    assert.equal(calls, 2, "one bounded same-provider repair is attempted");
    assert.equal((result.response as any).discipline, "technical");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("solution model rejects private research citations at the provider boundary and falls back", async () => {
  const root = await mkdtemp(join(tmpdir(), "solution-model-private-citation-"));
  try {
    let calls = 0;
    const connections = [connection("groq", "openai/gpt-oss-120b"), connection("mistral", "mistral-small-latest")];
    const model = new FreeProviderSolutionModel(root, { list: async () => connections } as any, { read: async () => "safe-test-credential" }, {
      adapter: (providerId) => ({ manifest: { providerId }, chat: async (_credential: unknown, request: any) => {
        calls += 1;
        const response = researchResponse("product") as any;
        if (providerId === "mistral") response.sources = [{ sourceId: "source-private", url: "http://127.0.0.1/private", title: "Private", retrievedAt: "2026-08-20T12:00:00Z", excerpt: "Private evidence", excerptDigest: "0".repeat(64), confidence: "low", relevance: "low", freshness: "unknown" }];
        return { schemaVersion: 1, providerId, modelId: request.modelId, requestId: request.requestId, content: JSON.stringify(response), finishReason: "stop", usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, estimated: false, extensions: [] }, toolCalls: [], extensions: [], verified: false };
      } }) as unknown as ProviderAdapter,
    }, () => now);
    const permit = { schemaVersion: 1 as const, projectId, contextDigest, dataClass: "source_code" as const, providerIds: ["groq", "mistral"], approvedAt: now - 1, expiresAt: now + 60_000 };
    const result = await model.run({ projectId, role: "product_research", contextDigest, instruction: "Analyze.", sources: [{ name: "CONTEXT.md", content: "Safe test context." }], permit });
    assert.equal(result.providerId, "groq");
    assert.equal(calls, 3, "one bounded repair precedes the independent provider fallback");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("solution model rejects an incomplete delivery plan at the provider boundary", async () => {
  const root = await mkdtemp(join(tmpdir(), "solution-model-delivery-contract-"));
  try {
    const model = new FreeProviderSolutionModel(root, { list: async () => [connection("groq", "openai/gpt-oss-120b")] } as any, { read: async () => "safe-test-credential" }, {
      adapter: (providerId) => ({ manifest: { providerId }, chat: async (_credential: unknown, request: any) => ({ schemaVersion: 1, providerId, modelId: request.modelId, requestId: request.requestId, content: JSON.stringify({ schemaVersion: 1 }), finishReason: "stop", usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, estimated: false, extensions: [] }, toolCalls: [], extensions: [], verified: false }) }) as unknown as ProviderAdapter,
    }, () => now);
    const permit = { schemaVersion: 1 as const, projectId, contextDigest, dataClass: "source_code" as const, providerIds: ["groq"], approvedAt: now - 1, expiresAt: now + 60_000 };
    await assert.rejects(() => model.run({ projectId, role: "delivery_planning", contextDigest, instruction: "Plan delivery.", sources: [{ name: "SOLUTION.md", content: "Safe approved solution." }], permit }));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("delivery roles reserve independent provider capacity instead of exhausting the mesh", () => {
  const consented = ["gemini", "mistral", "nvidia-nim", "groq", "huggingface", "cohere", "zhipu", "kilo", "openrouter"];
  assert.deepEqual(providerIdsForRole("delivery_planning", consented, ["gemini", "mistral", "nvidia-nim", "groq"]), ["gemini"]);
  assert.deepEqual(providerIdsForRole("delivery_review", consented, ["mistral", "huggingface", "cohere", "zhipu", "openrouter", "nvidia-nim", "gemini", "groq"]), ["mistral", "huggingface", "cohere", "zhipu", "openrouter"]);
  assert.deepEqual(providerIdsForRole("technical_delivery_review", consented, ["nvidia-nim", "kilo", "groq", "mistral", "gemini"]), ["nvidia-nim", "kilo", "groq"]);
  assert.deepEqual(providerIdsForRole("delivery_review", ["gemini"], ["mistral", "gemini"]), ["gemini"]);
  assert.deepEqual(providerIdsForRole("product_research", consented, ["gemini", "mistral", "nvidia-nim", "groq"]), consented);
  assert.deepEqual(providerIdsForRole("product_review", consented, ["mistral", "nvidia-nim", "gemini", "huggingface", "kilo", "groq", "cohere"]), ["gemini", "huggingface", "cohere"]);
  assert.deepEqual(providerIdsForRole("technical_review", consented, ["nvidia-nim", "mistral", "gemini", "huggingface", "kilo", "groq", "cohere"]), ["nvidia-nim", "mistral", "kilo", "groq"]);
});

test("delivery planning publishes the canonical wire constraints providers must satisfy", async () => {
  const root = await mkdtemp(join(tmpdir(), "solution-model-delivery-wire-"));
  try {
    let responseSchema: any;
    const model = new FreeProviderSolutionModel(root, { list: async () => [connection("groq", "openai/gpt-oss-120b")] } as any, { read: async () => "safe-test-credential" }, {
      adapter: (providerId) => ({ manifest: { providerId }, chat: async (_credential: unknown, request: any) => { responseSchema = request.responseSchema; return { schemaVersion: 1, providerId, modelId: request.modelId, requestId: request.requestId, content: JSON.stringify({ schemaVersion: 1 }), finishReason: "stop", usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, estimated: false, extensions: [] }, toolCalls: [], extensions: [], verified: false }; } }) as unknown as ProviderAdapter,
    }, () => now);
    const permit = { schemaVersion: 1 as const, projectId, contextDigest, dataClass: "source_code" as const, providerIds: ["groq"], approvedAt: now - 1, expiresAt: now + 60_000 };
    await assert.rejects(() => model.run({ projectId, role: "delivery_planning", contextDigest, instruction: "Plan delivery.", sources: [{ name: "SOLUTION.md", content: "Safe approved solution." }], permit }));
    assert.equal(responseSchema.properties.items.items.properties.id.type, "string");
    assert.equal(responseSchema.properties.items.items.properties.id.pattern, undefined);
    assert.deepEqual(responseSchema.properties.items.items.properties.storyPoints.enum, [null, 1, 2, 3, 5, 8, 13]);
    assert.equal(responseSchema.properties.coverage.minItems, 10);
    assert.equal(responseSchema.properties.coverage.maxItems, 10);
    assert.equal(responseSchema.properties.gates.items.properties.id.type, "string");
    assert.equal(responseSchema.properties.gates.items.properties.id.pattern, undefined);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("delivery planning canonically decomposes a valid leaf task without inventing scope", async () => {
  const root = await mkdtemp(join(tmpdir(), "solution-model-delivery-decompose-"));
  try {
    const raw = threeLevelDeliveryPlan();
    const model = new FreeProviderSolutionModel(root, { list: async () => [connection("groq", "openai/gpt-oss-120b")] } as any, { read: async () => "safe-test-credential" }, {
      adapter: (providerId) => ({ manifest: { providerId }, chat: async (_credential: unknown, request: any) => ({ schemaVersion: 1, providerId, modelId: request.modelId, requestId: request.requestId, content: JSON.stringify(raw), finishReason: "stop", usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, estimated: false, extensions: [] }, toolCalls: [], extensions: [], verified: false }) }) as unknown as ProviderAdapter,
    }, () => now);
    const solutionDigest = "b".repeat(64);
    const permit = { schemaVersion: 1 as const, projectId, contextDigest, dataClass: "source_code" as const, providerIds: ["groq"], approvedAt: now - 1, expiresAt: now + 60_000 };
    const result = await model.run({ projectId, role: "delivery_planning", contextDigest, instruction: `Set solutionDigest exactly to ${solutionDigest}.`, sources: [{ name: "SOLUTION.md", content: "Safe approved solution." }], permit });
    const plan = result.response as any;
    assert.equal(plan.contextDigest, contextDigest);
    assert.equal(plan.solutionDigest, solutionDigest);
    assert.equal(plan.items.length, 4);
    assert.equal(plan.items.at(-1).type, "subtask");
    assert.equal(plan.items.at(-1).parentId, plan.items[2].id);
    assert.equal(plan.items.at(-1).description, plan.items[2].description);
    assert.ok(plan.coverage.every((entry: any) => entry.itemIds.includes(plan.items.at(-1).id)));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("solution reconciliation requests and locally validates the complete canonical solution contract", async () => {
  const root = await mkdtemp(join(tmpdir(), "solution-model-reconciliation-"));
  try {
    let required: string[] = [];
    const model = new FreeProviderSolutionModel(root, { list: async () => [connection("groq", "openai/gpt-oss-120b")] } as any, { read: async () => "safe-test-credential" }, {
      adapter: (providerId) => ({ manifest: { providerId }, chat: async (_credential: unknown, request: any) => { required = request.responseSchema.required; return { schemaVersion: 1, providerId, modelId: request.modelId, requestId: request.requestId, content: JSON.stringify(solutionResponse()), finishReason: "stop", usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, estimated: false, extensions: [] }, toolCalls: [], extensions: [], verified: false }; } }) as unknown as ProviderAdapter,
    }, () => now);
    const permit = { schemaVersion: 1 as const, projectId, contextDigest, dataClass: "source_code" as const, providerIds: ["groq"], approvedAt: now - 1, expiresAt: now + 60_000 };
    const result = await model.run({ projectId, role: "solution_reconciliation", contextDigest, instruction: "Reconcile.", sources: [{ name: "RESEARCH.md", content: "# Sanitized research" }], permit });
    assert.ok(required.includes("alternatives"));
    assert.ok(required.includes("unresolvedBlockers"));
    assert.equal((result.response as any).schemaVersion, 1);
  } finally { await rm(root, { recursive: true, force: true }); }
});

function connection(providerId: "groq" | "mistral", modelId: string): ProviderConnection {
  const limits = providerId === "groq" ? { context: 131_072, output: 65_536, url: "https://api.groq.com/openai/v1" } : { context: 256_000, output: 32_000, url: "https://api.mistral.ai/v1" };
  return { schemaVersion: 1, id: `connection-${providerId}`, providerId, modelId, apiBaseUrl: limits.url, credentialReference: `vault:providers/${providerId}/primary`, credentialFingerprint: "012345abcdef", credentialState: "active", state: "ready", privacyClass: "training_eligible", capabilityRoles: ["implementer"], contextWindowTokens: limits.context, maxOutputTokens: limits.output, cost: { access: "account_limited_free", plan: "Free", zeroCost: true, billingEnabled: false, observedAt: now - 1, expiresAt: now + 60_000, source: "account_api" }, quota: { source: "account_api", observedAt: now - 1, expiresAt: now + 60_000, requestsPerMinute: 5, requestsPerDay: 100, tokensPerMinute: 30_000, tokensPerDay: 1_000_000, remainingRequests: 90, remainingTokens: 900_000, resetAt: now + 60_000 }, canary: { status: "passed", observedAt: now - 1, expiresAt: now + 60_000, modelId, capabilities: ["chat", "structured_output"], inputTokens: 1, outputTokens: 1, failureCode: null }, updatedAt: now - 1 };
}

function researchResponse(discipline: "product" | "technical") {
  const topics = discipline === "product"
    ? ["market", "competitor_features", "competitor_pricing", "public_reviews", "audience", "problem", "product"]
    : ["architecture", "data", "integrations", "security", "privacy", "reliability", "delivery"];
  return {
    schemaVersion: 1,
    discipline,
    questions: ["What evidence is required?"],
    sources: [],
    claims: [],
    contradictions: [],
    gaps: topics.map((topic) => ({ topic, question: `What evidence supports ${topic}?`, reason: "browsing_unavailable", impact: `Verified ${topic} evidence is not available.` })),
  };
}

function solutionResponse() {
  const section = ["Implement the complete grounded requirement."];
  return {
    schemaVersion: "1", title: "Grounded product solution", summary: "A complete grounded product solution ready for independent review.",
    behavior: section, architecture: section, userExperience: section, data: section, integrations: section,
    security: section, privacy: section, reliability: section, rollout: section, metrics: section,
    alternatives: [
      { option: "Use the grounded architecture.", disposition: "selected", rationale: "It satisfies the verified context." },
      { option: "Replace the established architecture.", disposition: "rejected", rationale: "It would add unsupported scope." },
    ],
    unresolvedBlockers: [], citations: ["local://CONTEXT.md", "local://RESEARCH.md"],
  };
}

function threeLevelDeliveryPlan() {
  const common = { description: "Implement the approved local-first decision journal behavior with bounded, verifiable project changes.", estimatedMinutes: 120, priority: "high", dependencies: [], acceptanceCriteria: ["The approved behavior is implemented with deterministic observable evidence.", "Automated validation demonstrates the expected behavior without external paid services."], definitionOfDone: ["The scoped implementation is complete and reviewed.", "All selected deterministic validation profiles pass."], implementationNotes: ["Follow the approved solution and preserve local-first data boundaries."], roleCapabilities: ["Developer"], rollbackRequirements: ["Revert the scoped project files and restore the last verified local state."], allowedFiles: ["src/decision-journal.ts"], validationProfiles: ["format", "lint", "unit"], citations: ["local://SOLUTION.md"] };
  const items = [
    { ...common, id: "epic-1", type: "epic", parentId: null, title: "Decision journal product", storyPoints: 13 },
    { ...common, id: "story-1", type: "story", parentId: "epic-1", title: "Record structured decisions", storyPoints: 5 },
    { ...common, id: "task-1", type: "task", parentId: "story-1", title: "Implement decision capture", storyPoints: null },
  ];
  const requirements = ["behavior", "architecture", "user_experience", "data", "integrations", "security", "privacy", "reliability", "rollout", "metrics"];
  return { schemaVersion: 1, title: "Decision journal delivery plan", objective: "Deliver the approved local-first personal decision journal through bounded and independently verifiable implementation work.", contextDigest: "c".repeat(64), solutionDigest: "d".repeat(64), items, coverage: requirements.map((requirement) => ({ requirement, itemIds: ["task-1"], validationProfiles: ["unit"], citations: ["local://SOLUTION.md"] })), gates: [{ id: "approval-gate", kind: "owner_approval", title: "Owner implementation approval", rationale: "Implementation cannot start until the owner approves the reviewed delivery plan.", beforeItemIds: ["task-1"] }], risks: ["Free provider capacity may delay implementation but must never enable paid routing."], assumptions: [], citations: ["local://SOLUTION.md"] };
}
