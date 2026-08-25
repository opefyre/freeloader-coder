import assert from "node:assert/strict";
import test from "node:test";

import { createControlPlaneServer } from "../apps/core/src/control-plane.js";
import {
  approveOwnerPilotImprovements,
  declineOwnerPilotImprovements,
  editOwnerPilotImprovements,
  listOwnerPilotImprovements,
  previewOwnerPilotImprovements,
} from "../apps/studio/src/owner-journey-certification-client.js";

const now = 1_800_000_000_000;
const id = `improvement_draft_${"a".repeat(20)}`;
const improvement = {
  id: `improvement_${"b".repeat(20)}`,
  category: "clarity" as const,
  title: "Improve clarity",
  problem: "Repeated clarity friction.",
  recommendation: "Show one bounded decision.",
  evidenceCount: 3,
  priority: "high" as const,
  estimatedSize: "small" as const,
  dependencies: [],
  acceptanceCriteria: ["Three sessions pass.", "One action is obvious."],
  evidenceDigest: "c".repeat(64),
};
const base = {
  schemaVersion: 1 as const,
  id,
  projectId: `project_${"d".repeat(16)}`,
  revision: 1,
  state: "pending" as const,
  reviewDigest: "e".repeat(64),
  previewDigest: "f".repeat(64),
  improvements: [improvement],
  jiraProjectKey: "PIPE",
  createdAt: now,
  updatedAt: now,
  declinedAt: null,
  completedAt: null,
  receipts: [],
  lastError: null,
  automaticSpendLimitUsd: 0 as const,
};

test("owner pilot improvement API exposes preview, edit, exact decisions, and method safety", async () => {
  const actions: string[] = [];
  const keys: string[] = [];
  const server = createControlPlaneServer({
    host: "127.0.0.1",
    port: 0,
    allowedOrigins: ["http://127.0.0.1:4310"],
    health: () => ({ schemaVersion: 1, instanceId: "0f86b913-7600-4c6f-a102-2fc6e4250c6f", status: "ready", observedAt: now, uptimeSeconds: 1 }),
    snapshot: () => ({ schemaVersion: 1, instanceId: "0f86b913-7600-4c6f-a102-2fc6e4250c6f", provenance: "local_observation", featureDataMode: "synthetic_fixture", observedAt: now, validForMs: 15_000, setup: { state: "ready", requiredChecksReady: 1, requiredChecksTotal: 1 }, services: [] }),
    ownerPilotImprovements: {
      list: () => ({ schemaVersion: 1, provenance: "local_owner_approved_improvement_handoff", drafts: [base], automaticSpendLimitUsd: 0 }),
      preview: (_input, key) => { keys.push(key); actions.push("preview"); return base; },
      edit: () => { actions.push("edit"); return { ...base, revision: 2 }; },
      approve: () => { actions.push("approve"); return { ...base, revision: 2, state: "completed" as const, completedAt: now + 1 }; },
      decline: () => { actions.push("decline"); return { ...base, revision: 2, state: "declined" as const, declinedAt: now + 1 }; },
    },
  });
  const port = await server.listen();
  const endpoint = `http://127.0.0.1:${port}`;
  try {
    assert.equal((await listOwnerPilotImprovements(endpoint)).drafts.length, 1);
    await previewOwnerPilotImprovements(endpoint, { projectId: base.projectId, expectedReviewDigest: base.reviewDigest }, "improvement.client.0001");
    assert.deepEqual(keys, ["improvement.client.0001"]);
    assert.equal((await editOwnerPilotImprovements(endpoint, id, { expectedRevision: 1, improvements: [improvement] })).revision, 2);
    assert.equal((await approveOwnerPilotImprovements(endpoint, id, { expectedRevision: 1, expectedPreviewDigest: base.previewDigest })).state, "completed");
    assert.equal((await declineOwnerPilotImprovements(endpoint, id, { expectedRevision: 1, expectedPreviewDigest: base.previewDigest })).state, "declined");
    assert.deepEqual(actions, ["preview", "edit", "approve", "decline"]);
    assert.equal((await fetch(`${endpoint}/api/v1/owner-pilot/improvements`, { method: "DELETE" })).status, 405);
    assert.equal((await fetch(`${endpoint}/api/v1/owner-pilot/improvements/${id}/approve`, { method: "GET" })).status, 405);
  } finally {
    await server.close();
  }
});
