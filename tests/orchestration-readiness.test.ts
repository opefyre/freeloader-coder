import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyReadiness,
  editReadinessAssumption,
  type ReadinessInput
} from "../packages/orchestration/src/decision-policy.js";

const readyInput: ReadinessInput = {
  requestId: "request-1",
  unsafeReason: null,
  unsupportedReason: null,
  ambiguities: [],
  assumptions: []
};

test("equivalent readiness evidence produces stable classes and question order", () => {
  const ambiguities = [
    {
      id: "provider",
      kind: "provider" as const,
      material: true,
      question: "Connect a free provider?",
      recommendedDefault: "Use an existing free route.",
      consequence: "Implementation waits for model capacity."
    },
    {
      id: "target",
      kind: "product" as const,
      material: true,
      question: "Which screen should change?",
      recommendedDefault: null,
      consequence: "Choosing the wrong screen changes product behavior."
    }
  ];
  const first = classifyReadiness({ ...readyInput, ambiguities });
  const second = classifyReadiness({ ...readyInput, ambiguities: [...ambiguities].reverse() });
  assert.deepEqual(first, second);
  assert.equal(first.classification, "requires_external_setup");
  assert.deepEqual(first.questions.map((question) => question.id), ["target", "provider"]);
  assert.equal(first.implementerEligible, false);
});

test("unsafe, unsupported, external setup, information, assumptions, and ready are distinct", () => {
  assert.equal(classifyReadiness({ ...readyInput, unsafeReason: "unsafe" }).classification, "unsafe");
  assert.equal(classifyReadiness({ ...readyInput, unsupportedReason: "unsupported" }).classification, "unsupported");
  assert.equal(classifyReadiness({
    ...readyInput,
    ambiguities: [{
      id: "permission",
      kind: "permission",
      material: true,
      question: "Allow the selected repository?",
      recommendedDefault: null,
      consequence: "No project file can be read without permission."
    }]
  }).classification, "needs_information");
  assert.equal(classifyReadiness({
    ...readyInput,
    assumptions: [{ id: "style", value: "Reuse current styles.", source: "project rules" }]
  }).classification, "ready_with_assumptions");
  assert.equal(classifyReadiness(readyInput).classification, "ready");
});

test("users can edit assumptions but cannot bypass a material blocker", () => {
  const decision = classifyReadiness({
    ...readyInput,
    assumptions: [{ id: "scope", value: "Use the smallest reversible change.", source: "default" }]
  });
  const edited = editReadinessAssumption(decision, "scope", "Update both responsive layouts.");
  assert.equal(edited.assumptions[0]?.value, "Update both responsive layouts.");
  const blocked = classifyReadiness({
    ...readyInput,
    ambiguities: [{
      id: "choice",
      kind: "product",
      material: true,
      question: "Which behavior is correct?",
      recommendedDefault: null,
      consequence: "The alternatives are incompatible."
    }]
  });
  assert.throws(() => editReadinessAssumption(blocked, "choice", "Guess."));
});

test("non-material ambiguity requires a visible recommended default", () => {
  assert.throws(() => classifyReadiness({
    ...readyInput,
    ambiguities: [{
      id: "detail",
      kind: "product",
      material: false,
      question: "Which minor label?",
      recommendedDefault: null,
      consequence: "Only copy changes."
    }]
  }));
});
