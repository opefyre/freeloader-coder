import assert from "node:assert/strict";
import test from "node:test";

import { assessEligibility, assertDeliveryPlanningEligible, authorizeEligibilityOverride, type EligibilityEvidence } from "../packages/orchestration/src/eligibility-gate.js";

const base: EligibilityEvidence = { projectId: "project_0123456789abcdef", requestId: "request_0123456789abcdef0123", projectKind: "existing_product", affectedDomains: ["frontend"], deliveryStages: ["frontend"], estimatedDeveloperHours: 1, requiresArchitectureDecision: false, evidence: ["One isolated label change."], confidence: 0.98 };

test("new products, architectural features, and multi-stage work pass explicitly", () => {
  assert.equal(assessEligibility({ ...base, projectKind: "new_product" }).assessment.classification, "new_product");
  assert.equal(assessEligibility({ ...base, requiresArchitectureDecision: true }).assessment.classification, "major_feature");
  assert.equal(assessEligibility({ ...base, affectedDomains: ["frontend", "backend"], deliveryStages: ["product", "frontend", "qa"], estimatedDeveloperHours: 24 }).eligible, true);
});

test("trivial work is declined with alternatives and blocks Jira planning", () => {
  const decision = assessEligibility(base, 10);
  assert.equal(decision.assessment.classification, "small_change");
  assert.equal(decision.alternatives.length, 2);
  assert.throws(() => assertDeliveryPlanningEligible(decision), /Jira delivery planning/);
});

test("ambiguous boundary work fails closed and owner override is audited", () => {
  const unclear = assessEligibility({ ...base, projectKind: "unknown", confidence: 0.6 });
  assert.equal(unclear.assessment.classification, "unclear");
  assert.throws(() => authorizeEligibilityOverride(unclear, { authorizedBy: "owner", rationale: "too short", at: 20 }));
  const overridden = authorizeEligibilityOverride(unclear, { authorizedBy: "owner", rationale: "This is part of the approved product launch scope.", at: 20 });
  assert.equal(overridden.eligible, true);
  assert.equal(overridden.override?.authorizedBy, "owner");
  assert.equal(overridden.assessment.classification, "major_feature");
  assert.doesNotThrow(() => assertDeliveryPlanningEligible(overridden, { now: 20 }));
});

test("expired, cross-project, and superseded eligibility authority fail closed", () => {
  const decision = assessEligibility({ ...base, projectKind: "new_product" }, 100);
  assert.throws(() => assertDeliveryPlanningEligible(decision, { now: 200, validityMs: 99 }), /expired/);
  assert.doesNotThrow(() => assertDeliveryPlanningEligible(decision, { projectId: decision.projectId, assessment: decision.assessment, now: 200, validityMs: 99, allowExpiredIfAssessmentCurrent: true }));
  assert.throws(() => assertDeliveryPlanningEligible(decision, { projectId: decision.projectId, assessment: { ...decision.assessment, confidence: 0.5 }, now: 200, validityMs: 99, allowExpiredIfAssessmentCurrent: true }), /superseded/);
  assert.throws(() => assertDeliveryPlanningEligible(decision, { projectId: "project_fedcba9876543210", now: 100 }), /another project/);
  assert.throws(() => assertDeliveryPlanningEligible(decision, { requestId: "request_abcdef01234567890123", now: 100 }), /superseded/);
  assert.throws(() => assertDeliveryPlanningEligible(decision, { assessment: { ...decision.assessment, confidence: 0.5 }, now: 100 }), /superseded/);
});
