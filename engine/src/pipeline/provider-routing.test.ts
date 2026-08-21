import { describe, expect, it } from "vitest";

import { derivePipelineRoutingHint } from "./provider-routing";

describe("derivePipelineRoutingHint", () => {
  it("classifies a code task and preserves a bounded token request", () => {
    const result = derivePipelineRoutingHint({
      messages: [
        { role: "user", content: "Implement the Jira sync and test it." },
      ],
      maxTokens: 4_000,
      tools: [{ type: "function" }],
    });

    expect(result).toEqual({
      workKind: "implementation",
      role: "implementer",
      estimatedInputTokens: 9,
      requestedOutputTokens: 4_000,
      requiresTools: true,
    });
  });

  it("routes independent QA work to a reviewer", () => {
    const result = derivePipelineRoutingHint({
      messages: [
        { role: "user", content: "Audit the proposed solution for omissions." },
      ],
    });

    expect(result.workKind).toBe("review");
    expect(result.role).toBe("reviewer");
  });
});
