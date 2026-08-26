import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  externalLearningCollectionSchema,
  ownerPilotAdvanceSchema,
  ownerPilotCollectionSchema,
  ownerPilotCohortReportSchema,
  ownerPilotCompleteSchema,
  ownerPilotCreateSchema,
  ownerPilotReviewSchema,
  ownerPilotObservationSchema,
  ownerPilotReceiptSchema,
  ownerPilotSummarySchema,
  ownerPilotSessionSchema,
  type ExternalLearningCollection,
  type OwnerJourneyTrustSnapshot,
  type OwnerPilotCollection,
  type OwnerPilotCohortReport,
  type OwnerPilotReview,
  type OwnerPilotReceipt,
  type OwnerPilotSummary,
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
const INTERRUPTION_AFTER_MS = 30 * 60_000;
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
          (session) => ["active", "interrupted"].includes(session.status),
        )
      )
        throw new OwnerPilotError(
          "A pilot session is already active. Resume or withdraw it before starting another.",
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
  reconcile(id: string, input: unknown, now = Date.now()) {
    return this.#serialize(async () => {
      const observation = ownerPilotObservationSchema.parse(input);
      const state = await this.#read();
      let current = requireSession(state, id);
      if (current.projectId !== observation.projectId) throw new OwnerPilotError("Pilot evidence belongs to a different project.");
      if (["completed", "withdrawn"].includes(current.status)) return current;
      const evidence = [
        ["context_ready", observation.contextDigest],
        ["solution_approved", observation.approvedDesignDigest],
        ["first_preview", observation.previewEvidenceDigest],
      ] as const;
      let changed = false;
      for (const [milestone, digest] of evidence) {
        if (current.milestones.some((value) => value.name === milestone)) continue;
        const expected = order[current.milestones.length];
        if (expected !== milestone || digest === null) break;
        const at = Math.max(current.milestones.at(-1)!.at, observation.activityAt);
        current = ownerPilotSessionSchema.parse({
          ...current, status: "active", revision: current.revision + 1,
          milestones: [...current.milestones, { name: milestone, at }],
          previewAt: milestone === "first_preview" ? at : current.previewAt,
          evidenceDigest: hash(`${current.evidenceDigest}:${milestone}:${at}:${digest}`),
        });
        changed = true;
      }
      const lastActivityAt = Math.max(current.startedAt, observation.activityAt);
      if (!changed && current.status === "active" && now - lastActivityAt > INTERRUPTION_AFTER_MS) {
        current = ownerPilotSessionSchema.parse({ ...current, status: "interrupted", revision: current.revision + 1, evidenceDigest: hash(`${current.evidenceDigest}:interrupted:${observation.activityAt}`) });
        changed = true;
      } else if (current.status === "interrupted" && observation.activityAt > current.milestones.at(-1)!.at) {
        current = ownerPilotSessionSchema.parse({ ...current, status: "active", revision: current.revision + 1, evidenceDigest: hash(`${current.evidenceDigest}:resumed:${observation.activityAt}`) });
        changed = true;
      }
      if (changed) { state.sessions = replace(state.sessions, current); await this.#write(state); }
      return current;
    });
  }
  summary(id: string, now = Date.now()): Promise<OwnerPilotSummary> {
    return this.#read().then((state) => summarize(requireSession(state, id), now));
  }
  receipt(id: string): Promise<OwnerPilotReceipt> {
    return this.#read().then((state) => receipt(requireSession(state, id)));
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
      if (value.frictions.includes("none") && value.frictions.length > 1)
        throw new OwnerPilotError(
          "No friction cannot be combined with another friction.",
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
    const completedEvidence = (await this.list()).sessions.filter(
      (session) => session.status === "completed",
    );
    const projectCoverageDigests = [
      ...new Set(completedEvidence.map((session) => hash(session.projectId))),
    ].sort();
    const scenarioCoverage = [
      ...new Set(completedEvidence.map((session) => session.scenario)),
    ].sort();
    const representative =
      projectCoverageDigests.length >= 2 && scenarioCoverage.length >= 2;
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
    const thresholdsPass =
      (learning.completionRatePercent ?? 0) >= 80 &&
      (learning.trustAtLeastFourPercent ?? 0) >= 67 &&
      (learning.medianTimeToPreviewSeconds ?? Number.POSITIVE_INFINITY) <= 1_800;
    const state =
      trust.freshness.state !== "current"
        ? "certification_needed"
        : !learning.eligibleForDecision || !representative
          ? "sample_needed"
          : thresholdsPass && improvements.length
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
          ? learning.completedSessions < 3
            ? `${Math.max(0, 3 - learning.completedSessions)} more completed consented sessions required.`
            : "More representative project or scenario coverage is required."
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
      improvements: state === "improvements_needed" ? improvements : [],
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
          projectCoverageDigests,
          scenarioCoverage,
        }),
      ),
      automaticSpendLimitUsd: 0,
    });
  }
  async cohortReport(
    trust: OwnerJourneyTrustSnapshot,
    now = Date.now(),
  ): Promise<OwnerPilotCohortReport> {
    const review = await this.review(trust, now);
    const learning = trust.learning;
    const completed = (await this.list()).sessions.filter(
      (session) => session.status === "completed",
    );
    const distinctProjectDigests = [
      ...new Set(completed.map((session) => hash(session.projectId))),
    ].sort();
    const scenarios = [...new Set(completed.map((session) => session.scenario))].sort();
    const distinctProjects = distinctProjectDigests.length;
    const distinctScenarios = scenarios.length;
    const missingScenario = (["new_product", "existing_product", "major_feature"] as const).find(
      (scenario) => !scenarios.includes(scenario),
    ) ?? null;
    const repeatedFrictionCount = review.rankedFrictions[0]?.count ?? 0;
    const threshold = (
      metric: OwnerPilotCohortReport["thresholds"][number]["metric"],
      direction: "at_least" | "at_most",
      target: number,
      observed: number | null,
    ) => ({
      metric,
      direction,
      target,
      observed,
      state:
        observed === null
          ? ("not_enough_data" as const)
          : direction === "at_least"
            ? observed >= target
              ? ("passed" as const)
              : ("failed" as const)
            : observed <= target
              ? ("passed" as const)
              : ("failed" as const),
    });
    const thresholds: OwnerPilotCohortReport["thresholds"] = [
      threshold("completed_sessions", "at_least", 3, learning.completedSessions),
      threshold("distinct_projects", "at_least", 2, distinctProjects),
      threshold("distinct_scenarios", "at_least", 2, distinctScenarios),
      threshold("completion_rate_percent", "at_least", 80, learning.completionRatePercent),
      threshold("trust_at_least_four_percent", "at_least", 67, learning.trustAtLeastFourPercent),
      threshold("median_time_to_preview_seconds", "at_most", 1_800, learning.medianTimeToPreviewSeconds),
      threshold("repeated_friction_count", "at_most", 1, repeatedFrictionCount),
    ];
    const coreFailed = thresholds.slice(3, 6).some((item) => item.state === "failed");
    const representative = distinctProjects >= 2 && distinctScenarios >= 2;
    const decision =
      trust.freshness.state !== "current"
        ? "certification_needed"
        : learning.completedSessions < 3 || !representative
          ? "sample_needed"
          : coreFailed
            ? "pause"
            : repeatedFrictionCount >= 2
              ? "improve"
              : "proceed";
    const content = {
      certification_needed: ["Refresh local evidence", "Run the local check before using pilot results.", "Run the local certification check."],
      sample_needed: ["More real sessions needed", `${Math.max(0, 3 - learning.completedSessions)} more completed consented sessions are required.`, "Complete the next consented project session."],
      pause: ["Pause and correct the journey", "One or more core outcome thresholds failed.", "Review the failed thresholds before starting more delivery work."],
      improve: ["Improve before expanding", "Core outcomes passed, but repeated friction needs correction.", "Review the evidence-backed improvement preview."],
      proceed: ["Evidence supports proceeding", "The bounded real-pilot thresholds passed without repeated material friction.", "Proceed with the next bounded product increment."],
    } as const;
    const nextSession =
      learning.completedSessions === 0
        ? { action: "complete_session" as const, scenario: "new_product" as const, instruction: "Complete one real project journey from idea to first preview." }
        : distinctProjects < 2
          ? { action: "add_project" as const, scenario: missingScenario, instruction: "Run the next session on a different project." }
          : distinctScenarios < 2
            ? { action: "add_scenario" as const, scenario: missingScenario, instruction: `Run a ${missingScenario ? missingScenario.replaceAll("_", " ") : "different"} scenario next.` }
            : learning.completedSessions < 3
              ? { action: "complete_session" as const, scenario: missingScenario, instruction: "Complete one more representative project session." }
              : { action: "review_decision" as const, scenario: null, instruction: "Review the evidence-backed cohort decision." };
    const [title, baseReason, baseNextAction] = content[decision];
    const reason = decision === "sample_needed" && learning.completedSessions >= 3
      ? "The minimum sample exists, but project or scenario coverage is not representative yet."
      : baseReason;
    const nextAction = decision === "sample_needed" ? nextSession.instruction : baseNextAction;
    const evidenceDigest = hash(JSON.stringify({
      review: review.evidenceDigest,
      distinctProjectDigests,
      scenarios,
      thresholds,
    }));
    return ownerPilotCohortReportSchema.parse({
      schemaVersion: 1,
      provenance: "privacy_safe_real_owner_pilot_cohort",
      observedAt: now,
      decision,
      title,
      reason,
      nextAction,
      thresholds,
      completedSessions: learning.completedSessions,
      minimumSampleSize: 3,
      distinctProjects,
      minimumDistinctProjects: 2,
      distinctScenarios,
      minimumDistinctScenarios: 2,
      nextSession,
      completionRatePercent: learning.completionRatePercent,
      medianTimeToPreviewSeconds: learning.medianTimeToPreviewSeconds,
      trustAtLeastFourPercent: learning.trustAtLeastFourPercent,
      rankedFrictions: review.rankedFrictions,
      evidenceDigest,
      automaticSpendLimitUsd: 0,
      privacy: {
        prompts: false,
        sourceCode: false,
        sessionNotes: false,
        attachments: false,
        credentials: false,
        absolutePaths: false,
        personalIdentifiers: false,
        privateJiraContent: false,
      },
      limitations: [
        "This bounded pilot evidence is not external adoption or market validation.",
        "Only aggregate consented session outcomes are included.",
      ],
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
function summarize(session: OwnerPilotSession, now: number): OwnerPilotSummary {
  const preview = session.previewAt === null ? null : Math.max(1, Math.round((session.previewAt - session.startedAt) / 1_000));
  const state = session.status === "active" && preview !== null ? "preview_ready" : session.status;
  const nextAction = session.status === "completed" ? "Review the privacy-safe session receipt."
    : session.status === "withdrawn" ? "No action is needed; consent was withdrawn."
      : session.status === "interrupted" ? "Resume the project or withdraw this pilot session."
        : preview !== null ? "Complete the session with a trust rating and friction feedback."
          : "No action needed; Codkesh is measuring verified project progress.";
  return ownerPilotSummarySchema.parse({ schemaVersion: 1, state, provenMilestones: session.milestones.length, totalMilestones: 5, elapsedSeconds: Math.min(604_800, Math.max(0, Math.round(((session.completedAt ?? now) - session.startedAt) / 1_000))), timeToPreviewSeconds: preview, nextAction, evidenceDigest: session.evidenceDigest, automaticSpendLimitUsd: 0 });
}
function receipt(session: OwnerPilotSession): OwnerPilotReceipt {
  return ownerPilotReceiptSchema.parse({
    schemaVersion: 1, provenance: "privacy_safe_real_owner_pilot", receiptId: `pilot_receipt_${hash(session.id).slice(0, 20)}`,
    sessionId: session.id, projectIdDigest: hash(session.projectId), scenario: session.scenario, status: session.status,
    milestones: session.milestones.map((milestone) => ({ name: milestone.name, elapsedSeconds: Math.max(0, Math.round((milestone.at - session.startedAt) / 1_000)) })),
    timeToPreviewSeconds: session.previewAt === null ? null : Math.max(1, Math.round((session.previewAt - session.startedAt) / 1_000)),
    trustRating: session.trustRating, frictions: session.frictions, evidenceDigest: session.evidenceDigest, automaticSpendLimitUsd: 0,
    privacy: { prompts: false, sourceCode: false, attachments: false, credentials: false, absolutePaths: false, personalIdentifiers: false, privateJiraContent: false },
    limitations: ["This receipt measures one consented owner journey; it is not market validation.", "Raw project content and participant identity are excluded."],
  });
}
