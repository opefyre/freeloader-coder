import { createHash } from "node:crypto";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { z } from "zod";

import { planHealing, type HealingFailureClass, type HealingPolicy } from "../../../packages/orchestration/src/healing.js";
import { evaluateQualityQuorum, type QualityReview } from "../../../packages/orchestration/src/quality-review.js";
import { eligibleExecutionTasks, projectExecutionRecordSchema, selectExecutionAssignment, type ExecutionCandidate, type ExecutionTask, type ProjectExecutionRecord } from "../../../packages/orchestration/src/project-execution.js";
import type { DeliveryPlanDraft } from "../../../packages/orchestration/src/delivery-plan.js";
import type { ProjectDeliveryPlanService } from "./project-delivery-plan-service.js";

const stateSchema = z.strictObject({ schemaVersion: z.literal(1), projects: z.record(z.string(), projectExecutionRecordSchema) });
type JiraReceipt = { completed: boolean; planDigest: string; issues: Record<string, { issueKey: string }> };

export class ProjectExecutionService {
  readonly #path: string;
  #mutation = Promise.resolve();

  constructor(
    stateDirectory: string,
    private readonly plans: Pick<ProjectDeliveryPlanService, "readDraft">,
    private readonly jira: { get(projectId: string): Promise<JiraReceipt | null> },
    private readonly now: () => number = Date.now
  ) {
    this.#path = resolve(stateDirectory, "project-executions.json");
  }

  async get(projectId: string) { return (await this.#load()).projects[projectId] ?? null; }

  async initialize(projectId: string) {
    const existing = await this.get(projectId);
    const [{ draft, document }, jira] = await Promise.all([this.plans.readDraft(projectId), this.jira.get(projectId)]);
    if (!jira?.completed || jira.planDigest !== document.digest) throw new ProjectExecutionError("jira_not_ready", "Implementation cannot start until the reviewed Jira hierarchy is complete.");
    if (existing) {
      if (existing.planDigest !== document.digest) throw new ProjectExecutionError("plan_changed", "The reviewed delivery plan changed after implementation began.");
      return existing;
    }
    const tasks = executableTasks(draft, jira, this.now());
    const record = projectExecutionRecordSchema.parse({ schemaVersion: 1, projectId, planDigest: document.digest, state: "running", revision: 0, tasks, updatedAt: this.now() });
    return this.#save(record);
  }

  async claim(projectId: string, workerId: string, candidates: readonly ExecutionCandidate[], leaseMs = 120_000) {
    if (!Number.isInteger(leaseMs) || leaseMs < 10_000 || leaseMs > 300_000) throw new ProjectExecutionError("invalid_lease", "Execution lease duration is invalid.");
    return this.#mutateProject<{ record: ProjectExecutionRecord; task: ExecutionTask | null }>(projectId, (record) => {
      const now = this.now();
      const task = eligibleExecutionTasks(record, now)[0];
      if (!task) return { record, result: { record, task: null } };
      const assignment = selectExecutionAssignment({ task, candidates, now });
      if (!assignment) {
        const waiting = replaceTask(record, { ...task, safeMessage: "Waiting for a free eligible provider and device capacity.", updatedAt: now });
        return { record: waiting, result: { record: waiting, task: null } };
      }
      const leaseId = `execlease_${createHash("sha256").update(`${projectId}:${task.id}:${workerId}:${now}:${record.revision}`).digest("hex").slice(0, 20)}`;
      const claimed: ExecutionTask = { ...task, status: "running", revision: task.revision + 1, assignment, lease: { leaseId, ownerId: workerId, acquiredAt: now, heartbeatAt: now, expiresAt: now + leaseMs }, safeMessage: "Implementation is running in an isolated project workspace.", updatedAt: now };
      const next = replaceTask(record, claimed);
      return { record: next, result: { record: next, task: claimed } };
    });
  }

