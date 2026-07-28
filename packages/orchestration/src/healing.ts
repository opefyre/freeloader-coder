export type HealingFailureClass =
  | "implementation"
  | "environment"
  | "flaky"
  | "provider"
  | "contract"
  | "product_decision"
  | "unsafe";

export interface HealingPolicy {
  readonly maxAttempts: number;
  readonly allowedFiles: readonly string[];
  readonly protectedPaths: readonly string[];
  readonly requiredChecks: readonly string[];
  readonly requiredReviewRoles: readonly string[];
  readonly minimumGoldenScore: number;
}

export interface HealingState {
  readonly attempt: number;
  readonly status: "repairable" | "needs_user" | "quarantined" | "recovered";
  readonly failureClass: HealingFailureClass;
  readonly evidenceRefs: readonly string[];
}

export function planHealing(input: {
  readonly failureClass: HealingFailureClass;
  readonly attempt: number;
  readonly changedFiles: readonly string[];
  readonly policy: HealingPolicy;
  readonly goldenScore: number;
  readonly previousGoldenScore: number;
}): HealingState {
  const { policy } = input;
  if (policy.maxAttempts < 0 || policy.maxAttempts > 10) throw new Error("Healing budget is invalid.");
  if (input.changedFiles.some((path) => policy.protectedPaths.some((protectedPath) =>
    path === protectedPath || path.startsWith(`${protectedPath}/`)
  ))) {
    return state("unsafe", input.attempt, "quarantined", ["protected-path-violation"]);
  }
  if (input.changedFiles.some((path) => !policy.allowedFiles.includes(path))) {
    return state("contract", input.attempt, "quarantined", ["scope-violation"]);
  }
  if (["product_decision", "environment"].includes(input.failureClass)) {
    return state(input.failureClass, input.attempt, "needs_user", [`${input.failureClass}-instruction`]);
  }
  if (input.failureClass === "unsafe") {
    return state(input.failureClass, input.attempt, "quarantined", ["unsafe-failure"]);
  }
  if (
    input.goldenScore < policy.minimumGoldenScore ||
    input.goldenScore < input.previousGoldenScore
  ) {
    return state(input.failureClass, input.attempt, "quarantined", ["golden-regression"]);
  }
  if (input.attempt >= policy.maxAttempts) {
    return state(input.failureClass, input.attempt, "quarantined", ["healing-budget-exhausted"]);
  }
  return state(input.failureClass, input.attempt, "repairable", ["validation-failure"]);
}

export function acceptHealing(input: {
  readonly state: HealingState;
  readonly checksRun: readonly string[];
  readonly reviewRolesRun: readonly string[];
  readonly policy: HealingPolicy;
}): HealingState {
  if (input.state.status !== "repairable") throw new Error("Only repairable work can be accepted.");
  if (input.policy.requiredChecks.some((check) => !input.checksRun.includes(check))) {
    throw new Error("Healing cannot weaken required validation.");
  }
  if (input.policy.requiredReviewRoles.some((role) => !input.reviewRolesRun.includes(role))) {
    throw new Error("Healing cannot weaken review quorum.");
  }
  return { ...input.state, status: "recovered", evidenceRefs: [...input.state.evidenceRefs, "revalidation-passed", "review-passed"] };
}

function state(
  failureClass: HealingFailureClass,
  attempt: number,
  status: HealingState["status"],
  evidenceRefs: readonly string[],
): HealingState {
  return { failureClass, attempt, status, evidenceRefs };
}
