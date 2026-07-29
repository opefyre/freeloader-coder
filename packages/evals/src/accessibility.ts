import { z } from "zod";

const version = z.literal(1);
const isoDate = z.string().datetime();

export const accessibilityDimensionSchema = z.enum([
  "keyboard",
  "focus",
  "semantics",
  "contrast",
  "motion",
  "zoom",
  "reflow",
  "text_alternative",
]);
export type AccessibilityDimension = z.infer<
  typeof accessibilityDimensionSchema
>;

export const accessibilityCheckSchema = z.strictObject({
  schemaVersion: version,
  id: z.string().regex(/^[a-z0-9][a-z0-9._-]+$/),
  label: z.string().min(3).max(120),
  dimension: accessibilityDimensionSchema,
  method: z.enum(["automated", "manual"]),
  severity: z.enum(["critical", "major", "minor"]),
  required: z.boolean(),
  state: z.enum(["passed", "failed", "not_run", "stale"]),
  surfaces: z.array(z.string().min(1).max(100)).min(1).max(100),
  owner: z.string().min(2).max(80),
  observedAt: isoDate.nullable(),
  reviewAfter: isoDate,
  evidenceRef: z.string().min(3).max(240).nullable(),
  remediation: z.string().min(5).max(400),
});
export type AccessibilityCheck = z.infer<typeof accessibilityCheckSchema>;

export const accessibilityGateSchema = z.strictObject({
  schemaVersion: version,
  candidateId: z.string().regex(/^candidate-[a-z0-9.-]+$/),
  standard: z.literal("WCAG 2.2 AA"),
  checks: z.array(accessibilityCheckSchema).min(8).max(200),
  criticalWorkflows: z.array(z.string().min(2).max(120)).min(1).max(50),
  supportedZoomPercent: z.literal(200),
  generatedAt: isoDate,
});
export type AccessibilityGate = z.infer<typeof accessibilityGateSchema>;

export interface AccessibilityAssessment {
  readonly releasable: boolean;
  readonly passed: number;
  readonly required: number;
  readonly failures: readonly AccessibilityCheck[];
  readonly criticalFailures: readonly AccessibilityCheck[];
  readonly incomplete: readonly AccessibilityCheck[];
  readonly stale: readonly AccessibilityCheck[];
  readonly missingDimensions: readonly AccessibilityDimension[];
  readonly action: string;
}

export function evaluateAccessibility(
  raw: unknown,
  now: string
): AccessibilityAssessment {
  const gate = accessibilityGateSchema.parse(raw);
  const required = gate.checks.filter((check) => check.required);
  const failures = required.filter((check) => check.state === "failed");
  const incomplete = required.filter((check) => check.state === "not_run");
  const stale = required.filter(
    (check) => check.state === "stale" || check.reviewAfter < now
  );
  const dimensions = new Set(required.map((check) => check.dimension));
  const allDimensions = accessibilityDimensionSchema.options;
  const missingDimensions = allDimensions.filter(
    (dimension) => !dimensions.has(dimension)
  );
  const criticalFailures = failures.filter(
    (check) => check.severity === "critical"
  );
  const releasable =
    failures.length === 0 &&
    incomplete.length === 0 &&
    stale.length === 0 &&
    missingDimensions.length === 0;
  return {
    releasable,
    passed: required.filter(
      (check) =>
        check.state === "passed" &&
        check.reviewAfter >= now &&
        check.evidenceRef !== null
    ).length,
    required: required.length,
    failures,
    criticalFailures,
    incomplete,
    stale,
    missingDimensions,
    action: releasable
      ? "Attach accessibility evidence to the release candidate."
      : criticalFailures[0]?.remediation ??
        failures[0]?.remediation ??
        incomplete[0]?.remediation ??
        stale[0]?.remediation ??
        "Add evidence for every required accessibility dimension.",
  };
}
