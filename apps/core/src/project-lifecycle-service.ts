import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { z } from "zod";

import {
  advanceProjectLifecycle,
  createProjectLifecycle,
  ownerAnswerSchema,
  ownerQuestionSchema,
  projectArtifactSchema,
  projectLifecycleRecordSchema,
  type OwnerQuestion,
  type ProjectLifecycleRecord,
} from "../../../packages/orchestration/src/project-lifecycle.js";
import { assessEligibility, eligibilityDecisionSchema, type EligibilityDecision } from "../../../packages/orchestration/src/eligibility-gate.js";

const answerRequestSchema = z.strictObject({
  schemaVersion: z.literal(1),
  expectedRevision: z.number().int().nonnegative(),
  answers: z.array(ownerAnswerSchema).min(1).max(100),
});
const solutionDecisionRequestSchema = z.strictObject({
  schemaVersion: z.literal(1),
  expectedRevision: z.number().int().nonnegative(),
  artifactDigest: z.string().regex(/^[a-f0-9]{64}$/),
  decision: z.enum(["approved", "declined", "revision_requested"]),
  feedback: z.string().trim().min(3).max(10_000).nullable(),
});
const reopenRequestSchema = z.strictObject({
  schemaVersion: z.literal(1),
  expectedRevision: z.number().int().nonnegative(),
  mission: z.string().trim().min(3).max(20_000),
  reason: z.string().trim().min(3).max(2_000),
});
const stateSchema = z.strictObject({
  schemaVersion: z.literal(1),
  records: z.array(projectLifecycleRecordSchema).max(1_000),
  receipts: z.record(z.string(), projectLifecycleRecordSchema),
  eligibility: z.record(z.string(), eligibilityDecisionSchema).default({}),
  eligibilityReceipts: z.record(z.string(), eligibilityDecisionSchema).default({}),
});

export class ProjectLifecycleService {
  readonly #path: string;
  #mutation = Promise.resolve();

  constructor(stateDirectory: string) {
    this.#path = resolve(stateDirectory, "project-lifecycles.json");
  }

