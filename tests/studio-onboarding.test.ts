import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  detectedProject,
  nextOnboardingStage,
  onboardingProgress,
  onboardingStages,
  safeOnboardingEvent,
  starterPlan
} from "../apps/studio/src/onboarding-fixture.js";

test("Studio onboarding covers the complete five-stage guided journey", () => {
  assert.deepEqual(
    onboardingStages.map((stage) => stage.id),
    ["select", "analyze", "plan", "preview", "decision"]
  );
  assert.equal(nextOnboardingStage("select"), "analyze");
  assert.equal(nextOnboardingStage("preview"), "decision");
  assert.equal(onboardingProgress("select"), 20);
  assert.equal(onboardingProgress("decision"), 100);
});

test("detected project separates facts, inferences, assumptions, and decisions", () => {
  assert.ok(detectedProject.facts.length > 0);
  assert.ok(detectedProject.inferences.length > 0);
  assert.ok(detectedProject.assumptions.length > 0);
  assert.ok(detectedProject.userDecisions.length > 0);
  assert.ok(detectedProject.protectedPaths.includes(".env"));
});

test("starter plan is under ten minutes and covers effects, evidence, free use, and undo", () => {
  assert.ok(starterPlan.expectedMinutes < 10);
  assert.match(starterPlan.providerPosture, /Free models are selected automatically/);
  assert.match(starterPlan.providerPosture, /stops before any paid route/);
  assert.ok(starterPlan.effects.length > 0);
  assert.ok(starterPlan.evidence.length > 0);
  assert.match(starterPlan.undo, /exact pre-run checkpoint/);
  assert.ok(starterPlan.advancedOperations.length >= 4);
});

test("privacy-safe onboarding events contain stage and class but no project content", () => {
  const event = safeOnboardingEvent({
    stage: "analyze",
    outcome: "failed",
    failureClass: "dependency"
  });
  assert.deepEqual(event, {
    schemaVersion: 1,
    stage: "analyze",
    outcome: "failed",
    failureClass: "dependency"
  });
  assert.doesNotMatch(JSON.stringify(event), /path|source|prompt|content/i);
});

test("Studio source exposes local, GitHub, Resume, checkpoint, preview, Keep, and Restore controls", async () => {
  const source = await readFile("apps/studio/src/App.tsx", "utf8");
  for (const expected of [
    "Choose local folder",
    "GitHub repository URL",
    "Resume verification",
    "Review safe starter",
    "Create validated preview",
    "Keep checkpoint",
    "Restore previous state",
    "Advanced · exact operations and limitations"
  ]) {
    assert.match(source, new RegExp(expected));
  }
  assert.match(source, /aria-current=\{stage\.id === onboardingStage/);
  assert.match(source, /aria-live="polite"/);
});
