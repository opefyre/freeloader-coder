import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  externalLearningCollectionSchema,
  externalLearningCompleteSchema,
  externalLearningCreateSchema,
  externalLearningSessionSchema,
  type ExternalLearningCollection,
  type ExternalLearningSession,
} from "../../../packages/runtime/src/owner-journey-certification.js";

type Stored = {
  schemaVersion: 1;
  sessions: ExternalLearningSession[];
  idempotency: Record<string, string>;
};

export class ExternalOwnerLearningService {
  readonly #path: string;
  #queue: Promise<unknown> = Promise.resolve();
  constructor(stateDirectory: string) {
    this.#path = resolve(stateDirectory, "external-owner-learning.json");
  }
  async list(): Promise<ExternalLearningCollection> {
    const state = await this.#read();
    return externalLearningCollectionSchema.parse({
      schemaVersion: 1,
      provenance: "local_consented_owner_learning",
      automaticSpendLimitUsd: 0,
      sessions: state.sessions,
    });
  }
  create(input: unknown, idempotencyKey: string, now = Date.now()) {
    return this.#serialize(async () => {
      const value = externalLearningCreateSchema.parse(input);
      validateKey(idempotencyKey);
      const state = await this.#read();
      const bound = state.idempotency[idempotencyKey];
      if (bound) return requireSession(state, bound);
      if (value.startedAt > now + 60_000)
        throw new LearningServiceError("Start time cannot be in the future.");
      const id = `learning_${hash(`${idempotencyKey}:${value.participantAlias}:${value.startedAt}`).slice(0, 20)}`;
      const session = externalLearningSessionSchema.parse({
        schemaVersion: 1,
        id,
        revision: 1,
        status: "draft",
        participantAlias: value.participantAlias,
        consentedAt: now,
        scenario: value.scenario,
        startedAt: value.startedAt,
        completedAt: null,
        timeToPreviewSeconds: null,
        trustRating: null,
        frictions: [],
        note: "",
        evidenceDigest: hash(`${id}:draft:${now}`),
        synthetic: false,
      });
      state.sessions = [...state.sessions, session].slice(-50);
      state.idempotency[idempotencyKey] = id;
      await this.#write(state);
      return session;
    });
  }
  complete(id: string, input: unknown) {
    return this.#serialize(async () => {
      const value = externalLearningCompleteSchema.parse(input);
      validateNote(value.note);
      const state = await this.#read();
      const current = requireSession(state, id);
      if (current.status !== "draft")
        throw new LearningServiceError(
          "Only a draft learning session can be completed.",
        );
      if (
        current.revision !== value.expectedRevision ||
        value.completedAt < current.startedAt
      )
        throw new LearningServiceError(
          "Learning session changed or has invalid timing.",
        );
      const { expectedRevision: _expectedRevision, ...completion } = value;
      const next = externalLearningSessionSchema.parse({
        ...current,
        ...completion,
        status: "completed",
        revision: current.revision + 1,
        evidenceDigest: hash(
          JSON.stringify({ id, scenario: current.scenario, ...value }),
        ),
      });
      state.sessions = state.sessions.map((session) =>
        session.id === id ? next : session,
      );
      await this.#write(state);
      return next;
    });
  }
  withdraw(id: string, expectedRevision: number) {
    return this.#serialize(async () => {
      const state = await this.#read();
      const current = requireSession(state, id);
      if (current.revision !== expectedRevision)
        throw new LearningServiceError(
          "Learning session changed. Refresh before continuing.",
        );
      if (current.status === "withdrawn") return current;
      const next = externalLearningSessionSchema.parse({
        ...current,
        status: "withdrawn",
        revision: current.revision + 1,
        note: "",
        evidenceDigest: hash(`${id}:withdrawn:${expectedRevision}`),
      });
      state.sessions = state.sessions.map((session) =>
        session.id === id ? next : session,
      );
      await this.#write(state);
      return next;
    });
  }
  async #read(): Promise<Stored> {
    try {
      const value = JSON.parse(await readFile(this.#path, "utf8")) as Stored;
      if (value.schemaVersion !== 1 || !value.idempotency)
        throw new Error("invalid");
      externalLearningCollectionSchema.parse({
        schemaVersion: 1,
        provenance: "local_consented_owner_learning",
        automaticSpendLimitUsd: 0,
        sessions: value.sessions,
      });
      return value;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT")
        return { schemaVersion: 1, sessions: [], idempotency: {} };
      throw new LearningServiceError(
        "Learning evidence is corrupt. Preserve it before explicit recovery.",
      );
    }
  }
  async #write(state: Stored) {
    await mkdir(resolve(this.#path, ".."), { recursive: true, mode: 0o700 });
    const temporary = `${this.#path}.tmp`;
    await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, {
      mode: 0o600,
    });
    await rename(temporary, this.#path);
  }
  #serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#queue.then(operation, operation);
    this.#queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}
export class LearningServiceError extends Error {
  constructor(message: string) {
    super(message);
  }
}
function requireSession(state: Stored, id: string) {
  const value = state.sessions.find((session) => session.id === id);
  if (!value)
    throw new LearningServiceError("Learning session is unavailable.");
  return value;
}
function validateKey(value: string) {
  if (!/^[a-zA-Z0-9._:-]{16,128}$/.test(value))
    throw new LearningServiceError("A valid idempotency key is required.");
}
function validateNote(value: string) {
  if (
    /(?:api[_-]?key|token|secret|password)\s*[:=]|bearer\s|sk-[a-z0-9]|\/Users\/|\/home\/|@[a-z0-9.-]+\.[a-z]{2,}/i.test(
      value,
    )
  )
    throw new LearningServiceError(
      "The note appears to contain private or credential material.",
    );
}
function hash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}
