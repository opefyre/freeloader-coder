import assert from "node:assert/strict";
import test from "node:test";
import { reconcileProjectContext } from "../apps/core/src/project-context-reconciler.js";
import type { ProjectContextAnalyzerResult } from "../apps/core/src/project-context-analyzers.js";

function result(facts: ProjectContextAnalyzerResult["facts"], sources: string[]): ProjectContextAnalyzerResult { return { analyzer: "source_architecture", status: "completed", facts, inferences: [], assumptions: [], unknowns: [], sources, failures: [] }; }

test("reconciliation deduplicates claims, keeps conflicts visible, and gives owner decisions provenance precedence", () => {
  const analyzerResults = [result([
    { key: "deployment_region", statement: "EU", source: "README.md" },
    { key: "deployment_region", statement: "EU", source: "README.md" },
    { key: "deployment_region", statement: "US", source: "package.json" },
    { key: "invented", statement: "Unsupported completion claim", source: "not-declared" },
  ], ["README.md", "package.json"])];
  const model = reconcileProjectContext({ analyzerResults, ownerDecisions: [{ key: "deployment_region", value: "Canada", source: "owner:decision-1" }], sourceDigests: { "README.md": "a".repeat(64), "package.json": "b".repeat(64) } });
  assert.equal(model.claims.find((claim) => claim.key === "deployment_region")?.value, "Canada");
  assert.equal(model.conflicts[0]?.resolution, "owner_decision");
  assert.equal(model.conflicts[0]?.alternatives.length, 2);
  assert.equal(model.excluded[0]?.value, "Unsupported completion claim");
});

test("changed source digests invalidate affected old claims and deterministic content keeps its digest", () => {
  const analyzerResults = [result([{ key: "runtime", statement: "Node 22", source: "package.json" }], ["package.json"])];
  const first = reconcileProjectContext({ analyzerResults, sourceDigests: { "package.json": "a".repeat(64) } });
  const same = reconcileProjectContext({ analyzerResults, sourceDigests: { "package.json": "a".repeat(64) }, previous: first });
  assert.equal(same.digest, first.digest); assert.equal(same.version, 1);
  const changed = reconcileProjectContext({ analyzerResults: [result([{ key: "runtime", statement: "Node 24", source: "package.json" }], ["package.json"])], sourceDigests: { "package.json": "b".repeat(64) }, previous: first });
  assert.equal(changed.version, 2);
  assert.deepEqual(changed.invalidated, [{ key: "runtime", source: "package.json", reason: "The cited source digest changed." }]);
  assert.notEqual(changed.digest, first.digest);
});
