import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";

import {
  autonomyAdvanceRequestSchema,
  autonomyModeChangeSchema,
  autonomyMutationResponseSchema,
  autonomyPauseChangeSchema,
  autonomyPreferenceSchema,
  autonomySnapshotSchema,
  coordinatorLeaseSchema,
  coordinatorReceiptSchema,
  requestAutonomyOverrideSchema,
  type AutonomyMode,
  type AutonomyMutationResponse,
  type AutonomySnapshot,
  type CoordinatorAction,
  type CoordinatorLease,
  type CoordinatorReceipt,
} from "../../../packages/runtime/src/autonomy.js";
import type { LocalRequest, LocalRequestCollection } from "../../../packages/runtime/src/local-requests.js";
import { planSafeNextAction } from "../../../packages/orchestration/src/safe-next-action.js";

const stateSchema = z.strictObject({
  schemaVersion: z.literal(1),
  preferences: z.array(autonomyPreferenceSchema).max(100),
  overrides: z.array(requestAutonomyOverrideSchema).max(500),
  leases: z.array(coordinatorLeaseSchema).max(100),
  receipts: z.array(coordinatorReceiptSchema).max(100),
});
type State = z.infer<typeof stateSchema>;

export type LocalAutonomyActions = Record<CoordinatorAction, (requestId: string) => Promise<LocalRequest>>;

export class LocalAutonomyService {
  readonly #statePath: string;
  readonly #requests: () => Promise<LocalRequestCollection>;
  readonly #actions: LocalAutonomyActions;
  #writeQueue: Promise<unknown> = Promise.resolve();
  #timer: NodeJS.Timeout | null = null;
  #active = false;

  constructor(
    stateDirectory: string,
    requests: () => Promise<LocalRequestCollection>,
    actions: LocalAutonomyActions,
  ) {
    this.#statePath = resolve(stateDirectory, "autonomy-state.json");
    this.#requests = requests;
    this.#actions = actions;
  }

