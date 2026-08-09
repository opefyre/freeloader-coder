import { createHash } from "node:crypto";

import {
  solutionContentSchema,
  solutionReviewResultSchema,
  type SolutionContent,
} from "../../../packages/orchestration/src/solution-design.js";
import type { ProjectLifecycleRecord } from "../../../packages/orchestration/src/project-lifecycle.js";
import type { ProjectLifecycleService } from "./project-lifecycle-service.js";
import type { ProjectSolutionService } from "./project-solution-service.js";
import type { ProjectEgressPermit } from "./project-egress-policy-service.js";

export type SolutionRole = "product_research" | "technical_research" | "solution_reconciliation" | "product_review" | "technical_review" | "delivery_planning" | "delivery_review" | "technical_delivery_review";

export interface SolutionModelEvidence {
  readonly providerId: string;
  readonly modelId: string;
  readonly response: unknown;
}

export interface RoutedSolutionModel {
  run(input: {
    readonly projectId: string;
    readonly role: SolutionRole;
    readonly contextDigest: string;
    readonly instruction: string;
    readonly sources: readonly { name: string; content: string }[];
    readonly permit: ProjectEgressPermit;
  }): Promise<SolutionModelEvidence>;
}

export interface VerifiedProjectContext {
  readonly digest: string;
  readonly markdown: string;
}

export class ProjectSolutionOrchestrator {
  constructor(
    private readonly lifecycles: Pick<ProjectLifecycleService, "get" | "publishSolution">,
    private readonly solutions: Pick<ProjectSolutionService, "publish" | "read">,
    private readonly context: { readVerified(projectId: string): Promise<VerifiedProjectContext> },
    private readonly egress: { authorize(projectId: string, contextDigest: string): Promise<ProjectEgressPermit> },
    private readonly model: RoutedSolutionModel,
    private readonly now: () => number = Date.now
  ) {}

  async run(projectId: string): Promise<ProjectLifecycleRecord> {
    const lifecycle = await this.lifecycles.get(projectId);
    if (!lifecycle) throw new Error("Project lifecycle was not found.");
    if (lifecycle.stage === "awaiting_design_approval") return lifecycle;
    if (lifecycle.stage !== "solution_design") throw new Error("Solution research is available only during solution design.");
    const verified = await this.context.readVerified(projectId);
    const permit = await this.egress.authorize(projectId, verified.digest);
    const existing = await this.readExisting(projectId);
    if (existing && lifecycle.artifacts.some((artifact) => artifact.kind === "solution" && artifact.digest === existing.digest)) return lifecycle;
    const revision = existing ? existing.revision + 1 : 1;
    const feedback = lifecycle.designFeedback.at(-1)?.feedback.trim() || "No owner revision feedback.";
    const baseSources = [{ name: "CONTEXT.md", content: verified.markdown }, { name: "Owner feedback", content: feedback }];

    const [product, technical] = await Promise.all([
      this.model.run({ projectId, role: "product_research", contextDigest: verified.digest, instruction: productInstruction(), sources: baseSources, permit }),
      this.model.run({ projectId, role: "technical_research", contextDigest: verified.digest, instruction: technicalInstruction(), sources: baseSources, permit }),
    ]);
    const reconciled = await this.model.run({
      projectId, role: "solution_reconciliation", contextDigest: verified.digest,
      instruction: reconciliationInstruction(),
      sources: [...baseSources, { name: "Product research", content: safeJson(product.response) }, { name: "Technical research", content: safeJson(technical.response) }], permit,
    });
    const content = solutionContentSchema.parse(reconciled.response);
    const reviewSource = { name: "Candidate solution", content: safeJson(content) };
    const [productReviewEvidence, technicalReviewEvidence] = await Promise.all([
      this.model.run({ projectId, role: "product_review", contextDigest: verified.digest, instruction: reviewInstruction("product"), sources: [...baseSources, reviewSource], permit }),
      this.model.run({ projectId, role: "technical_review", contextDigest: verified.digest, instruction: reviewInstruction("technical"), sources: [...baseSources, reviewSource], permit }),
    ]);
    const productReview = solutionReviewResultSchema.parse(productReviewEvidence.response);
    const technicalReview = solutionReviewResultSchema.parse(technicalReviewEvidence.response);
    if (productReview.discipline !== "product" || technicalReview.discipline !== "technical") throw new Error("Solution reviewers returned mismatched disciplines.");
    if (productReview.verdict !== "pass" || technicalReview.verdict !== "pass") {
      throw new SolutionReviewDissentError([...productReview.findings, ...technicalReview.findings]);
    }
    const reviewerIds = [reviewerIdentity(productReviewEvidence, productReview.reviewerId), reviewerIdentity(technicalReviewEvidence, technicalReview.reviewerId)];
    if (reviewerIds[0] === reviewerIds[1]) throw new Error("Solution review requires independent reviewer identities.");
    const artifact = await this.solutions.publish(projectId, {
      ...content, revision, reviews: [
        { ...productReview, reviewerId: reviewerIds[0], verdict: "pass" },
        { ...technicalReview, reviewerId: reviewerIds[1], verdict: "pass" },
      ],
    }, this.now());
    return this.lifecycles.publishSolution(projectId, artifact);
  }

  private async readExisting(projectId: string) {
    try { return await this.solutions.read(projectId); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
  }
}

export class SolutionReviewDissentError extends Error {
  constructor(readonly findings: readonly string[]) { super("Independent solution review did not reach approval."); }
}

function reviewerIdentity(evidence: SolutionModelEvidence, declared: string) {
  return `${evidence.providerId}/${evidence.modelId}/${declared}`.slice(0, 160);
}

function safeJson(value: unknown) {
  const serialized = JSON.stringify(value);
  if (!serialized || serialized.length > 500_000) throw new Error("Solution research output is not safely bounded.");
  return serialized;
}

function productInstruction() { return "Analyze the grounded context as a product specialist. Cover user outcomes, workflows, UX, rollout, metrics, ambiguity, and primary-source citations. Return structured JSON only; never invent observed facts."; }
function technicalInstruction() { return "Analyze the grounded context as a senior architect. Cover architecture, data, integrations, security, privacy, reliability, delivery constraints, and primary-source citations. Return structured JSON only; distinguish evidence from proposals."; }
function reconciliationInstruction() { return "Reconcile both specialist analyses into one complete implementable solution. Resolve conflicts using CONTEXT.md as authority, incorporate owner feedback, retain traceable citations, and populate every required solution section. Return JSON matching the requested schema only."; }
function reviewInstruction(discipline: "product" | "technical") { return `Independently audit the candidate solution from the ${discipline} discipline against CONTEXT.md and owner feedback. Fail on omissions, contradictions, invented facts, unsafe assumptions, or non-implementable guidance. Return a strict verdict and actionable findings.`; }

export function solutionRunDigest(input: { projectId: string; contextDigest: string; revision: number }) {
  return createHash("sha256").update(`${input.projectId}:${input.contextDigest}:${input.revision}`).digest("hex");
}
