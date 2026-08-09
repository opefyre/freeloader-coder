import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { z } from "zod";

import { deliveryPlanRunSchema, type DeliveryPlanRun } from "../../../packages/orchestration/src/delivery-plan.js";
import { FreeProviderSolutionUnavailableError } from "./free-provider-solution-model.js";
import { ProjectEgressDeniedError } from "./project-egress-policy-service.js";
import { DeliveryPlanReviewDissentError, ProjectDeliveryPlanOrchestrator } from "./project-delivery-plan-orchestrator.js";
import { JiraDeliveryNeedsUserError } from "./jira-delivery-service.js";

export { deliveryPlanRunSchema, type DeliveryPlanRun };

const stateSchema = z.strictObject({
  schemaVersion: z.literal(1),
  runs: z.record(z.string(), deliveryPlanRunSchema),
});

export class ProjectDeliveryPlanCoordinator {
  readonly #path: string;
  readonly #inFlight = new Map<string, Promise<void>>();
  readonly #timers = new Map<string, ReturnType<typeof setTimeout>>();
  #mutation = Promise.resolve();

  constructor(
    stateDirectory: string,
    private readonly orchestrator: ProjectDeliveryPlanOrchestrator,
    private readonly now: () => number = Date.now,
    private readonly afterPlan?: (projectId: string) => Promise<unknown>
  ) {
    this.#path = resolve(stateDirectory, "project-delivery-plan-runs.json");
  }

  async schedule(projectId: string): Promise<DeliveryPlanRun> {
    let run = await this.get(projectId);
    if (run?.state === "completed") return run;
    if (!run || run.state === "needs_user") {
      run = await this.#set({
        schemaVersion: 1,
        projectId,
        state: "queued",
        attempts: run?.attempts ?? 0,
        retryAt: null,
        safeMessage: "Delivery planning is queued.",
        updatedAt: this.now(),
      });
    }
    if (run.state === "deferred" && run.retryAt && run.retryAt > this.now()) {
      this.#scheduleRetry(projectId, run.retryAt);
      return run;
    }
    if (!this.#inFlight.has(projectId)) {
      const work = this.#execute(projectId).finally(() => this.#inFlight.delete(projectId));
      this.#inFlight.set(projectId, work);
    }
    return run;
  }

  async get(projectId: string) {
    return (await this.#load()).runs[projectId] ?? null;
  }

  async resumePending() {
    const runs = Object.values((await this.#load()).runs).filter((run) =>
      ["queued", "running", "deferred"].includes(run.state)
    );
    for (const run of runs) await this.schedule(run.projectId);
    return runs.length;
  }

  async #execute(projectId: string) {
    const current = await this.get(projectId);
    const attempts = (current?.attempts ?? 0) + 1;
    await this.#set({
      schemaVersion: 1,
      projectId,
      state: "running",
      attempts,
      retryAt: null,
      safeMessage: "Independent specialists are creating and reviewing the delivery plan.",
      updatedAt: this.now(),
    });
    try {
      await this.orchestrator.run(projectId);
      await this.afterPlan?.(projectId);
      await this.#set({
        schemaVersion: 1,
        projectId,
        state: "completed",
        attempts,
        retryAt: null,
        safeMessage: this.afterPlan ? "The reviewed delivery plan and Jira hierarchy are ready." : "The reviewed delivery plan is ready for Jira creation.",
        updatedAt: this.now(),
      });
    } catch (error) {
      if (error instanceof FreeProviderSolutionUnavailableError && error.retryAt !== null) {
        await this.#set({
          schemaVersion: 1,
          projectId,
          state: "deferred",
          attempts,
          retryAt: error.retryAt,
          safeMessage: error.message,
          updatedAt: this.now(),
        });
        this.#scheduleRetry(projectId, error.retryAt);
        return;
      }
      const safeMessage =
        error instanceof ProjectEgressDeniedError ||
        error instanceof DeliveryPlanReviewDissentError ||
        error instanceof JiraDeliveryNeedsUserError ||
        error instanceof FreeProviderSolutionUnavailableError
          ? error.message
          : "Delivery planning stopped safely. Review the approved solution and provider evidence before retrying.";
      await this.#set({
        schemaVersion: 1,
        projectId,
        state: "needs_user",
        attempts,
        retryAt: null,
        safeMessage,
        updatedAt: this.now(),
      });
    }
  }

  #scheduleRetry(projectId: string, retryAt: number) {
    const current = this.#timers.get(projectId);
    if (current) clearTimeout(current);
    const timer = setTimeout(() => {
      this.#timers.delete(projectId);
      void this.schedule(projectId);
    }, Math.min(Math.max(1, retryAt - this.now()), 2_147_000_000));
    timer.unref();
    this.#timers.set(projectId, timer);
  }

  async #set(run: DeliveryPlanRun) {
    return this.#mutate(async (state) => ({
      state: { ...state, runs: { ...state.runs, [run.projectId]: deliveryPlanRunSchema.parse(run) } },
      result: run,
    }));
  }

  async #mutate<T>(operation: (state: z.infer<typeof stateSchema>) => Promise<{ state: z.infer<typeof stateSchema>; result: T }>) {
    let result!: T;
    const next = this.#mutation.then(async () => {
      const outcome = await operation(await this.#load());
      await atomicWrite(this.#path, `${JSON.stringify(stateSchema.parse(outcome.state), null, 2)}\n`);
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
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return stateSchema.parse({ schemaVersion: 1, runs: {} });
      }
      throw new Error("Delivery plan coordinator state is corrupt.");
    }
  }
}

async function atomicWrite(path: string, content: string) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, content, { encoding: "utf8", mode: 0o600 });
  await chmod(temporary, 0o600);
  await rename(temporary, path);
  await chmod(path, 0o600);
}
