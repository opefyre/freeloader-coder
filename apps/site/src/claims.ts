export type ClaimStatus = "verified" | "bounded" | "unavailable";

export type PublicClaim = {
  readonly id: string;
  readonly label: string;
  readonly detail: string;
  readonly status: ClaimStatus;
  readonly source: string;
  readonly sourceLabel: string;
};

export const repositoryUrl = "https://github.com/opefyre/freeloader-coder";
export const documentationUrl = `${repositoryUrl}#readme`;
export const issuesUrl = `${repositoryUrl}/issues`;
export const securityUrl = `${repositoryUrl}/security`;

export const publicClaims: readonly PublicClaim[] = [
  { id: "local-first", label: "Local-first control", detail: "Project state, credentials, validation, and canonical evidence remain under the operator's control.", status: "verified", source: `${repositoryUrl}/blob/main/docs/decisions/adr-0001-local-first.md`, sourceLabel: "Local-first ADR" },
  { id: "free-first", label: "$0 automatic spend", detail: "Paid routes are disabled by default and no provider can silently convert a free workflow into paid usage.", status: "verified", source: `${repositoryUrl}/blob/main/docs/decisions/adr-0002-free-first.md`, sourceLabel: "Free-first ADR" },
  { id: "evidence", label: "Evidence before Done", detail: "Model output is never treated as completion until deterministic validation and required review pass.", status: "verified", source: `${repositoryUrl}/blob/main/docs/decisions/adr-0003-evidence-before-done.md`, sourceLabel: "Evidence ADR" },
  { id: "providers", label: "Free-provider fabric", detail: "Provider eligibility and quotas vary by account, region, model, and time; admission is probed rather than assumed.", status: "bounded", source: `${repositoryUrl}/blob/main/docs/architecture/expanded-provider-mesh.md`, sourceLabel: "Provider architecture" },
  { id: "paid", label: "Paid providers", detail: "OpenAI and Anthropic live API execution is not currently available. Safety contracts and disabled surfaces exist.", status: "unavailable", source: `${repositoryUrl}/blob/main/docs/evidence/PIPE-113-177-PAID-SAFETY.md`, sourceLabel: "Paid-provider evidence" },
  { id: "launch", label: "Public preview", detail: "The verified static preview is publicly served from Cloudflare Pages. Adoption, conversion, and retention evidence are not yet claimed.", status: "verified", source: "https://pipeline-studio.pages.dev/", sourceLabel: "Live preview" }
];

export const demoStages = [
  { id: "request", eyebrow: "01 · Intent", title: "Describe the outcome", detail: "Ask in plain language. The workspace binds the request to one registered repository and shows what remains unclear.", evidence: "Durable request · readiness questions" },
  { id: "plan", eyebrow: "02 · Grounding", title: "Review a cited plan", detail: "Repository topology and protected paths ground a dependency-aware plan. You approve a specific revision.", evidence: "Source snapshot · immutable approval" },
  { id: "work", eyebrow: "03 · Isolation", title: "Generate changes safely", detail: "A provider proposes bounded changes inside an isolated Git worktree. External text remains untrusted input.", evidence: "Worktree proof · patch preview" },
  { id: "validate", eyebrow: "04 · Verification", title: "Prove the result", detail: "Fixed project-aware commands validate the changed scope. Failure preserves work and opens bounded healing.", evidence: "Tests · build · policy findings" },
  { id: "review", eyebrow: "05 · Judgment", title: "Inspect independent review", detail: "Functional and risk review assess the observed diff and evidence. Uncertainty stops for you.", evidence: "Review quorum · dissent" },
  { id: "apply", eyebrow: "06 · Control", title: "Keep, restore, or publish", detail: "Only an explicit action can integrate or publish. The demo ends before any external write.", evidence: "Receipt preview · no external effect" }
] as const;
