import assert from "node:assert/strict";
import test from "node:test";

import {
  approveMcpTools,
  connectMcp,
  createExtensionHarness,
  discoverMcpServer,
  recordMcpFailure,
  removeMcp,
  revokeMcp,
  validateExtension,
  type ExtensionManifest,
  type ToolDefinition
} from "../packages/tools/src/index.js";

const tool: ToolDefinition = {
  schemaVersion: 1,
  id: "community.search",
  version: "1.0.0",
  title: "Community search",
  description: "Search approved documentation.",
  origin: "unverified",
  publisher: "Local contributor",
  sourceUrl: "https://example.com/search",
  signature: `sha256:${"b".repeat(64)}`,
  inputSchema: { type: "object", required: ["query"] },
  outputSchema: { type: "object", required: ["results"] },
  capabilities: ["docs.read"],
  effects: ["read_network"],
  reversible: true,
  idempotent: true,
  timeoutMs: 10_000,
  retryLimit: 1,
  compensation: "No persistent effect to compensate.",
  postcondition: "A bounded result receipt is present.",
  evidence: "Store result count and endpoint class.",
  redaction: "Remove query content from analytics.",
  compatibility: { core: "^1.0.0", platforms: ["darwin-arm64"] }
};

test("MCP discovery always quarantines and requires explicit effects review", () => {
  const session = discoverMcpServer({
    projectId: "project-1",
    server: {
      schemaVersion: 1,
      id: "local.docs",
      title: "Local docs MCP",
      transport: { kind: "stdio", executableId: "docs-mcp", arguments: ["--safe"] },
      environmentReferences: [],
      allowedHosts: [],
      timeoutMs: 10_000,
      retryLimit: 1
    },
    tools: [tool]
  });
  assert.equal(session.state, "quarantined");
  assert.throws(
    () => approveMcpTools({
      session,
      toolIds: [tool.id],
      approvedEffects: ["read_network"],
      riskAcknowledged: false
    }),
    /risk acknowledgement/
  );
  const approved = approveMcpTools({
    session,
    toolIds: [tool.id],
    approvedEffects: ["read_network"],
    riskAcknowledged: true
  });
  assert.equal(connectMcp(approved).state, "connected");
});

test("MCP failure stays outside canonical state and bounded retries quarantine", () => {
  const discovered = discoverMcpServer({
    projectId: "project-1",
    server: {
      schemaVersion: 1,
      id: "remote.docs",
      title: "Remote docs MCP",
      transport: { kind: "https", url: "https://mcp.example.com", pinnedHost: "mcp.example.com" },
      environmentReferences: ["vault:mcp.docs"],
      allowedHosts: ["mcp.example.com"],
      timeoutMs: 10_000,
      retryLimit: 1
    },
    tools: [tool]
  });
  assert.throws(
    () => recordMcpFailure({ session: discovered, activeCanonicalWrite: true }),
    /canonical/
  );
  const degraded = recordMcpFailure({ session: discovered, activeCanonicalWrite: false });
  assert.equal(degraded.state, "degraded");
  assert.equal(recordMcpFailure({ session: degraded, activeCanonicalWrite: false }).state, "quarantined");
  assert.equal(revokeMcp(degraded).approvedToolIds.length, 0);
  assert.equal(removeMcp(degraded).configurationStored, false);
});

function manifest(overrides: Partial<ExtensionManifest> = {}): ExtensionManifest {
  return {
    schemaVersion: 1,
    id: "studio.example",
    version: "1.0.0",
    kind: "tool",
    title: "Example extension",
    publisher: "Pipeline Studio",
    sourceUrl: "https://example.com/extension",
    signature: `sha256:${"c".repeat(64)}`,
    coreCompatibility: "^1.0.0",
    permissions: ["docs.read"],
    externalServices: ["example.com"],
    dataUse: "Synthetic fixtures only.",
    costPolicy: "free_only",
    support: "official",
    tools: [tool],
    migrations: [],
    ...overrides
  };
}

test("extension SDK checks compatibility, permission expansion, and removal", () => {
  const current = manifest();
  const valid = validateExtension({ manifest: current, coreVersion: "1.4.0", previous: null });
  assert.equal(valid.compatibility.compatible, true);
  const expanded = validateExtension({
    manifest: manifest({ version: "1.1.0", permissions: ["docs.read", "project.write"] }),
    coreVersion: "1.4.0",
    previous: current
  });
  assert.equal(expanded.compatibility.requiresRenewedApproval, true);
  const breaking = validateExtension({
    manifest: manifest({ version: "2.0.0" }),
    coreVersion: "1.4.0",
    previous: current
  });
  assert.equal(breaking.compatibility.compatible, false);
  assert.match(breaking.compatibility.reasons[0] ?? "", /migration/);
  const harness = createExtensionHarness({ manifest: current, fixtures: { success: true } });
  assert.equal(harness.installable, true);
  assert.match(harness.removalPlan.join(" "), /Reconcile canonical effects/);
});
