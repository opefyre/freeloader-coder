import assert from "node:assert/strict";
import test from "node:test";

import { withDiscoveryEvidence } from "../packages/runtime/src/integration-connections.js";

const connection = (overrides: Record<string, unknown> = {}) => ({
  schemaVersion: 1,
  provider: "github",
  state: "ready",
  accountLabel: "owner",
  authMethod: "github_device_oauth",
  observedAt: 1_000,
  resources: [{ id: "R1", kind: "github_repository", label: "owner/repo", url: "https://github.com/owner/repo", detail: "Private repository" }],
  nextAction: "Choose repositories inside a project.",
  ...overrides,
});

test("discovery evidence distinguishes live, cached, stale, empty, permission, and failure states", () => {
  const live = withDiscoveryEvidence({ schemaVersion: 1, provenance: "local_observation", observedAt: 1_000, connections: [connection()] }, "live_probe", 1_001);
  assert.deepEqual(live.connections[0]?.discovery, { source: "live_probe", freshness: "current", freshUntil: 301_000, result: "available", recovery: { action: "none", label: "Ready" } });
  const stale = withDiscoveryEvidence({ schemaVersion: 1, provenance: "local_observation", observedAt: 1_000, connections: [connection()] }, "cached_metadata", 301_001);
  assert.equal(stale.connections[0]?.discovery?.freshness, "stale");
  assert.equal(stale.connections[0]?.discovery?.source, "cached_metadata");
  const empty = withDiscoveryEvidence({ schemaVersion: 1, provenance: "local_observation", observedAt: 1_000, connections: [connection({ resources: [], nextAction: "No repositories are available." })] }, "live_probe", 1_001);
  assert.equal(empty.connections[0]?.discovery?.result, "empty");
  assert.equal(empty.connections[0]?.discovery?.recovery.action, "retry");
  const denied = withDiscoveryEvidence({ schemaVersion: 1, provenance: "local_observation", observedAt: 1_000, connections: [connection({ state: "unavailable", resources: [], nextAction: "Grant repository access and reconnect." })] }, "live_probe", 1_001);
  assert.equal(denied.connections[0]?.discovery?.result, "permission_required");
  assert.deepEqual(denied.connections[0]?.discovery?.recovery, { action: "manage_access", label: "Review access" });
  const failed = withDiscoveryEvidence({ schemaVersion: 1, provenance: "local_observation", observedAt: 1_000, connections: [connection({ state: "failed", resources: [], nextAction: "Provider is temporarily unavailable." })] }, "live_probe", 1_001);
  assert.equal(failed.connections[0]?.discovery?.result, "unavailable");
  assert.equal(failed.connections[0]?.discovery?.recovery.action, "retry");
  assert.doesNotMatch(JSON.stringify(failed), /token|credential|secret/i);
});

test("malformed or secret-bearing discovery metadata fails closed", () => {
  assert.throws(() => withDiscoveryEvidence({ schemaVersion: 1, provenance: "local_observation", observedAt: 1_000, connections: [{ ...connection(), accessToken: "secret" }] }, "live_probe", 1_001));
  assert.throws(() => withDiscoveryEvidence({ schemaVersion: 1, provenance: "local_observation", observedAt: 1_000, connections: [connection({ resources: [{ id: "R1", kind: "github_repository", label: "repo", url: "file:///secret", detail: "bad" }] })] }, "live_probe", 1_001));
});
