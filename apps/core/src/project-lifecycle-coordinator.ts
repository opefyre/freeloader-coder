import { randomUUID } from "node:crypto";
import { access, chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { z } from "zod";

import type { ProjectLifecycleRecord } from "../../../packages/orchestration/src/project-lifecycle.js";

const actionKindSchema = z.enum(["solution", "delivery_plan", "execution"]);
const eventSchema = z.strictObject({
  sequence: z.number().int().positive(),
  type: z.enum(["lease_acquired", "lease_recovered", "checkpoint", "action_dispatched", "action_completed", "terminal_observed", "project_reopened", "lease_released"]),
  stage: z.string().trim().min(1).max(80),
  actionId: z.string().trim().min(1).max(240).nullable(),
  at: z.number().int().nonnegative(),
});
const stateSchema = z.strictObject({
  schemaVersion: z.literal(1),
  projectId: z.string().regex(/^project_[a-f0-9]{16}$/),
  revision: z.number().int().nonnegative(),
  checkpoint: z.strictObject({ stage: z.string().trim().min(1).max(80), lifecycleRevision: z.number().int().nonnegative(), at: z.number().int().nonnegative() }).nullable(),
  dispatches: z.record(z.string(), z.strictObject({ actionId: z.string(), kind: actionKindSchema, lifecycleRevision: z.number().int().nonnegative(), state: z.enum(["dispatched", "completed"]), updatedAt: z.number().int().nonnegative() })),
  events: z.array(eventSchema).max(1_000),
  terminalStage: z.enum(["complete", "cancelled"]).nullable(),
});
const leaseSchema = z.strictObject({ token: z.string().uuid(), ownerId: z.string().trim().min(1).max(160), acquiredAt: z.number().int().nonnegative(), expiresAt: z.number().int().nonnegative() });

export type ProjectLifecycleCoordinatorState = z.infer<typeof stateSchema>;
type ActionKind = z.infer<typeof actionKindSchema>;
type LifecycleSource = { get(projectId: string): Promise<ProjectLifecycleRecord | null>; list(): Promise<readonly ProjectLifecycleRecord[]> };
type StageWorkers = {
  solution(projectId: string, actionId: string): Promise<unknown>;
  deliveryPlan(projectId: string, actionId: string): Promise<unknown>;
  execution(projectId: string, actionId: string): Promise<unknown>;
};

export class ProjectLifecycleCoordinator {
  readonly #recordsDirectory: string;
  readonly #leasesDirectory: string;
  readonly #inFlight = new Set<string>();
  #timer: NodeJS.Timeout | null = null;

  constructor(
    stateDirectory: string,
    private readonly lifecycles: LifecycleSource,
    private readonly workers: StageWorkers,
    private readonly ownerId: string,
    private readonly now: () => number = Date.now,
    private readonly leaseMs = 60_000
  ) {
    this.#recordsDirectory = resolve(stateDirectory, "project-lifecycle-coordinator");
    this.#leasesDirectory = resolve(stateDirectory, "project-lifecycle-leases");
  }

  async get(projectId: string): Promise<ProjectLifecycleCoordinatorState> {
    return this.#load(projectId);
  }

  async reconcileAll(): Promise<number> {
    const records = await this.lifecycles.list();
    await Promise.all(records.map((record) => this.reconcile(record.projectId)));
    return records.length;
  }

  async acknowledgeReopen(projectId: string, expectedTerminalStage: "complete" | "cancelled", reopenedLifecycleRevision: number): Promise<void> {
    const lifecycle = await this.lifecycles.get(projectId);
    if (!lifecycle || lifecycle.stage !== "context_review" || lifecycle.revision !== reopenedLifecycleRevision) throw new Error("The explicit lifecycle reopen has not completed.");
    const state = await this.#load(projectId);
    if (state.terminalStage !== expectedTerminalStage) throw new Error("The recorded terminal state changed before reopen acknowledgement.");
    await this.#persist({ ...state, terminalStage: null, checkpoint: { stage: lifecycle.stage, lifecycleRevision: lifecycle.revision, at: this.now() } }, { type: "project_reopened", stage: lifecycle.stage, actionId: null, at: this.now() });
  }

  async reconcile(projectId: string): Promise<"busy" | "checkpointed" | "dispatched" | "terminal"> {
    if (this.#inFlight.has(projectId)) return "busy";
    this.#inFlight.add(projectId);
    let lease: z.infer<typeof leaseSchema> | null = null;
    try {
      const observedLifecycle = await this.lifecycles.get(projectId);
      if (!observedLifecycle) throw new Error("Project lifecycle was not found.");
      const observedState = await this.#load(projectId);
      const observedKind = actionForStage(observedLifecycle.stage);
      const observedActionId = observedKind
        ? `${projectId}:${observedKind}:revision-${observedLifecycle.revision}`
        : null;
      if (
        observedActionId &&
        !(await pathExists(this.#leasePath(projectId))) &&
        observedState.checkpoint?.stage === observedLifecycle.stage &&
        observedState.checkpoint.lifecycleRevision === observedLifecycle.revision &&
        observedState.dispatches[observedActionId]?.state === "completed"
      ) {
        return "checkpointed";
      }
      lease = await this.#acquire(projectId);
      if (!lease) return "busy";
      const lifecycle = await this.lifecycles.get(projectId);
      if (!lifecycle) throw new Error("Project lifecycle was not found.");
      let state = await this.#load(projectId);
      if (state.terminalStage !== null && lifecycle.stage !== state.terminalStage) {
        throw new Error("A terminal project cannot be changed without an explicit reopen operation.");
      }
      state = await this.#recordCheckpoint(state, lifecycle);
      if (lifecycle.stage === "complete" || lifecycle.stage === "cancelled") {
        if (state.terminalStage === null) {
          state = await this.#persist({ ...state, terminalStage: lifecycle.stage }, { type: "terminal_observed", stage: lifecycle.stage, actionId: null, at: this.now() });
        }
        return "terminal";
      }
      const kind = actionForStage(lifecycle.stage);
      if (!kind) return "checkpointed";
      const actionId = `${projectId}:${kind}:revision-${lifecycle.revision}`;
      const prior = state.dispatches[actionId];
      if (prior?.state === "completed") return "checkpointed";
      if (!prior) {
        state = await this.#persist({ ...state, dispatches: { ...state.dispatches, [actionId]: { actionId, kind, lifecycleRevision: lifecycle.revision, state: "dispatched", updatedAt: this.now() } } }, { type: "action_dispatched", stage: lifecycle.stage, actionId, at: this.now() });
      }
      await this.#heartbeat(projectId, lease);
      await dispatch(this.workers, kind, projectId, actionId);
      state = await this.#load(projectId);
      await this.#persist({ ...state, dispatches: { ...state.dispatches, [actionId]: { actionId, kind, lifecycleRevision: lifecycle.revision, state: "completed", updatedAt: this.now() } } }, { type: "action_completed", stage: lifecycle.stage, actionId, at: this.now() });
      return "dispatched";
    } finally {
      if (lease) await this.#release(projectId, lease);
      this.#inFlight.delete(projectId);
    }
  }

  start(intervalMs = 5_000): void {
    if (this.#timer) return;
    void this.reconcileAll().catch(() => undefined);
    this.#timer = setInterval(() => void this.reconcileAll().catch(() => undefined), intervalMs);
    this.#timer.unref();
  }

  stop(): void {
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = null;
  }

  async #recordCheckpoint(state: ProjectLifecycleCoordinatorState, lifecycle: ProjectLifecycleRecord) {
    if (state.checkpoint?.stage === lifecycle.stage && state.checkpoint.lifecycleRevision === lifecycle.revision) return state;
    return this.#persist({ ...state, checkpoint: { stage: lifecycle.stage, lifecycleRevision: lifecycle.revision, at: this.now() } }, { type: "checkpoint", stage: lifecycle.stage, actionId: null, at: this.now() });
  }

  async #persist(state: ProjectLifecycleCoordinatorState, event: Omit<z.infer<typeof eventSchema>, "sequence">) {
    const sequence = (state.events.at(-1)?.sequence ?? 0) + 1;
    const next = stateSchema.parse({ ...state, revision: state.revision + 1, events: [...state.events, { ...event, sequence }].slice(-1_000) });
    await atomicWrite(this.#statePath(state.projectId), `${JSON.stringify(next, null, 2)}\n`);
    return next;
  }

  async #load(projectId: string): Promise<ProjectLifecycleCoordinatorState> {
    assertProjectId(projectId);
    try { return stateSchema.parse(JSON.parse(await readFile(this.#statePath(projectId), "utf8"))); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return stateSchema.parse({ schemaVersion: 1, projectId, revision: 0, checkpoint: null, dispatches: {}, events: [], terminalStage: null });
      throw new Error("Project lifecycle coordinator state is corrupt.");
    }
  }

  async #acquire(projectId: string): Promise<z.infer<typeof leaseSchema> | null> {
    const lock = this.#leasePath(projectId);
    await mkdir(this.#leasesDirectory, { recursive: true, mode: 0o700 });
    const lease = leaseSchema.parse({ token: randomUUID(), ownerId: this.ownerId, acquiredAt: this.now(), expiresAt: this.now() + this.leaseMs });
    try {
      await mkdir(lock, { mode: 0o700 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const current = await readLease(lock);
      const heartbeatAt = current ? await readHeartbeat(lock, current.token) : null;
      if (current && Math.max(current.expiresAt, (heartbeatAt ?? 0) + this.leaseMs) > this.now()) return null;
      try { await rename(lock, `${lock}.stale-${randomUUID()}`); }
      catch (renameError) { if ((renameError as NodeJS.ErrnoException).code === "ENOENT") return this.#acquire(projectId); throw renameError; }
      await mkdir(lock, { mode: 0o700 });
      let state = await this.#load(projectId);
      state = await this.#persist(state, { type: "lease_recovered", stage: state.checkpoint?.stage ?? "unknown", actionId: null, at: this.now() });
    }
    await atomicWrite(resolve(lock, "owner.json"), `${JSON.stringify(lease)}\n`);
    await this.#heartbeat(projectId, lease);
    const state = await this.#load(projectId);
    await this.#persist(state, { type: "lease_acquired", stage: state.checkpoint?.stage ?? "unknown", actionId: null, at: this.now() });
    return lease;
  }

  async #heartbeat(projectId: string, lease: z.infer<typeof leaseSchema>) {
    await atomicWrite(resolve(this.#leasePath(projectId), `heartbeat-${lease.token}.json`), `${JSON.stringify({ at: this.now() })}\n`);
  }

  async #release(projectId: string, lease: z.infer<typeof leaseSchema>) {
    const lock = this.#leasePath(projectId);
    const current = await readLease(lock);
    if (current?.token !== lease.token) return;
    const state = await this.#load(projectId);
    await this.#persist(state, { type: "lease_released", stage: state.checkpoint?.stage ?? "unknown", actionId: null, at: this.now() });
    await rm(lock, { recursive: true, force: true });
  }

  #statePath(projectId: string) { return resolve(this.#recordsDirectory, `${projectId}.json`); }
  #leasePath(projectId: string) { return resolve(this.#leasesDirectory, `${projectId}.lock`); }
}

function actionForStage(stage: ProjectLifecycleRecord["stage"]): ActionKind | null {
  if (stage === "solution_design") return "solution";
  if (stage === "backlog_design" || stage === "backlog_qa") return "delivery_plan";
  if (stage === "delivery") return "execution";
  return null;
}

function dispatch(workers: StageWorkers, kind: ActionKind, projectId: string, actionId: string) {
  if (kind === "solution") return workers.solution(projectId, actionId);
  if (kind === "delivery_plan") return workers.deliveryPlan(projectId, actionId);
  return workers.execution(projectId, actionId);
}

async function readLease(lock: string) { try { return leaseSchema.parse(JSON.parse(await readFile(resolve(lock, "owner.json"), "utf8"))); } catch { return null; } }
async function readHeartbeat(lock: string, token: string) { try { return z.strictObject({ at: z.number().int().nonnegative() }).parse(JSON.parse(await readFile(resolve(lock, `heartbeat-${token}.json`), "utf8"))).at; } catch { return null; } }
async function pathExists(path: string) { try { await access(path); return true; } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; } }
function assertProjectId(projectId: string) { if (!/^project_[a-f0-9]{16}$/.test(projectId)) throw new Error("Project identity is invalid."); }
async function atomicWrite(path: string, content: string) { await mkdir(dirname(path), { recursive: true, mode: 0o700 }); const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`; await writeFile(temporary, content, { encoding: "utf8", mode: 0o600 }); await chmod(temporary, 0o600); await rename(temporary, path); await chmod(path, 0o600); }
