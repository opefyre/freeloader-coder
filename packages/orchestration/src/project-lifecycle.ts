import { z } from "zod";

import { projectLifecycleStageSchema } from "../../runtime/src/local-projects.js";

const projectId = z.string().regex(/^project_[a-f0-9]{16}$/);
const digest = z.string().regex(/^[a-f0-9]{64}$/);

export const ownerQuestionSchema = z.strictObject({
  id: z.string().regex(/^question_[a-f0-9]{16}$/),
  prompt: z.string().trim().min(3).max(1_000),
  whyItMatters: z.string().trim().min(3).max(1_000),
  options: z.array(z.strictObject({
    id: z.string().trim().min(1).max(80),
    label: z.string().trim().min(1).max(160),
    consequence: z.string().trim().min(1).max(500),
  })).min(2).max(6),
  allowsCustomAnswer: z.boolean(),
  sourceFindingIds: z.array(z.string().trim().min(1).max(160)).min(1).max(30),
});

export const ownerAnswerSchema = z.strictObject({
  questionId: z.string().regex(/^question_[a-f0-9]{16}$/),
  optionId: z.string().trim().min(1).max(80).nullable(),
  customAnswer: z.string().trim().min(1).max(2_000).nullable(),
  answeredAt: z.number().int().nonnegative(),
});

export const projectArtifactSchema = z.strictObject({
  kind: z.enum(["context", "solution", "backlog"]),
  projectRelativePath: z.enum([
    ".pipeline/CONTEXT.md",
    ".pipeline/SOLUTION.md",
    ".pipeline/BACKLOG.md",
  ]),
  digest,
  revision: z.number().int().positive(),
  createdAt: z.number().int().nonnegative(),
  citations: z.array(z.string().trim().min(1).max(2_048)).max(500),
  reviewerIds: z.array(z.string().trim().min(1).max(160)).max(20),
  qaPassed: z.boolean(),
});

export const majorWorkAssessmentSchema = z.strictObject({
  classification: z.enum(["new_product", "major_feature", "small_change", "unclear"]),
  rationale: z.array(z.string().trim().min(1).max(500)).min(1).max(20),
  affectedDomains: z.array(z.string().trim().min(1).max(160)).max(50),
  estimatedDeveloperHours: z.number().min(0).max(100_000),
  requiresArchitectureDecision: z.boolean(),
  confidence: z.number().min(0).max(1),
});

export const projectLifecycleRecordSchema = z.strictObject({
  schemaVersion: z.literal(1),
  projectId,
  stage: projectLifecycleStageSchema,
  revision: z.number().int().nonnegative(),
  mission: z.string().trim().min(3).max(20_000),
  assessment: majorWorkAssessmentSchema.nullable(),
  questions: z.array(ownerQuestionSchema).max(100),
  answers: z.array(ownerAnswerSchema).max(100),
  artifacts: z.array(projectArtifactSchema).max(100),
  designApproval: z.strictObject({
    artifactDigest: digest,
    decision: z.enum(["approved", "declined"]),
    decidedAt: z.number().int().nonnegative(),
  }).nullable(),
  designFeedback: z.array(z.strictObject({
    artifactDigest: digest,
    feedback: z.string().trim().min(3).max(10_000),
    requestedAt: z.number().int().nonnegative(),
  })).max(50).default([]),
  jiraEpicId: z.string().trim().min(1).max(160).nullable(),
  blockedReason: z.string().trim().min(1).max(1_000).nullable(),
  updatedAt: z.number().int().nonnegative(),
});

export type ProjectLifecycleRecord = z.infer<typeof projectLifecycleRecordSchema>;
export type OwnerQuestion = z.infer<typeof ownerQuestionSchema>;
export type OwnerAnswer = z.infer<typeof ownerAnswerSchema>;
export type MajorWorkAssessment = z.infer<typeof majorWorkAssessmentSchema>;

