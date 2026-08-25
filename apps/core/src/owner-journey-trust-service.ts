import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  certificationFreshnessSchema,
  externalLearningAggregateSchema,
  ownerJourneyTrustSnapshotSchema,
  pilotReadinessSchema,
  type ExternalLearningCollection,
  type OwnerJourneyCertificationSnapshot,
  type OwnerJourneyTrustSnapshot,
} from "../../../packages/runtime/src/owner-journey-certification.js";

const DAY = 86_400_000;
const DEFAULT_CADENCE = 7 * DAY;
const OVERDUE_GRACE = DAY;
const RETRY_DELAY = 6 * 60 * 60_000;

type Stored = {
  schemaVersion: 1;
  revision: number;
  lastTickAt: number | null;
  lastAttemptAt: number | null;
  retryAt: number | null;
  failureCount: number;
};

const empty: Stored = { schemaVersion: 1, revision: 1, lastTickAt: null, lastAttemptAt: null, retryAt: null, failureCount: 0 };

export class OwnerJourneyTrustService {
  readonly #path: string;
  #active: Promise<OwnerJourneyTrustSnapshot> | null = null;
  constructor(
    stateDirectory: string,
    private readonly certification: { snapshot(now?: number): Promise<OwnerJourneyCertificationSnapshot>; run(key: string, now?: number): Promise<unknown> },
    private readonly learning: { list(): Promise<ExternalLearningCollection> },
    private readonly cadenceMs = DEFAULT_CADENCE,
  ) {
    if (cadenceMs < DAY || cadenceMs > 30 * DAY) throw new TrustServiceError("Freshness cadence is outside the safe range.");
    this.#path = resolve(stateDirectory, "owner-journey-trust.json");
  }