  start(intervalMs = 5_000): void {
    if (this.#timer) return;
    this.#timer = setInterval(() => void this.tick(), intervalMs);
    this.#timer.unref();
    void this.tick();
  }

  stop(): void {
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = null;
  }

  async snapshot(now = Date.now()): Promise<AutonomySnapshot> {
    const [state, collection] = await Promise.all([this.#load(), this.#requests()]);
    const activeLeases = state.leases.filter((lease) => lease.expiresAt > now);
    const requestIds = new Set(collection.requests.map((request) => request.id));
    const preferences = mergePreferences(state, collection.requests, now);
    const recommendations = collection.requests.map((request) => {
      const preference = preferences.find((item) => item.projectId === request.projectId)!;
      const override = state.overrides.find((item) => item.requestId === request.id);
      return planSafeNextAction({
        request,
        mode: override?.mode ?? preference.mode,
        paused: preference.paused,
        now,
      });
    });
    const waits = recommendations.map((item) => item.retryAt).filter((value): value is number => value !== null && value > now);
    const needsAttention = recommendations.some((item) => item.classification === "attention");
    const health =
      !this.#timer
        ? "stopped"
        : this.#active || activeLeases.length > 0
          ? "active"
          : needsAttention
            ? "attention"
            : waits.length > 0
              ? "waiting"
              : "idle";
    return autonomySnapshotSchema.parse({
      schemaVersion: 1,
      provenance: "local_autonomy_coordinator",
      observedAt: now,
      validForMs: 15_000,
      automaticSpendLimitUsd: 0,
      health,
      running: this.#timer !== null,
      preferences,
      overrides: state.overrides.filter((item) => requestIds.has(item.requestId)),
      recommendations,
      leases: activeLeases,
      receipts: state.receipts.slice(-100).reverse(),
      nextWakeAt: waits.length ? Math.min(...waits) : null,
    });
  }

  setProjectMode(projectId: string, input: unknown): Promise<AutonomyMutationResponse> {
    return this.#serialize(async () => {
      assertProjectId(projectId);
      const change = autonomyModeChangeSchema.parse(input);
      const state = await this.#load();
      const current = state.preferences.find((item) => item.projectId === projectId);
      if (rank(change.mode) > rank(current?.mode ?? "guided") && !change.confirmBroaderAutomation) {
        throw new LocalAutonomyError("confirmation_required", "Confirm the broader automation mode explicitly.");
      }
      const preference = autonomyPreferenceSchema.parse({
        projectId,
        mode: change.mode,
        paused: current?.paused ?? false,
        updatedAt: Date.now(),
      });
      await this.#save({
        ...state,
        preferences: [...state.preferences.filter((item) => item.projectId !== projectId), preference],
      });
      return autonomyMutationResponseSchema.parse({
        schemaVersion: 1,
        outcome: "mode_changed",
        snapshot: await this.snapshot(),
        receipt: null,
      });
    });
  }

  setProjectPaused(projectId: string, input: unknown): Promise<AutonomyMutationResponse> {
    return this.#serialize(async () => {
      assertProjectId(projectId);
      const change = autonomyPauseChangeSchema.parse(input);
      const state = await this.#load();
      const current = state.preferences.find((item) => item.projectId === projectId);
      const preference = autonomyPreferenceSchema.parse({
        projectId,
        mode: current?.mode ?? "guided",
        paused: change.paused,
        updatedAt: Date.now(),
      });
      await this.#save({
        ...state,
        preferences: [...state.preferences.filter((item) => item.projectId !== projectId), preference],
      });
      return autonomyMutationResponseSchema.parse({
        schemaVersion: 1,
        outcome: "pause_changed",
        snapshot: await this.snapshot(),
        receipt: null,
      });
    });
  }

  setRequestMode(requestId: string, input: unknown): Promise<AutonomyMutationResponse> {
    return this.#serialize(async () => {
      assertRequestId(requestId);
      const change = autonomyModeChangeSchema.parse(input);
      const collection = await this.#requests();
      const request = collection.requests.find((item) => item.id === requestId);
      if (!request) throw new LocalAutonomyError("not_found", "Request was not found.");
      const state = await this.#load();
      const projectMode = state.preferences.find((item) => item.projectId === request.projectId)?.mode ?? "guided";
      if (rank(change.mode) > rank(projectMode)) {
        throw new LocalAutonomyError("policy_denied", "A request cannot be more autonomous than its project.");
      }
      const override = requestAutonomyOverrideSchema.parse({
        requestId,
        projectId: request.projectId,
        mode: change.mode,
        updatedAt: Date.now(),
      });
      await this.#save({
        ...state,
        overrides: [...state.overrides.filter((item) => item.requestId !== requestId), override],
      });
      return autonomyMutationResponseSchema.parse({
        schemaVersion: 1,
        outcome: "mode_changed",
        snapshot: await this.snapshot(),
        receipt: null,
      });
    });
  }

  advance(requestId: string, input: unknown): Promise<AutonomyMutationResponse> {
    return this.#serialize(async () => {
      assertRequestId(requestId);
      const advance = autonomyAdvanceRequestSchema.parse(input);
      return this.#advanceLocked(requestId, advance.expectedUpdatedAt, false);
    });
  }

  async tick(now = Date.now()): Promise<void> {
    if (this.#active || !this.#timer) return;
    this.#active = true;
    try {
      await this.#serialize(async () => {
        const snapshot = await this.snapshot(now);
        const candidate = snapshot.recommendations.find((item) =>
          item.automaticAllowed && (item.retryAt === null || item.retryAt <= now)
        );
        if (candidate) await this.#advanceLocked(candidate.requestId, candidate.expectedUpdatedAt, true);
      });
    } finally {
      this.#active = false;
    }
  }

  async #advanceLocked(requestId: string, expectedUpdatedAt: number, automatic: boolean): Promise<AutonomyMutationResponse> {
    const now = Date.now();
    let state = await this.#load();
    const collection = await this.#requests();
    const request = collection.requests.find((item) => item.id === requestId);
    if (!request) throw new LocalAutonomyError("not_found", "Request was not found.");
    if (request.updatedAt !== expectedUpdatedAt) throw new LocalAutonomyError("stale_revision", "Request state changed. Refresh before advancing it.");
    const preference = mergePreferences(state, collection.requests, now).find((item) => item.projectId === request.projectId)!;
    const override = state.overrides.find((item) => item.requestId === request.id);
    const recommendation = planSafeNextAction({ request, mode: override?.mode ?? preference.mode, paused: preference.paused, now });
    if (!recommendation.action) {
      return autonomyMutationResponseSchema.parse({ schemaVersion: 1, outcome: "no_action", snapshot: await this.snapshot(), receipt: null });
    }
    if (automatic && !recommendation.automaticAllowed) {
      throw new LocalAutonomyError("policy_denied", "The current mode does not allow this automatic step.");
    }
    if (preference.paused) throw new LocalAutonomyError("paused", "This project is paused.");
    const existing = state.leases.find((lease) => lease.requestId === requestId && lease.expiresAt > now);
    if (existing) throw new LocalAutonomyError("lease_active", "Another coordinator step is still active.");
    const lease: CoordinatorLease = coordinatorLeaseSchema.parse({
      requestId,
      owner: "local_safe_step_coordinator",
      acquiredAt: now,
      expiresAt: now + 60_000,
    });
    state = { ...state, leases: [...state.leases.filter((item) => item.requestId !== requestId), lease] };
    await this.#save(state);
    let receipt: CoordinatorReceipt;
    try {
      const changed = await this.#actions[recommendation.action](requestId);
      receipt = makeReceipt(request, recommendation.action, "completed", recommendation.reason, now, changed.updatedAt);
    } catch (error) {
      receipt = makeReceipt(request, recommendation.action, "failed", safeError(error), now, null);
    }
    state = await this.#load();
    await this.#save({
      ...state,
      leases: state.leases.filter((item) => item.requestId !== requestId),
      receipts: [...state.receipts, receipt].slice(-100),
    });
    return autonomyMutationResponseSchema.parse({
      schemaVersion: 1,
      outcome: receipt.outcome === "completed" ? "advanced" : "reconciled",
      snapshot: await this.snapshot(),
      receipt,
    });
  }

  #serialize<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.#writeQueue.then(operation, operation);
    this.#writeQueue = run.then(() => undefined, () => undefined);
    return run;
  }

  async #load(): Promise<State> {
    try {
      return stateSchema.parse(JSON.parse(await readFile(this.#statePath, "utf8")));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new LocalAutonomyError("state_invalid", "Autonomy state is invalid; automatic work remains stopped.");
      return { schemaVersion: 1, preferences: [], overrides: [], leases: [], receipts: [] };
    }
  }

  async #save(state: State): Promise<void> {
    const validated = stateSchema.parse(state);
    await mkdir(resolve(this.#statePath, ".."), { recursive: true, mode: 0o700 });
    const temporary = `${this.#statePath}.${randomUUID()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(validated, null, 2)}\n`, { mode: 0o600 });
    await rename(temporary, this.#statePath);
  }
}

export class LocalAutonomyError extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}

function mergePreferences(state: State, requests: readonly LocalRequest[], now: number) {
  const projectIds = [...new Set(requests.map((request) => request.projectId))];
  return projectIds.map((projectId) =>
    state.preferences.find((item) => item.projectId === projectId) ??
    autonomyPreferenceSchema.parse({ projectId, mode: "guided", paused: false, updatedAt: now })
  );
}
function makeReceipt(request: LocalRequest, action: CoordinatorAction, outcome: CoordinatorReceipt["outcome"], detail: string, startedAt: number, resultingUpdatedAt: number | null): CoordinatorReceipt {
  return coordinatorReceiptSchema.parse({
    id: `receipt_${createHash("sha256").update(`${request.id}:${action}:${startedAt}`).digest("hex").slice(0, 16)}`,
    requestId: request.id,
    projectId: request.projectId,
    action,
    outcome,
    detail,
    startedAt,
    completedAt: Date.now(),
    expectedUpdatedAt: request.updatedAt,
    resultingUpdatedAt,
  });
}
function safeError(error: unknown): string { return error instanceof Error ? error.message.slice(0, 500) : "The safe step failed without a recognized error."; }
function rank(mode: AutonomyMode): number { return mode === "guided" ? 0 : mode === "balanced" ? 1 : 2; }
function assertProjectId(value: string): void { if (!/^project_[a-f0-9]{16}$/.test(value)) throw new LocalAutonomyError("invalid_id", "Project identity is invalid."); }
function assertRequestId(value: string): void { if (!/^request_[a-f0-9]{20}$/.test(value)) throw new LocalAutonomyError("invalid_id", "Request identity is invalid."); }
