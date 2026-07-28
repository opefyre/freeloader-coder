import assert from "node:assert/strict";
import test from "node:test";
import { buildSupportBundle, redactDiagnostic } from "../packages/control-center/src/diagnostics.js";

test("support bundle is opt-in, redacted, correlated, and source-free", () => {
  const bundle = buildSupportBundle({
    correlationId: "diag-20260728",
    checks: [{ id: "db", label: "Database", state: "healthy", detail: "Integrity passed", repair: null, rollback: null }],
    artifacts: [{ id: "log", kind: "log", content: "token=abc123 /Users/aboshifb/project", containsSourceCode: false }],
    selectedIds: ["log"],
  });
  assert.match(bundle.included[0]!.preview, /token=\[redacted\]/);
  assert.match(bundle.included[0]!.preview, /\/Users\/\[user\]/);
});

test("source code is excluded and secret forms are redacted", () => {
  assert.throws(() => buildSupportBundle({
    correlationId: "diag-source", checks: [],
    artifacts: [{ id: "source", kind: "log", content: "const secret = 1", containsSourceCode: true }],
    selectedIds: ["source"],
  }));
  const credential = ["sk", "abcdefghijklmnop"].join("-");
  assert.equal(redactDiagnostic(`api_key=hello ${credential}`), "api_key=[redacted] [redacted]");
});
