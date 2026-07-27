export type Stage =
  | "queued"
  | "preparing"
  | "planning"
  | "implementing"
  | "fast_validation"
  | "full_validation"
  | "healing"
  | "functional_review"
  | "design_review"
  | "committing"
  | "integrating"
  | "integration_validation"
  | "review_ready"
  | "needs_user"
  | "quarantined";

export interface WorkflowRecord {
  readonly taskId: string;
  readonly stage: Stage;
  readonly revision: number;
  readonly healingAttempts: number;
  readonly evidence: readonly string[];
}

export interface ValidationResult {
  readonly passed: boolean;
  readonly evidence: string;
}

export interface ReviewResult {
  readonly verdict: "pass" | "fail" | "needs_user";
  readonly evidence: string;
}

export interface WorkflowAdapters {
  prepare(taskId: string): Promise<string>;
  plan(taskId: string): Promise<string>;
  implement(taskId: string): Promise<string>;
  validate(taskId: string, tier: "fast" | "full"): Promise<ValidationResult>;
  heal(taskId: string, attempt: number): Promise<string>;
  review(taskId: string, kind: "functional" | "design"): Promise<ReviewResult>;
  commit(taskId: string): Promise<string>;
  integrate(taskId: string): Promise<string>;
  validateIntegration(taskId: string): Promise<ValidationResult>;
}

export interface WorkflowOptions {
  readonly maxHealingAttempts: number;
}

export async function runWorkflow(
  taskId: string,
  adapters: WorkflowAdapters,
  options: WorkflowOptions = { maxHealingAttempts: 2 }
): Promise<WorkflowRecord> {
  let record: WorkflowRecord = {
    taskId,
    stage: "queued",
    revision: 0,
    healingAttempts: 0,
    evidence: []
  };

  const advance = (stage: Stage, evidence?: string): void => {
    record = {
      ...record,
      stage,
      revision: record.revision + 1,
      evidence: evidence ? [...record.evidence, evidence] : record.evidence
    };
  };

  advance("preparing", await adapters.prepare(taskId));
  advance("planning", await adapters.plan(taskId));
  advance("implementing", await adapters.implement(taskId));

  while (true) {
    advance("fast_validation");
    const fast = await adapters.validate(taskId, "fast");
    if (!fast.passed) {
      if (record.healingAttempts >= options.maxHealingAttempts) {
        advance("quarantined", fast.evidence);
        return record;
      }
      record = { ...record, healingAttempts: record.healingAttempts + 1 };
      advance("healing", fast.evidence);
      advance("implementing", await adapters.heal(taskId, record.healingAttempts));
      continue;
    }
    advance("full_validation", fast.evidence);
    const full = await adapters.validate(taskId, "full");
    if (!full.passed) {
      if (record.healingAttempts >= options.maxHealingAttempts) {
        advance("quarantined", full.evidence);
        return record;
      }
      record = { ...record, healingAttempts: record.healingAttempts + 1 };
      advance("healing", full.evidence);
      advance("implementing", await adapters.heal(taskId, record.healingAttempts));
      continue;
    }

    advance("functional_review", full.evidence);
    const functional = await adapters.review(taskId, "functional");
    if (functional.verdict === "needs_user") {
      advance("needs_user", functional.evidence);
      return record;
    }
    if (functional.verdict === "fail") {
      advance("quarantined", functional.evidence);
      return record;
    }

    advance("design_review", functional.evidence);
    const design = await adapters.review(taskId, "design");
    if (design.verdict === "needs_user") {
      advance("needs_user", design.evidence);
      return record;
    }
    if (design.verdict === "fail") {
      advance("quarantined", design.evidence);
      return record;
    }

    advance("committing", design.evidence);
    const commitEvidence = await adapters.commit(taskId);
    advance("integrating", commitEvidence);
    const integrationEvidence = await adapters.integrate(taskId);
    advance("integration_validation", integrationEvidence);
    const integrationValidation = await adapters.validateIntegration(taskId);
    if (!integrationValidation.passed) {
      advance("quarantined", integrationValidation.evidence);
      return record;
    }
    advance("review_ready", integrationValidation.evidence);
    return record;
  }
}