  async get(projectId: string): Promise<ProjectLifecycleRecord | null> {
    assertProjectId(projectId);
    return (await this.#load()).records.find((record) => record.projectId === projectId) ?? null;
  }

  async list(): Promise<readonly ProjectLifecycleRecord[]> {
    return (await this.#load()).records;
  }

  async eligibility(projectId: string): Promise<EligibilityDecision | null> {
    assertProjectId(projectId);
    return (await this.#load()).eligibility[projectId] ?? null;
  }

  async assess(projectId: string, raw: unknown, idempotencyKey: string): Promise<{ lifecycle: ProjectLifecycleRecord; decision: EligibilityDecision }> {
    assertProjectId(projectId); assertIdempotencyKey(idempotencyKey);
    const request = z.strictObject({
      schemaVersion: z.literal(1), expectedRevision: z.number().int().nonnegative(),
      requestId: z.string().regex(/^request_[a-f0-9]{20}$/), projectKind: z.enum(["new_product", "existing_product", "unknown"]),
      affectedDomains: z.array(z.string().trim().min(1).max(160)).max(50), deliveryStages: z.array(z.enum(["research", "product", "design", "frontend", "backend", "data", "infrastructure", "qa", "launch"])).max(9),
      estimatedDeveloperHours: z.number().min(0).max(100_000), requiresArchitectureDecision: z.boolean(), evidence: z.array(z.string().trim().min(1).max(500)).min(1).max(30), confidence: z.number().min(0).max(1),
    }).parse(raw);
    return this.#mutate(async (state) => {
      const key = `${projectId}:${idempotencyKey}`;
      const replay = state.eligibilityReceipts[key];
      const current = requireRecord(state.records, projectId);
      if (replay) return { state, result: { lifecycle: current, decision: replay } };
      if (current.revision !== request.expectedRevision) throw new ProjectLifecycleServiceError("stale_revision", "Project context changed. Reassess the latest evidence.");
      const { schemaVersion: _schemaVersion, expectedRevision: _expectedRevision, ...evidence } = request;
      const decision = assessEligibility({ ...evidence, projectId });
      const questions = decision.assessment.classification === "unclear" ? [scopeClarification(decision)] : [];
      const lifecycle = advanceProjectLifecycle(current, { type: "scope_assessed", assessment: decision.assessment, questions }, Date.now());
      return { state: { ...replaceRecord(state, lifecycle), eligibility: { ...state.eligibility, [projectId]: decision }, eligibilityReceipts: { ...state.eligibilityReceipts, [key]: decision } }, result: { lifecycle, decision } };
    });
  }

  async begin(input: { projectId: string; mission: string; now?: number }): Promise<ProjectLifecycleRecord> {
    return this.#mutate(async (state) => {
      const existing = state.records.find((record) => record.projectId === input.projectId);
      if (existing) return { state, result: existing };
      let record = createProjectLifecycle({ projectId: input.projectId, mission: input.mission, now: input.now ?? Date.now() });
      record = advanceProjectLifecycle(record, { type: "begin_context_review" }, input.now ?? Date.now());
      return { state: { ...state, records: [...state.records, record] }, result: record };
    });
  }

  async publishQuestions(input: {
    projectId: string;
    artifact: ProjectLifecycleRecord["artifacts"][number];
    questions: readonly OwnerQuestion[];
    now?: number;
  }): Promise<ProjectLifecycleRecord> {
    return this.#mutate(async (state) => {
      const current = requireRecord(state.records, input.projectId);
      const record = advanceProjectLifecycle(current, {
        type: "context_completed",
        artifact: input.artifact,
        questions: input.questions.map((question) => ownerQuestionSchema.parse(question)),
      }, input.now ?? Date.now());
      return { state: replaceRecord(state, record), result: record };
    });
  }

  async answer(
    projectId: string,
    raw: unknown,
    idempotencyKey: string,
    persist?: (
      questions: readonly OwnerQuestion[],
      answers: readonly z.infer<typeof ownerAnswerSchema>[],
    ) => Promise<void>,
  ): Promise<ProjectLifecycleRecord> {
    assertProjectId(projectId);
    assertIdempotencyKey(idempotencyKey);
    const request = answerRequestSchema.parse(raw);
    return this.#mutate(async (state) => {
      const receiptKey = `${projectId}:${idempotencyKey}`;
      const replay = state.receipts[receiptKey];
      if (replay) return { state, result: replay };
      const current = requireRecord(state.records, projectId);
      if (current.revision !== request.expectedRevision) throw new ProjectLifecycleServiceError("stale_revision", "Questions changed. Review the latest choices before answering.");
      let record = advanceProjectLifecycle(current, { type: "clarifications_resolved", answers: request.answers }, Date.now());
      let resolvedEligibility = state.eligibility[projectId];
      if (current.assessment?.classification === "unclear" && resolvedEligibility) {
        const priorEligibility = resolvedEligibility;
        const scopeQuestion = current.questions.find((question) => question.sourceFindingIds.includes(priorEligibility.requestId));
        const scopeAnswer = scopeQuestion ? request.answers.find((answer) => answer.questionId === scopeQuestion.id) : undefined;
        if (scopeAnswer?.optionId && ["new_product", "major_feature", "small_change"].includes(scopeAnswer.optionId)) {
          const classification = scopeAnswer.optionId as "new_product" | "major_feature" | "small_change";
          resolvedEligibility = assessEligibility({
            projectId,
            requestId: priorEligibility.requestId,
            projectKind: classification === "new_product" ? "new_product" : "existing_product",
            affectedDomains: classification === "major_feature" ? ["product", "implementation"] : [],
            deliveryStages: classification === "major_feature" ? ["product", "design", "frontend", "backend", "qa"] : classification === "new_product" ? ["research", "product", "design", "frontend", "backend", "qa", "launch"] : ["frontend"],
            estimatedDeveloperHours: classification === "small_change" ? 2 : 16,
            requiresArchitectureDecision: classification !== "small_change",
            evidence: [`The owner classified the outcome as ${classification.replaceAll("_", " ")}.`],
            confidence: 1,
          });
          record = advanceProjectLifecycle(record, { type: "scope_assessed", assessment: resolvedEligibility.assessment }, Date.now());
        }
      }
      await persist?.(current.questions, record.answers);
      return {
        state: { ...replaceRecord(state, record), eligibility: resolvedEligibility ? { ...state.eligibility, [projectId]: resolvedEligibility } : state.eligibility, receipts: { ...state.receipts, [receiptKey]: record } },
        result: record,
      };
    });
  }

  async publishSolution(projectId: string, rawArtifact: unknown): Promise<ProjectLifecycleRecord> {
    assertProjectId(projectId);
    const artifact = z.strictObject({ kind: z.literal("solution"), projectRelativePath: z.literal(".pipeline/SOLUTION.md"), digest: z.string().regex(/^[a-f0-9]{64}$/), revision: z.number().int().positive(), createdAt: z.number().int().nonnegative(), citations: z.array(z.string().trim().min(1).max(2_048)).min(1).max(500), reviewerIds: z.array(z.string().trim().min(1).max(160)).min(2).max(20), qaPassed: z.literal(true) }).parse(rawArtifact);
    return this.#mutate(async (state) => {
      const record = advanceProjectLifecycle(requireRecord(state.records, projectId), { type: "design_completed", artifact }, Date.now());
      return { state: replaceRecord(state, record), result: record };
    });
  }

  async publishBacklog(projectId: string, rawArtifact: unknown): Promise<ProjectLifecycleRecord> {
    assertProjectId(projectId);
    const artifact = projectArtifactSchema.parse(rawArtifact);
    if (artifact.kind !== "backlog" || artifact.projectRelativePath !== ".pipeline/BACKLOG.md") throw new Error("Backlog artifact is invalid.");
    return this.#mutate(async (state) => {
      const record = advanceProjectLifecycle(requireRecord(state.records, projectId), { type: "backlog_completed", artifact }, Date.now());
      return { state: replaceRecord(state, record), result: record };
    });
  }

  async activateDelivery(projectId: string, artifactDigest: string, jiraEpicId: string): Promise<ProjectLifecycleRecord> {
    assertProjectId(projectId);
    return this.#mutate(async (state) => {
      const record = advanceProjectLifecycle(requireRecord(state.records, projectId), { type: "backlog_qa_passed", artifactDigest, jiraEpicId }, Date.now());
      return { state: replaceRecord(state, record), result: record };
    });
  }

  async completeDelivery(projectId: string): Promise<ProjectLifecycleRecord> {
    assertProjectId(projectId);
    return this.#mutate(async (state) => {
      const current = requireRecord(state.records, projectId);
      if (current.stage === "complete") return { state, result: current };
      const record = advanceProjectLifecycle(current, { type: "delivery_completed" }, Date.now());
      return { state: replaceRecord(state, record), result: record };
    });
  }

  async decideSolution(projectId: string, raw: unknown, idempotencyKey: string, beforeCommit: () => Promise<void> = async () => undefined): Promise<ProjectLifecycleRecord> {
    assertProjectId(projectId); assertIdempotencyKey(idempotencyKey);
    const request = solutionDecisionRequestSchema.parse(raw);
    return this.#mutate(async (state) => {
      const receiptKey = `${projectId}:solution:${idempotencyKey}`;
      const replay = state.receipts[receiptKey];
      if (replay) return { state, result: replay };
      const current = requireRecord(state.records, projectId);
      if (current.revision !== request.expectedRevision) throw new ProjectLifecycleServiceError("stale_revision", "The solution changed. Review the latest version before deciding.");
      if (request.decision !== "revision_requested" && request.feedback !== null) throw new Error("Feedback is accepted only for a revision request.");
      if (request.decision === "revision_requested" && request.feedback === null) throw new Error("A revision request requires feedback.");
      const event = request.decision === "approved" ? { type: "design_approved" as const, artifactDigest: request.artifactDigest }
        : request.decision === "declined" ? { type: "design_declined" as const, artifactDigest: request.artifactDigest }
          : { type: "design_revision_requested" as const, artifactDigest: request.artifactDigest, feedback: request.feedback ?? "" };
      const record = advanceProjectLifecycle(current, event, Date.now());
      await beforeCommit();
      return { state: { ...replaceRecord(state, record), receipts: { ...state.receipts, [receiptKey]: record } }, result: record };
    });
  }

  async reopen(projectId: string, raw: unknown, idempotencyKey: string): Promise<ProjectLifecycleRecord> {
    assertProjectId(projectId); assertIdempotencyKey(idempotencyKey);
    const request = reopenRequestSchema.parse(raw);
    return this.#mutate(async (state) => {
      const receiptKey = `${projectId}:reopen:${idempotencyKey}`;
      const replay = state.receipts[receiptKey];
      if (replay) return { state, result: replay };
      const current = requireRecord(state.records, projectId);
      if (current.revision !== request.expectedRevision) throw new ProjectLifecycleServiceError("stale_revision", "The project changed. Review the latest terminal state before reopening it.");
      const record = advanceProjectLifecycle(current, { type: "reopen", mission: request.mission, reason: request.reason }, Date.now());
      return { state: { ...replaceRecord(state, record), receipts: { ...state.receipts, [receiptKey]: record } }, result: record };
    });
  }

  async #mutate<T>(operation: (state: z.infer<typeof stateSchema>) => Promise<{ state: z.infer<typeof stateSchema>; result: T }>): Promise<T> {
    let result!: T;
    const next = this.#mutation.then(async () => {
      const outcome = await operation(await this.#load());
      await atomicWrite(this.#path, JSON.stringify(stateSchema.parse(outcome.state), null, 2));
      result = outcome.result;
    });
    this.#mutation = next.catch(() => undefined);
    await next;
    return result;
  }

  async #load() {
    try {
      return stateSchema.parse(JSON.parse(await readFile(this.#path, "utf8")));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return stateSchema.parse({ schemaVersion: 1, records: [], receipts: {}, eligibility: {}, eligibilityReceipts: {} });
      throw new ProjectLifecycleServiceError("corrupt_state", "Project lifecycle state could not be validated.");
    }
  }
}

export class ProjectLifecycleServiceError extends Error {
  constructor(readonly code: "not_found" | "stale_revision" | "corrupt_state", message: string) {
    super(message);
  }
}

function requireRecord(records: readonly ProjectLifecycleRecord[], projectId: string) {
  assertProjectId(projectId);
  const record = records.find((candidate) => candidate.projectId === projectId);
  if (!record) throw new ProjectLifecycleServiceError("not_found", "Project lifecycle was not found.");
  return record;
}

function replaceRecord(state: z.infer<typeof stateSchema>, record: ProjectLifecycleRecord) {
  return { ...state, records: [...state.records.filter((candidate) => candidate.projectId !== record.projectId), record] };
}

function assertProjectId(value: string) {
  if (!/^project_[a-f0-9]{16}$/.test(value)) throw new ProjectLifecycleServiceError("not_found", "Project identity is invalid.");
}

function assertIdempotencyKey(value: string) {
  if (!/^[a-zA-Z0-9._:-]{8,160}$/.test(value)) throw new Error("Idempotency key is invalid.");
}

function scopeClarification(decision: EligibilityDecision): OwnerQuestion {
  return ownerQuestionSchema.parse({
    id: `question_${decision.requestId.slice("request_".length, "request_".length + 16)}`,
    prompt: "How substantial is this outcome?",
    whyItMatters: "Pipeline Studio runs the autonomous product lifecycle only for a new product or a major feature.",
    options: [
      { id: "new_product", label: "New product", consequence: "Continue through product discovery, solution design, planning, and delivery." },
      { id: "major_feature", label: "Major feature", consequence: "Continue after the existing product and affected systems are understood." },
      { id: "small_change", label: "Small change", consequence: "Stop this lifecycle and handle the request as ordinary coding work." },
    ],
    allowsCustomAnswer: false,
    sourceFindingIds: [decision.requestId],
  });
}

async function atomicWrite(path: string, content: string) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, content, { encoding: "utf8", mode: 0o600 });
  await chmod(temporary, 0o600);
  await rename(temporary, path);
  await chmod(path, 0o600);
}
