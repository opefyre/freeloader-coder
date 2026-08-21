import { describe, expect, it } from "vitest";

import {
  buildPipelineContextSuffix,
  buildWorkspaceContextSuffix,
} from "./project-context";

describe("buildPipelineContextSuffix", () => {
  it("renders bounded, cited project grounding for the Agent Canvas system suffix", () => {
    const suffix = buildPipelineContextSuffix({
      projectId: "pipeline-studio",
      contextPath: "CONTEXT.md",
      contextDigest: "a".repeat(64),
      observedAt: Date.parse("2026-08-09T12:00:00.000Z"),
      citations: [{ path: "README.md", digest: "b".repeat(64) }],
    });

    expect(suffix).toContain("<PIPELINE_PROJECT_CONTEXT>");
    expect(suffix).toContain("Canonical context: CONTEXT.md");
    expect(suffix).toContain(`README.md (${"b".repeat(64)})`);
    expect(suffix).toContain("Never read or disclose credentials");
  });

  it("rejects context that escapes the selected project", () => {
    expect(() =>
      buildPipelineContextSuffix({
        projectId: "pipeline-studio",
        contextPath: "../CONTEXT.md",
        contextDigest: "a".repeat(64),
        observedAt: 1,
        citations: [{ path: "README.md", digest: "b".repeat(64) }],
      }),
    ).toThrow(/safe path/);
  });

  it("grounds a conversation in its selected local workspace", () => {
    const suffix = buildWorkspaceContextSuffix("/Users/example/my-product");

    expect(suffix).toContain("Workspace: /Users/example/my-product");
    expect(suffix).toContain("CONTEXT.md");
    expect(suffix).toContain("flag stale or contradictory context");
  });
});
