export const PIPELINE_MCP_TOOLS = [
  {
    name: "pipeline_status",
    description: "Read Codkesh health and runtime readiness.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    path: "/api/v1/health",
  },
  {
    name: "pipeline_integrations",
    description: "List connected productivity and infrastructure services and their selectable resources.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    path: "/api/v1/integration-connections",
  },
  {
    name: "pipeline_projects",
    description: "List Codkesh projects and their current lifecycle state.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    path: "/api/v1/projects",
  },
  {
    name: "pipeline_action_center",
    description: "Read owner approvals, blockers, and other items requiring attention.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    path: "/api/v1/attention",
  },
] as const;

export async function callPipelineMcpTool(
  name: string,
  fetcher: typeof fetch = fetch,
  controlPlaneBaseUrl = "http://127.0.0.1:4312",
): Promise<{ content: readonly { type: "text"; text: string }[]; isError?: boolean }> {
  const tool = PIPELINE_MCP_TOOLS.find((candidate) => candidate.name === name);
  if (!tool) return mcpError("Unknown Codkesh tool.");
  const base = new URL(controlPlaneBaseUrl);
  if (base.protocol !== "http:" || !["127.0.0.1", "localhost", "::1"].includes(base.hostname)) {
    return mcpError("Codkesh MCP only connects to the local control plane.");
  }
  try {
    const response = await fetcher(new URL(tool.path, base), {
      method: "GET",
      headers: { Accept: "application/json" },
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return mcpError(`Codkesh returned ${response.status}.`);
    const text = await readBounded(response, 512_000);
    const value = JSON.parse(text) as unknown;
    return { content: [{ type: "text", text: JSON.stringify(redactSensitive(value), null, 2) }] };
  } catch {
    return mcpError("Codkesh is unavailable. Start the local control plane and retry.");
  }
}

function mcpError(text: string) {
  return { content: [{ type: "text" as const, text }], isError: true };
}

async function readBounded(response: Response, limit: number): Promise<string> {
  const text = await response.text();
  if (text.length > limit) throw new Error("Response too large.");
  return text;
}

function redactSensitive(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSensitive);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
    /(secret|token|credential|authorization|password|api.?key)/i.test(key)
      ? []
      : [[key, redactSensitive(child)]],
  ));
}
