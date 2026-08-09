import type { ExecutionCandidate, ExecutionTask } from "../../../packages/orchestration/src/project-execution.js";
import type { QualityReview } from "../../../packages/orchestration/src/quality-review.js";
import type { HealingFailureClass, HealingPolicy } from "../../../packages/orchestration/src/healing.js";
import type { ProjectExecutionService } from "./project-execution-service.js";

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
      task = await this.service.recordIntegration(projectId, task.id, lease.leaseId, this.workerId, integration);
      await this.adapters.observe?.(projectId, task);
      return await this.service.get(projectId);
    } finally {
      clearInterval(heartbeat);
    }
  }

  private async heal(projectId: string, task: ExecutionTask, leaseId: string, validation: WorkerValidation, implementation: ImplementationResult) {
    const [failureClass, policy] = await Promise.all([this.adapters.classifyFailure(projectId, task, validation), this.adapters.healingPolicy(projectId, task)]);
    return this.service.assessHealing(projectId, task.id, leaseId, this.workerId, { failureClass, changedFiles: implementation.changedFiles, policy, goldenScore: implementation.goldenScore, previousGoldenScore: implementation.previousGoldenScore });
  }
}
