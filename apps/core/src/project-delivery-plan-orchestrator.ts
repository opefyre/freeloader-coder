import { deliveryPlanContentSchema, deliveryPlanReviewSchema } from "../../../packages/orchestration/src/delivery-plan.js";
import type { ProjectLifecycleRecord } from "../../../packages/orchestration/src/project-lifecycle.js";
import type { ProjectEgressPermit } from "./project-egress-policy-service.js";
import type { ProjectLifecycleService } from "./project-lifecycle-service.js";
import type { ProjectDeliveryPlanService } from "./project-delivery-plan-service.js";
import type { RoutedSolutionModel, SolutionModelEvidence, VerifiedProjectContext } from "./project-solution-orchestrator.js";
import type { SolutionDocument } from "../../../packages/orchestration/src/solution-design.js";

export class ProjectDeliveryPlanOrchestrator {
  constructor(
    private readonly lifecycles: Pick<ProjectLifecycleService, "get" | "eligibility" | "publishBacklog">,
    private readonly plans: Pick<ProjectDeliveryPlanService, "publish" | "read">,
    private readonly context: { readVerified(projectId: string): Promise<VerifiedProjectContext> },
    private readonly solutions: { read(projectId: string): Promise<SolutionDocument> },
    private readonly egress: { authorize(projectId: string, contextDigest: string): Promise<ProjectEgressPermit> },
    private readonly model: RoutedSolutionModel,
    private readonly now: () => number = Date.now
  ) {}

  async run(projectId: string): Promise<ProjectLifecycleRecord> {
    const lifecycle = await this.lifecycles.get(projectId);
    if (!lifecycle) throw new Error("Project lifecycle was not found.");
    if (lifecycle.stage === "backlog_qa" || lifecycle.stage === "delivery") return lifecycle;
    if (lifecycle.stage !== "backlog_design" || lifecycle.designApproval?.decision !== "approved") throw new Error("Backlog planning requires an approved solution.");
    const eligibility = await this.lifecycles.eligibility(projectId);
    if (!eligibility?.eligible) throw new Error("Backlog planning requires an eligible major-work decision.");
    const [context, solution] = await Promise.all([this.context.readVerified(projectId), this.solutions.read(projectId)]);
    if (lifecycle.designApproval.artifactDigest !== solution.digest) throw new Error("Approved solution digest does not match the verified solution artifact.");
    const permit = await this.egress.authorize(projectId, context.digest);
    const existing = await this.readExisting(projectId);
    const sources = [{ name: "CONTEXT.md", content: context.markdown }, { name: "SOLUTION.md", content: solution.markdown }];
    const evidence = await this.model.run({ projectId, role: "delivery_planning", contextDigest: context.digest, instruction: planningInstruction(), sources, permit });
    const plan = deliveryPlanContentSchema.parse(evidence.response);
    if (plan.contextDigest !== context.digest || plan.solutionDigest !== solution.digest) throw new Error("Delivery plan is not bound to the approved evidence.");
    if (plan.items.some((item) => item.type === "subtask" && (item.allowedFiles.length === 0 || item.validationProfiles.length === 0))) throw new Error("Delivery plan subtasks require explicit file and validation authority.");
    const candidate = { name: "Candidate delivery plan", content: boundedJson(plan) };
    const [deliveryEvidence, technicalEvidence] = await Promise.all([
      this.model.run({ projectId, role: "delivery_review", contextDigest: context.digest, instruction: reviewInstruction("delivery"), sources: [...sources, candidate], permit }),
      this.model.run({ projectId, role: "technical_delivery_review", contextDigest: context.digest, instruction: reviewInstruction("technical"), sources: [...sources, candidate], permit }),
    ]);
    const delivery = deliveryPlanReviewSchema.parse(deliveryEvidence.response);
    const technical = deliveryPlanReviewSchema.parse(technicalEvidence.response);
    if (delivery.discipline !== "delivery" || technical.discipline !== "technical") throw new Error("Backlog reviewers returned mismatched disciplines.");
    if (delivery.verdict !== "pass" || technical.verdict !== "pass") throw new DeliveryPlanReviewDissentError([...delivery.findings, ...technical.findings]);
    const reviewerIds = [identity(deliveryEvidence, delivery.reviewerId), identity(technicalEvidence, technical.reviewerId)];
    const executors = [executorIdentity(evidence), executorIdentity(deliveryEvidence), executorIdentity(technicalEvidence)];
    if (reviewerIds[0] === reviewerIds[1] || new Set(executors).size !== executors.length) throw new Error("Backlog QA requires a planner and two independent reviewer identities.");
    const artifact = await this.plans.publish(projectId, { ...plan, revision: (existing?.revision ?? 0) + 1, reviews: [{ ...delivery, reviewerId: reviewerIds[0], verdict: "pass" }, { ...technical, reviewerId: reviewerIds[1], verdict: "pass" }] }, this.now());
    return this.lifecycles.publishBacklog(projectId, artifact);
  }

  private async readExisting(projectId: string) { try { return await this.plans.read(projectId); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; } }
}

export class DeliveryPlanReviewDissentError extends Error { constructor(readonly findings: readonly string[]) { super("Independent backlog QA did not reach approval."); } }
function identity(evidence: SolutionModelEvidence, declared: string) { return `${evidence.providerId}/${evidence.modelId}/${declared}`.slice(0, 160); }
function executorIdentity(evidence: SolutionModelEvidence) { return `${evidence.providerId}/${evidence.modelId}`; }
function boundedJson(value: unknown) { const result = JSON.stringify(value); if (!result || result.length > 2_000_000) throw new Error("Delivery plan output is not safely bounded."); return result; }
function planningInstruction() { return "Transform the approved solution into a self-contained delivery hierarchy. Include epics, stories, tasks, and 60–120 minute subtasks; estimates, dependencies, acceptance criteria, Definition of Done, role capabilities, rollback requirements, implementation notes, and citations. Provide a complete coverage matrix for behavior, architecture, user_experience, data, integrations, security, privacy, reliability, rollout, and metrics; each requirement must map to executable subtask IDs and deterministic validation profiles. Provide explicit owner_approval and infrastructure gates wherever authority or resources are required. Every subtask must name the exact safe project-relative files it may change in allowedFiles and select validationProfiles only from format, lint, typecheck, unit, integration, build, and visual. Use stable plan and gate IDs, preserve exact context and solution digests, and return strict JSON only."; }
function reviewInstruction(discipline: "delivery" | "technical") { return `Independently audit the candidate delivery plan from the ${discipline} discipline against CONTEXT.md and the approved SOLUTION.md. Fail on omissions, invalid hierarchy, work larger than two hours at subtask level, missing estimates or dependencies, vague criteria, invented facts, or non-executable instructions.`; }
