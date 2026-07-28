import { z } from "zod";

import {
  toolDefinitionSchema,
  type ToolDefinition,
  type ToolEffect
} from "./registry.js";

export const mcpTransportSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("stdio"),
    executableId: z.string().regex(/^[a-z][a-z0-9._-]+$/),
    arguments: z.array(z.string().max(300)).max(30)
  }),
  z.strictObject({
    kind: z.literal("https"),
    url: z.url().refine((value) => value.startsWith("https://"), "Remote MCP requires HTTPS."),
    pinnedHost: z.hostname()
  })
]);

export const mcpServerSchema = z.strictObject({
  schemaVersion: z.literal(1),
  id: z.string().regex(/^[a-z][a-z0-9._-]{2,127}$/),
  title: z.string().trim().min(1).max(120),
  transport: mcpTransportSchema,
  environmentReferences: z.array(z.string().regex(/^vault:[a-z0-9._-]+$/)).max(20),
  allowedHosts: z.array(z.hostname()).max(30),
  timeoutMs: z.number().int().min(1_000).max(120_000),
  retryLimit: z.number().int().min(0).max(3)
});

export type McpServer = z.infer<typeof mcpServerSchema>;
export type McpLifecycleState =
  | "discovered"
  | "quarantined"
  | "approved"
  | "connected"
  | "degraded"
  | "revoked"
  | "removed";

export interface McpSession {
  readonly server: McpServer;
  readonly projectId: string;
  readonly state: McpLifecycleState;
  readonly tools: readonly ToolDefinition[];
  readonly approvedToolIds: readonly string[];
  readonly lastUsedAt: number | null;
  readonly failureCount: number;
  readonly configurationStored: boolean;
}

export function discoverMcpServer(input: {
  readonly server: unknown;
  readonly projectId: string;
  readonly tools: readonly unknown[];
}): McpSession {
  const server = mcpServerSchema.parse(input.server);
  const tools = input.tools.map((tool) => toolDefinitionSchema.parse(tool));
  return {
    server,
    projectId: input.projectId,
    state: "quarantined",
    tools,
    approvedToolIds: [],
    lastUsedAt: null,
    failureCount: 0,
    configurationStored: true
  };
}

export function approveMcpTools(input: {
  readonly session: McpSession;
  readonly toolIds: readonly string[];
  readonly approvedEffects: readonly ToolEffect[];
  readonly riskAcknowledged: boolean;
}): McpSession {
  if (input.session.state !== "quarantined") throw new Error("Only quarantined discovery can be reviewed.");
  const selected = input.session.tools.filter((tool) => input.toolIds.includes(tool.id));
  if (selected.length !== input.toolIds.length) throw new Error("Unknown discovered tool.");
  if (
    selected.some((tool) => tool.origin === "unverified")
    && !input.riskAcknowledged
  ) {
    throw new Error("Unverified tools require explicit risk acknowledgement.");
  }
  if (selected.some((tool) => tool.effects.some((effect) => !input.approvedEffects.includes(effect)))) {
    throw new Error("Requested tool effects exceed approval.");
  }
  return { ...input.session, state: "approved", approvedToolIds: [...input.toolIds] };
}

export function connectMcp(session: McpSession): McpSession {
  if (session.state !== "approved" && session.state !== "degraded") {
    throw new Error("MCP server must be approved before connection.");
  }
  return { ...session, state: "connected", failureCount: 0 };
}

export function recordMcpFailure(input: {
  readonly session: McpSession;
  readonly activeCanonicalWrite: boolean;
}): McpSession {
  if (input.activeCanonicalWrite) {
    throw new Error("MCP failure cannot transition canonical task state.");
  }
  const failureCount = input.session.failureCount + 1;
  return {
    ...input.session,
    state: failureCount > input.session.server.retryLimit ? "quarantined" : "degraded",
    failureCount
  };
}

export function revokeMcp(session: McpSession): McpSession {
  if (session.state === "removed") throw new Error("Removed configuration cannot be revoked.");
  return { ...session, state: "revoked", approvedToolIds: [] };
}

export function removeMcp(session: McpSession): McpSession {
  return {
    ...session,
    state: "removed",
    approvedToolIds: [],
    configurationStored: false
  };
}
