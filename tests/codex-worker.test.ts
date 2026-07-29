import assert from "node:assert/strict";
import test from "node:test";

import {
  disconnectedCodexWorker,
  planCodexWork,
  codexWorkerConnectionSchema,
} from "../packages/execution/src/index.js";

test("Codex worker remains disabled until Codex login is explicitly connected", () => {
  const result = planCodexWork({
    connection: disconnectedCodexWorker,
    workId: "work-1",
    sandbox: "workspace_write",
    allowedTools: ["shell"],
    requiredValidations: ["typecheck", "test"],
    requiredReviews: ["functional", "security"],
  });
  assert.equal(result.allowed, false);
});

test("Codex plan preserves sandbox, approvals, validation, and independent review", () => {
  const result = planCodexWork({
    connection: { ...disconnectedCodexWorker, state: "ready" },
    workId: "work-1",
    sandbox: "workspace_write",
    allowedTools: ["shell"],
    requiredValidations: ["typecheck", "test"],
    requiredReviews: ["functional", "security"],
  });
  assert.equal(result.allowed, true);
  if (result.allowed) {
    assert.equal(result.plan.approvalPolicy, "on_request");
    assert.equal(result.plan.localEvidenceRequired, true);
    assert.equal(result.plan.completionIsUnverified, true);
  }
});

test("Codex connection rejects copied sessions and undocumented credentials", () => {
  assert.throws(() =>
    codexWorkerConnectionSchema.parse({
      ...disconnectedCodexWorker,
      copiedBrowserSession: true,
    })
  );
});