  async heartbeat(projectId: string, taskId: string, leaseId: string, ownerId: string, leaseMs = 120_000) {
    return this.#updateOwned(projectId, taskId, leaseId, ownerId, (record, task, now) => {
      const updated = { ...task, lease: { ...task.lease!, heartbeatAt: now, expiresAt: now + leaseMs }, revision: task.revision + 1, updatedAt: now };
      return { record: replaceTask(record, updated), result: updated };
    });
  }

  async recordImplementation(projectId: string, taskId: string, leaseId: string, ownerId: string, evidenceDigest: string) {
    return this.#updateOwned(projectId, taskId, leaseId, ownerId, (record, task, now) => {
      if (task.status !== "running" && task.status !== "healing") throw new ProjectExecutionError("invalid_stage", "Implementation evidence is not accepted in this stage.");
      const updated = { ...task, status: "validating" as const, implementationEvidence: [...task.implementationEvidence, digestSchema.parse(evidenceDigest)], revision: task.revision + 1, safeMessage: "Deterministic validation is running.", updatedAt: now };
      return { record: replaceTask(record, updated), result: updated };
    });
  }

  async recordValidation(projectId: string, taskId: string, leaseId: string, ownerId: string, validation: unknown) {
    return this.#updateOwned(projectId, taskId, leaseId, ownerId, (record, task, now) => {
      if (task.status !== "validating") throw new ProjectExecutionError("invalid_stage", "Validation evidence is not accepted in this stage.");
      const parsed = validationSchema.parse(validation);
      const passed = new Set(task.validations.filter((item) => item.passed).map((item) => item.tier));
      if (parsed.tier === "full" && !passed.has("fast")) throw new ProjectExecutionError("validation_order", "Full validation requires passing fast validation first.");
      const validations = [...task.validations, { ...parsed, observedAt: now }];
      const status = parsed.passed && parsed.tier === "full" ? "reviewing" as const : "validating" as const;
      const updated = { ...task, status, validations, revision: task.revision + 1, safeMessage: parsed.passed ? (parsed.tier === "full" ? "Independent review is running." : "Fast validation passed; full validation is next.") : "Validation failed; bounded healing assessment is required.", updatedAt: now };
      return { record: replaceTask(record, updated), result: updated };
    });
  }

  async recordReviews(projectId: string, taskId: string, leaseId: string, ownerId: string, reviews: readonly QualityReview[]) {
    return this.#updateOwned(projectId, taskId, leaseId, ownerId, (record, task, now) => {
      if (task.status !== "reviewing" || !task.assignment) throw new ProjectExecutionError("invalid_stage", "Review evidence is not accepted in this stage.");
      const quorum = evaluateQualityQuorum({ uiChanged: task.uiChanged, implementerProviderId: task.assignment.providerId, deterministicValidationPassed: hasValidation(task, "fast") && hasValidation(task, "full"), reviews });
      const storedReviews = reviews.map((review) => ({ reviewerId: review.reviewerId, providerId: review.providerId, role: review.role, verdict: review.verdict, evidenceDigest: reviewDigest(review), findings: review.findings.map((finding) => `${finding.severity}: ${finding.acceptanceCriterion} — ${finding.recommendedRepair}`), observedAt: now }));
      const status = quorum.verdict === "needs_user" ? "needs_user" as const : quorum.ready ? "integrating" as const : "quarantined" as const;
      const updated = { ...task, status, reviews: storedReviews, lease: status === "integrating" ? task.lease : null, revision: task.revision + 1, safeMessage: status === "integrating" ? "Reviews passed; commit, integration, and post-integration validation are required." : status === "needs_user" ? "Independent review requires an owner decision." : "Independent review failed; work is safely quarantined.", updatedAt: now };
      let next = replaceTask(record, updated);
      next = projectState(next, now);
      return { record: next, result: updated };
    });
  }

  async recordIntegration(projectId: string, taskId: string, leaseId: string, ownerId: string, input: { commitDigest: string; integrationDigest: string; validation: unknown }) {
    return this.#updateOwned(projectId, taskId, leaseId, ownerId, (record, task, now) => {
      if (task.status !== "integrating") throw new ProjectExecutionError("invalid_stage", "Integration evidence is not accepted in this stage.");
      const validation = validationSchema.parse(input.validation);
      if (validation.tier !== "integration" || !validation.passed || validation.exitCode !== 0) throw new ProjectExecutionError("integration_failed", "Post-integration validation must pass before completion.");
      const updated = { ...task, status: "completed" as const, commitDigest: digestSchema.parse(input.commitDigest), integrationDigest: digestSchema.parse(input.integrationDigest), validations: [...task.validations, { ...validation, observedAt: now }], lease: null, revision: task.revision + 1, safeMessage: "Implementation, independent review, commit, integration, and post-integration validation passed.", updatedAt: now };
      let next = replaceTask(record, updated);
      next = projectState(next, now);
      return { record: next, result: updated };
    });
  }

  async assessHealing(projectId: string, taskId: string, leaseId: string, ownerId: string, input: { failureClass: HealingFailureClass; changedFiles: readonly string[]; policy: HealingPolicy; goldenScore: number; previousGoldenScore: number }) {
    return this.#updateOwned(projectId, taskId, leaseId, ownerId, (record, task, now) => {
      if (task.status !== "validating") throw new ProjectExecutionError("invalid_stage", "Healing assessment requires failed validation evidence.");
      if (!task.validations.some((validation) => !validation.passed)) throw new ProjectExecutionError("validation_required", "Healing requires observed failed validation.");
      const healing = planHealing({ ...input, attempt: task.attempt });
      const status = healing.status === "repairable" ? "healing" as const : healing.status === "needs_user" ? "needs_user" as const : "quarantined" as const;
      const updated = { ...task, status, attempt: healing.status === "repairable" ? task.attempt + 1 : task.attempt, failureClass: healing.failureClass, lease: healing.status === "repairable" ? task.lease : null, revision: task.revision + 1, safeMessage: healing.status === "repairable" ? "A bounded repair is authorized; all validation and review gates remain required." : healing.status === "needs_user" ? "Healing requires an owner decision or environment change." : "Healing was safely quarantined by policy.", updatedAt: now };
      let next = replaceTask(record, updated);
      next = projectState(next, now);
      return { record: next, result: updated };
    });
  }

  async reconcileExpired(projectId: string) {
    return this.#mutateProject(projectId, (record) => {
      const now = this.now();
      const tasks = record.tasks.map((task): ExecutionTask => task.lease && task.lease.expiresAt <= now ? { ...task, status: "needs_user", lease: null, revision: task.revision + 1, safeMessage: "The worker lease expired with an unknown outcome. Inspect preserved evidence before retrying.", updatedAt: now } : task);
      return { record: projectState({ ...record, tasks, revision: record.revision + 1, updatedAt: now }, now), result: tasks.filter((task) => task.status === "needs_user") };
    });
  }

  async #updateOwned<T>(projectId: string, taskId: string, leaseId: string, ownerId: string, operation: (record: ProjectExecutionRecord, task: ExecutionTask, now: number) => { record: ProjectExecutionRecord; result: T }) {
    return this.#mutateProject(projectId, (record) => {
      const task = record.tasks.find((candidate) => candidate.id === taskId);
      const now = this.now();
      if (!task?.lease || task.lease.leaseId !== leaseId || task.lease.ownerId !== ownerId || task.lease.expiresAt <= now) throw new ProjectExecutionError("lease_denied", "Only the current unexpired lease owner can update this task.");
      return operation(record, task, now);
    });
  }

  async #mutateProject<T>(projectId: string, operation: (record: ProjectExecutionRecord) => { record: ProjectExecutionRecord; result: T }) {
    return this.#mutate(async (state) => {
      const record = state.projects[projectId];
      if (!record) throw new ProjectExecutionError("not_found", "Project execution has not been initialized.");
      const outcome = operation(record);
      const parsed = projectExecutionRecordSchema.parse(outcome.record);
      return { state: { ...state, projects: { ...state.projects, [projectId]: parsed } }, result: outcome.result };
    });
  }

  async #save(record: ProjectExecutionRecord) { return this.#mutate(async (state) => ({ state: { ...state, projects: { ...state.projects, [record.projectId]: record } }, result: record })); }
  async #mutate<T>(operation: (state: z.infer<typeof stateSchema>) => Promise<{ state: z.infer<typeof stateSchema>; result: T }>) { let result!: T; const next = this.#mutation.then(async () => { const outcome = await operation(await this.#load()); await atomicWrite(this.#path, `${JSON.stringify(stateSchema.parse(outcome.state), null, 2)}\n`); result = outcome.result; }); this.#mutation = next.catch(() => undefined); await next; return result; }
  async #load() { try { return stateSchema.parse(JSON.parse(await readFile(this.#path, "utf8"))); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return stateSchema.parse({ schemaVersion: 1, projects: {} }); throw new Error("Project execution state is corrupt."); } }
}

