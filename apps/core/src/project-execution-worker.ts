import type { ExecutionCandidate, ExecutionTask } from "../../../packages/orchestration/src/project-execution.js";
import type { QualityReview } from "../../../packages/orchestration/src/quality-review.js";
import type { HealingFailureClass, HealingPolicy } from "../../../packages/orchestration/src/healing.js";
import type { ProjectExecutionService } from "./project-execution-service.js";
import { FreeProviderExecutionError } from "./free-provider-execution-model.js";
import { ProjectTaskWorkspaceError } from "./project-task-workspace.js";

export type WorkerValidation = { tier: "fast" | "full" | "integration"; commandLabel: string; passed: boolean; exitCode: number; evidenceDigest: string };
export type ImplementationResult = { evidenceDigest: string; changedFiles: readonly string[]; goldenScore: number; previousGoldenScore: number };

export interface ProjectExecutionAdapters {
  candidates(projectId: string, task: ExecutionTask): Promise<readonly ExecutionCandidate[]>;
  implement(projectId: string, task: ExecutionTask, attempt: number): Promise<ImplementationResult>;
  validate(projectId: string, task: ExecutionTask, tier: "fast" | "full"): Promise<WorkerValidation>;
  classifyFailure(projectId: string, task: ExecutionTask, validation: WorkerValidation): Promise<HealingFailureClass>;
  healingPolicy(projectId: string, task: ExecutionTask): Promise<HealingPolicy>;
  heal(projectId: string, task: ExecutionTask, attempt: number): Promise<ImplementationResult>;
  review(projectId: string, task: ExecutionTask): Promise<readonly QualityReview[]>;
  integrate(projectId: string, task: ExecutionTask): Promise<{ commitDigest: string; integrationDigest: string; validation: WorkerValidation }>;
  observe?(projectId: string, task: ExecutionTask): Promise<void>;
}

export class ProjectExecutionWorker {
  constructor(
    private readonly service: ProjectExecutionService,
    private readonly adapters: ProjectExecutionAdapters,
    private readonly workerId: string,
    private readonly leaseMs = 120_000
  ) {}

  async tick(projectId: string) {
    const record = await this.service.get(projectId) ?? await this.service.initialize(projectId);
    if (record.state !== "running") return record;
    const completed = new Set(record.tasks.filter((task) => task.status === "completed").map((task) => task.id));
    const queued = record.tasks.find((task) => task.status === "queued" && task.dependsOn.every((dependency) => completed.has(dependency)));
    if (!queued) return record;
    const candidates = await this.adapters.candidates(projectId, queued);
    const claim = await this.service.claim(projectId, this.workerId, candidates, this.leaseMs);
    const lease = claim.task?.lease;
    if (!claim.task || !lease) return claim.record;
    let task = claim.task;
    const heartbeat = setInterval(() => { void this.service.heartbeat(projectId, task.id, lease.leaseId, this.workerId, this.leaseMs).catch(() => undefined); }, Math.max(5_000, Math.floor(this.leaseMs / 3)));
    heartbeat.unref();
    try {
      let implementation = await this.adapters.implement(projectId, task, task.attempt);
      task = await this.service.recordImplementation(projectId, task.id, lease.leaseId, this.workerId, implementation.evidenceDigest);
      while (true) {
        const fast = await this.adapters.validate(projectId, task, "fast");
        task = await this.service.recordValidation(projectId, task.id, lease.leaseId, this.workerId, fast);
        if (!fast.passed) {
          task = await this.heal(projectId, task, lease.leaseId, fast, implementation);
          if (task.status !== "healing") return await this.service.get(projectId);
          implementation = await this.adapters.heal(projectId, task, task.attempt);
          task = await this.service.recordImplementation(projectId, task.id, lease.leaseId, this.workerId, implementation.evidenceDigest);
          continue;
        }
        const full = await this.adapters.validate(projectId, task, "full");
        task = await this.service.recordValidation(projectId, task.id, lease.leaseId, this.workerId, full);
        if (!full.passed) {
          task = await this.heal(projectId, task, lease.leaseId, full, implementation);
          if (task.status !== "healing") return await this.service.get(projectId);
          implementation = await this.adapters.heal(projectId, task, task.attempt);
          task = await this.service.recordImplementation(projectId, task.id, lease.leaseId, this.workerId, implementation.evidenceDigest);
          continue;
        }
        break;
      }
      task = await this.service.recordReviews(projectId, task.id, lease.leaseId, this.workerId, await this.adapters.review(projectId, task));
      if (task.status !== "integrating") return await this.service.get(projectId);
      const integration = await this.adapters.integrate(projectId, task);
      if (!integration.validation.passed) {
        await this.service.interrupt(projectId, task.id, lease.leaseId, this.workerId, "Execution needs attention: Clean-checkout validation failed before integration; no unverified commit was retained.", "implementation");
        return await this.service.get(projectId);
      }
      task = await this.service.recordIntegration(projectId, task.id, lease.leaseId, this.workerId, integration);
      await this.adapters.observe?.(projectId, task).catch((error) => {
        console.warn("Completed execution could not be synchronized to its external observer; canonical completion proof is preserved for retry.", {
          projectId,
          taskId: task.id,
          error: error instanceof Error ? error.message.slice(0, 300) : "External observation failed.",
        });
      });
      return await this.service.get(projectId);
    } catch (error) {
      if (task.status === "completed") return await this.service.get(projectId);
      if (error instanceof FreeProviderExecutionError && (error.code === "capacity_unavailable" || error.code === "provider_failed")) {
        await this.service.releaseForRetry(projectId, task.id, lease.leaseId, this.workerId, "The assigned free provider is temporarily unavailable. The task is safely queued for its next eligible window.");
      } else {
        const failureClass = error instanceof ProjectTaskWorkspaceError && !["canonical_dirty", "repository_invalid"].includes(error.code)
          ? "implementation" as const
          : error instanceof Error && /Provider proposal (?:exceeded grounded file authority|conflicts with observed file state|omitted required task files)/.test(error.message)
          ? "implementation" as const
          : undefined;
        await this.service.interrupt(projectId, task.id, lease.leaseId, this.workerId, safeError(error), failureClass);
        if (failureClass === "implementation") {
          await this.adapters.observe?.(projectId, task).catch(() => undefined);
          return await this.service.get(projectId);
        }
      }
      await this.adapters.observe?.(projectId, task).catch(() => undefined);
      throw error;
    } finally {
      clearInterval(heartbeat);
    }
  }

  private async heal(projectId: string, task: ExecutionTask, leaseId: string, validation: WorkerValidation, implementation: ImplementationResult) {
    const [failureClass, policy] = await Promise.all([this.adapters.classifyFailure(projectId, task, validation), this.adapters.healingPolicy(projectId, task)]);
    return this.service.assessHealing(projectId, task.id, leaseId, this.workerId, { failureClass, changedFiles: implementation.changedFiles, policy, goldenScore: implementation.goldenScore, previousGoldenScore: implementation.previousGoldenScore });
  }
}

function safeError(error: unknown) {
  const message = error instanceof Error ? error.message : "Execution stopped without a verified outcome.";
  return `Execution needs attention: ${message.replace(/(?:api[_-]?key|password|secret|token)\s*[:=]\s*\S+/gi, "$1=[redacted]").slice(0, 430)}`;
}
