import assert from "node:assert/strict";
import test from "node:test";

import { FreeProviderProjectKindAssistant, localIntentSignals } from "../apps/core/src/free-provider-project-kind-assistant.js";

const deterministic = { kind: "unknown" as const, confidence: 0.5, evidence: ["No implementation evidence."] };

test("classification sends only categorical signals and records provider attribution", async () => {
  let payload = "";
  const assistant = new FreeProviderProjectKindAssistant({ chat: async (input) => {
    payload = input.messages[1]?.content ?? "";
    return {
      id: "request",
      providerId: "free-provider",
      modelId: "free-model",
      workKind: "planning" as const,
      attemptedProviderIds: ["free-provider"],
      response: {
        schemaVersion: 1 as const,
        providerId: "free-provider",
        requestId: "request",
        modelId: "free-model",
        content: JSON.stringify({ kind: "existing_product", confidence: 0.91, rationale: ["Modification and existing-asset signals agree."] }),
        finishReason: "stop" as const,
        toolCalls: [],
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, estimated: false, extensions: [] },
        extensions: [],
        verified: false as const,
      },
    };
  } });
  const outcome = "Extend our existing app for a private customer named Example Person at /Users/private/work";
  const result = await assistant.classify({ outcome, ownerSelection: "existing_product", deterministic });
  assert.equal(result.kind, "existing_product");
  assert.match(result.evidence[0] ?? "", /free-provider\/free-model/);
  assert.equal(payload.includes(outcome), false);
  assert.equal(payload.includes("Example Person"), false);
  assert.equal(payload.includes("/Users/"), false);
  assert.deepEqual(JSON.parse(payload).signals, localIntentSignals(outcome));
});

test("malformed and unavailable provider output preserves owner clarification", async () => {
  const malformed = new FreeProviderProjectKindAssistant({ chat: async () => { throw new Error("provider unavailable"); } });
  const result = await malformed.classify({ outcome: "Improve it", ownerSelection: "existing_product", deterministic });
  assert.equal(result.kind, "unknown");
  assert.equal(result.confidence, 0.4);
  assert.match(result.evidence[0] ?? "", /clarification/);
});
