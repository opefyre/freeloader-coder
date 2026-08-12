import { z } from "zod";

import {
  AGENT_CANVAS_AUTO_MODEL,
  type AgentCanvasModelGateway,
} from "./agent-canvas-model-gateway.js";
import type {
  ProjectKindAssistant,
  ProjectKindClassification,
} from "./project-intake-coordinator.js";

const responseSchema = z.strictObject({
  kind: z.enum(["new_product", "existing_product", "unknown"]),
  confidence: z.number().min(0).max(1),
  rationale: z.array(z.string().trim().min(1).max(300)).min(1).max(5),
});

export class FreeProviderProjectKindAssistant implements ProjectKindAssistant {
  constructor(private readonly gateway: Pick<AgentCanvasModelGateway, "chat">) {}

  async classify(input: Parameters<ProjectKindAssistant["classify"]>[0]): Promise<ProjectKindClassification> {
    try {
      const result = await this.gateway.chat({
        model: AGENT_CANVAS_AUTO_MODEL,
        messages: [
          {
            role: "system",
            content: "Classify product-development intake from categorical signals only. Do not call tools. Return exactly one JSON object with kind, confidence, and rationale. Choose unknown whenever signals are insufficient or contradictory.",
          },
          {
            role: "user",
            content: JSON.stringify({
              task: "Classify new product versus existing product.",
              ownerSelection: input.ownerSelection,
              signals: localIntentSignals(input.outcome),
              deterministicKind: input.deterministic.kind,
              deterministicConfidence: input.deterministic.confidence,
            }),
          },
        ],
        max_tokens: 800,
        temperature: 0,
        tools: [],
      });
      const parsed = responseSchema.parse(JSON.parse(result.response.content));
      return {
        kind: parsed.kind,
        confidence: parsed.confidence,
        evidence: [
          `Free-provider assessment used ${result.providerId}/${result.modelId} with categorical, locally derived signals only.`,
          ...parsed.rationale.map((item) => `Model rationale: ${item}`),
        ],
      };
    } catch {
      return {
        kind: "unknown",
        confidence: 0.4,
        evidence: ["Free-provider assessment was unavailable or invalid; owner clarification remains required."],
      };
    }
  }
}

export function localIntentSignals(outcome: string) {
  const normalized = outcome.toLowerCase();
  return {
    mentionsExistingAsset: /\b(existing|current|our app|our site|our system|legacy|repo|codebase)\b/.test(normalized),
    mentionsModification: /\b(add|change|extend|improve|redesign|migrate|integrate|fix)\b/.test(normalized),
    mentionsCreation: /\b(new|create|build|launch|from scratch|greenfield)\b/.test(normalized),
    mentionsProductScale: /\b(product|platform|application|app|service|system)\b/.test(normalized),
    isDetailed: outcome.trim().length >= 80,
  };
}
