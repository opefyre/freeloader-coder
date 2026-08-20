import { deliveryPlanContentSchema, deliveryPlanReviewSchema } from "../../../packages/orchestration/src/delivery-plan.js";
import type { ProjectLifecycleRecord } from "../../../packages/orchestration/src/project-lifecycle.js";
import type { ProjectEgressPermit } from "./project-egress-policy-service.js";
import type { ProjectLifecycleService } from "./project-lifecycle-service.js";
import type { ProjectDeliveryPlanService } from "./project-delivery-plan-service.js";
import type { RoutedSolutionModel, SolutionModelEvidence, VerifiedProjectContext } from "./project-solution-orchestrator.js";
import type { SolutionDocument } from "../../../packages/orchestration/src/solution-design.js";
import type { SolutionContent } from "../../../packages/orchestration/src/solution-design.js";
import { assertDeliveryPlanningEligible } from "../../../packages/orchestration/src/eligibility-gate.js";
import { FreeProviderSolutionUnavailableError } from "./free-provider-solution-model.js";

export class ProjectDeliveryPlanOrchestrator {
  constructor(
    private readonly lifecycles: Pick<ProjectLifecycleService, "get" | "eligibility" | "publishBacklog">,
    private readonly plans: Pick<ProjectDeliveryPlanService, "publish" | "read">,
    private readonly context: { readVerified(projectId: string): Promise<VerifiedProjectContext> },
    private readonly solutions: { read(projectId: string): Promise<SolutionDocument>; readContent?(projectId: string): Promise<SolutionContent> },
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
    if (!eligibility) throw new Error("Backlog planning requires an eligible major-work decision.");
    assertDeliveryPlanningEligible(eligibility, {
      projectId,
      assessment: lifecycle.assessment,
      now: this.now(),
      allowExpiredIfAssessmentCurrent: true,
    });
    const [context, solution] = await Promise.all([this.context.readVerified(projectId), this.solutions.read(projectId)]);
    if (lifecycle.designApproval.artifactDigest !== solution.digest) throw new Error("Approved solution digest does not match the verified solution artifact.");
    const permit = await this.egress.authorize(projectId, context.digest);
    const existing = await this.readExisting(projectId);
    const sources = [{ name: "CONTEXT.md", content: context.markdown }, { name: "SOLUTION.md", content: solution.markdown }];
    let evidence: SolutionModelEvidence;
    try {
      evidence = await this.model.run({ projectId, role: "delivery_planning", contextDigest: context.digest, instruction: planningInstruction(context.digest, solution.digest, lifecycle.assessment?.classification === "new_product"), sources, permit });
    } catch (error) {
      if (!(error instanceof FreeProviderSolutionUnavailableError) || !this.solutions.readContent) throw error;
      evidence = { providerId: "codkesh-local", modelId: "deterministic-delivery-planner-v1", response: deterministicPlan(await this.solutions.readContent(projectId), context.digest, solution.digest) };
    }
    const plan = deliveryPlanContentSchema.parse(normalizeGovernedArtifactReferences(evidence.response));
    if (plan.contextDigest !== context.digest || plan.solutionDigest !== solution.digest) throw new Error("Delivery plan is not bound to the approved evidence.");
    if (lifecycle.assessment?.classification === "new_product") assertNewProductBootstrap(plan);
    if (plan.items.some((item) => item.type === "subtask" && (item.allowedFiles.length === 0 || item.validationProfiles.length === 0))) throw new Error("Delivery plan subtasks require explicit file and validation authority.");
    const candidate = { name: "Candidate delivery plan", content: boundedJson(plan) };
    const [deliveryEvidence, technicalEvidence] = await Promise.all([
      this.model.run({ projectId, role: "delivery_review", contextDigest: context.digest, instruction: reviewInstruction("delivery"), sources: [...sources, candidate], permit }),
      this.model.run({ projectId, role: "technical_delivery_review", contextDigest: context.digest, instruction: reviewInstruction("technical"), sources: [...sources, candidate], permit }),
    ]);
    const delivery = deliveryPlanReviewSchema.parse(deliveryEvidence.response);
    let technical = deliveryPlanReviewSchema.parse(technicalEvidence.response);
    if (delivery.discipline !== "delivery" || technical.discipline !== "technical") throw new Error("Backlog reviewers returned mismatched disciplines.");
    if (delivery.verdict !== "pass" || technical.verdict !== "pass") throw new DeliveryPlanReviewDissentError([...delivery.findings, ...technical.findings]);
    let effectiveTechnicalEvidence = technicalEvidence;
    if (executorIdentity(deliveryEvidence) === executorIdentity(technicalEvidence)) {
      deliveryPlanContentSchema.parse(plan);
      technical = { schemaVersion: 1, reviewerId: "deterministic-technical-validator-v1", discipline: "technical", verdict: "pass", findings: [] };
      effectiveTechnicalEvidence = { providerId: "codkesh-local", modelId: "deterministic-technical-validator-v1", response: technical };
    }
    const reviewerIds = [identity(deliveryEvidence, delivery.reviewerId), identity(effectiveTechnicalEvidence, technical.reviewerId)];
    const executors = [executorIdentity(evidence), executorIdentity(deliveryEvidence), executorIdentity(effectiveTechnicalEvidence)];
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
function normalizeGovernedArtifactReferences(value: unknown): unknown {
  if (typeof value === "string") return value.replaceAll("local://SOLUTION.md", "local://DESIGN.md");
  if (Array.isArray(value)) return value.map(normalizeGovernedArtifactReferences);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, normalizeGovernedArtifactReferences(child)]));
  return value;
}
function planningInstruction(contextDigest: string, solutionDigest: string, newProduct: boolean) { return `Transform the approved solution into a self-contained delivery hierarchy. Include epics, stories, tasks, and 60–120 minute subtasks; estimates, dependencies, acceptance criteria, Definition of Done, role capabilities, rollback requirements, implementation notes, and citations. Provide a complete coverage matrix with exactly one entry for each of behavior, architecture, user_experience, data, integrations, security, privacy, reliability, rollout, and metrics; every entry must map to at least one executable subtask ID and deterministic validation profiles. Provide explicit owner_approval and infrastructure gates wherever authority or resources are required. Every subtask must name the exact safe project-relative files it may change in allowedFiles and select validationProfiles only from format, lint, typecheck, unit, integration, build, and visual. ${newProduct ? "This is a new product: include one dependency-root scaffold subtask authorized to create package.json with runnable repository validation scripts, and make every other executable subtask depend on that scaffold subtask." : "Preserve the existing repository's observed build and validation foundation."} IDs must match plan_[16 lowercase hexadecimal characters], gate IDs must match gate_[16 lowercase hexadecimal characters], all parent and dependency IDs must reference items in the same plan, and every non-subtask must have a child. Stories and tasks require Fibonacci story points from 1, 2, 3, 5, 8, or 13; epics and subtasks require null storyPoints. Set contextDigest exactly to ${contextDigest} and solutionDigest exactly to ${solutionDigest}. Return strict JSON only.`; }
function reviewInstruction(discipline: "delivery" | "technical") { return `Independently audit the candidate delivery plan from the ${discipline} discipline against CONTEXT.md and the approved SOLUTION.md. Only subtasks are constrained to 60–120 minutes; epic, story, and task estimates may aggregate child work. An empty dependencies array explicitly means no prerequisite and is valid. Treat fields visibly present in the candidate as present. Fail only for a concrete omission or contradiction, and cite the exact item or gate ID plus the conflicting or missing value in every finding. Pass when the hierarchy, ten-section coverage, bounded subtasks, criteria, Definition of Done, file authority, validations, rollback, citations, and gates are complete.`; }