export class ProjectExecutionError extends Error { constructor(readonly code: string, message: string) { super(message); } }
const digestSchema = z.string().regex(/^[a-f0-9]{64}$/);
const validationSchema = z.strictObject({ tier: z.enum(["fast", "full", "integration"]), commandLabel: z.string().trim().min(1).max(200), passed: z.boolean(), exitCode: z.number().int(), evidenceDigest: digestSchema });
function executableTasks(plan: DeliveryPlanDraft, jira: JiraReceipt, now: number): ExecutionTask[] { const subtasks = plan.items.filter((item) => item.type === "subtask"); const byParent = new Map<string, typeof subtasks>(); for (const item of subtasks) byParent.set(item.parentId!, [...(byParent.get(item.parentId!) ?? []), item]); return subtasks.map((item) => { const parent = plan.items.find((candidate) => candidate.id === item.parentId); const inherited = parent?.dependencies.flatMap((dependency) => byParent.get(dependency)?.map((child) => child.id) ?? []) ?? []; const issue = jira.issues[item.id]; if (!issue) throw new ProjectExecutionError("jira_receipt_incomplete", `Jira receipt is missing ${item.id}.`); const text = `${item.title} ${item.description} ${item.implementationNotes.join(" ")}`.toLowerCase(); const uiChanged = /\b(ui|ux|frontend|visual|responsive|component|page|screen)\b/.test(text); return { id: item.id, jiraIssueKey: issue.issueKey, title: item.title, dependsOn: [...new Set([...item.dependencies.filter((id) => subtasks.some((candidate) => candidate.id === id)), ...inherited])], uiChanged, requiredCapabilities: uiChanged ? ["chat", "structured_output", "tool_calling"] : ["chat", "structured_output"], privacyClass: "source_code", status: "queued", revision: 0, attempt: 0, assignment: null, lease: null, implementationEvidence: [], validations: [], reviews: [], commitDigest: null, integrationDigest: null, failureClass: null, safeMessage: "Queued behind verified dependencies.", updatedAt: now }; }); }
function replaceTask(record: ProjectExecutionRecord, task: ExecutionTask): ProjectExecutionRecord { return { ...record, revision: record.revision + 1, tasks: record.tasks.map((candidate) => candidate.id === task.id ? task : candidate), updatedAt: task.updatedAt }; }
function projectState(record: ProjectExecutionRecord, now: number): ProjectExecutionRecord { const state = record.tasks.every((task) => task.status === "completed") ? "completed" : record.tasks.some((task) => task.status === "quarantined") ? "quarantined" : record.tasks.some((task) => task.status === "needs_user") ? "needs_user" : "running"; return { ...record, state, updatedAt: now }; }
function hasValidation(task: ExecutionTask, tier: "fast" | "full") { return task.validations.some((validation) => validation.tier === tier && validation.passed); }
function reviewDigest(review: QualityReview) { return createHash("sha256").update(JSON.stringify(review)).digest("hex"); }
async function atomicWrite(path: string, content: string) { await mkdir(dirname(path), { recursive: true, mode: 0o700 }); const temporary = `${path}.${process.pid}.tmp`; await writeFile(temporary, content, { encoding: "utf8", mode: 0o600 }); await chmod(temporary, 0o600); await rename(temporary, path); await chmod(path, 0o600); }