export type ProjectLifecycleEvent =
  | { type: "begin_context_review" }
  | { type: "context_completed"; artifact: z.infer<typeof projectArtifactSchema>; questions: readonly OwnerQuestion[] }
  | { type: "clarifications_resolved"; answers: readonly OwnerAnswer[] }
  | { type: "scope_assessed"; assessment: MajorWorkAssessment; questions?: readonly OwnerQuestion[] }
  | { type: "design_completed"; artifact: z.infer<typeof projectArtifactSchema> }
  | { type: "design_approved"; artifactDigest: string }
  | { type: "design_declined"; artifactDigest: string }
  | { type: "design_revision_requested"; artifactDigest: string; feedback: string }
  | { type: "backlog_completed"; artifact: z.infer<typeof projectArtifactSchema>; jiraEpicId: string }
  | { type: "backlog_qa_passed"; artifactDigest: string }
  | { type: "delivery_completed" }
  | { type: "owner_input_required"; reason: string }
  | { type: "resume" };

export function createProjectLifecycle(input: {
  projectId: string;
  mission: string;
  now: number;
}): ProjectLifecycleRecord {
  return projectLifecycleRecordSchema.parse({
    schemaVersion: 1,
    projectId: input.projectId,
    stage: "intake",
    revision: 0,
    mission: input.mission,
    assessment: null,
    questions: [],
    answers: [],
    artifacts: [],
    designApproval: null,
    designFeedback: [],
    jiraEpicId: null,
    blockedReason: null,
    updatedAt: input.now,
  });
}

export function advanceProjectLifecycle(
  current: ProjectLifecycleRecord,
  rawEvent: ProjectLifecycleEvent,
  now: number
): ProjectLifecycleRecord {
  const record = projectLifecycleRecordSchema.parse(current);
  const event = validateEvent(rawEvent);
  let patch: Partial<ProjectLifecycleRecord>;
  switch (event.type) {
    case "begin_context_review":
      requireStage(record, "intake");
      patch = { stage: "context_review" };
      break;
    case "context_completed": {
      requireStage(record, "context_review");
      if (event.artifact.kind !== "context" || !event.artifact.qaPassed) {
        throw new Error("Context review requires a QA-passed CONTEXT.md artifact.");
      }
      patch = {
        stage: event.questions.length > 0 ? "clarification" : "context_review",
        questions: [...event.questions],
        artifacts: upsertArtifact(record.artifacts, event.artifact),
      };
      break;
    }
    case "clarifications_resolved":
      requireStage(record, "clarification");
      patch = {
        stage: "context_review",
        answers: validateAnswers(record.questions, event.answers),
        questions: [],
        blockedReason: null,
      };
      break;
    case "scope_assessed":
      requireStage(record, "context_review");
      if (event.assessment.classification === "small_change") {
        patch = { stage: "cancelled", assessment: event.assessment, blockedReason: "The request is below the configured major-work threshold." };
      } else if (event.assessment.classification === "unclear" || event.assessment.confidence < 0.75) {
        const questions = (event.questions ?? []).map((question) => ownerQuestionSchema.parse(question));
        if (questions.length === 0) throw new Error("Unclear scope requires a selectable owner clarification.");
        patch = { stage: "clarification", assessment: event.assessment, questions, blockedReason: "Major-work scope is not yet certain." };
      } else {
        patch = { stage: "solution_design", assessment: event.assessment, blockedReason: null };
      }
      break;
    case "design_completed":
      requireStage(record, "solution_design");
      if (event.artifact.kind !== "solution" || !event.artifact.qaPassed) {
        throw new Error("Owner review requires a QA-passed SOLUTION.md artifact.");
      }
      patch = { stage: "awaiting_design_approval", artifacts: upsertArtifact(record.artifacts, event.artifact) };
      break;
    case "design_approved": {
      requireStage(record, "awaiting_design_approval");
      const artifact = requireArtifact(record, "solution", event.artifactDigest);
      patch = { stage: "backlog_design", designApproval: { artifactDigest: artifact.digest, decision: "approved", decidedAt: now } };
      break;
    }
    case "design_declined":
      requireStage(record, "awaiting_design_approval");
      requireArtifact(record, "solution", event.artifactDigest);
      patch = { stage: "cancelled", designApproval: { artifactDigest: event.artifactDigest, decision: "declined", decidedAt: now }, blockedReason: "The owner declined the proposed solution." };
      break;
    case "design_revision_requested":
      requireStage(record, "awaiting_design_approval");
      requireArtifact(record, "solution", event.artifactDigest);
      if (event.feedback.trim().length < 3) throw new Error("A solution revision needs specific owner feedback.");
      patch = { stage: "solution_design", designApproval: null, designFeedback: [...record.designFeedback, { artifactDigest: event.artifactDigest, feedback: event.feedback.trim(), requestedAt: now }], blockedReason: null };
      break;
    case "backlog_completed":
      requireStage(record, "backlog_design");
      if (event.artifact.kind !== "backlog") throw new Error("Backlog design must produce BACKLOG.md.");
      patch = { stage: "backlog_qa", artifacts: upsertArtifact(record.artifacts, event.artifact), jiraEpicId: event.jiraEpicId };
      break;
    case "backlog_qa_passed": {
      requireStage(record, "backlog_qa");
      const backlog = requireArtifact(record, "backlog", event.artifactDigest);
      if (!backlog.qaPassed || !record.jiraEpicId) throw new Error("Delivery requires a QA-passed backlog and its Jira epic.");
      patch = { stage: "delivery" };
      break;
    }
    case "delivery_completed":
      requireStage(record, "delivery");
      patch = { stage: "complete" };
      break;
    case "owner_input_required":
      if (["complete", "cancelled"].includes(record.stage)) throw new Error("Terminal projects cannot request owner input.");
      patch = { stage: "blocked", blockedReason: event.reason };
      break;
    case "resume":
      requireStage(record, "blocked");
      patch = { stage: inferResumeStage(record), blockedReason: null };
      break;
  }
  return projectLifecycleRecordSchema.parse({
    ...record,
    ...patch,
    revision: record.revision + 1,
    updatedAt: now,
  });
}

