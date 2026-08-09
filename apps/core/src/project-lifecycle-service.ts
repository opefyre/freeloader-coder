import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { z } from "zod";

import {
  advanceProjectLifecycle,
  createProjectLifecycle,
  ownerAnswerSchema,
  ownerQuestionSchema,
  projectLifecycleRecordSchema,
  type OwnerQuestion,
  type ProjectLifecycleRecord,
} from "../../../packages/orchestration/src/project-lifecycle.js";

const answerRequestSchema = z.strictObject({
  schemaVersion: z.literal(1),
  expectedRevision: z.number().int().nonnegative(),
  answers: z.array(ownerAnswerSchema).min(1).max(100),
});
const stateSchema = z.strictObject({
  schemaVersion: z.literal(1),
  records: z.array(projectLifecycleRecordSchema).max(1_000),
  receipts: z.record(z.string(), projectLifecycleRecordSchema),
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

  async answer(projectId: string, raw: unknown, idempotencyKey: string): Promise<ProjectLifecycleRecord> {
    assertProjectId(projectId);
    assertIdempotencyKey(idempotencyKey);
    const request = answerRequestSchema.parse(raw);
    return this.#mutate(async (state) => {
      const receiptKey = `${projectId}:${idempotencyKey}`;
      const replay = state.receipts[receiptKey];
      if (replay) return { state, result: replay };
      const current = requireRecord(state.records, projectId);
      if (current.revision !== request.expectedRevision) throw new ProjectLifecycleServiceError("stale_revision", "Questions changed. Review the latest choices before answering.");
      const record = advanceProjectLifecycle(current, { type: "clarifications_resolved", answers: request.answers }, Date.now());
      return {
        state: { ...replaceRecord(state, record), receipts: { ...state.receipts, [receiptKey]: record } },
        result: record,
      };
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
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return stateSchema.parse({ schemaVersion: 1, records: [], receipts: {} });
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

async function atomicWrite(path: string, content: string) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, content, { encoding: "utf8", mode: 0o600 });
  await chmod(temporary, 0o600);
  await rename(temporary, path);
  await chmod(path, 0o600);
}