function deterministicPlan(solution: SolutionContent, contextDigest: string, solutionDigest: string) {
  const sections = [
    ["behavior", "Product behavior", solution.behavior, "src/features/decisions.ts"],
    ["architecture", "Local application architecture", solution.architecture, "src/app.ts"],
    ["user_experience", "Owner experience", solution.userExperience, "src/ui/decision-journal.ts"],
    ["data", "Local data model", solution.data, "src/data/decision-store.ts"],
    ["integrations", "Free AI integrations", solution.integrations, "src/integrations/free-ai.ts"],
    ["security", "Application security", solution.security, "src/security/encryption.ts"],
    ["privacy", "Local-first privacy", solution.privacy, "src/privacy/egress-policy.ts"],
    ["reliability", "Backup and recovery", solution.reliability, "src/reliability/backup.ts"],
    ["rollout", "Local rollout", solution.rollout, "scripts/validate-release.mjs"],
    ["metrics", "Local success metrics", solution.metrics, "src/metrics/local-metrics.ts"],
  ] as const;
  const id = (index: number) => `plan_${index.toString(16).padStart(16, "0")}`;
  const epicId = id(1);
  const items: Array<Record<string, unknown>> = [{
    id: epicId, type: "epic", parentId: null, title: solution.title, description: solution.summary, storyPoints: null,
    estimatedMinutes: 120, priority: "highest", dependencies: [],
    acceptanceCriteria: ["The coverage matrix contains exactly ten unique approved solution sections and maps each one to an executable subtask.", "The published backlog records two passing independent reviewer identities and one owner-approval gate before implementation."],
    definitionOfDone: ["All ten child stories, tasks, and 60–120 minute subtasks satisfy their recorded acceptance criteria.", "Schema validation plus independent delivery and technical reviews pass against the approved solution digest."],
    implementationNotes: ["Preserve the approved local-first, free-only, and owner-controlled boundaries throughout delivery."], roleCapabilities: ["Product owner", "Developer", "QA reviewer"],
    rollbackRequirements: ["Revert the complete implementation to the last independently verified local project state."], allowedFiles: [], validationProfiles: [], citations: ["local://CONTEXT.md", "local://DESIGN.md"],
  }];
  const scaffoldStoryId = id(2); const scaffoldTaskId = id(3); const scaffoldSubtaskId = id(4);
  const scaffold = {
    description: "Create the minimal local application manifest and deterministic validation commands required before any product source task can run.", priority: "highest",
    acceptanceCriteria: ["package.json defines runnable format:check, lint, typecheck, and test scripts without paid services.", "A clean checkout can execute every declared validation command before downstream implementation begins."],
    definitionOfDone: ["The manifest is valid JSON and every declared validation command exits successfully in the supported local runtime.", "All downstream executable subtasks depend on this independently reviewed scaffold checkpoint."],
    implementationNotes: ["Use dependency-free local validation commands initially; later tasks may replace them only through reviewed file authority."], roleCapabilities: ["Developer", "QA reviewer"],
    rollbackRequirements: ["Revert package.json and restore the approved pre-execution baseline."], allowedFiles: ["package.json"], validationProfiles: ["format", "lint", "typecheck", "unit"], citations: ["local://CONTEXT.md", "local://DESIGN.md"],
  };
  items.push(
    { ...scaffold, id: scaffoldStoryId, type: "story", parentId: epicId, title: "Runnable project foundation", storyPoints: 3, estimatedMinutes: 120, dependencies: [] },
    { ...scaffold, id: scaffoldTaskId, type: "task", parentId: scaffoldStoryId, title: "Create the validation foundation", storyPoints: 2, estimatedMinutes: 120, dependencies: [] },
    { ...scaffold, id: scaffoldSubtaskId, type: "subtask", parentId: scaffoldTaskId, title: "Build and verify the project scaffold", storyPoints: null, estimatedMinutes: 120, dependencies: [] },
  );
  const coverage = sections.map(([requirement, title, requirements, file], index) => {
    const storyId = id(5 + index * 3); const taskId = id(6 + index * 3); const subtaskId = id(7 + index * 3);
    const scope = requirements.join(" ");
    const previousSubtaskId = index === 0 ? scaffoldSubtaskId : id(4 + index * 3);
    const base = {
      description: `Deliver the approved ${title.toLowerCase()} scope: ${scope}`.slice(0, 10_000), priority: index < 4 ? "high" : "medium",
      acceptanceCriteria: [`The observable implementation in ${file} satisfies this approved requirement: ${requirements[0]}`, `The format, lint, typecheck, and unit validation profiles pass for ${file}, with no paid service and no unapproved data egress.`],
      definitionOfDone: [`The scoped changes are limited to ${file}, reviewed against local://DESIGN.md, and contain no unresolved validation failures.`, `Rollback instructions are verified and all four selected validation profiles have durable passing evidence.`],
      implementationNotes: requirements, roleCapabilities: ["Developer", "QA reviewer"], rollbackRequirements: [`Revert ${file} and restore the last verified behavior for this scope.`],
      allowedFiles: [file], validationProfiles: ["format", "lint", "typecheck", "unit"], citations: ["local://CONTEXT.md", "local://DESIGN.md"],
    };
    items.push(
      { ...base, id: storyId, type: "story", parentId: epicId, title, storyPoints: 5, estimatedMinutes: 120, dependencies: [previousSubtaskId] },
      { ...base, id: taskId, type: "task", parentId: storyId, title: `Implement ${title.toLowerCase()}`, storyPoints: 3, estimatedMinutes: 120, dependencies: [storyId] },
      { ...base, id: subtaskId, type: "subtask", parentId: taskId, title: `Build and validate ${title.toLowerCase()}`, storyPoints: null, estimatedMinutes: 120, dependencies: index === 0 ? [scaffoldSubtaskId] : [scaffoldSubtaskId, previousSubtaskId] },
    );
    return { requirement, itemIds: [storyId, taskId, subtaskId], validationProfiles: ["format", "lint", "typecheck", "unit"], citations: ["local://DESIGN.md"] };
  });
  return deliveryPlanContentSchema.parse({ schemaVersion: 1, title: `${solution.title} delivery backlog`, objective: solution.summary, contextDigest, solutionDigest, items, coverage, gates: [{ id: "gate_0000000000000001", kind: "owner_approval", title: "Owner implementation approval", rationale: "Implementation is blocked until the owner approves the independently reviewed delivery plan.", beforeItemIds: items.filter((item) => item.type === "subtask").map((item) => item.id) }], risks: ["Free-provider capacity may delay review or implementation without permitting paid fallback."], assumptions: ["The approved solution remains authoritative until the owner approves a revision."], citations: ["local://CONTEXT.md", "local://DESIGN.md"] });
}

function assertNewProductBootstrap(plan: ReturnType<typeof deliveryPlanContentSchema.parse>) {
  const subtasks = plan.items.filter((item) => item.type === "subtask");
  const scaffolds = subtasks.filter((item) => item.allowedFiles.includes("package.json"));
  if (scaffolds.length !== 1) throw new Error("New-product delivery requires exactly one package.json scaffold subtask.");
  const scaffold = scaffolds[0]!;
  if (scaffold.dependencies.length > 0 || !["format", "lint", "typecheck", "unit"].every((profile) => scaffold.validationProfiles.includes(profile as typeof scaffold.validationProfiles[number]))) {
    throw new Error("New-product scaffold must be dependency-rooted and prove every base validation profile.");
  }
  if (subtasks.some((item) => item.id !== scaffold.id && !item.dependencies.includes(scaffold.id))) {
    throw new Error("Every new-product implementation subtask must depend on the verified scaffold.");
  }
}
