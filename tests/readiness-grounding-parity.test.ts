import assert from "node:assert/strict";
import test from "node:test";
import { buildGroundingContract } from "../packages/orchestration/src/grounding.js";
import { validateTaskGraph } from "../packages/orchestration/src/readiness.js";

const limits = { maxUnits: 8, maxFilesPerUnit: 4 };

test("task graph accepts bounded acyclic work and preserves dependency order", () => {
  const graph = validateTaskGraph({
    units: [
      { id: "a", title: "Contract", files: ["packages/a.ts"], dependsOn: [] },
      { id: "b", title: "Consumer", files: ["packages/b.ts"], dependsOn: ["a"] }
    ]
  }, limits);
  assert.equal(graph.units.length, 2);
});

test("task graph rejects cycles, missing dependencies, unsafe paths, and unordered overlap", () => {
  assert.throws(() => validateTaskGraph({ units: [
    { id: "a", title: "A", files: ["a.ts"], dependsOn: ["b"] },
    { id: "b", title: "B", files: ["b.ts"], dependsOn: ["a"] }
  ] }, limits));
  assert.throws(() => validateTaskGraph({ units: [
    { id: "a", title: "A", files: ["a.ts"], dependsOn: ["missing"] }
  ] }, limits));
  assert.throws(() => validateTaskGraph({ units: [
    { id: "a", title: "A", files: ["../outside"], dependsOn: [] }
  ] }, limits));
  assert.throws(() => validateTaskGraph({ units: [
    { id: "a", title: "A", files: ["shared.ts"], dependsOn: [] },
    { id: "b", title: "B", files: ["shared.ts"], dependsOn: [] }
  ] }, limits));
});

test("grounding digest is deterministic regardless of input source order", () => {
  const input = {
    rules: ["Preserve evidence", "Keep changes bounded"],
    maxSourceBytes: 200,
    sources: [
      { path: "docs/b.md", content: "B" },
      { path: "docs/a.md", content: "A" }
    ]
  };
  const first = buildGroundingContract(input);
  const second = buildGroundingContract({ ...input, sources: [...input.sources].reverse() });
  assert.equal(first.sha256, second.sha256);
  assert.deepEqual(first.sources.map((source) => source.path), ["docs/a.md", "docs/b.md"]);
});

test("grounding rejects traversal, duplicate paths, empty rules, and oversized sources", () => {
  assert.throws(() => buildGroundingContract({
    sources: [{ path: "../private", content: "x" }],
    rules: ["bounded"],
    maxSourceBytes: 10
  }));
  assert.throws(() => buildGroundingContract({
    sources: [{ path: "a.md", content: "x" }, { path: "a.md", content: "y" }],
    rules: ["bounded"],
    maxSourceBytes: 10
  }));
  assert.throws(() => buildGroundingContract({
    sources: [{ path: "a.md", content: "x" }],
    rules: [],
    maxSourceBytes: 10
  }));
  assert.throws(() => buildGroundingContract({
    sources: [{ path: "a.md", content: "too large" }],
    rules: ["bounded"],
    maxSourceBytes: 2
  }));
});
