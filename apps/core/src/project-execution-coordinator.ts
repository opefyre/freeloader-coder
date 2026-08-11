import { randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { z } from "zod";

import { FreeProviderExecutionError } from "./free-provider-execution-model.js";
import type { ProjectExecutionRecord } from "../../../packages/orchestration/src/project-execution.js";

const runSchema = z.strictObject({
  projectId: z.string().regex(/^project_[a-f0-9]{16}$/),
  state: z.enum(["queued", "running", "deferred", "needs_user", "completed"]),
  attempts: z.number().int().nonnegative(),
  retryAt: z.number().int().nonnegative().nullable(),
  safeMessage: z.string().trim().min(1).max(500),
  updatedAt: z.number().int().nonnegative(),
});
const stateSchema = z.strictObject({ schemaVersion: z.literal(1), runs: z.record(z.string(), runSchema) });
export type ProjectExecutionRun = z.infer<typeof runSchema>;

type ExecutionWorker = { tick(projectId: string): Promise<ProjectExecutionRecord | null> };
type ExecutionService = { get(projectId: string): Promise<ProjectExecutionRecord | null>; reconcileExpired(projectId: string): Promise<unknown> };

export class ProjectExecutionCoordinator {
  readonly #path: string;
  readonly #inFlight = new Set<string>();
  readonly #timers = new Map<string, NodeJS.Timeout>();
  readonly #readyQueue: string[] = [];
  readonly #queued = new Set<string>();
  #activeProjects = 0;
  #mutation = Promise.resolve();
  #stopped = false;

  constructor(
    stateDirectory: string,
    private readonly service: ExecutionService,
    private readonly worker: ExecutionWorker,
    private readonly now: () => number = Date.now,
    private readonly defaultRetryMs = 300_000,
    private readonly onCompleted: (projectId: string) => Promise<void> = async () => undefined,
    private readonly maxConcurrentProjects = 2
  ) { this.#path = resolve(stateDirectory, "project-execution-runs.json"); }

  async get(projectId: string) { return (await this.#load()).runs[projectId] ?? null; }

  async schedule(projectId: string, retryAt: number | null = null) {
    if (this.#stopped) return;
    const at = Math.max(this.now(), retryAt ?? this.now());
    await this.#saveRun(projectId, { state: at > this.now() ? "deferred" : "queued", retryAt: at > this.now() ? at : null, safeMessage: at > this.now() ? "Waiting for the next verified free-provider window." : "Ready for autonomous execution." });
    this.#arm(projectId, at);
  }

  async resumePending() {
    this.#stopped = false;
    const state = await this.#load();
    for (const run of Object.values(state.runs).sort((left, right) => left.updatedAt - right.updatedAt || left.projectId.localeCompare(right.projectId))) if (["queued", "running", "deferred"].includes(run.state)) this.#arm(run.projectId, Math.max(this.now(), run.retryAt ?? this.now()));
  }

  stop() { this.#stopped = true; for (const timer of this.#timers.values()) clearTimeout(timer); this.#timers.clear(); this.#readyQueue.length = 0; this.#queued.clear(); }

  async shutdown() {
    this.stop();
    while (this.#activeProjects > 0 || this.#inFlight.size > 0) await new Promise<void>((resolve) => setTimeout(resolve, 0));
    await this.#mutation;
  }

  #arm(projectId: string, at: number) {
    if (this.#stopped || this.#inFlight.has(projectId)) return;
    const current = this.#timers.get(projectId); if (current) clearTimeout(current);
    const timer = setTimeout(() => { this.#timers.delete(projectId); this.#enqueue(projectId); }, Math.max(0, at - this.now()));
    timer.unref(); this.#timers.set(projectId, timer);
  }

  #enqueue(projectId: string) {
    if (this.#stopped || this.#inFlight.has(projectId) || this.#queued.has(projectId)) return;
    this.#queued.add(projectId); this.#readyQueue.push(projectId); this.#drain();
  }

  #drain() {
    while (!this.#stopped && this.#activeProjects < this.maxConcurrentProjects && this.#readyQueue.length > 0) {
      const projectId = this.#readyQueue.shift()!; this.#queued.delete(projectId); this.#activeProjects += 1;
      void this.#run(projectId).finally(() => { this.#activeProjects -= 1; this.#drain(); });
    }
  }

  async #run(projectId: string) {
    if (this.#stopped || this.#inFlight.has(projectId)) return;
    this.#inFlight.add(projectId);
    try {
      await this.#saveRun(projectId, { state: "running", retryAt: null, safeMessage: "Autonomous execution is running." }, true);
      await this.service.reconcileExpired(projectId);
      const before = await this.service.get(projectId);
      const record = await this.worker.tick(projectId);
      if (!record) return;
      if (record.state === "completed") {
        await this.onCompleted(projectId);
        await this.#saveRun(projectId, { state: "completed", retryAt: null, safeMessage: "All implementation and evidence gates passed; project completion was reconciled." });
        return;
      }
      if (record.state === "needs_user" || record.state === "quarantined") { await this.#saveRun(projectId, { state: "needs_user", retryAt: null, safeMessage: "Execution requires owner attention before it can continue." }); return; }
      const ready = hasReadyTask(record);
      const progressed = executionProgressKey(before) !== executionProgressKey(record);
      const retryAt = this.now() + (ready && progressed ? 100 : this.defaultRetryMs);
      await this.#saveRun(projectId, { state: "deferred", retryAt, safeMessage: ready && progressed ? "Continuing with the next dependency-ready task." : ready ? "No eligible free provider or worker is available; a deferred recovery check is scheduled." : "No task is currently claimable; the graph will be checked again." });
      this.#arm(projectId, retryAt);
    } catch (error) {
      if (error instanceof FreeProviderExecutionError && (error.code === "capacity_unavailable" || error.code === "provider_failed")) {
        const retryAt = Math.max(this.now() + 1_000, error.retryAt ?? this.now() + this.defaultRetryMs);
        await this.#saveRun(projectId, { state: "deferred", retryAt, safeMessage: "Free-provider capacity is temporarily unavailable. Retry is scheduled without consuming paid capacity." });
        this.#arm(projectId, retryAt);
      } else {
        await this.#saveRun(projectId, { state: "needs_user", retryAt: null, safeMessage: "Execution stopped safely and needs owner attention." });
      }
    } finally { this.#inFlight.delete(projectId); }
  }

  async #saveRun(projectId: string, patch: Pick<ProjectExecutionRun, "state" | "retryAt" | "safeMessage">, increment = false) {
    await this.#mutate(async (state) => { const previous = state.runs[projectId]; const run = runSchema.parse({ projectId, ...patch, attempts: (previous?.attempts ?? 0) + (increment ? 1 : 0), updatedAt: this.now() }); return { schemaVersion: 1 as const, runs: { ...state.runs, [projectId]: run } }; });
  }
  async #mutate(operation: (state: z.infer<typeof stateSchema>) => Promise<z.infer<typeof stateSchema>>) { const next = this.#mutation.then(async () => atomicWrite(this.#path, `${JSON.stringify(stateSchema.parse(await operation(await this.#load())), null, 2)}\n`)); this.#mutation = next.catch(() => undefined); await next; }
  async #load() { try { return stateSchema.parse(JSON.parse(await readFile(this.#path, "utf8"))); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return stateSchema.parse({ schemaVersion: 1, runs: {} }); throw new Error("Project execution scheduler state is corrupt."); } }
}

function hasReadyTask(record: ProjectExecutionRecord) { const completed = new Set(record.tasks.filter((task) => task.status === "completed").map((task) => task.id)); return record.tasks.some((task) => task.status === "queued" && task.dependsOn.every((dependency) => completed.has(dependency))); }
function executionProgressKey(record: ProjectExecutionRecord | null) { return record ? JSON.stringify(record.tasks.map((task) => ({ id: task.id, status: task.status, attempt: task.attempt, assignment: task.assignment?.providerId ?? null, lease: task.lease?.leaseId ?? null, implementation: task.implementationEvidence.length, validations: task.validations.length, reviews: task.reviews.length, commit: task.commitDigest, integration: task.integrationDigest }))) : "missing"; }
async function atomicWrite(path: string, content: string) { await mkdir(dirname(path), { recursive: true, mode: 0o700 }); const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`; await writeFile(temporary, content, { encoding: "utf8", mode: 0o600 }); await chmod(temporary, 0o600); await rename(temporary, path); await chmod(path, 0o600); }
