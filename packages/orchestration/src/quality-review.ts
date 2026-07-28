export type ReviewRole = "functional" | "design" | "security" | "risk";

export interface QualityFinding {
  readonly id: string;
  readonly severity: "info" | "minor" | "major" | "critical";
  readonly evidenceRef: string;
  readonly confidence: number;
  readonly acceptanceCriterion: string;
  readonly recommendedRepair: string;
}

export interface QualityReview {
  readonly reviewerId: string;
  readonly providerId: string;
  readonly role: ReviewRole;
  readonly verdict: "pass" | "fail" | "needs_user";
  readonly findings: readonly QualityFinding[];
}

export function evaluateQualityQuorum(input: {
  readonly uiChanged: boolean;
  readonly implementerProviderId: string;
  readonly deterministicValidationPassed: boolean;
  readonly reviews: readonly QualityReview[];
}): {
  readonly ready: boolean;
  readonly verdict: "pass" | "fail" | "needs_user";
  readonly dissent: boolean;
  readonly roles: readonly ReviewRole[];
  readonly findings: readonly (QualityFinding & { reviewerId: string; role: ReviewRole })[];
} {
  if (input.reviews.length < 2) throw new Error("Independent review requires at least two reviewers.");
  if (new Set(input.reviews.map((review) => review.reviewerId)).size !== input.reviews.length) {
    throw new Error("Reviewer identities must be independent.");
  }
  if (input.reviews.every((review) => review.providerId === input.implementerProviderId)) {
    throw new Error("Review quorum must include a provider independent from the implementer.");
  }
  const roles = [...new Set(input.reviews.map((review) => review.role))].sort();
  if (!roles.includes("functional") || (input.uiChanged && !roles.includes("design"))) {
    throw new Error("The required functional and design review roles are missing.");
  }
  const findings = input.reviews.flatMap((review) =>
    review.findings.map((finding) => {
      if (
        !finding.evidenceRef.trim() ||
        !finding.acceptanceCriterion.trim() ||
        !finding.recommendedRepair.trim() ||
        finding.confidence < 0 ||
        finding.confidence > 1
      ) {
        throw new Error("Review finding is incomplete.");
      }
      return { ...finding, reviewerId: review.reviewerId, role: review.role };
    })
  );
  const dissent = new Set(input.reviews.map((review) => review.verdict)).size > 1;
  const critical = findings.some((finding) => finding.severity === "critical");
  const needsUser = input.reviews.some((review) => review.verdict === "needs_user");
  const failed = input.reviews.some((review) => review.verdict === "fail");
  const verdict = needsUser ? "needs_user" : critical || failed ? "fail" : "pass";
  return {
    ready: input.deterministicValidationPassed && verdict === "pass",
    verdict: input.deterministicValidationPassed ? verdict : "fail",
    dissent,
    roles,
    findings,
  };
}
