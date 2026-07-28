import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import {
  providerJournalDocumentSchema,
  type ProviderAttemptRecord,
  type ProviderJournalDocument,
  type ProviderJournalEvent
} from "../../schemas/src/index.js";
export type {
  ProviderAttemptRecord,
  ProviderJournalDocument,
  ProviderJournalEvent
} from "../../schemas/src/index.js";

export type ProviderTaskStatus =
  | "ready"
  | "running"
  | "deferred"
  | "needs_user"
  | "succeeded";

export type ProviderJournalEventInput = ProviderJournalEvent extends infer Event
  ? Event extends ProviderJournalEvent
    ? Omit<Event, "sequence" | "eventId" | "taskId">
    : never
  : never;

export interface ProviderJournalProjection {
  readonly taskId: string;
  readonly workUnitId: string;
  readonly requestDigest: string;
  readonly lastSequence: number;
  readonly runNumber: number;
  readonly status: ProviderTaskStatus;
  readonly attempts: readonly ProviderAttemptRecord[];
  readonly selectedCandidateId: string | null;
  readonly outputDigest: string | null;
  readonly retryAt: number | null;
  readonly statusReason: string | null;
}

export class JsonProviderJournalStore {
  public constructor(private readonly filePath: string) {}

  public async load(input: {
    readonly taskId: string;
    readonly workUnitId: string;
    readonly requestDigest: string;
  }): Promise<ProviderJournalDocument> {
    try {
      const document = parseProviderJournal(await readFile(this.filePath, "utf8"));
      assertJournalIdentity(document, input);
      replayProviderJournal(document);
      return document;
    } catch (error) {
      if (isMissingFile(error)) {
        return {
          schemaVersion: 1,
          taskId: input.taskId,
          workUnitId: input.workUnitId,
          requestDigest: input.requestDigest,
          events: []
        };
      }
      throw error;
    }
  }

