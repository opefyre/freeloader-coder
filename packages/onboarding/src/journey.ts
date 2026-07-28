import { createHash } from "node:crypto";

import {
  firstJourneyPlanSchema,
  journeyEventSchema,
  projectProfileSchema,
  starterTaskSchema,
  type FirstJourneyPlan,
  type JourneyEvent,
  type ProjectProfile,
  type StarterTask
} from "./contracts.js";

export function recommendStarterTasks(profileInput: unknown): readonly StarterTask[] {
  const profile = projectProfileSchema.parse(profileInput);
  const tasks: StarterTask[] = [];
  if (profile.frameworks.some((framework) => ["React", "Next.js", "Vue", "Svelte", "Angular"].includes(framework))) {
    tasks.push(starterTaskSchema.parse({
      id: "starter-preview",
      title: "Improve one visible heading and preview it",
      reason: "A small visible change teaches the plan, preview, evidence, Keep, and Restore flow.",
      effect: "local_reversible",
      estimatedMinutes: 8
    }));
  }
  if (profile.tests.length > 0) {
    tasks.push(starterTaskSchema.parse({
      id: "starter-tests",
      title: "Explain and run the existing checks",
      reason: "This verifies the project setup without changing source files.",
      effect: "read_only",
      estimatedMinutes: 4
    }));
  }
  tasks.push(starterTaskSchema.parse({
    id: "starter-summary",
    title: "Create a verified project summary",
    reason: "This confirms the detected stack, commands, safeguards, and missing setup.",
    effect: "read_only",
    estimatedMinutes: 3
  }));
  return tasks;
}

export function buildFirstJourneyPlan(input: {
  readonly profile: unknown;
  readonly taskId?: string;
}): FirstJourneyPlan {
  const profile = projectProfileSchema.parse(input.profile);
  const tasks = recommendStarterTasks(profile);
  const task = tasks.find((candidate) => candidate.id === input.taskId) ?? tasks[0];
  if (!task) throw new Error("No starter task is available.");
  return firstJourneyPlanSchema.parse({
    schemaVersion: 1,
    projectId: profile.projectId,
    recommendedTask: task,
    expectedMinutes: task.estimatedMinutes,
    providerPosture: "Use available free capacity automatically; stop before any paid route.",
    localResources: "Use the low-impact local profile and pause if the computer becomes busy.",
    effects: task.effect === "read_only"
      ? ["Read project metadata and validation output only."]
      : ["Create an isolated checkpoint.", "Change only the approved file.", "Start a local preview."],
    evidence: ["Changed-file summary", "Validation results", "Preview observation", "Restorable checkpoint"],
    undo: task.effect === "read_only"
      ? "No project change is made."
      : "Restore the exact pre-run checkpoint without touching unrelated work."
  });
}

export function createJourneyEvent(input: {
  readonly projectId: string;
  readonly stage: JourneyEvent["stage"];
  readonly outcome: JourneyEvent["outcome"];
  readonly failureClass?: NonNullable<JourneyEvent["failureClass"]>;
  readonly occurredAt: number;
}): JourneyEvent {
  return journeyEventSchema.parse({
    schemaVersion: 1,
    projectId: `project_${hash(input.projectId).slice(0, 12)}`,
    stage: input.stage,
    outcome: input.outcome,
    failureClass: input.failureClass ?? null,
    occurredAt: input.occurredAt
  });
}

export function nextJourneyStage(
  stage: JourneyEvent["stage"]
): JourneyEvent["stage"] | "complete" {
  return {
    select: "analyze",
    analyze: "plan",
    plan: "preview",
    preview: "decision",
    decision: "complete"
  }[stage] as JourneyEvent["stage"] | "complete";
}

export function summarizeGrounding(profileInput: unknown): {
  readonly facts: readonly string[];
  readonly inferences: readonly string[];
  readonly assumptions: readonly string[];
  readonly userDecisions: readonly string[];
} {
  const profile: ProjectProfile = projectProfileSchema.parse(profileInput);
  const statements = (classification: ProjectProfile["statements"][number]["classification"]) =>
    profile.statements
      .filter((statement) => statement.classification === classification)
      .map((statement) => statement.text);
  return {
    facts: statements("fact"),
    inferences: statements("inference"),
    assumptions: statements("assumption"),
    userDecisions: statements("user_decision")
  };
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