function validateAnswers(questions: readonly OwnerQuestion[], rawAnswers: readonly OwnerAnswer[]): OwnerAnswer[] {
  const answers = rawAnswers.map((answer) => ownerAnswerSchema.parse(answer));
  if (answers.length !== questions.length) throw new Error("Every blocking clarification must be answered.");
  const seen = new Set<string>();
  for (const answer of answers) {
    if (seen.has(answer.questionId)) throw new Error("A clarification cannot be answered more than once.");
    seen.add(answer.questionId);
    const question = questions.find((candidate) => candidate.id === answer.questionId);
    if (!question) throw new Error("Clarification answer does not match an active question.");
    if ((answer.optionId === null) === (answer.customAnswer === null)) {
      throw new Error("Choose one option or provide one custom answer.");
    }
    if (answer.optionId !== null && !question.options.some((option) => option.id === answer.optionId)) {
      throw new Error("Clarification answer selected an unknown option.");
    }
    if (answer.customAnswer !== null && !question.allowsCustomAnswer) {
      throw new Error("This clarification does not allow a custom answer.");
    }
  }
  return [...answers].sort((left, right) => left.questionId.localeCompare(right.questionId));
}

function validateEvent(event: ProjectLifecycleEvent): ProjectLifecycleEvent {
  if (event.type === "owner_input_required" && event.reason.trim().length < 3) {
    throw new Error("Owner input blockers require a specific reason.");
  }
  return event;
}

function requireStage(record: ProjectLifecycleRecord, stage: ProjectLifecycleRecord["stage"]): void {
  if (record.stage !== stage) throw new Error(`Event requires ${stage}; project is ${record.stage}.`);
}

function requireArtifact(record: ProjectLifecycleRecord, kind: "solution" | "backlog", artifactDigest: string) {
  const artifact = record.artifacts.find((candidate) => candidate.kind === kind && candidate.digest === artifactDigest);
  if (!artifact) throw new Error(`The approved ${kind} artifact revision was not found.`);
  return artifact;
}

function upsertArtifact(
  artifacts: ProjectLifecycleRecord["artifacts"],
  artifact: ProjectLifecycleRecord["artifacts"][number]
) {
  return [...artifacts.filter((candidate) => !(candidate.kind === artifact.kind && candidate.revision === artifact.revision)), artifact];
}

function inferResumeStage(record: ProjectLifecycleRecord): ProjectLifecycleRecord["stage"] {
  if (record.designApproval?.decision === "approved" && !record.jiraEpicId) return "backlog_design";
  if (record.jiraEpicId) return "delivery";
  if (record.artifacts.some((artifact) => artifact.kind === "solution")) return "awaiting_design_approval";
  if (record.artifacts.some((artifact) => artifact.kind === "context")) return "context_review";
  return "intake";
}
