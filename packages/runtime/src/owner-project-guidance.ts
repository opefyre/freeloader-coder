import { z } from "zod";

import {
  localProjectSnapshotSchema,
  projectLifecycleStageSchema,
  type LocalProjectSnapshot,
} from "./local-projects.js";

export const ownerProjectDestinationSchema = z.enum([
  "overview",
  "resources",
  "progress",
  "actions",
]);

export const ownerProjectGuidanceSchema = z.strictObject({
  schemaVersion: z.literal(1),
  provenance: z.literal("canonical_project_owner_guidance"),
  projectId: localProjectSnapshotSchema.shape.id,
  lifecycleStage: projectLifecycleStageSchema,
  stageLabel: z.string().trim().min(1).max(80),
  outcome: z.string().trim().min(1).max(180),
  ownerState: z.enum(["autonomous", "action_required", "attention", "complete"]),
  ownerStateLabel: z.string().trim().min(1).max(80),
  primaryAction: z.strictObject({
    label: z.string().trim().min(1).max(80),
    destination: ownerProjectDestinationSchema,
  }),
  approvalBoundary: z.string().trim().min(1).max(180),
  downstreamEffect: z.string().trim().min(1).max(240),
  recovery: z.string().trim().min(1).max(240),
  automaticSpendLimitUsd: z.literal(0),
});

export type OwnerProjectGuidance = z.infer<typeof ownerProjectGuidanceSchema>;

type GuidanceSeed = Omit<
  OwnerProjectGuidance,
  "schemaVersion" | "provenance" | "projectId" | "lifecycleStage" | "automaticSpendLimitUsd"
>;

const guidanceByStage: Record<z.infer<typeof projectLifecycleStageSchema>, GuidanceSeed> = {
  intake: guidance("Intake", "Codkesh is collecting the idea and project inputs.", "autonomous", "Codkesh is working", "Review project intake", "overview", "No owner approval is required yet.", "Context preparation can begin after the inputs are complete.", "Open the project to inspect missing inputs; existing files remain unchanged."),
  context_review: guidance("Context review", "Codkesh is grounding the project in its local files and selected resources.", "autonomous", "Codkesh is working", "Review project context", "overview", "No implementation is authorized at this stage.", "A verified context package will either advance or ask focused questions.", "Open project files to inspect evidence or restore a missing context artifact."),
  clarification: guidance("Clarification", "A bounded owner decision is required before design can continue.", "action_required", "Your decision is required", "Answer project questions", "actions", "Only the displayed answers authorize the next design step.", "Your answer updates project context; it does not authorize implementation or deployment.", "Leave the decision pending if the options are insufficient; project work remains safe."),
  solution_design: guidance("Solution design", "Codkesh is researching and preparing the implementation design.", "autonomous", "Codkesh is working", "View solution progress", "overview", "No code or infrastructure change is authorized yet.", "A reviewable solution will be presented before backlog creation.", "Inspect evidence and limitations in Project files if progress appears stale."),
  awaiting_design_approval: guidance("Design approval", "The proposed solution is ready for an owner decision.", "action_required", "Your approval is required", "Review proposed design", "actions", "Approval authorizes backlog planning only—not implementation or deployment.", "Approve to create the detailed delivery plan, request changes to revise it, or decline to stop.", "Request changes or decline; Codkesh preserves the current evidence and makes no downstream change."),
  backlog_design: guidance("Delivery planning", "Codkesh is translating the approved design into implementation-sized work.", "autonomous", "Codkesh is working", "View delivery plan", "overview", "The approved design bounds planning; implementation has not started.", "A complete Jira-backed plan will enter independent QA before delivery.", "Review the delivery-plan artifact if planning stalls; approved design remains authoritative."),
  backlog_qa: guidance("Plan validation", "The delivery plan is being checked for completeness, dependencies, and testability.", "autonomous", "Codkesh is validating", "View plan evidence", "overview", "No implementation begins until plan validation passes.", "Passing evidence opens delivery; failures return the plan for bounded repair.", "Open Project files to inspect failed evidence or the preserved prior revision."),
  delivery: guidance("Implementation", "Codkesh is executing the approved plan with validation and review gates.", "autonomous", "Codkesh is working", "Open project progress", "progress", "Only approved tasks may change the isolated project workspace.", "Passing work advances through validation, independent review, and controlled integration.", "Use Action Center when work is blocked or quarantined; unsafe work remains isolated."),
  blocked: guidance("Blocked", "Codkesh cannot continue safely without attention.", "attention", "Needs your attention", "Resolve blocker", "actions", "Only the selected recovery action authorizes another attempt.", "A valid decision resumes bounded work; no decision leaves current evidence unchanged.", "Inspect the blocker, evidence, and recovery choices in Action Center before proceeding."),
  complete: guidance("Complete", "All approved work reached its required completion evidence.", "complete", "Completed", "Review final outcome", "progress", "No further project mutation is authorized by this completed run.", "The owner can review evidence, commits, Jira receipts, and any remaining recommendations.", "Reopen through an explicit new request; never modify completion evidence to force a rerun."),
  cancelled: guidance("Cancelled", "The project run stopped without authorizing further work.", "complete", "Stopped", "Review project record", "overview", "Cancellation authorizes no additional change.", "Existing files and durable evidence remain available for review.", "Start a new explicit request if the project should continue; do not reuse stale approval."),
};

export function ownerProjectGuidance(project: LocalProjectSnapshot): OwnerProjectGuidance {
  const stage = project.lifecycleStage ?? "intake";
  const seed = project.state === "failed"
    ? guidance("Recovery required", "Canonical project evidence is unavailable or invalid.", "attention", "Needs recovery", "Review recovery", "actions", "No action is authorized until project evidence is trustworthy.", "A verified recovery may restore the last safe lifecycle state.", project.warnings[0] ?? "Inspect the preserved project evidence before retrying.")
    : project.state === "warning" && stage !== "blocked"
      ? { ...guidanceByStage[stage], ownerState: "attention" as const, ownerStateLabel: "Check project evidence", recovery: project.warnings[0] ?? guidanceByStage[stage].recovery }
      : guidanceByStage[stage];
  return ownerProjectGuidanceSchema.parse({ schemaVersion: 1, provenance: "canonical_project_owner_guidance", projectId: project.id, lifecycleStage: stage, ...seed, automaticSpendLimitUsd: 0 });
}

function guidance(stageLabel: string, outcome: string, ownerState: GuidanceSeed["ownerState"], ownerStateLabel: string, label: string, destination: GuidanceSeed["primaryAction"]["destination"], approvalBoundary: string, downstreamEffect: string, recovery: string): GuidanceSeed {
  return { stageLabel, outcome, ownerState, ownerStateLabel, primaryAction: { label, destination }, approvalBoundary, downstreamEffect, recovery };
}
