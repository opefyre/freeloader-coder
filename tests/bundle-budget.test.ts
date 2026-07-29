import assert from "node:assert/strict";
import test from "node:test";

import {
  assessBundleBudgets,
  studioBundleBudgets,
  type BundleAsset,
} from "../packages/releases/src/bundle-budget.js";

const passing: BundleAsset[] = [
  { file: "index.js", bytes: 390_410, kind: "entry" },
  { file: "react-runtime.js", bytes: 189_640, kind: "shared" },
  { file: "integration-workbench.js", bytes: 58_030, kind: "feature" },
];

test("verified Sprint 22 topology passes explicit budgets", () => {
  const result = assessBundleBudgets(passing);
  assert.equal(result.passed, true);
  assert.deepEqual(result.failures, []);
  assert.deepEqual(studioBundleBudgets, {
    entry: 450_000,
    shared: 210_000,
    feature: 75_000,
  });
});

test("entry, shared, and feature regressions fail with named measurements", () => {
  const result = assessBundleBudgets([
    { file: "index.js", bytes: 450_001, kind: "entry" },
    { file: "react-runtime.js", bytes: 210_001, kind: "shared" },
    { file: "workspace.js", bytes: 75_001, kind: "feature" },
  ]);
  assert.equal(result.passed, false);
  assert.deepEqual(result.failures, [
    "index.js: entry chunk is 450001 bytes; limit is 450000.",
    "react-runtime.js: shared chunk is 210001 bytes; limit is 210000.",
    "workspace.js: feature chunk is 75001 bytes; limit is 75000.",
  ]);
});

test("missing entry and invalid measurements fail closed", () => {
  assert.deepEqual(
    assessBundleBudgets([
      { file: "feature.js", bytes: 0, kind: "feature" },
    ]).failures,
    [
      "Expected exactly one entry chunk; observed 0.",
      "feature.js: byte measurement is invalid.",
    ]
  );
});
