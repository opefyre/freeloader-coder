export type ReadinessClass =
  | "ready"
  | "ready_with_assumptions"
  | "needs_information"
  | "unsafe"
  | "unsupported"
  | "requires_external_setup";

export type BlockerKind =
  | "product"
  | "project_evidence"
  | "permission"
  | "environment"
  | "cost"
  | "provider";

export interface ReadinessAmbiguity {
  readonly id: string;
  readonly kind: BlockerKind;
  readonly material: boolean;
  readonly question: string;
  readonly recommendedDefault: string | null;
  readonly consequence: string;
}

export interface EditableAssumption {
  readonly id: string;
  readonly value: string;
  readonly source: string;
}

export interface ReadinessInput {
  readonly requestId: string;
  readonly unsafeReason: string | null;
  readonly unsupportedReason: string | null;
  readonly ambiguities: readonly ReadinessAmbiguity[];
  readonly assumptions: readonly EditableAssumption[];
}

export interface ReadinessDecision {
  readonly schemaVersion: 1;
  readonly requestId: string;
  readonly classification: ReadinessClass;
  readonly blockers: readonly ReadinessAmbiguity[];
  readonly questions: readonly ReadinessAmbiguity[];
  readonly assumptions: readonly EditableAssumption[];
  readonly implementerEligible: boolean;
}

export function classifyReadiness(input: ReadinessInput): ReadinessDecision {
  assertIdentity(input.requestId, "Request");
  const ambiguities = uniqueById(input.ambiguities, "Readiness ambiguity")
    .map(validateAmbiguity)
    .sort(compareAmbiguity);
  const assumptions = uniqueById(input.assumptions, "Assumption")
    .map(validateAssumption)
    .sort((left, right) => left.id.localeCompare(right.id));
  const blockers = ambiguities.filter((ambiguity) => ambiguity.material);
  const external = blockers.filter((blocker) =>
    ["environment", "cost", "provider"].includes(blocker.kind)
  );
  const information = blockers.filter((blocker) =>
    ["product", "project_evidence", "permission"].includes(blocker.kind)
  );

  const classification: ReadinessClass = input.unsafeReason
    ? "unsafe"
    : input.unsupportedReason
      ? "unsupported"
      : external.length > 0
        ? "requires_external_setup"
        : information.length > 0
          ? "needs_information"
          : assumptions.length > 0
            ? "ready_with_assumptions"
            : "ready";

  return {
    schemaVersion: 1,
    requestId: input.requestId,
    classification,
    blockers,
    questions: blockers.slice(0, 3),
    assumptions,
    implementerEligible:
      classification === "ready" || classification === "ready_with_assumptions"
  };
}

export function editReadinessAssumption(
  decision: ReadinessDecision,
  assumptionId: string,
  value: string
): ReadinessDecision {
  if (!decision.implementerEligible) {
    throw new Error("Blocked readiness decisions cannot be edited into implementation.");
  }
  const nextValue = value.trim();
  if (!nextValue) throw new Error("Assumption value cannot be empty.");
  if (!decision.assumptions.some((assumption) => assumption.id === assumptionId)) {
    throw new Error("Assumption does not exist.");
  }
  return {
    ...decision,
    assumptions: decision.assumptions.map((assumption) =>
      assumption.id === assumptionId ? { ...assumption, value: nextValue } : assumption
    )
  };
}

function validateAmbiguity(ambiguity: ReadinessAmbiguity): ReadinessAmbiguity {
  assertIdentity(ambiguity.id, "Readiness ambiguity");
  if (!ambiguity.question.trim() || !ambiguity.consequence.trim()) {
    throw new Error("Readiness ambiguity requires a question and consequence.");
  }
  if (!ambiguity.material && !ambiguity.recommendedDefault?.trim()) {
    throw new Error("Non-material ambiguity requires a recommended default.");
  }
  return {
    ...ambiguity,
    question: ambiguity.question.trim(),
    recommendedDefault: ambiguity.recommendedDefault?.trim() || null,
    consequence: ambiguity.consequence.trim()
  };
}

function validateAssumption(assumption: EditableAssumption): EditableAssumption {
  assertIdentity(assumption.id, "Assumption");
  if (!assumption.value.trim() || !assumption.source.trim()) {
    throw new Error("Assumption requires a value and source.");
  }
  return {
    ...assumption,
    value: assumption.value.trim(),
    source: assumption.source.trim()
  };
}

function compareAmbiguity(left: ReadinessAmbiguity, right: ReadinessAmbiguity): number {
  const priority: Record<BlockerKind, number> = {
    product: 0,
    permission: 1,
    project_evidence: 2,
    environment: 3,
    cost: 4,
    provider: 5
  };
  return Number(right.material) - Number(left.material)
    || priority[left.kind] - priority[right.kind]
    || left.id.localeCompare(right.id);
}

function uniqueById<T extends { readonly id: string }>(
  values: readonly T[],
  label: string
): T[] {
  const ids = new Set<string>();
  for (const value of values) {
    if (ids.has(value.id)) throw new Error(`${label} IDs must be unique.`);
    ids.add(value.id);
  }
  return [...values];
}

function assertIdentity(value: string, label: string): void {
  if (!/^[a-zA-Z0-9._-]{1,120}$/.test(value)) {
    throw new Error(`${label} identity is invalid.`);
  }
}
