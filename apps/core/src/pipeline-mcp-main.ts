import { createInterface } from "node:readline";

import { callPipelineMcpTool, PIPELINE_MCP_TOOLS } from "./pipeline-mcp.js";

const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });

lines.on("line", (line) => {
  void handleLine(line);
});

async function handleLine(line: string): Promise<void> {
  let request: Record<string, unknown>;
  try {
    request = JSON.parse(line) as Record<string, unknown>;
  } catch {
    return send(null, undefined, { code: -32700, message: "Parse error" });
  }
  const id = request.id as string | number | null | undefined;
  if (request.method === "notifications/initialized") return;
  if (request.method === "initialize") {
    return send(id ?? null, {
      protocolVersion: "2024-11-05",
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: "pipeline-studio", version: "1.0.0" },
    });
  }
  if (request.method === "ping") return send(id ?? null, {});
  if (request.method === "tools/list") {
    return send(id ?? null, { tools: PIPELINE_MCP_TOOLS.map(({ path: _path, ...tool }) => tool) });
  }
  if (request.method === "tools/call") {
    const params = request.params && typeof request.params === "object"
      ? request.params as Record<string, unknown>
      : {};
    if (typeof params.name !== "string") {
      return send(id ?? null, undefined, { code: -32602, message: "Tool name is required" });
    }
    return send(id ?? null, await callPipelineMcpTool(params.name));
  }
  if (id === undefined) return;
  return send(id ?? null, undefined, { code: -32601, message: "Method not found" });
}

function send(
  id: string | number | null,
  result?: unknown,
  error?: { code: number; message: string },
): void {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, ...(error ? { error } : { result }) })}\n`);
}
