import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { z } from "zod";
import { solutionRunSchema, type SolutionRun } from "../../../packages/orchestration/src/solution-design.js";
import { FreeProviderSolutionUnavailableError } from "./free-provider-solution-model.js";
import { ProjectEgressDeniedError } from "./project-egress-policy-service.js";
import { ProjectSolutionOrchestrator, SolutionReviewDissentError } from "./project-solution-orchestrator.js";

export { solutionRunSchema, type SolutionRun };
const stateSchema = z.strictObject({ schemaVersion: z.literal(1), runs: z.record(z.string(), solutionRunSchema) });

export class ProjectSolutionCoordinator {
  readonly #path: string;
  readonly #inFlight = new Map<string, Promise<void>>();
  readonly #timers = new Map<string, ReturnType<typeof setTimeout>>();
  #mutation = Promise.resolve();
  constructor(stateDirectory: string, private readonly orchestrator: ProjectSolutionOrchestrator, private readonly now: () => number = Date.now) { this.#path = resolve(stateDirectory, "project-solution-runs.json"); }

  async schedule(projectId: string): Promise<SolutionRun> {
    let run = await this.get(projectId);
    if (run?.state === "completed") return run;
    if (!run || run.state === "needs_user") run = await this.#set({ schemaVersion: 1, projectId, state: "queued", attempts: run?.attempts ?? 0, retryAt: null, safeMessage: "Solution research is queued.", updatedAt: this.now() });
    if (run.state === "deferred" && run.retryAt && run.retryAt > this.now()) { this.#scheduleRetry(projectId, run.retryAt); return run; }
    if (!this.#inFlight.has(projectId)) {
      const work = this.#execute(projectId).finally(() => this.#inFlight.delete(projectId));
      this.#inFlight.set(projectId, work);
    }
    return run;
  }

  async get(projectId: string) { return (await this.#load()).runs[projectId] ?? null; }
  async resumePending() { const runs = Object.values((await this.#load()).runs).filter((run) => ["queued", "running", "deferred"].includes(run.state)); for (const run of runs) await this.schedule(run.projectId); return runs.length; }
  async shutdown() { for (const timer of this.#timers.values()) clearTimeout(timer); this.#timers.clear(); await Promise.allSettled([...this.#inFlight.values()]); await this.#mutation; }

  async #execute(projectId: string) {
    const current = await this.get(projectId);
    const attempts = (current?.attempts ?? 0) + 1;
    await this.#set({ schemaVersion: 1, projectId, state: "running", attempts, retryAt: null, safeMessage: "Free-provider specialists are researching and reviewing the solution.", updatedAt: this.now() });
    try {
      await this.orchestrator.run(projectId);
      await this.#set({ schemaVersion: 1, projectId, state: "completed", attempts, retryAt: null, safeMessage: "Reviewed solution is ready for owner approval.", updatedAt: this.now() });
    } catch (error) {
      if (error instanceof FreeProviderSolutionUnavailableError && error.retryAt !== null) {
        const retryAt = error.retryAt > this.now() ? error.retryAt : this.now() + 60_000;
        await this.#set({ schemaVersion: 1, projectId, state: "deferred", attempts, retryAt, safeMessage: error.message, updatedAt: this.now() }); this.#scheduleRetry(projectId, retryAt); return;
      }
      const message = error instanceof ProjectEgressDeniedError || error instanceof SolutionReviewDissentError || error instanceof FreeProviderSolutionUnavailableError ? error.message : safeUnexpectedMessage(error);
      await this.#set({ schemaVersion: 1, projectId, state: "needs_user", attempts, retryAt: null, safeMessage: message, updatedAt: this.now() });
    }
  }

  #scheduleRetry(projectId: string, retryAt: number) { const current = this.#timers.get(projectId); if (current) clearTimeout(current); const timer = setTimeout(() => { this.#timers.delete(projectId); void this.schedule(projectId); }, Math.min(Math.max(1, retryAt - this.now()), 2_147_000_000)); timer.unref(); this.#timers.set(projectId, timer); }
  async #set(run: SolutionRun) { return this.#mutate(async (state) => ({ state: { ...state, runs: { ...state.runs, [run.projectId]: solutionRunSchema.parse(run) } }, result: run })); }
  async #mutate<T>(operation: (state: z.infer<typeof stateSchema>) => Promise<{ state: z.infer<typeof stateSchema>; result: T }>) { let result!: T; const next = this.#mutation.then(async () => { const outcome = await operation(await this.#load()); await atomicWrite(this.#path, `${JSON.stringify(stateSchema.parse(outcome.state), null, 2)}\n`); result = outcome.result; }); this.#mutation = next.catch(() => undefined); await next; return result; }
  async #load() { try { return stateSchema.parse(JSON.parse(await readFile(this.#path, "utf8"))); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return stateSchema.parse({ schemaVersion: 1, runs: {} }); throw new Error("Solution coordinator state is corrupt."); } }
}
function safeUnexpectedMessage(error: unknown) {
  if (error instanceof z.ZodError) return "Solution evidence did not match the required structure. Review provider output before retrying.";
  const message = error instanceof Error ? error.message.trim() : "";
  if (/^(?:Project context|Project provider consent|CONTEXT\.md|Solution research|Research context|Solution artifacts)\b/.test(message) && message.length <= 240 && !/[\r\n]/.test(message)) return message;
  return "Solution research stopped safely. Review provider and project evidence before retrying.";
}
async function atomicWrite(path: string, content: string) { await mkdir(dirname(path), { recursive: true, mode: 0o700 }); const temporary = `${path}.${process.pid}.tmp`; await writeFile(temporary, content, { encoding: "utf8", mode: 0o600 }); await chmod(temporary, 0o600); await rename(temporary, path); await chmod(path, 0o600); }
