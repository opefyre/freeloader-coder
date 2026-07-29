import assert from "node:assert/strict";
import test from "node:test";

import {
  accessibilityGateSchema,
  evaluateAccessibility,
  type AccessibilityCheck,
  type AccessibilityGate,
} from "../packages/evals/src/index.js";

const dimensions: readonly AccessibilityCheck["dimension"][] = [
  "keyboard",
  "focus",
  "semantics",
  "contrast",
  "motion",
  "zoom",
  "reflow",
  "text_alternative",
];

const gate: AccessibilityGate = {
  schemaVersion: 1,
  candidateId: "candidate-0.8.0-beta.3",
  standard: "WCAG 2.2 AA",
  checks: dimensions.map((dimension) => ({
    schemaVersion: 1,
    id: `check-${dimension.replaceAll("_", "-")}`,
    label: `Required ${dimension.replaceAll("_", " ")} evidence`,
    dimension,
    method: dimension === "contrast" ? "automated" : "manual",
    severity: "critical",
    required: true,
    state: "passed",
    surfaces: ["Critical Studio workflow"],
    owner: "Accessibility reviewer",
    observedAt: "2026-07-29T08:00:00.000Z",
    reviewAfter: "2026-10-29T08:00:00.000Z",
    evidenceRef: `evidence://${dimension}/verified`,
    remediation: `Restore verified ${dimension} evidence.`,
  })),
  criticalWorkflows: ["Add project", "Approve plan", "Review evidence"],
  supportedZoomPercent: 200,
  generatedAt: "2026-07-29T08:00:00.000Z",
};

test("complete current accessibility evidence permits release", () => {
  const result = evaluateAccessibility(gate, "2026-07-29T08:00:00.000Z");
  assert.equal(result.releasable, true);
  assert.equal(result.passed, 8);
  assert.equal(result.required, 8);
  assert.deepEqual(result.missingDimensions, []);
});

test("one critical chart-alternative failure blocks release", () => {
  const broken = structuredClone(gate);
  broken.checks[7]!.state = "failed";
  broken.checks[7]!.evidenceRef = "fixture://chart-without-alternative";
  const result = evaluateAccessibility(
    broken,
    "2026-07-29T08:00:00.000Z"
  );
  assert.equal(result.releasable, false);
  assert.equal(result.criticalFailures.length, 1);
  assert.equal(result.criticalFailures[0]?.dimension, "text_alternative");
  assert.match(result.action, /restore verified/i);
});

test("not-run and stale required evidence both fail closed", () => {
  const broken = structuredClone(gate);
  broken.checks[0]!.state = "not_run";
  broken.checks[1]!.reviewAfter = "2026-07-01T00:00:00.000Z";
  const result = evaluateAccessibility(
    broken,
    "2026-07-29T08:00:00.000Z"
  );
  assert.equal(result.releasable, false);
  assert.equal(result.incomplete.length, 1);
  assert.equal(result.stale.length, 1);
});

test("a missing required dimension blocks release", () => {
  const broken = {
    ...gate,
    checks: gate.checks.filter(
      (check) => check.dimension !== "text_alternative"
    ),
  };
  assert.throws(() => accessibilityGateSchema.parse(broken));
});

test("accessibility contracts reject unknown fields and unsupported zoom", () => {
  assert.throws(() =>
    accessibilityGateSchema.parse({
      ...gate,
      supportedZoomPercent: 150,
      waiveCriticalFailure: true,
    })
  );
});
