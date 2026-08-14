import assert from "node:assert/strict";
import test from "node:test";

import { assertJiraClosureEligible, evaluateJiraClosure, JiraClosurePolicyError } from "../packages/orchestration/src/jira-closure-policy.js";

const digest = "a".repeat(64);
const observed = (criterionId: string, kind: "implementation" | "deterministic_test" | "independent_review" | "live_journey" | "commit" = "implementation") => ({ criterionId, kind, reference: `${kind}://PIPE-1/${criterionId}`, digest, observedAt: 100, provenance: "observed" as const, resolved: true });

function candidate() {
  return {
    issueKey: "PIPE-1", kind: "work_item" as const,
    acceptanceCriteria: [{ id: "AC-1", text: "The owner can complete the journey." }, { id: "AC-2", text: "The result remains accessible." }],
    evidence: [observed("AC-1"), observed("AC-2"), observed("AC-1", "commit"), observed("AC-2", "live_journey")],
    requiredValidationProfiles: ["unit", "build", "visual"], passedValidationProfiles: ["unit", "build", "visual"],
    reviewerIds: ["reviewer-functional", "reviewer-design"], implementerId: "worker-implementation",
    commitDigest: digest, liveJourneyRequired: true,
    closureComment: "Acceptance evidence, deterministic validation, review, commit, and live proof are attached.",
    children: [], priorTransitions: [{ from: "To Do", to: "In Progress", occurredAt: 50, evidenceDigest: digest }],
  };
}

test("complete observed criterion evidence permits Jira closure and preserves history", () => {
  const input = candidate();
  assert.equal(evaluateJiraClosure(input).eligible, true);
  assert.deepEqual(assertJiraClosureEligible(input).priorTransitions, input.priorTransitions);
});

test("fixture-only evidence, missing tests, review, commit, live proof, and comment all block Done", () => {
  const input = candidate();
  const decision = evaluateJiraClosure({ ...input, evidence: input.evidence.map((item) => ({ ...item, provenance: "fixture" as const })), passedValidationProfiles: ["unit"], reviewerIds: ["worker-implementation"], commitDigest: null, closureComment: null });
  assert.equal(decision.eligible, false);
  assert.match(decision.blockers.join(" "), /AC-1.*AC-2.*build.*visual.*independent.*commit.*live journey.*closure comment.*Fixture-only/is);
  assert.throws(() => assertJiraClosureEligible({ ...input, evidence: [] }), JiraClosurePolicyError);
});

test("parent closure fails while any required child lacks Done proof", () => {
  const input = candidate();
  const decision = evaluateJiraClosure({ ...input, kind: "parent", children: [{ issueKey: "PIPE-2", done: true, proofComplete: true }, { issueKey: "PIPE-3", done: true, proofComplete: false }, { issueKey: "PIPE-4", done: false, proofComplete: false }] });
  assert.equal(decision.eligible, false);
  assert.match(decision.blockers.join(" "), /PIPE-3.*PIPE-4/s);
  assert.deepEqual(decision.preservedHistory, input.priorTransitions);
});

test("unresolved evidence links and implementer self-review cannot satisfy closure", () => {
  const input = candidate();
  const evidence = input.evidence.map((item) => ({ ...item, resolved: false }));
  const decision = evaluateJiraClosure({ ...input, evidence, reviewerIds: ["worker-implementation", "reviewer-functional"] });
  assert.equal(decision.eligible, false);
  assert.match(decision.blockers.join(" "), /resolved observed evidence.*Two independent reviewers.*commit.*live journey/is);
});
