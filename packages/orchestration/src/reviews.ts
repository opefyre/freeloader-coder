export interface ReviewerFinding {
  readonly severity: "info" | "minor" | "major" | "critical";
  readonly message: string;
}

export interface ReviewerResult {
  readonly reviewerId: string;
  readonly verdict: "pass" | "fail" | "needs_user";
  readonly findings: readonly ReviewerFinding[];
}

export interface QuorumResult {
  readonly verdict: "pass" | "fail" | "needs_user";
  readonly dissent: boolean;
  readonly findings: readonly (ReviewerFinding & { readonly reviewerId: string })[];
}

export function aggregateReviewQuorum(results: readonly ReviewerResult[]): QuorumResult {
  if (results.length < 2) throw new Error("Review quorum requires at least two reviewers.");
  if (new Set(results.map((result) => result.reviewerId)).size !== results.length) {
    throw new Error("Reviewers must be independent identities.");
  }
  const findings = results.flatMap((result) =>
    result.findings.map((finding) => ({ ...finding, reviewerId: result.reviewerId }))
  );
  if (results.some((result) => result.verdict === "needs_user")) {
    return { verdict: "needs_user", dissent: true, findings };
  }
  if (findings.some((finding) => ["major", "critical"].includes(finding.severity))) {
    return { verdict: "fail", dissent: results.some((result) => result.verdict === "pass"), findings };
  }
  const failures = results.filter((result) => result.verdict === "fail").length;
  return {
    verdict: failures > results.length / 2 ? "fail" : "pass",
    dissent: failures > 0,
    findings
  };
}
