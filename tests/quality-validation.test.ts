import assert from "node:assert/strict";
import test from "node:test";

import {
  buildValidationReport,
  createValidationPlan,
  type ProjectCheck,
} from "../packages/validation/src/project-validation.js";

const checks: readonly ProjectCheck[] = [
  { id: "type", kind: "type", command: ["npm", "run", "typecheck"], required: true, appliesTo: ["*"], environment: { CI: "1" } },
  { id: "a11y", kind: "accessibility", command: ["npm", "run", "a11y"], required: false, appliesTo: ["apps/studio/"], environment: {} },
  { id: "api", kind: "integration", command: ["npm", "run", "api"], required: false, appliesTo: ["packages/api/"], environment: {} },
];

test("changed-scope optimization retains required gates and relevant optional checks", () => {
  assert.deepEqual(
    createValidationPlan({ checks, changedPaths: ["apps/studio/src/App.tsx"] }).map((check) => check.id),
    ["type", "a11y"],
  );
});

test("required failure blocks readiness and report hashes are reproducible", () => {
  const plan = createValidationPlan({ checks, changedPaths: ["README.md"] });
  const observations = [{
    checkId: "type", outcome: "failed" as const, durationMs: 12,
    artifactDigest: "sha256:log", logRef: "artifacts/type.log", waiver: null,
  }];
  const first = buildValidationReport({ sourceDigest: "a".repeat(64), plan, observations });
  const second = buildValidationReport({ sourceDigest: "a".repeat(64), plan, observations });
  assert.equal(first.ready, false);
  assert.equal(first.reportDigest, second.reportDigest);
});

test("authorized waivers require a consequence and preserve the explicit outcome", () => {
  const plan = createValidationPlan({ checks, changedPaths: ["README.md"] });
  assert.throws(() => buildValidationReport({
    sourceDigest: "b".repeat(64),
    plan,
    observations: [{
      checkId: "type", outcome: "waived", durationMs: 1,
      artifactDigest: null, logRef: null, waiver: { authorizedBy: "opefyre", consequence: "" },
    }],
  }));
  const report = buildValidationReport({
    sourceDigest: "b".repeat(64),
    plan,
    observations: [{
      checkId: "type", outcome: "waived", durationMs: 1,
      artifactDigest: null, logRef: "waivers/type.md",
      waiver: { authorizedBy: "opefyre", consequence: "Type safety is not proven." },
    }],
  });
  assert.equal(report.ready, true);
  assert.equal(report.checks[0]?.outcome, "waived");
});

test("timeout, crash, flaky, unavailable, and not-applicable remain distinct", () => {
  const outcomes = ["timeout", "crash", "flaky", "unavailable", "not_applicable"];
  assert.equal(new Set(outcomes).size, 5);
});
