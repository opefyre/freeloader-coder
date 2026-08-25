import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  externalLearningCollectionSchema,
  ownerPilotAdvanceSchema,
  ownerPilotCollectionSchema,
  ownerPilotCompleteSchema,
  ownerPilotCreateSchema,
  ownerPilotReviewSchema,
  ownerPilotSessionSchema,
  type ExternalLearningCollection,
  type OwnerJourneyTrustSnapshot,
  type OwnerPilotCollection,
  type OwnerPilotReview,
  type OwnerPilotSession,
} from "../../../packages/runtime/src/owner-journey-certification.js";

type Stored = {
  schemaVersion: 1;
  sessions: OwnerPilotSession[];
  idempotency: Record<string, string>;
};
const order = [
  "session_started",
  "context_ready",
  "solution_approved",
  "first_preview",
  "session_completed",
] as const;
const labels = {
  setup: [
    "Simplify pilot setup",
    "Owners encountered repeated setup friction.",
    "Reduce required setup steps and add deterministic recovery guidance.",
  ],
  navigation: [
    "Clarify the owner journey",
    "Owners repeatedly struggled to find the next action.",
    "Make the current step and single next action unmistakable.",
  ],
  trust: [
    "Strengthen evidence and trust",
    "Owners repeatedly lacked confidence in the presented evidence.",
    "Expose concise source, validation, and rollback evidence at the decision point.",
  ],
  clarity: [
    "Improve decision clarity",
    "Owners repeatedly found decisions or outcomes unclear.",
    "Rewrite the decision surface around outcome, impact, and bounded options.",
  ],
  speed: [
    "Reduce time to first preview",
    "Owners repeatedly waited too long for the first useful preview.",
    "Shorten the critical path and surface honest progress while work continues.",
  ],
  approval: [
    "Streamline approvals",
    "Owners repeatedly encountered approval friction.",
    "Consolidate approval context and preserve one clear approve, edit, or decline action.",
  ],
} as const;