  async snapshot(now = Date.now()): Promise<OwnerJourneyTrustSnapshot> {
    const [certification, learning, stored] = await Promise.all([this.certification.snapshot(now), this.learning.list(), this.#read()]);
    return buildTrustSnapshot(certification, learning, stored, now, this.cadenceMs);
  }

  tick(now = Date.now()): Promise<OwnerJourneyTrustSnapshot> {
    if (this.#active) return this.#active;
    this.#active = this.#tick(now).finally(() => { this.#active = null; });
    return this.#active;
  }

  async #tick(now: number) {
    const state = await this.#read();
    const before = await this.snapshot(now);
    if (!["due", "overdue", "not_run", "failed"].includes(before.freshness.state) || (state.retryAt !== null && state.retryAt > now)) {
      if (state.lastTickAt !== now) await this.#write({ ...state, revision: state.revision + 1, lastTickAt: now });
      return this.snapshot(now);
    }
    const attempt: Stored = { ...state, revision: state.revision + 1, lastTickAt: now, lastAttemptAt: now };
    await this.#write(attempt);
    try {
      await this.certification.run(`certification.auto.${hash(String(Math.floor(now / this.cadenceMs))).slice(0, 24)}`, now);
      await this.#write({ ...attempt, revision: attempt.revision + 1, retryAt: null, failureCount: 0 });
    } catch {
      await this.#write({ ...attempt, revision: attempt.revision + 1, retryAt: now + RETRY_DELAY, failureCount: Math.min(10, state.failureCount + 1) });
    }
    return this.snapshot(now);
  }

  async #read(): Promise<Stored> {
    try {
      const value = JSON.parse(await readFile(this.#path, "utf8")) as Stored;
      if (value.schemaVersion !== 1 || !Number.isInteger(value.revision) || value.revision < 1 || !Number.isInteger(value.failureCount) || value.failureCount < 0 || value.failureCount > 10) throw new Error("invalid");
      for (const timestamp of [value.lastTickAt, value.lastAttemptAt, value.retryAt]) if (timestamp !== null && (!Number.isInteger(timestamp) || timestamp < 0)) throw new Error("invalid");
      return value;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return structuredClone(empty);
      throw new TrustServiceError("Trust freshness state is corrupt. Preserve it before explicit recovery.");
    }
  }
  async #write(value: Stored) {
    await mkdir(resolve(this.#path, ".."), { recursive: true, mode: 0o700 });
    const temporary = `${this.#path}.tmp`;
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
    await rename(temporary, this.#path);
  }
}

export function buildTrustSnapshot(certification: OwnerJourneyCertificationSnapshot, collection: ExternalLearningCollection, stored: Stored, now: number, cadenceMs = DEFAULT_CADENCE) {
  const completed = collection.sessions.filter((session) => session.status === "completed");
  const attempted = collection.sessions.filter((session) => session.status !== "withdrawn");
  const times = completed.map((session) => session.timeToPreviewSeconds!).sort((a, b) => a - b);
  const ratings = completed.map((session) => session.trustRating!);
  const frictionCounts = Object.fromEntries(["setup", "navigation", "trust", "clarity", "speed", "approval", "none"].map((name) => [name, 0])) as Record<string, number>;
  for (const session of completed) for (const friction of new Set(session.frictions)) frictionCounts[friction] = (frictionCounts[friction] ?? 0) + 1;
  const eligible = completed.length >= 3;
  const learning = externalLearningAggregateSchema.parse({
    schemaVersion: 1, provenance: "privacy_safe_external_learning_aggregate", observedAt: now,
    completedSessions: completed.length, eligibleForDecision: eligible, minimumSampleSize: 3,
    completionRatePercent: attempted.length ? Math.round(completed.length / attempted.length * 100) : null,
    medianTimeToPreviewSeconds: times.length ? median(times) : null,
    averageTrustRating: ratings.length ? Number((ratings.reduce((sum, value) => sum + value, 0) / ratings.length).toFixed(2)) : null,
    trustAtLeastFourPercent: ratings.length ? Math.round(ratings.filter((value) => value >= 4).length / ratings.length * 100) : null,
    frictionCounts, excludedDrafts: collection.sessions.filter((session) => session.status === "draft").length,
    excludedWithdrawn: collection.sessions.filter((session) => session.status === "withdrawn").length,
    automaticSpendLimitUsd: 0,
    limitations: eligible ? ["This is bounded pilot-learning evidence, not external adoption or market validation."] : ["At least three completed consented sessions are required before a pilot-readiness decision."],
  });
  const lastPassedAt = certification.lastPassedReceipt ? Date.parse(certification.lastPassedReceipt.completedAt) : null;
  const dueAt = lastPassedAt === null ? null : lastPassedAt + cadenceMs;
  const retryBlocked = stored.retryAt !== null && stored.retryAt > now;
  let freshnessState: "current" | "due" | "overdue" | "running" | "failed" | "not_run" = "not_run";
  if (certification.state === "running") freshnessState = "running";
  else if (certification.state === "failed" && retryBlocked) freshnessState = "failed";
  else if (lastPassedAt === null) freshnessState = "not_run";
  else if (now > (dueAt ?? 0) + OVERDUE_GRACE) freshnessState = "overdue";
  else if (now >= (dueAt ?? 0)) freshnessState = "due";
  else freshnessState = "current";
  const nextCheckAt = retryBlocked ? stored.retryAt! : dueAt ?? now;
  const freshness = certificationFreshnessSchema.parse({
    schemaVersion: 1, provenance: "local_certification_freshness", state: freshnessState, observedAt: now,
    lastPassedAt, nextCheckAt, dueAt, retryAt: stored.retryAt, cadenceMs, automaticSpendLimitUsd: 0,
    message: freshnessState === "current" ? "Local certification is current." : freshnessState === "running" ? "Local certification is running." : freshnessState === "failed" ? "The last automatic check failed safely and will retry later." : "Local certification is due.",
  });
  const readiness = buildReadiness(freshness.state, learning, now);
  return ownerJourneyTrustSnapshotSchema.parse({ schemaVersion: 1, provenance: "local_owner_journey_trust", observedAt: now, validForMs: 15_000, freshness, learning, readiness, automaticSpendLimitUsd: 0 });
}

function buildReadiness(freshness: ReturnType<typeof certificationFreshnessSchema.parse>["state"], learning: ReturnType<typeof externalLearningAggregateSchema.parse>, now: number) {
  if (freshness !== "current") return pilotReadinessSchema.parse({ schemaVersion: 1, provenance: "local_pilot_readiness_policy", observedAt: now, state: "certification_needed", title: "Local check needed", reason: "Current local certification is required before pilot evidence can be reviewed.", nextAction: "Run the local check", reasons: [freshness], automaticSpendLimitUsd: 0 });
  if (!learning.eligibleForDecision) return pilotReadinessSchema.parse({ schemaVersion: 1, provenance: "local_pilot_readiness_policy", observedAt: now, state: "learning_needed", title: "More owner sessions needed", reason: `${Math.max(0, learning.minimumSampleSize - learning.completedSessions)} more completed consented session${learning.completedSessions === 2 ? "" : "s"} required.`, nextAction: "Record a consented owner session", reasons: ["Minimum privacy-safe sample has not been reached."], automaticSpendLimitUsd: 0 });
  const reasons = [learning.completionRatePercent! < 70 ? "Completion rate is below 70%." : null, learning.medianTimeToPreviewSeconds! > 1_800 ? "Median time to preview is above 30 minutes." : null, learning.trustAtLeastFourPercent! < 67 ? "Fewer than 67% of ratings are 4 or 5." : null].filter((value): value is string => value !== null);
  return pilotReadinessSchema.parse({ schemaVersion: 1, provenance: "local_pilot_readiness_policy", observedAt: now, state: reasons.length ? "thresholds_not_met" : "review_ready", title: reasons.length ? "Pilot improvements needed" : "Pilot evidence ready for review", reason: reasons.length ? "The bounded pilot thresholds are not all met." : "Current certification and the minimum privacy-safe learning thresholds passed.", nextAction: reasons.length ? "Review friction and run another session" : "Review the pilot evidence", reasons, automaticSpendLimitUsd: 0 });
}
function median(values: number[]) { const middle = Math.floor(values.length / 2); return values.length % 2 ? values[middle]! : Math.round((values[middle - 1]! + values[middle]!) / 2); }
function hash(value: string) { return createHash("sha256").update(value).digest("hex"); }
export class TrustServiceError extends Error {}
