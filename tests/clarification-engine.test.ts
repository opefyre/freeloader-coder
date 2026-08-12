import assert from "node:assert/strict";
import test from "node:test";

import {
  buildClarificationPlan,
  type ClarificationFinding,
} from "../packages/orchestration/src/clarification-engine.js";

const finding = (
  overrides: Partial<ClarificationFinding>,
): ClarificationFinding => ({
  id: "identity-one",
  prompt: "Who can create accounts?",
  whyItMatters: "This changes identity and onboarding architecture.",
  material: true,
  priority: "high",
  options: [
    {
      id: "invite",
      label: "Invite only",
      consequence: "Admins control access.",
    },
    {
      id: "public",
      label: "Public signup",
      consequence: "Anyone can register.",
    },
  ],
  allowsCustomAnswer: true,
  recommendedDefault: null,
  ...overrides,
});

test("blocking findings are deduplicated, prioritized, bounded, and selectable", () => {
  const plan = buildClarificationPlan([
    finding({ id: "identity-two", prompt: " Who can create accounts ? " }),
    finding({}),
    finding({
      id: "region",
      prompt: "Which launch region is required?",
      priority: "critical",
    }),
    finding({ id: "billing", prompt: "Who owns billing?", priority: "normal" }),
    finding({
      id: "fourth",
      prompt: "Which audit policy applies?",
      priority: "normal",
    }),
  ]);
  assert.equal(plan.questions.length, 3);
  assert.equal(plan.questions[0]?.prompt, "Which launch region is required?");
  const identity = plan.questions.find(
    (question) => question.prompt === "Who can create accounts?",
  );
  assert.deepEqual(identity?.sourceFindingIds, [
    "identity-one",
    "identity-two",
  ]);
  assert.equal(identity?.options.length, 2);
});

test("semantic duplicates merge and retain recommendation, impact, and dependency evidence", () => {
  const plan = buildClarificationPlan([
    finding({
      id: "identity-one",
      prompt: "Who can create accounts?",
      recommendedDefault: "invite",
      affectedArtifacts: ["DESIGN.md", "CONTEXT.md"],
    }),
    finding({
      id: "identity-two",
      prompt: "Which users can create an account?",
      affectedArtifacts: ["INFRA.md"],
      dependsOnFindingIds: ["market"],
    }),
  ]);
  assert.equal(plan.questions.length, 1);
  assert.equal(plan.questions[0]?.recommendedOptionId, "invite");
  assert.deepEqual(plan.questions[0]?.affectedArtifacts, [
    "CONTEXT.md",
    "DESIGN.md",
    "INFRA.md",
  ]);
  assert.deepEqual(plan.questions[0]?.sourceFindingIds, [
    "identity-one",
    "identity-two",
  ]);
});

test("non-blocking uncertainty becomes an explicit assumption instead of an owner interruption", () => {
  const plan = buildClarificationPlan([
    finding({
      id: "copy-tone",
      prompt: "Which minor copy tone?",
      material: false,
      options: [],
      recommendedDefault: "Reuse the current product voice.",
    }),
  ]);
  assert.equal(plan.questions.length, 0);
  assert.deepEqual(plan.assumptions, [
    {
      sourceFindingIds: ["copy-tone"],
      value: "Reuse the current product voice.",
    },
  ]);
});

test("blocking findings without real choices and assumptions without defaults fail closed", () => {
  assert.throws(
    () => buildClarificationPlan([finding({ options: [] })]),
    /selectable options/,
  );
  assert.throws(
    () => buildClarificationPlan([finding({ recommendedDefault: "missing" })]),
    /offered option/,
  );
  assert.throws(
    () =>
      buildClarificationPlan([
        finding({
          options: [
            ...finding({}).options,
            { id: "invite", label: "Duplicate", consequence: "No." },
          ],
        }),
      ]),
    /distinguishable/,
  );
  assert.throws(
    () =>
      buildClarificationPlan([
        finding({ material: false, options: [], recommendedDefault: null }),
      ]),
    /recommended default/,
  );
});
