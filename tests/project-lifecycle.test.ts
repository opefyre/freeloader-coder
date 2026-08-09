import assert from "node:assert/strict";
import test from "node:test";

import {
  advanceProjectLifecycle,
  createProjectLifecycle,
} from "../packages/orchestration/src/project-lifecycle.js";

const digest = (character: string) => character.repeat(64);
const artifact = (kind: "context" | "solution" | "backlog", character: string) => ({
  kind,
  projectRelativePath: ({
    context: ".pipeline/CONTEXT.md",
    solution: ".pipeline/SOLUTION.md",
    backlog: ".pipeline/BACKLOG.md",
  } as const)[kind],
  digest: digest(character),
  revision: 1,
  createdAt: 20,
  citations: ["local://README.md"],
  reviewerIds: ["reviewer-context"],
  qaPassed: true,
});

test("major project lifecycle enforces context, approval, backlog QA, and delivery gates", () => {
  let record = createProjectLifecycle({
    projectId: "project_0123456789abcdef",
    mission: "Create a complete team operations application.",
    now: 10,
  });
  record = advanceProjectLifecycle(record, { type: "begin_context_review" }, 11);
  record = advanceProjectLifecycle(record, { type: "context_completed", artifact: artifact("context", "a"), questions: [] }, 20);
  record = advanceProjectLifecycle(record, {
    type: "scope_assessed",
    assessment: {
      classification: "new_product",
      rationale: ["Multiple user journeys and services are required."],
      affectedDomains: ["product", "frontend", "backend", "operations"],
      estimatedDeveloperHours: 800,
      requiresArchitectureDecision: true,
      confidence: 0.94,
    },
  }, 30);
  assert.equal(record.stage, "solution_design");
  record = advanceProjectLifecycle(record, { type: "design_completed", artifact: artifact("solution", "b") }, 40);
  assert.equal(record.stage, "awaiting_design_approval");
  const revisionRequested = advanceProjectLifecycle(record, { type: "design_revision_requested", artifactDigest: digest("b"), feedback: "Clarify the rollout rollback boundary." }, 41);
  assert.equal(revisionRequested.stage, "solution_design");
  assert.equal(revisionRequested.designFeedback[0]?.artifactDigest, digest("b"));
  assert.throws(() => advanceProjectLifecycle(record, { type: "design_approved", artifactDigest: digest("c") }, 41));
  record = advanceProjectLifecycle(record, { type: "design_approved", artifactDigest: digest("b") }, 42);
  record = advanceProjectLifecycle(record, { type: "backlog_completed", artifact: artifact("backlog", "c"), jiraEpicId: "10001" }, 50);
  record = advanceProjectLifecycle(record, { type: "backlog_qa_passed", artifactDigest: digest("c") }, 60);
  assert.equal(record.stage, "delivery");
  record = advanceProjectLifecycle(record, { type: "delivery_completed" }, 70);
  assert.equal(record.stage, "complete");
});

test("small changes stop at the major-work guardrail", () => {
  let record = createProjectLifecycle({ projectId: "project_0123456789abcdef", mission: "Change one label.", now: 1 });
  record = advanceProjectLifecycle(record, { type: "begin_context_review" }, 2);
  record = advanceProjectLifecycle(record, { type: "context_completed", artifact: artifact("context", "a"), questions: [] }, 3);
  record = advanceProjectLifecycle(record, {
    type: "scope_assessed",
    assessment: {
      classification: "small_change",
      rationale: ["One isolated copy edit."],
      affectedDomains: ["frontend"],
      estimatedDeveloperHours: 0.25,
      requiresArchitectureDecision: false,
      confidence: 0.99,
    },
  }, 4);
  assert.equal(record.stage, "cancelled");
  assert.match(record.blockedReason ?? "", /major-work threshold/);
});

test("unclear scope cannot block without a selectable owner question", () => {
  let record = createProjectLifecycle({ projectId: "project_0123456789abcdef", mission: "Improve the product.", now: 1 });
  record = advanceProjectLifecycle(record, { type: "begin_context_review" }, 2);
  record = advanceProjectLifecycle(record, { type: "context_completed", artifact: artifact("context", "a"), questions: [] }, 3);
  const assessment = { classification: "unclear" as const, rationale: ["The requested outcome is ambiguous."], affectedDomains: [], estimatedDeveloperHours: 0, requiresArchitectureDecision: false, confidence: 0.4 };
  assert.throws(() => advanceProjectLifecycle(record, { type: "scope_assessed", assessment }, 4), /selectable owner clarification/);
  record = advanceProjectLifecycle(record, { type: "scope_assessed", assessment, questions: [{ id: "question_0123456789abcdef", prompt: "How substantial is this outcome?", whyItMatters: "This decides whether the autonomous product lifecycle should run.", options: [{ id: "major", label: "Major feature", consequence: "Continue through design and delivery." }, { id: "small", label: "Small change", consequence: "Stop this lifecycle." }], allowsCustomAnswer: true, sourceFindingIds: ["scope"] }] }, 5);
  assert.equal(record.stage, "clarification");
  assert.equal(record.questions.length, 1);
});

test("owner questions require selectable options", () => {
  let record = createProjectLifecycle({ projectId: "project_0123456789abcdef", mission: "Build a new customer portal.", now: 1 });
  record = advanceProjectLifecycle(record, { type: "begin_context_review" }, 2);
  assert.throws(() => advanceProjectLifecycle(record, {
    type: "context_completed",
    artifact: artifact("context", "a"),
    questions: [{
      id: "question_0123456789abcdef",
      prompt: "Who can create accounts?",
      whyItMatters: "This changes identity and onboarding architecture.",
      options: [{ id: "invite", label: "Invite only", consequence: "Admins control access." }],
      allowsCustomAnswer: true,
      sourceFindingIds: ["identity-gap"],
    }],
  }, 3));
});

test("clarification answers are complete, selectable, canonical, and audit-preserving", () => {
  let record = createProjectLifecycle({ projectId: "project_0123456789abcdef", mission: "Build a new customer portal.", now: 1 });
  record = advanceProjectLifecycle(record, { type: "begin_context_review" }, 2);
  record = advanceProjectLifecycle(record, {
    type: "context_completed",
    artifact: artifact("context", "a"),
    questions: [{
      id: "question_0123456789abcdef",
      prompt: "Who can create accounts?",
      whyItMatters: "This changes identity and onboarding architecture.",
      options: [
        { id: "invite", label: "Invite only", consequence: "Admins control access." },
        { id: "public", label: "Public signup", consequence: "Anyone can register." },
      ],
      allowsCustomAnswer: false,
      sourceFindingIds: ["identity-gap"],
    }],
  }, 3);
  assert.throws(() => advanceProjectLifecycle(record, { type: "clarifications_resolved", answers: [] }, 4), /Every blocking/);
  assert.throws(() => advanceProjectLifecycle(record, {
    type: "clarifications_resolved",
    answers: [{ questionId: "question_0123456789abcdef", optionId: "unknown", customAnswer: null, answeredAt: 4 }],
  }, 4), /unknown option/);
  record = advanceProjectLifecycle(record, {
    type: "clarifications_resolved",
    answers: [{ questionId: "question_0123456789abcdef", optionId: "invite", customAnswer: null, answeredAt: 5 }],
  }, 5);
  assert.equal(record.stage, "context_review");
  assert.equal(record.questions.length, 0);
  assert.deepEqual(record.answers, [{ questionId: "question_0123456789abcdef", optionId: "invite", customAnswer: null, answeredAt: 5 }]);
});