export class OwnerPilotService {
  readonly #path: string;
  #queue: Promise<unknown> = Promise.resolve();
  constructor(stateDirectory: string) {
    this.#path = resolve(stateDirectory, "owner-pilot.json");
  }
  async list(): Promise<OwnerPilotCollection> {
    const state = await this.#read();
    return ownerPilotCollectionSchema.parse({
      schemaVersion: 1,
      provenance: "local_consented_owner_pilot",
      sessions: state.sessions,
      automaticSpendLimitUsd: 0,
    });
  }
  create(input: unknown, key: string, now = Date.now()) {
    return this.#serialize(async () => {
      validateKey(key);
      const value = ownerPilotCreateSchema.parse(input);
      if (value.startedAt > now + 60_000)
        throw new OwnerPilotError("Start time cannot be in the future.");
      const state = await this.#read();
      const replay = state.idempotency[key];
      if (replay) return requireSession(state, replay);
      if (
        state.sessions.some(
          (session) =>
            session.projectId === value.projectId &&
            session.status === "active",
        )
      )
        throw new OwnerPilotError(
          "This project already has an active pilot session.",
        );
      const id = `pilot_${hash(`${key}:${value.projectId}:${value.startedAt}`).slice(0, 20)}`;
      const session = ownerPilotSessionSchema.parse({
        schemaVersion: 1,
        id,
        projectId: value.projectId,
        revision: 1,
        status: "active",
        scenario: value.scenario,
        consentedAt: now,
        startedAt: value.startedAt,
        previewAt: null,
        completedAt: null,
        milestones: [{ name: "session_started", at: value.startedAt }],
        trustRating: null,
        frictions: [],
        note: "",
        evidenceDigest: hash(`${id}:started:${now}`),
        automaticSpendLimitUsd: 0,
      });
      state.sessions = [...state.sessions, session].slice(-50);
      state.idempotency[key] = id;
      await this.#write(state);
      return session;
    });
  }
  advance(id: string, input: unknown) {
    return this.#serialize(async () => {
      const value = ownerPilotAdvanceSchema.parse(input);
      const state = await this.#read();
      const current = requireSession(state, id);
      if (
        current.status !== "active" ||
        current.revision !== value.expectedRevision
      )
        throw new OwnerPilotError(
          "Pilot session changed. Refresh before continuing.",
        );
      const expected = order[current.milestones.length];
      if (
        value.milestone !== expected ||
        value.at < current.milestones.at(-1)!.at
      )
        throw new OwnerPilotError(
          "Pilot milestones must be recorded once and in order.",
        );
      const next = ownerPilotSessionSchema.parse({
        ...current,
        revision: current.revision + 1,
        milestones: [
          ...current.milestones,
          { name: value.milestone, at: value.at },
        ],
        previewAt:
          value.milestone === "first_preview" ? value.at : current.previewAt,
        evidenceDigest: hash(
          `${current.evidenceDigest}:${value.milestone}:${value.at}`,
        ),
      });
      state.sessions = replace(state.sessions, next);
      await this.#write(state);
      return next;
    });
  }
  complete(id: string, input: unknown) {
    return this.#serialize(async () => {
      const value = ownerPilotCompleteSchema.parse(input);
      validateNote(value.note);
      const state = await this.#read();
      const current = requireSession(state, id);
      if (
        current.status !== "active" ||
        current.revision !== value.expectedRevision
      )
        throw new OwnerPilotError(
          "Pilot session changed. Refresh before continuing.",
        );
      if (
        current.milestones.at(-1)?.name !== "first_preview" ||
        current.previewAt === null
      )
        throw new OwnerPilotError(
          "Record the first preview before completing this session.",
        );
      if (value.completedAt < current.previewAt)
        throw new OwnerPilotError(
          "Completion time cannot precede the first preview.",
        );
      const next = ownerPilotSessionSchema.parse({
        ...current,
        revision: current.revision + 1,
        status: "completed",
        completedAt: value.completedAt,
        milestones: [
          ...current.milestones,
          { name: "session_completed", at: value.completedAt },
        ],
        trustRating: value.trustRating,
        frictions: [...new Set(value.frictions)],
        note: value.note,
        evidenceDigest: hash(
          JSON.stringify({
            id,
            revision: current.revision,
            completedAt: value.completedAt,
            trustRating: value.trustRating,
            frictions: [...new Set(value.frictions)],
          }),
        ),
        automaticSpendLimitUsd: 0,
      });
      state.sessions = replace(state.sessions, next);
      await this.#write(state);
      return next;
    });
  }
  withdraw(id: string, expectedRevision: number) {
    return this.#serialize(async () => {
      const state = await this.#read();
      const current = requireSession(state, id);
      if (current.revision !== expectedRevision)
        throw new OwnerPilotError(
          "Pilot session changed. Refresh before continuing.",
        );
      if (current.status === "withdrawn") return current;
      const next = ownerPilotSessionSchema.parse({
        ...current,
        revision: current.revision + 1,
        status: "withdrawn",
        trustRating: null,
        frictions: [],
        note: "",
        evidenceDigest: hash(`${id}:withdrawn:${expectedRevision}`),
      });
      state.sessions = replace(state.sessions, next);
      await this.#write(state);
      return next;
    });
  }
  async learningCollection(): Promise<ExternalLearningCollection> {
    const sessions = (await this.list()).sessions.map((session) => ({
      schemaVersion: 1 as const,
      id: `learning_${hash(session.id).slice(0, 20)}`,
      revision: session.revision,
      status:
        session.status === "completed"
          ? ("completed" as const)
          : session.status === "withdrawn"
            ? ("withdrawn" as const)
            : ("draft" as const),
      participantAlias: `participant-${hash(session.id).slice(0, 8)}`,
      consentedAt: session.consentedAt,
      scenario: session.scenario,
      startedAt: session.startedAt,
      completedAt: session.completedAt,
      timeToPreviewSeconds:
        session.previewAt === null
          ? null
          : Math.max(
              1,
              Math.round((session.previewAt - session.startedAt) / 1_000),
            ),
      trustRating: session.trustRating,
      frictions: session.frictions,
      note: session.note,
      evidenceDigest: session.evidenceDigest,
      synthetic: false as const,
    }));
    return externalLearningCollectionSchema.parse({
      schemaVersion: 1,
      provenance: "local_consented_owner_learning",
      automaticSpendLimitUsd: 0,
      sessions,
    });
  }
  async review(
    trust: OwnerJourneyTrustSnapshot,
    now = Date.now(),
  ): Promise<OwnerPilotReview> {
    const learning = trust.learning;
    const rankedFrictions = Object.entries(learning.frictionCounts)
      .filter(([category, count]) => category !== "none" && count > 0)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([category, count]) => ({ category, count }));
    const improvements = rankedFrictions
      .filter(({ count }) => count >= 2)
      .map(({ category, count }) => {
        const [title, problem, recommendation] =
          labels[category as keyof typeof labels];
        return {
          id: `improvement_${hash(`${category}:${count}`).slice(0, 20)}`,
          category,
          title,
          problem,
          recommendation,
          evidenceCount: count,
          priority:
            count >= Math.max(3, Math.ceil(learning.completedSessions / 2))
              ? ("high" as const)
              : ("medium" as const),
          estimatedSize: ["speed", "setup"].includes(category)
            ? ("medium" as const)
            : ("small" as const),
          dependencies: [],
          acceptanceCriteria: [
            `The ${category} friction is measurably reduced in the next three completed consented sessions.`,
            "The owner journey remains local-first, privacy-safe, restart-safe, and $0 by default.",
          ],
          evidenceDigest: hash(`${trust.observedAt}:${category}:${count}`),
        };
      });
    const state =
      trust.freshness.state !== "current"
        ? "certification_needed"
        : !learning.eligibleForDecision
          ? "sample_needed"
          : improvements.length
            ? "improvements_needed"
            : "review_ready";
    const title = (
      {
        certification_needed: "Local check needed",
        sample_needed: "More pilot sessions needed",
        improvements_needed: "Pilot improvements ready",
        review_ready: "Pilot evidence ready",
      } as const
    )[state];
    const reason =
      state === "certification_needed"
        ? "Current local certification is required before pilot evidence can be reviewed."
        : state === "sample_needed"
          ? `${Math.max(0, 3 - learning.completedSessions)} more completed consented sessions required.`
          : state === "improvements_needed"
            ? `${improvements.length} evidence-backed improvement${improvements.length === 1 ? "" : "s"} are ready for owner review.`
            : "Current certification and bounded pilot thresholds passed without repeated material friction.";
    return ownerPilotReviewSchema.parse({
      schemaVersion: 1,
      provenance: "privacy_safe_owner_pilot_review",
      observedAt: now,
      state,
      title,
      reason,
      completedSessions: learning.completedSessions,
      minimumSampleSize: 3,
      completionRatePercent: learning.completionRatePercent,
      medianTimeToPreviewSeconds: learning.medianTimeToPreviewSeconds,
      trustAtLeastFourPercent: learning.trustAtLeastFourPercent,
      rankedFrictions,
      improvements,
      limitations: [
        "This bounded pilot evidence is not external adoption or market validation.",
        "Participant identities, prompts, source code, attachments, credentials, and raw notes are excluded.",
      ],
      evidenceDigest: hash(
        JSON.stringify({
          freshness: trust.freshness.state,
          completed: learning.completedSessions,
          completion: learning.completionRatePercent,
          median: learning.medianTimeToPreviewSeconds,
          trust: learning.trustAtLeastFourPercent,
          rankedFrictions,
        }),
      ),
      automaticSpendLimitUsd: 0,
    });
  }
  async #read(): Promise<Stored> {
    try {
      const value = JSON.parse(await readFile(this.#path, "utf8")) as Stored;
      if (value.schemaVersion !== 1 || !value.idempotency)
        throw new Error("invalid");
      ownerPilotCollectionSchema.parse({
        schemaVersion: 1,
        provenance: "local_consented_owner_pilot",
        sessions: value.sessions,
        automaticSpendLimitUsd: 0,
      });
      return value;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT")
        return { schemaVersion: 1, sessions: [], idempotency: {} };
      throw new OwnerPilotError(
        "Pilot evidence is corrupt. Preserve it before explicit recovery.",
      );
    }
  }
  async #write(value: Stored) {
    await mkdir(resolve(this.#path, ".."), { recursive: true, mode: 0o700 });
    const temporary = `${this.#path}.tmp`;
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
      mode: 0o600,
    });
    await rename(temporary, this.#path);
  }
  #serialize<T>(operation: () => Promise<T>) {
    const result = this.#queue.then(operation, operation);
    this.#queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}

export class OwnerPilotError extends Error {}
function replace(values: OwnerPilotSession[], next: OwnerPilotSession) {
  return values.map((value) => (value.id === next.id ? next : value));
}
function requireSession(state: Stored, id: string) {
  const session = state.sessions.find((value) => value.id === id);
  if (!session) throw new OwnerPilotError("Pilot session is unavailable.");
  return session;
}
function validateKey(value: string) {
  if (!/^[a-zA-Z0-9._:-]{16,128}$/.test(value))
    throw new OwnerPilotError("A valid idempotency key is required.");
}
function validateNote(value: string) {
  if (
    /(?:api[_-]?key|token|secret|password)\s*[:=]|bearer\s|sk-[a-z0-9]|\/Users\/|\/home\/|@[a-z0-9.-]+\.[a-z]{2,}/i.test(
      value,
    )
  )
    throw new OwnerPilotError(
      "The note appears to contain private or credential material.",
    );
}
function hash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}
