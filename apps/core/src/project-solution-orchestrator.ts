import { createHash } from "node:crypto";

import {
  solutionContentSchema,
  solutionRevisionScopeSchema,
  solutionReviewResultSchema,
  type SolutionContent,
} from "../../../packages/orchestration/src/solution-design.js";
import type { ProjectLifecycleRecord } from "../../../packages/orchestration/src/project-lifecycle.js";
import type { ProjectLifecycleService } from "./project-lifecycle-service.js";
import type { ProjectSolutionService } from "./project-solution-service.js";
import type { ProjectEgressPermit } from "./project-egress-policy-service.js";
import { assertDeliveryPlanningEligible } from "../../../packages/orchestration/src/eligibility-gate.js";

export type SolutionRole = "product_research" | "technical_research" | "solution_revision_scope" | "solution_reconciliation" | "product_review" | "technical_review" | "delivery_planning" | "delivery_review" | "technical_delivery_review";

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
    private readonly lifecycles: Pick<ProjectLifecycleService, "get" | "eligibility" | "publishSolution">,
    private readonly solutions: Pick<ProjectSolutionService, "publish" | "publishResearch" | "read" | "readContent">,
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
    const eligibility = await this.lifecycles.eligibility(projectId);
    if (!eligibility) throw new Error("Solution research requires a current major-work eligibility decision.");
    assertDeliveryPlanningEligible(eligibility, {
      projectId,
      assessment: lifecycle.assessment,
      now: this.now(),
    });
    const verified = await this.context.readVerified(projectId);
    const permit = await this.egress.authorize(projectId, verified.digest);
    const existing = await this.readExisting(projectId);
    if (existing && lifecycle.designFeedback.length === 0 && lifecycle.artifacts.some((artifact) => artifact.kind === "solution" && artifact.digest === existing.digest)) return lifecycle;
    const revision = existing ? existing.revision + 1 : 1;
    const feedback = lifecycle.designFeedback.at(-1)?.feedback.trim() || "No owner revision feedback.";
    const existingContent = existing ? await this.solutions.readContent(projectId) : null;
    const baseSources = [{ name: "CONTEXT.md", content: verified.markdown }, { name: "Owner feedback", content: feedback }, ...(existingContent ? [{ name: "Current approved candidate", content: safeJson(existingContent) }] : [])];
    const revisionScope = existingContent ? solutionRevisionScopeSchema.parse((await this.model.run({
      projectId, role: "solution_revision_scope", contextDigest: verified.digest,
      instruction: revisionScopeInstruction(), sources: baseSources, permit,
    })).response) : null;

    const [product, technical] = await Promise.all([
      this.model.run({ projectId, role: "product_research", contextDigest: verified.digest, instruction: productInstruction(), sources: baseSources, permit }),
      this.model.run({ projectId, role: "technical_research", contextDigest: verified.digest, instruction: technicalInstruction(), sources: baseSources, permit }),
    ]);
    await this.solutions.publishResearch(projectId, {
      contextDigest: verified.digest,
      product,
      technical,
    });
    const reconciled = await this.model.run({
      projectId, role: "solution_reconciliation", contextDigest: verified.digest,
      instruction: reconciliationInstruction(),
      sources: [...baseSources, { name: "Product research", content: safeJson(product.response) }, { name: "Technical research", content: safeJson(technical.response) }], permit,
    });
    const candidate = solutionContentSchema.parse(reconciled.response);
    const content = existingContent && revisionScope ? mergeScopedRevision(existingContent, candidate, revisionScope.sections) : candidate;
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

function productInstruction() { return "Analyze the grounded context as a product specialist. Return a strict research evidence graph with discipline=product, scoped questions, HTTP(S) sources, retrieval timestamps, SHA-256 excerpt digests, confidence, relevance, source-bound claims, contradictions, and explicit browsing/evidence gaps. Cover market, competitors, users, workflows, UX, rollout, and metrics. Never invent observed facts."; }
function technicalInstruction() { return "Analyze the grounded context as a senior architect. Return a strict research evidence graph with discipline=technical, scoped questions, HTTP(S) sources, retrieval timestamps, SHA-256 excerpt digests, confidence, relevance, source-bound claims, contradictions, and explicit browsing/evidence gaps. Cover architecture, data, integrations, security, privacy, reliability, and delivery constraints. Distinguish evidence from proposals."; }
function reconciliationInstruction() { return "Reconcile both specialist analyses into one complete implementable solution. Resolve conflicts using CONTEXT.md as authority, incorporate owner feedback, cite both local://CONTEXT.md and local://RESEARCH.md plus only verified research URLs, record selected and rejected alternatives with rationale, and keep every unresolved blocker explicit with owner, impact, and resolution. Populate every required solution section and return JSON matching the requested schema only."; }
function revisionScopeInstruction() { return "Compare the owner feedback with the current candidate and CONTEXT.md. Return only the exact solution section keys that must change. Do not include unaffected sections. Return strict structured JSON."; }
function reviewInstruction(discipline: "product" | "technical") { return `Independently audit the candidate solution from the ${discipline} discipline against CONTEXT.md and owner feedback. Fail on omissions, contradictions, invented facts, unsafe assumptions, or non-implementable guidance. Return a strict verdict and actionable findings.`; }

export function solutionRunDigest(input: { projectId: string; contextDigest: string; revision: number }) {
  return createHash("sha256").update(`${input.projectId}:${input.contextDigest}:${input.revision}`).digest("hex");
}

function mergeScopedRevision(current: SolutionContent, candidate: SolutionContent, sections: readonly string[]): SolutionContent {
  const allowed = new Set(sections);
  const merged = { ...current } as Record<string, unknown>;
  for (const section of allowed) merged[section] = (candidate as unknown as Record<string, unknown>)[section];
  merged.citations = [...new Set([...current.citations, ...candidate.citations])];
  return solutionContentSchema.parse(merged);
}
