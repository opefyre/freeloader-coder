import assert from "node:assert/strict";
import test from "node:test";

import { callPipelineMcpTool, PIPELINE_MCP_TOOLS } from "../apps/core/src/pipeline-mcp.js";

test("Pipeline MCP exposes a minimal read-only tool surface", () => {
  assert.deepEqual(PIPELINE_MCP_TOOLS.map((tool) => tool.name), [
    "pipeline_status",
    "pipeline_integrations",
    "pipeline_projects",
    "pipeline_action_center",
  ]);
  assert.ok(PIPELINE_MCP_TOOLS.every((tool) => tool.inputSchema.additionalProperties === false));
});

test("Pipeline MCP calls only loopback and redacts sensitive response fields", async () => {
  const seen: string[] = [];
  const result = await callPipelineMcpTool("pipeline_integrations", async (input) => {
    seen.push(String(input));
    return new Response(JSON.stringify({ provider: "jira", token: "never-return", state: "ready" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
  assert.deepEqual(seen, ["http://127.0.0.1:4312/api/v1/integration-connections"]);
  assert.equal(result.isError, undefined);
  assert.match(result.content[0]?.text ?? "", /jira/);
  assert.doesNotMatch(result.content[0]?.text ?? "", /never-return|token/);
  assert.equal((await callPipelineMcpTool("pipeline_status", fetch, "https://example.com")).isError, true);
});
