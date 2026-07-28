import assert from "node:assert/strict";
import test from "node:test";

import {
  buildFirstJourneyPlan,
  createJourneyEvent,
  journeyEventSchema,
  nextJourneyStage,
  recommendStarterTasks,
  scanProject
} from "../packages/onboarding/src/index.js";

const profile = scanProject({
  projectId: "example-private-project",
  files: [
    {
      path: "package.json",
      content: JSON.stringify({
        scripts: { test: "node --test", build: "vite build" },
        dependencies: { react: "19", vite: "8" },
        packageManager: "npm@11"
      }),
      bytes: 140
    },
    { path: "package-lock.json", content: "{}", bytes: 2 },
    { path: "src/App.tsx", content: "export const App=()=> <main/>", bytes: 30 },
    { path: "tests/App.test.ts", content: "export const pass=true", bytes: 22 }
  ],
  maxFiles: 100,
  maxFileBytes: 100_000,
  maxTotalBytes: 1_000_000
});

test("starter tasks are project-aware, safe, and bounded below ten minutes", () => {
  const tasks = recommendStarterTasks(profile);
  assert.equal(tasks[0]?.id, "starter-preview");
  assert.ok(tasks.some((task) => task.effect === "read_only"));
  assert.ok(tasks.every((task) => task.estimatedMinutes < 10));
});

test("first plan explains time, automatic free routing, effects, evidence, and undo", () => {
  const plan = buildFirstJourneyPlan({ profile });
  assert.equal(plan.expectedMinutes, 8);
  assert.match(plan.providerPosture, /free capacity automatically/);
  assert.match(plan.providerPosture, /stop before any paid route/);
  assert.ok(plan.effects.some((effect) => /isolated checkpoint/.test(effect)));
  assert.ok(plan.evidence.includes("Preview observation"));
  assert.match(plan.undo, /exact pre-run checkpoint/);
  assert.doesNotMatch(JSON.stringify(plan), /Groq|OpenRouter|git worktree|npm run/);
});

test("guided journey has a deterministic stage sequence through Keep or Restore", () => {
  assert.equal(nextJourneyStage("select"), "analyze");
  assert.equal(nextJourneyStage("analyze"), "plan");
  assert.equal(nextJourneyStage("plan"), "preview");
  assert.equal(nextJourneyStage("preview"), "decision");
  assert.equal(nextJourneyStage("decision"), "complete");
});

test("completion, abandonment, and failure events contain no project content", () => {
  const events = [
    createJourneyEvent({
      projectId: "absolute/path/private-project",
      stage: "preview",
      outcome: "completed",
      occurredAt: 100
    }),
    createJourneyEvent({
      projectId: "absolute/path/private-project",
      stage: "plan",
      outcome: "abandoned",
      occurredAt: 101
    }),
    createJourneyEvent({
      projectId: "absolute/path/private-project",
      stage: "analyze",
      outcome: "failed",
      failureClass: "dependency",
      occurredAt: 102
    })
  ];
  const serialized = JSON.stringify(events);
  assert.doesNotMatch(serialized, /absolute|private-project|path/);
  assert.ok(events.every((event) => /^project_[a-f0-9]{12}$/.test(event.projectId)));
  assert.equal(events[2]?.failureClass, "dependency");
});

test("journey events reject prompt, path, or content fields", () => {
  assert.throws(
    () =>
      journeyEventSchema.parse({
        ...createJourneyEvent({
          projectId: "project",
          stage: "select",
          outcome: "started",
          occurredAt: 100
        }),
        prompt: "private source code"
      }),
    /Unrecognized key/
  );
});