  public async save(document: ProviderJournalDocument): Promise<void> {
    const validated = providerJournalDocumentSchema.parse(document);
    replayProviderJournal(validated);
    await mkdir(dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.next`;
    await writeFile(temporaryPath, `${JSON.stringify(validated, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600
    });
    await rename(temporaryPath, this.filePath);
  }
}

export function appendProviderEvent(
  document: ProviderJournalDocument,
  event: ProviderJournalEventInput
): ProviderJournalDocument {
  const sequence = document.events.length + 1;
  const next = {
    ...event,
    sequence,
    eventId: `${document.taskId}:provider:${sequence}`,
    taskId: document.taskId
  } as ProviderJournalEvent;
  const updated = providerJournalDocumentSchema.parse({
    ...document,
    events: [...document.events, next]
  });
  replayProviderJournal(updated);
  return updated;
}

export function replayProviderJournal(
  document: ProviderJournalDocument
): ProviderJournalProjection {
  assertJournalIdentity(document, document);
  let projection: ProviderJournalProjection = {
    taskId: document.taskId,
    workUnitId: document.workUnitId,
    requestDigest: document.requestDigest,
    lastSequence: 0,
    runNumber: 0,
    status: "ready",
    attempts: [],
    selectedCandidateId: null,
    outputDigest: null,
    retryAt: null,
    statusReason: null
  };
  const eventIds = new Set<string>();
  for (const event of document.events) {
    if (event.sequence !== projection.lastSequence + 1) {
      throw new Error("Provider journal sequence is not contiguous.");
    }
    if (event.taskId !== document.taskId) throw new Error("Provider journal task identity changed.");
    if (eventIds.has(event.eventId)) throw new Error("Provider journal event is duplicated.");
    eventIds.add(event.eventId);
    projection = applyEvent(projection, event);
  }
  return projection;
}

export function parseProviderJournal(serialized: string): ProviderJournalDocument {
  return providerJournalDocumentSchema.parse(JSON.parse(serialized));
}

function applyEvent(
  projection: ProviderJournalProjection,
  event: ProviderJournalEvent
): ProviderJournalProjection {
  const base = { ...projection, lastSequence: event.sequence };
  switch (event.type) {
    case "provider.task_initialized":
      if (event.sequence !== 1) throw new Error("Provider task initialization must be first.");
      if (
        event.workUnitId !== projection.workUnitId ||
        event.requestDigest !== projection.requestDigest
      ) {
        throw new Error("Provider task initialization identity is invalid.");
      }
      return base;
    case "provider.run_started":
      if (!["ready", "deferred"].includes(projection.status)) {
        throw new Error("Provider run cannot start from the current state.");
      }
      if (event.runNumber !== projection.runNumber + 1) {
        throw new Error("Provider run number is not monotonic.");
      }
      return {
        ...base,
        runNumber: event.runNumber,
        status: "running",
        retryAt: null,
        statusReason: null
      };
    case "provider.route_recorded":
      if (projection.status !== "running" || event.runNumber !== projection.runNumber) {
        throw new Error("Recorded route belongs to a different provider run.");
      }
      return base;
    case "provider.call_started":
      if (projection.status !== "running") throw new Error("Provider call requires a running task.");
      if (event.attempt.runNumber !== projection.runNumber) {
        throw new Error("Provider attempt belongs to a different run.");
      }
      if (projection.attempts.some((attempt) => attempt.idempotencyKey === event.attempt.idempotencyKey)) {
        throw new Error("Provider idempotency key is duplicated.");
      }
      return { ...base, attempts: [...projection.attempts, event.attempt] };
    case "provider.call_failed":
      return {
        ...base,
        attempts: updateAttempt(projection.attempts, event.idempotencyKey, {
          status: "failed",
          finishedAt: event.occurredAt,
          failureClass: event.failureClass,
          failureCode: event.failureCode,
          retryAt: event.retryAt
        })
      };
    case "provider.call_succeeded": {
      const attempts = updateAttempt(projection.attempts, event.idempotencyKey, {
        status: "succeeded",
        finishedAt: event.occurredAt,
        outputDigest: event.outputDigest,
        inputTokens: event.inputTokens,
        outputTokens: event.outputTokens
      });
      const attempt = attempts.find((item) => item.idempotencyKey === event.idempotencyKey);
      return {
        ...base,
        attempts,
        status: "succeeded",
        selectedCandidateId: attempt?.candidateId ?? null,
        outputDigest: event.outputDigest,
        retryAt: null,
        statusReason: null
      };
    }
    case "provider.task_deferred":
      if (projection.status !== "running") throw new Error("Only running provider work can defer.");
      return {
        ...base,
        status: "deferred",
        retryAt: event.retryAt,
        statusReason: event.reason
      };
    case "provider.task_needs_user":
      if (projection.status !== "running") throw new Error("Only running provider work can need user.");
      return {
        ...base,
        status: "needs_user",
        retryAt: null,
        statusReason: event.reason
      };
  }
}

function updateAttempt(
  attempts: readonly ProviderAttemptRecord[],
  idempotencyKey: string,
  update: Partial<ProviderAttemptRecord>
): readonly ProviderAttemptRecord[] {
  let found = false;
  const updated = attempts.map((attempt) => {
    if (attempt.idempotencyKey !== idempotencyKey) return attempt;
    if (attempt.status !== "started") throw new Error("Provider attempt is already terminal.");
    found = true;
    return { ...attempt, ...update };
  });
  if (!found) throw new Error("Provider attempt does not exist.");
  return updated;
}

function assertJournalIdentity(
  document: Pick<ProviderJournalDocument, "taskId" | "workUnitId" | "requestDigest">,
  expected: Pick<ProviderJournalDocument, "taskId" | "workUnitId" | "requestDigest">
): void {
  if (
    !document.taskId ||
    !document.workUnitId ||
    !document.requestDigest ||
    document.taskId !== expected.taskId ||
    document.workUnitId !== expected.workUnitId ||
    document.requestDigest !== expected.requestDigest
  ) {
    throw new Error("Provider journal identity does not match the requested work.");
  }
}

function isMissingFile(error: unknown): boolean {
  return isRecord(error) && error.code === "ENOENT";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
