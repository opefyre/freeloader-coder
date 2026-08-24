import assert from "node:assert/strict";
import test from "node:test";

import { evaluateQualityQuorum, type QualityReview } from "../packages/orchestration/src/quality-review.js";

const reviews: readonly QualityReview[] = [
  { reviewerId: "functional-1", providerId: "groq", role: "functional", verdict: "pass", findings: [] },
  { reviewerId: "design-1", providerId: "gemini", role: "design", verdict: "pass", findings: [] },
];

test("UI work requires functional and design roles with provider independence", () => {
  assert.equal(evaluateQualityQuorum({
    uiChanged: true, implementerProviderId: "cloudflare",
    deterministicValidationPassed: true, reviews,
  }).ready, true);
  assert.throws(() => evaluateQualityQuorum({
    uiChanged: true, implementerProviderId: "cloudflare",
    deterministicValidationPassed: true, reviews: reviews.slice(0, 1),
  }));
});

test("critical evidence-backed dissent blocks readiness", () => {
  const result = evaluateQualityQuorum({
    uiChanged: true, implementerProviderId: "cloudflare", deterministicValidationPassed: true,
    reviews: [reviews[0]!, {
      ...reviews[1]!, verdict: "fail",
      findings: [{
        id: "contrast", severity: "critical", evidenceRef: "screenshots/mobile.png",
        confidence: 0.98, acceptanceCriterion: "AC1", recommendedRepair: "Restore visible focus.",
      }],
    }],
  });
  assert.equal(result.ready, false);
  assert.equal(result.dissent, true);
});

test("a contradictory pass carrying a major finding cannot pass the gate", () => {
  const result = evaluateQualityQuorum({
    uiChanged: true, implementerProviderId: "cloudflare", deterministicValidationPassed: true,
    reviews: [reviews[0]!, {
      ...reviews[1]!, verdict: "pass",
      findings: [{
        id: "missing-crud", severity: "major", evidenceRef: "src/features/decisions.ts",
        confidence: 0.96, acceptanceCriterion: "Owner can complete every CRUD operation.",
        recommendedRepair: "Implement and wire the missing operations.",
      }],
    }],
  });
  assert.equal(result.verdict, "fail");
  assert.equal(result.ready, false);
});

test("provider agreement cannot override deterministic failure", () => {
  const result = evaluateQualityQuorum({
    uiChanged: true, implementerProviderId: "cloudflare",
    deterministicValidationPassed: false, reviews,
  });
  assert.equal(result.verdict, "fail");
  assert.equal(result.ready, false);
});
