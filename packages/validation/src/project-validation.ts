import { createHash } from "node:crypto";

export type CheckKind =
  | "format"
  | "lint"
  | "type"
  | "unit"
  | "integration"
  | "build"
  | "security"
  | "accessibility"
  | "project";

export type CheckOutcome =
  | "passed"
  | "failed"
  | "warning"
  | "skipped"
  | "unavailable"
  | "timeout"
  | "crash"
  | "flaky"
  | "not_applicable"
  | "waived";

export interface ProjectCheck {
  readonly id: string;
  readonly kind: CheckKind;
  readonly command: readonly string[];
  readonly required: boolean;
  readonly appliesTo: readonly string[];
  readonly environment: Readonly<Record<string, string>>;
}

export interface CheckObservation {
  readonly checkId: string;
  readonly outcome: CheckOutcome;
  readonly durationMs: number;
  readonly artifactDigest: string | null;
  readonly logRef: string | null;
  readonly waiver: {
    readonly authorizedBy: string;
    readonly consequence: string;
  } | null;
}

export interface ValidationReport {
  readonly schemaVersion: 1;
  readonly sourceDigest: string;
  readonly planDigest: string;
  readonly reportDigest: string;
  readonly ready: boolean;
  readonly checks: readonly (ProjectCheck & CheckObservation)[];
}

export function createValidationPlan(input: {
  readonly checks: readonly ProjectCheck[];
  readonly changedPaths: readonly string[];
}): readonly ProjectCheck[] {
  const ids = new Set<string>();
  const changed = [...new Set(input.changedPaths)].sort();
  return input.checks
    .map((check) => {
      if (!/^[a-zA-Z0-9._-]{1,120}$/.test(check.id) || ids.has(check.id)) {
        throw new Error("Validation check identities must be unique and valid.");
      }
      ids.add(check.id);
      if (check.command.length === 0 || check.command.some((part) => !part.trim())) {
        throw new Error("Validation commands must be explicit.");
      }
      if (check.required && check.appliesTo.length === 0) {
        throw new Error("Required checks must declare their scope.");
      }
      return {
        ...check,
        command: [...check.command],
        appliesTo: [...new Set(check.appliesTo)].sort(),
        environment: Object.fromEntries(Object.entries(check.environment).sort()),
      };
    })
    .filter((check) =>
      check.required ||
      check.appliesTo.some((pattern) => changed.some((path) => matchesScope(path, pattern)))
    )
    .sort((left, right) => Number(right.required) - Number(left.required) || left.id.localeCompare(right.id));
}

export function buildValidationReport(input: {
  readonly sourceDigest: string;
  readonly plan: readonly ProjectCheck[];
  readonly observations: readonly CheckObservation[];
}): ValidationReport {
  if (!/^[a-f0-9]{64}$/.test(input.sourceDigest)) throw new Error("Source digest is invalid.");
  const observations = new Map(input.observations.map((item) => [item.checkId, item]));
  if (observations.size !== input.observations.length) {
    throw new Error("Check observations must be unique.");
  }
  const checks = input.plan.map((check) => {
    const observation = observations.get(check.id);
    if (!observation) throw new Error(`Missing observation for ${check.id}.`);
    validateObservation(check, observation);
    return { ...check, ...observation };
  });
  if (observations.size !== checks.length) throw new Error("Unknown check observation.");
  const planDigest = digest(JSON.stringify(input.plan));
  const body = {
    schemaVersion: 1 as const,
    sourceDigest: input.sourceDigest,
    planDigest,
    ready: checks.every((check) => checkAllowsReadiness(check)),
    checks,
  };
  return { ...body, reportDigest: digest(JSON.stringify(body)) };
}

function validateObservation(check: ProjectCheck, observation: CheckObservation): void {
  if (observation.durationMs < 0 || !Number.isFinite(observation.durationMs)) {
    throw new Error("Check duration is invalid.");
  }
  if (observation.outcome === "waived") {
    if (!observation.waiver?.authorizedBy.trim() || !observation.waiver.consequence.trim()) {
      throw new Error("A waiver requires an authorized user and consequence.");
    }
  } else if (observation.waiver) {
    throw new Error("Waiver evidence is only valid for waived checks.");
  }
  if (check.required && ["skipped", "not_applicable"].includes(observation.outcome)) {
    throw new Error("Required checks cannot be skipped or marked not applicable.");
  }
}

function checkAllowsReadiness(check: ProjectCheck & CheckObservation): boolean {
  if (!check.required) return !["failed", "timeout", "crash"].includes(check.outcome);
  return ["passed", "warning", "waived"].includes(check.outcome);
}

function matchesScope(path: string, pattern: string): boolean {
  if (pattern === "*") return true;
  return pattern.endsWith("/") ? path.startsWith(pattern) : path === pattern || path.startsWith(`${pattern}/`);
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
