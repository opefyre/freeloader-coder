import { createHash, randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { z } from "zod";

import {
  planHealing,
  type HealingFailureClass,
  type HealingPolicy,
} from "../../../packages/orchestration/src/healing.js";
import {
  evaluateQualityQuorum,
  type QualityReview,
} from "../../../packages/orchestration/src/quality-review.js";
import {
  completionEvidence,
  eligibleExecutionTasks,
  executionLiveJourneySchema,
  projectExecutionRecordSchema,
  selectExecutionAssignment,
  type ExecutionCandidate,
  type ExecutionTask,
  type ProjectExecutionRecord,
} from "../../../packages/orchestration/src/project-execution.js";
import type { DeliveryPlanDraft } from "../../../packages/orchestration/src/delivery-plan.js";
import type { ProjectDeliveryPlanService } from "./project-delivery-plan-service.js";
import {
  assertDeliveryPlanningEligible,
  type EligibilityDecision,
} from "../../../packages/orchestration/src/eligibility-gate.js";
import { isOwnerFacingUiDeliveryItem } from "./project-delivery-authority.js";

const stateSchema = z.strictObject({
  schemaVersion: z.literal(1),
  projects: z.record(z.string(), projectExecutionRecordSchema),
});
const reviewRepairSchema = z.strictObject({
  approvalId: z.string().regex(/^approval_[a-f0-9]{20}$/),
  expectedRevision: z.number().int().nonnegative(),
  rationale: z.string().trim().min(10).max(2_000),
});
const environmentRetrySchema = z.strictObject({
  taskId: z.string().regex(/^plan_[a-f0-9]{16}$/),
  expectedRevision: z.number().int().nonnegative(),
  rationale: z.string().trim().min(10).max(500),
});
const quarantineRecoverySchema = z.strictObject({
  taskId: z.string().regex(/^plan_[a-f0-9]{16}$/),
  expectedRevision: z.number().int().nonnegative(),
  approvalId: z.string().regex(/^approval_[a-f0-9]{20}$/),
  rationale: z.string().trim().min(10).max(500),
});
type QuarantineRepairEvidence = readonly {
  profile: ExecutionTask["validationProfiles"][number];
  passed: boolean;
  exitCode: number;
  evidenceDigest: string;
}[];
type JiraReceipt = {
  completed: boolean;
  planDigest: string;
  issues: Record<string, { issueKey: string }>;
};

export class ProjectExecutionService {
  readonly #path: string;
  #mutation = Promise.resolve();

  constructor(
    stateDirectory: string,
    private readonly plans: Pick<ProjectDeliveryPlanService, "readDraft">,
    private readonly jira: {
      get(projectId: string): Promise<JiraReceipt | null>;
    },
    private readonly now: () => number = Date.now,
    private readonly eligibility?: {
      eligibility(projectId: string): Promise<EligibilityDecision | null>;
    },
  ) {
    this.#path = resolve(stateDirectory, "project-executions.json");
  }

  async get(projectId: string) {
    return (await this.#load()).projects[projectId] ?? null;
  }

  async initialize(projectId: string) {
    const existing = await this.get(projectId);
    if (!this.eligibility)
      throw new ProjectExecutionError(
        "eligibility_missing",
        "Implementation requires a current major-work eligibility authority.",
      );
    const authority = await this.eligibility.eligibility(projectId);
    if (!authority)
      throw new ProjectExecutionError(
        "eligibility_missing",
        "Implementation requires a current major-work eligibility authority.",
      );
    assertDeliveryPlanningEligible(authority, {
      projectId,
      assessment: authority.assessment,
      now: this.now(),
      allowExpiredIfAssessmentCurrent: true,
    });
    const [{ draft, document }, jira] = await Promise.all([
      this.plans.readDraft(projectId),
      this.jira.get(projectId),
    ]);
    if (!jira?.completed || jira.planDigest !== document.digest)
      throw new ProjectExecutionError(
        "jira_not_ready",
        "Implementation cannot start until the reviewed Jira hierarchy is complete.",
      );
    if (existing) {
      if (existing.planDigest !== document.digest)
        throw new ProjectExecutionError(
          "plan_changed",
          "The reviewed delivery plan changed after implementation began.",
        );
      return existing;
    }
    const tasks = executableTasks(draft, jira, this.now());
    const record = projectExecutionRecordSchema.parse({
      schemaVersion: 1,
      projectId,
      planDigest: document.digest,
      state: "running",
      revision: 0,
      tasks,
      updatedAt: this.now(),
    });
    return this.#save(record);
  }

  async claim(
    projectId: string,
    workerId: string,
    candidates: readonly ExecutionCandidate[],
    leaseMs = 120_000,
  ) {
    if (!Number.isInteger(leaseMs) || leaseMs < 10_000 || leaseMs > 300_000)
      throw new ProjectExecutionError(
        "invalid_lease",
        "Execution lease duration is invalid.",
      );
    return this.#mutateProject<{
      record: ProjectExecutionRecord;
      task: ExecutionTask | null;
    }>(projectId, (record) => {
      const now = this.now();
      const task = eligibleExecutionTasks(record, now)[0];
      if (!task) return { record, result: { record, task: null } };
      // Review-capacity deferral must not erase the implementer identity after
      // implementation and both deterministic validation tiers have passed.
      // No implementation provider capacity is needed to resume review.
      const assignment = hasValidatedImplementationAwaitingReview(task)
        ? task.assignment
        : selectExecutionAssignment({ task, candidates, now });
      if (!assignment) {
        const waiting = replaceTask(record, {
          ...task,
          safeMessage:
            "Waiting for a free eligible provider and device capacity.",
          updatedAt: now,
        });
        return { record: waiting, result: { record: waiting, task: null } };
      }
      const leaseId = `execlease_${createHash("sha256").update(`${projectId}:${task.id}:${workerId}:${now}:${record.revision}`).digest("hex").slice(0, 20)}`;
      const claimed: ExecutionTask = {
        ...task,
        status: "running",
        revision: task.revision + 1,
        assignment,
        lease: {
          leaseId,
          ownerId: workerId,
          acquiredAt: now,
          heartbeatAt: now,
          expiresAt: now + leaseMs,
        },
        safeMessage:
          "Implementation is running in an isolated project workspace.",
        updatedAt: now,
      };
      const next = replaceTask(record, claimed);
      return { record: next, result: { record: next, task: claimed } };
    });
  }

  async reconcileEquivalentQueued(projectId: string) {
    return this.#mutateProject(projectId, (record) => {
      let next = record;
      let changed = true;
      while (changed) {
        changed = false;
        const completed = new Set(
          next.tasks
            .filter((task) => task.status === "completed")
            .map((task) => task.id),
        );
        for (const target of next.tasks.filter(
          (task) =>
            task.status === "queued" &&
            task.dependsOn.every((dependency) => completed.has(dependency)),
        )) {
          const signature = executionEquivalenceSignature(next, target);
          if (!signature) continue;
          const candidates = next.tasks.filter(
            (source) =>
              source.id !== target.id &&
              source.status === "completed" &&
              completionEvidence(source) &&
              executionEquivalenceSignature(next, source) === signature,
          );
          const proofDigests = new Set(
            candidates.map(executionCompletionProofDigest),
          );
          if (candidates.length !== 1 || proofDigests.size !== 1) continue;
          const source = candidates[0]!;
          const reconciled: ExecutionTask = {
            ...target,
            status: "completed",
            revision: target.revision + 1,
            assignment: source.assignment,
            lease: null,
            implementationEvidence: source.implementationEvidence,
            validations: source.validations,
            reviews: source.reviews,
            commitDigest: source.commitDigest,
            integrationDigest: source.integrationDigest,
            liveJourneyEvidence: source.liveJourneyEvidence ?? null,
            reconciliationEvidence: {
              sourceTaskId: source.id,
              signature,
              proofDigest: executionCompletionProofDigest(source),
              reconciledAt: this.now(),
            },
            failureClass: null,
            safeMessage: `Verified equivalent delivery was reconciled from ${source.jiraIssueKey}; no duplicate implementation ran.`,
            updatedAt: this.now(),
          };
          next = replaceTask(next, reconciled);
          changed = true;
          break;
        }
      }
      next = projectState(next, this.now());
      return { record: next, result: next };
    });
  }

  async heartbeat(
    projectId: string,
    taskId: string,
    leaseId: string,
    ownerId: string,
    leaseMs = 120_000,
  ) {
    return this.#updateOwned(
      projectId,
      taskId,
      leaseId,
      ownerId,
      (record, task, now) => {
        const updated = {
          ...task,
          lease: { ...task.lease!, heartbeatAt: now, expiresAt: now + leaseMs },
          revision: task.revision + 1,
          updatedAt: now,
        };
        return { record: replaceTask(record, updated), result: updated };
      },
    );
  }

  async recordImplementation(
    projectId: string,
    taskId: string,
    leaseId: string,
    ownerId: string,
    evidenceDigest: string,
  ) {
    return this.#updateOwned(
      projectId,
      taskId,
      leaseId,
      ownerId,
      (record, task, now) => {
        if (task.status !== "running" && task.status !== "healing")
          throw new ProjectExecutionError(
            "invalid_stage",
            "Implementation evidence is not accepted in this stage.",
          );
        const updated = {
          ...task,
          status: "validating" as const,
          deferredProviderIds: [],
          verifiedRecoveryEvidenceDigest: null,
          implementationEvidence: [
            ...task.implementationEvidence,
            digestSchema.parse(evidenceDigest),
          ],
          failureClass: null,
          revision: task.revision + 1,
          safeMessage: "Deterministic validation is running.",
          updatedAt: now,
        };
        return { record: replaceTask(record, updated), result: updated };
      },
    );
  }

  async recordValidation(
    projectId: string,
    taskId: string,
    leaseId: string,
    ownerId: string,
    validation: unknown,
  ) {
    return this.#updateOwned(
      projectId,
      taskId,
      leaseId,
      ownerId,
      (record, task, now) => {
        if (task.status !== "validating")
          throw new ProjectExecutionError(
            "invalid_stage",
            "Validation evidence is not accepted in this stage.",
          );
        const parsed = validationSchema.parse(validation);
        const passed = new Set(
          task.validations
            .filter((item) => item.passed)
            .map((item) => item.tier),
        );
        if (parsed.tier === "full" && !passed.has("fast"))
          throw new ProjectExecutionError(
            "validation_order",
            "Full validation requires passing fast validation first.",
          );
        const validations = [
          ...task.validations,
          { ...parsed, observedAt: now },
        ];
        const status =
          parsed.passed && parsed.tier === "full"
            ? ("reviewing" as const)
            : ("validating" as const);
        const updated = {
          ...task,
          status,
          validations,
          revision: task.revision + 1,
          safeMessage: parsed.passed
            ? parsed.tier === "full"
              ? "Independent review is running."
              : "Fast validation passed; full validation is next."
            : "Validation failed; bounded healing assessment is required.",
          updatedAt: now,
        };
        return { record: replaceTask(record, updated), result: updated };
      },
    );
  }

  async resumeValidatedReview(
    projectId: string,
    taskId: string,
    leaseId: string,
    ownerId: string,
  ) {
    return this.#updateOwned(
      projectId,
      taskId,
      leaseId,
      ownerId,
      (record, task, now) => {
        if (
          task.status !== "running" ||
          task.implementationEvidence.length === 0 ||
          task.reviews.length > 0 ||
          task.failureClass === "implementation" ||
          !hasValidation(task, "fast") ||
          !hasValidation(task, "full")
        )
          throw new ProjectExecutionError(
            "invalid_stage",
            "Only preserved, fully validated implementation evidence can resume directly at review.",
          );
        const updated: ExecutionTask = {
          ...task,
          status: "reviewing",
          revision: task.revision + 1,
          safeMessage:
            "Preserved validation evidence is current; independent review resumed without duplicate implementation.",
          updatedAt: now,
        };
        return { record: replaceTask(record, updated), result: updated };
      },
    );
  }

  async recordReviews(
    projectId: string,
    taskId: string,
    leaseId: string,
    ownerId: string,
    reviews: readonly QualityReview[],
  ) {
    return this.#updateOwned(
      projectId,
      taskId,
      leaseId,
      ownerId,
      (record, task, now) => {
        if (task.status !== "reviewing" || !task.assignment)
          throw new ProjectExecutionError(
            "invalid_stage",
            "Review evidence is not accepted in this stage.",
          );
        const quorum = evaluateQualityQuorum({
          uiChanged: task.uiChanged,
          implementerProviderId: task.assignment.providerId,
          deterministicValidationPassed:
            hasValidation(task, "fast") && hasValidation(task, "full"),
          reviews,
        });
        const storedReviews = reviews.map((review) => ({
          reviewerId: review.reviewerId,
          providerId: review.providerId,
          role: review.role,
          verdict: review.verdict,
          evidenceDigest: reviewDigest(review),
          findings: review.findings.map(
            (finding) =>
              `${finding.severity}: ${finding.acceptanceCriterion} — ${finding.recommendedRepair}`,
          ),
          observedAt: now,
        }));
        const status =
          quorum.verdict === "needs_user"
            ? ("needs_user" as const)
            : quorum.ready
              ? ("integrating" as const)
              : ("quarantined" as const);
        const updated = {
          ...task,
          status,
          reviews: storedReviews,
          lease: status === "integrating" ? task.lease : null,
          revision: task.revision + 1,
          safeMessage:
            status === "integrating"
              ? "Reviews passed; commit, integration, and post-integration validation are required."
              : status === "needs_user"
                ? "Independent review requires an owner decision."
                : "Independent review failed; work is safely quarantined.",
          updatedAt: now,
        };
        let next = replaceTask(record, updated);
        next = projectState(next, now);
        return { record: next, result: updated };
      },
    );
  }

  async recordIntegration(
    projectId: string,
    taskId: string,
    leaseId: string,
    ownerId: string,
    input: {
      commitDigest: string;
      integrationDigest: string;
      validation: unknown;
      liveJourneyEvidence?: unknown;
    },
  ) {
    return this.#updateOwned(
      projectId,
      taskId,
      leaseId,
      ownerId,
      (record, task, now) => {
        if (task.status !== "integrating")
          throw new ProjectExecutionError(
            "invalid_stage",
            "Integration evidence is not accepted in this stage.",
          );
        const validation = validationSchema.parse(input.validation);
        if (
          validation.tier !== "integration" ||
          !validation.passed ||
          validation.exitCode !== 0
        )
          throw new ProjectExecutionError(
            "integration_failed",
            "Post-integration validation must pass before completion.",
          );
        const commitDigest = gitDigestSchema.parse(input.commitDigest);
        const liveJourneyEvidence =
          input.liveJourneyEvidence === undefined
            ? null
            : executionLiveJourneySchema.parse(input.liveJourneyEvidence);
        const liveJourneyRequired =
          task.uiChanged || task.validationProfiles.includes("visual");
        if (
          liveJourneyRequired &&
          (!liveJourneyEvidence ||
            !liveJourneyEvidence.passed ||
            liveJourneyEvidence.revisionDigest !== commitDigest ||
            liveJourneyEvidence.assertions.some(
              (assertion) => !assertion.passed,
            ))
        ) {
          throw new ProjectExecutionError(
            "live_journey_incomplete",
            "Owner-facing completion requires a passing live journey for the exact integrated revision.",
          );
        }
        const updated = {
          ...task,
          status: "completed" as const,
          commitDigest,
          integrationDigest: digestSchema.parse(input.integrationDigest),
          liveJourneyEvidence,
          validations: [
            ...task.validations,
            { ...validation, observedAt: now },
          ],
          lease: null,
          revision: task.revision + 1,
          safeMessage:
            "Implementation, independent review, commit, integration, and post-integration validation passed.",
          updatedAt: now,
        };
        let next = replaceTask(record, updated);
        next = projectState(next, now);
        return { record: next, result: updated };
      },
    );
  }

  async assessHealing(
    projectId: string,
    taskId: string,
    leaseId: string,
    ownerId: string,
    input: {
      failureClass: HealingFailureClass;
      changedFiles: readonly string[];
      policy: HealingPolicy;
      goldenScore: number;
      previousGoldenScore: number;
    },
  ) {
    return this.#updateOwned(
      projectId,
      taskId,
      leaseId,
      ownerId,
      (record, task, now) => {
        if (task.status !== "validating")
          throw new ProjectExecutionError(
            "invalid_stage",
            "Healing assessment requires failed validation evidence.",
          );
        if (!task.validations.some((validation) => !validation.passed))
          throw new ProjectExecutionError(
            "validation_required",
            "Healing requires observed failed validation.",
          );
        const failures = task.validations.filter(
          (validation) => !validation.passed,
        );
        if (
          failures.length >= 2 &&
          failures.at(-1)?.evidenceDigest === failures.at(-2)?.evidenceDigest
        ) {
          const updated = {
            ...task,
            status: "needs_user" as const,
            failureClass: input.failureClass,
            lease: null,
            revision: task.revision + 1,
            safeMessage:
              "The same validation failure repeated without new evidence. Automatic retries stopped to preserve the repair budget.",
            updatedAt: now,
          };
          const next = projectState(replaceTask(record, updated), now);
          return { record: next, result: updated };
        }
        const healing = planHealing({ ...input, attempt: task.attempt });
        const status =
          healing.status === "repairable"
            ? ("healing" as const)
            : healing.status === "needs_user"
              ? ("needs_user" as const)
              : ("quarantined" as const);
        const updated = {
          ...task,
          status,
          attempt:
            healing.status === "repairable" ? task.attempt + 1 : task.attempt,
          failureClass: healing.failureClass,
          lease: healing.status === "repairable" ? task.lease : null,
          revision: task.revision + 1,
          safeMessage:
            healing.status === "repairable"
              ? "A bounded repair is authorized; all validation and review gates remain required."
              : healing.status === "needs_user"
                ? "Healing requires an owner decision or environment change."
                : "Healing was safely quarantined by policy.",
          updatedAt: now,
        };
        let next = replaceTask(record, updated);
        next = projectState(next, now);
        return { record: next, result: updated };
      },
    );
  }

  async reconcileExpired(projectId: string) {
    return this.#mutateProject(projectId, (record) => {
      const now = this.now();
      const tasks = record.tasks.map((task): ExecutionTask => {
        if (!task.lease || task.lease.expiresAt > now) return task;
        const preMutation =
          task.status === "running" &&
          task.implementationEvidence.length === 0 &&
          task.validations.length === 0 &&
          task.reviews.length === 0 &&
          task.commitDigest === null &&
          task.integrationDigest === null;
        if (preMutation) {
          const deferredProviderIds = task.assignment?.providerId
            ? [
                ...new Set([
                  ...(task.deferredProviderIds ?? []),
                  task.assignment.providerId,
                ]),
              ].slice(-20)
            : task.deferredProviderIds;
          return {
            ...task,
            status: "queued",
            attempt: Math.min(20, task.attempt + 1),
            assignment: null,
            deferredProviderIds,
            lease: null,
            failureClass: "provider",
            revision: task.revision + 1,
            safeMessage:
              "Codkesh restarted before implementation evidence was recorded. The isolated workspace will be reset and the task will resume on an eligible free provider.",
            updatedAt: now,
          };
        }
        return {
          ...task,
          status: "needs_user",
          lease: null,
          revision: task.revision + 1,
          safeMessage:
            "The worker lease expired after implementation may have begun. Preserved evidence requires owner review before any retry.",
          updatedAt: now,
        };
      });
      return {
        record: projectState(
          { ...record, tasks, revision: record.revision + 1, updatedAt: now },
          now,
        ),
        result: tasks.filter(
          (task, index) => task.revision !== record.tasks[index]?.revision,
        ),
      };
    });
  }

  async authorizeReviewRepair(
    projectId: string,
    taskId: string,
    input: unknown,
  ) {
    const approval = reviewRepairSchema.parse(input);
    return this.#mutateProject(projectId, (record) => {
      const task = record.tasks.find((candidate) => candidate.id === taskId);
      if (!task)
        throw new ProjectExecutionError(
          "not_found",
          "Execution task was not found.",
        );
      if (
        task.reviewAttempts?.some(
          (attempt) => attempt.approvalId === approval.approvalId,
        )
      )
        return { record, result: task };
      if (task.revision !== approval.expectedRevision)
        throw new ProjectExecutionError(
          "stale_revision",
          "Review evidence changed. Review the latest findings before authorizing repair.",
        );
      const cleanCheckoutFailure =
        task.status === "needs_user" &&
        task.reviews.length > 0 &&
        task.reviews.every((review) => review.verdict === "pass") &&
        (task.failureClass === "implementation" ||
          task.safeMessage.includes("Post-integration validation") ||
          task.safeMessage ===
            "Execution needs attention: Commit changes do not match exact file authority.");
      const validationDissent =
        ["needs_user", "quarantined"].includes(task.status) &&
        task.reviews.length === 0 &&
        task.validations.some((validation) => !validation.passed) &&
        (task.failureClass === "implementation" ||
          task.safeMessage ===
            "Execution needs attention: Healing budget is invalid.");
      const proposalContractDissent =
        isPreEvidenceExecutionDissent(task) ||
        (task.status === "needs_user" &&
          task.reviews.length === 0 &&
          task.implementationEvidence.length === 0 &&
          /(?:Provider proposal (?:failed strict response contract|exceeded grounded file authority|conflicts with observed file state|omitted required task files)|Command failed:[\s\S]{0,600}\bprettier --write\b)/.test(
            task.safeMessage,
          ));
      if (
        !["needs_user", "quarantined"].includes(task.status) ||
        (!validationDissent &&
          !proposalContractDissent &&
          task.reviews.length === 0) ||
        (task.reviews.length > 0 &&
          !hasBlockingReviewDissent(task.reviews) &&
          !cleanCheckoutFailure)
      ) {
        throw new ProjectExecutionError(
          "repair_denied",
          "Owner-authorized repair requires current validation, review, or clean-checkout dissent evidence.",
        );
      }
      if (task.attempt >= 20)
        throw new ProjectExecutionError(
          "repair_budget_exhausted",
          "The bounded repair history is full; create a revised delivery task instead.",
        );
      const now = this.now();
      const archived = {
        approvalId: approval.approvalId,
        priorRevision: task.revision,
        implementerProviderId: task.assignment?.providerId ?? null,
        implementationEvidence: task.implementationEvidence,
        validations: task.validations,
        reviews: task.reviews,
        rationale: approval.rationale,
        decidedAt: now,
      };
      const updated: ExecutionTask = {
        ...task,
        status: "queued",
        revision: task.revision + 1,
        // An explicit owner authorization starts a new, independently audited repair
        // cycle. Historical attempts remain immutable in reviewAttempts; carrying the
        // old counter forward either denies the new authorization immediately or,
        // with a sliding ceiling, permits an unbounded retry storm.
        attempt: 0,
        assignment: null,
        lease: null,
        implementationEvidence: [],
        validations: [],
        reviews: [],
        reviewAttempts: [...(task.reviewAttempts ?? []), archived],
        commitDigest: null,
        integrationDigest: null,
        failureClass: "product_decision",
        safeMessage:
          "The owner authorized a bounded repair; implementation, validation, independent review, and integration must run again.",
        updatedAt: now,
      };
      return {
        record: projectState(replaceTask(record, updated), now),
        result: updated,
      };
    });
  }

  async authorizeCompletedRepair(
    projectId: string,
    taskId: string,
    input: unknown,
    verification?: QuarantineRepairEvidence,
  ) {
    const approval = reviewRepairSchema.parse(input);
    return this.#mutateProject(projectId, (record) => {
      const task = record.tasks.find((candidate) => candidate.id === taskId);
      if (!task)
        throw new ProjectExecutionError(
          "not_found",
          "Execution task was not found.",
        );
      if (
        task.reviewAttempts?.some(
          (attempt) => attempt.approvalId === approval.approvalId,
        )
      )
        return { record, result: task };
      if (task.revision !== approval.expectedRevision)
        throw new ProjectExecutionError(
          "stale_revision",
          "Completion evidence changed. Review the latest proof before authorizing prerequisite repair.",
        );
      if (
        task.status !== "completed" ||
        task.lease ||
        !completionEvidence(task)
      ) {
        throw new ProjectExecutionError(
          "repair_denied",
          "Completed prerequisite repair requires a previously verified, integrated task and explicit owner approval.",
        );
      }
      if (task.attempt >= 20)
        throw new ProjectExecutionError(
          "repair_budget_exhausted",
          "The bounded repair history is full; create a revised delivery plan instead.",
        );
      const now = this.now();
      const verifiedRecoveryEvidenceDigest = verification
        ? createHash("sha256")
            .update(JSON.stringify(verification))
            .digest("hex")
        : null;
      if (verification) {
        const passedProfiles = new Set(
          verification
            .filter((item) => item.passed && item.exitCode === 0)
            .map((item) => item.profile),
        );
        if (
          task.validationProfiles.some(
            (profile) => !passedProfiles.has(profile),
          )
        )
          throw new ProjectExecutionError(
            "retry_denied",
            "Completed recovery requires fresh passing evidence for every reviewed validation profile.",
          );
      }
      const archived = {
        approvalId: approval.approvalId,
        priorRevision: task.revision,
        implementerProviderId: task.assignment?.providerId ?? null,
        implementationEvidence: task.implementationEvidence,
        validations: task.validations,
        reviews: task.reviews,
        rationale: approval.rationale,
        decidedAt: now,
      };
      const invalidated = new Set<string>([task.id]);
      let changed = true;
      while (changed) {
        changed = false;
        for (const candidate of record.tasks) {
          if (
            !invalidated.has(candidate.id) &&
            candidate.dependsOn.some((dependency) =>
              invalidated.has(dependency),
            )
          ) {
            invalidated.add(candidate.id);
            changed = true;
          }
        }
      }
      const tasks = record.tasks.map((candidate): ExecutionTask => {
        if (candidate.id === task.id)
          return {
            ...candidate,
            status: "queued",
            revision: candidate.revision + 1,
            attempt: 0,
            assignment: null,
            lease: null,
            verifiedRecoveryEvidenceDigest,
            implementationEvidence: verification
              ? candidate.implementationEvidence
              : [],
            validations: [],
            reviews: [],
            reviewAttempts: [...(candidate.reviewAttempts ?? []), archived],
            commitDigest: null,
            integrationDigest: null,
            failureClass: "implementation",
            safeMessage: verification
              ? "The owner reopened this completed prerequisite with fresh deterministic recovery evidence; model reimplementation is not required."
              : "The owner reopened this completed prerequisite after downstream deterministic evidence invalidated its toolchain contract.",
            updatedAt: now,
          };
        if (!invalidated.has(candidate.id)) return candidate;
        const downstreamAttempt =
          candidate.implementationEvidence.length > 0 ||
          candidate.validations.length > 0 ||
          candidate.reviews.length > 0 ||
          candidate.commitDigest ||
          candidate.integrationDigest
            ? {
                approvalId: approval.approvalId,
                priorRevision: candidate.revision,
                implementerProviderId: candidate.assignment?.providerId ?? null,
                implementationEvidence: candidate.implementationEvidence,
                validations: candidate.validations,
                reviews: candidate.reviews,
                rationale: `Prerequisite proof was reopened and invalidated this downstream evidence. ${approval.rationale}`,
                decidedAt: now,
              }
            : null;
        return {
          ...candidate,
          status: "queued",
          revision: candidate.revision + 1,
          attempt: 0,
          assignment: null,
          lease: null,
          implementationEvidence: [],
          validations: [],
          reviews: [],
          reviewAttempts: downstreamAttempt
            ? [...(candidate.reviewAttempts ?? []), downstreamAttempt]
            : candidate.reviewAttempts,
          commitDigest: null,
          integrationDigest: null,
          failureClass: null,
          safeMessage:
            "Queued behind a reopened prerequisite whose proof is being repaired.",
          updatedAt: now,
        };
      });
      const updatedTask = tasks.find((candidate) => candidate.id === task.id)!;
      return {
        record: projectState(
          {
            ...record,
            state: "running",
            tasks,
            revision: record.revision + 1,
            updatedAt: now,
          },
          now,
        ),
        result: updatedTask,
      };
    });
  }

  async releaseForRetry(
    projectId: string,
    taskId: string,
    leaseId: string,
    ownerId: string,
    safeMessage: string,
  ) {
    return this.#updateOwned(
      projectId,
      taskId,
      leaseId,
      ownerId,
      (record, task, now) => {
        const preserveAssignment =
          hasValidatedImplementationAwaitingReview(task);
        const updated: ExecutionTask = {
          ...task,
          status: "queued",
          assignment: preserveAssignment ? task.assignment : null,
          lease: null,
          revision: task.revision + 1,
          safeMessage,
          updatedAt: now,
        };
        return {
          record: projectState(replaceTask(record, updated), now),
          result: updated,
        };
      },
    );
  }

  async releaseContractFailureForRetry(
    projectId: string,
    taskId: string,
    leaseId: string,
    ownerId: string,
    providerId: string,
    safeMessage: string,
  ) {
    return this.#updateOwned(
      projectId,
      taskId,
      leaseId,
      ownerId,
      (record, task, now) => {
        const deferredProviderIds = [
          ...new Set([...(task.deferredProviderIds ?? []), providerId]),
        ].slice(-20);
        const updated: ExecutionTask = {
          ...task,
          status: "queued",
          attempt: Math.min(20, task.attempt + 1),
          assignment: null,
          deferredProviderIds,
          lease: null,
          failureClass: "implementation",
          revision: task.revision + 1,
          safeMessage,
          updatedAt: now,
        };
        return {
          record: projectState(replaceTask(record, updated), now),
          result: updated,
        };
      },
    );
  }

  async authorizeEnvironmentRetry(projectId: string, input: unknown) {
    const retry = environmentRetrySchema.parse(input);
    return this.#mutateProject(projectId, (record) => {
      const task = record.tasks.find(
        (candidate) => candidate.id === retry.taskId,
      );
      if (!task)
        throw new ProjectExecutionError(
          "not_found",
          "Execution task was not found.",
        );
      if (task.revision !== retry.expectedRevision)
        throw new ProjectExecutionError(
          "stale_revision",
          "Execution evidence changed. Review the latest state before retrying.",
        );
      const legacyWorkspaceLifecycleFailure =
        task.failureClass === "product_decision" &&
        task.safeMessage.includes("ENOENT: no such file or directory") &&
        task.safeMessage.includes("project-task-worktrees") &&
        task.safeMessage.endsWith("package.json'");
      if (
        task.status !== "needs_user" ||
        task.lease ||
        task.reviews.length > 0 ||
        task.commitDigest ||
        task.integrationDigest ||
        (task.failureClass &&
          !["implementation", "environment"].includes(task.failureClass) &&
          !legacyWorkspaceLifecycleFailure)
      ) {
        throw new ProjectExecutionError(
          "retry_denied",
          "Only a pre-review, pre-commit environment failure can be resumed with this action.",
        );
      }
      const now = this.now();
      const updated: ExecutionTask = {
        ...task,
        status: "queued",
        assignment: null,
        revision: task.revision + 1,
        safeMessage: `Owner resumed execution after the environment was repaired: ${retry.rationale}`,
        updatedAt: now,
      };
      return {
        record: projectState(replaceTask(record, updated), now),
        result: updated,
      };
    });
  }

  async authorizeQuarantineRecovery(
    projectId: string,
    input: unknown,
    verification: QuarantineRepairEvidence,
  ) {
    const recovery = quarantineRecoverySchema.parse(input);
    return this.#mutateProject(projectId, (record) => {
      const task = record.tasks.find(
        (candidate) => candidate.id === recovery.taskId,
      );
      if (!task)
        throw new ProjectExecutionError(
          "not_found",
          "Execution task was not found.",
        );
      if (task.revision !== recovery.expectedRevision)
        throw new ProjectExecutionError(
          "stale_revision",
          "Execution evidence changed. Review the latest state before recovering quarantined work.",
        );
      const passedProfiles = new Set(
        verification
          .filter(
            (item) =>
              item.passed &&
              item.exitCode === 0 &&
              /^[a-f0-9]{64}$/.test(item.evidenceDigest),
          )
          .map((item) => item.profile),
      );
      if (
        task.validationProfiles.some((profile) => !passedProfiles.has(profile))
      )
        throw new ProjectExecutionError(
          "retry_denied",
          "Quarantine recovery requires fresh passing evidence for every reviewed validation profile.",
        );
      const verifiedPreReviewInterruption =
        task.status === "needs_user" &&
        task.reviews.length === 0 &&
        task.commitDigest === null &&
        task.integrationDigest === null &&
        (task.failureClass === "implementation" ||
          task.failureClass === "environment") &&
        task.validations.some((validation) => !validation.passed);
      const legacyDependencyInterruption =
        task.status === "needs_user" &&
        (task.safeMessage.includes("npm ci") ||
          task.safeMessage.includes("Bounded source evidence"));
      const boundedQuarantine =
        task.status === "quarantined" &&
        Boolean(
          task.failureClass &&
          ["implementation", "environment"].includes(task.failureClass),
        );
      const verifiedCleanCheckoutRepair =
        task.status === "needs_user" &&
        task.reviews.length > 0 &&
        task.reviews.every((review) => review.verdict === "pass") &&
        task.commitDigest === null &&
        task.integrationDigest === null &&
        task.failureClass === "implementation" &&
        task.safeMessage.includes("Clean-checkout validation failed");
      const verifiedReviewDissentRepair =
        ["needs_user", "quarantined"].includes(task.status) &&
        task.reviews.length > 0 &&
        hasBlockingReviewDissent(task.reviews) &&
        task.commitDigest === null &&
        task.integrationDigest === null;
      if (
        (!boundedQuarantine &&
          !legacyDependencyInterruption &&
          !verifiedPreReviewInterruption &&
          !verifiedCleanCheckoutRepair &&
          !verifiedReviewDissentRepair) ||
        task.lease ||
        (task.reviews.length > 0 &&
          !verifiedCleanCheckoutRepair &&
          !verifiedReviewDissentRepair) ||
        task.commitDigest ||
        task.integrationDigest
      ) {
        throw new ProjectExecutionError(
          "retry_denied",
          "Only an owner-approved, freshly verified repair of a pre-review quarantine or dependency interruption can be recovered with this action.",
        );
      }
      const now = this.now();
      const evidenceDigest = createHash("sha256")
        .update(JSON.stringify(verification))
        .digest("hex");
      const verifiedReviewedRepair =
        verifiedCleanCheckoutRepair || verifiedReviewDissentRepair;
      const archived = verifiedReviewedRepair
        ? {
            approvalId: recovery.approvalId,
            priorRevision: task.revision,
            implementerProviderId: task.assignment?.providerId ?? null,
            implementationEvidence: task.implementationEvidence,
            validations: task.validations,
            reviews: task.reviews,
            rationale: recovery.rationale,
            decidedAt: now,
          }
        : null;
      const updated: ExecutionTask = {
        ...task,
        status: "queued",
        assignment: null,
        verifiedRecoveryEvidenceDigest: evidenceDigest,
        attempt: verifiedReviewedRepair ? 0 : task.attempt,
        validations: verifiedReviewedRepair ? [] : task.validations,
        reviews: verifiedReviewedRepair ? [] : task.reviews,
        reviewAttempts: archived
          ? [...(task.reviewAttempts ?? []), archived]
          : task.reviewAttempts,
        revision: task.revision + 1,
        safeMessage: `Owner approved one freshly verified ${verifiedReviewDissentRepair ? "review-dissent" : verifiedCleanCheckoutRepair ? "clean-checkout" : "pre-review"} recovery (${recovery.approvalId}, ${evidenceDigest.slice(0, 12)}): ${recovery.rationale}`.slice(
          0,
          500,
        ),
        updatedAt: now,
      };
      return {
        record: projectState(replaceTask(record, updated), now),
        result: updated,
      };
    });
  }

  async interrupt(
    projectId: string,
    taskId: string,
    leaseId: string,
    ownerId: string,
    safeMessage: string,
    failureClass?: HealingFailureClass,
  ) {
    return this.#updateOwned(
      projectId,
      taskId,
      leaseId,
      ownerId,
      (record, task, now) => {
        const updated: ExecutionTask = {
          ...task,
          status: "needs_user",
          lease: null,
          failureClass: failureClass ?? task.failureClass,
          revision: task.revision + 1,
          safeMessage,
          updatedAt: now,
        };
        return {
          record: projectState(replaceTask(record, updated), now),
          result: updated,
        };
      },
    );
  }

  async #updateOwned<T>(
    projectId: string,
    taskId: string,
    leaseId: string,
    ownerId: string,
    operation: (
      record: ProjectExecutionRecord,
      task: ExecutionTask,
      now: number,
    ) => { record: ProjectExecutionRecord; result: T },
  ) {
    return this.#mutateProject(projectId, (record) => {
      const task = record.tasks.find((candidate) => candidate.id === taskId);
      const now = this.now();
      if (
        !task?.lease ||
        task.lease.leaseId !== leaseId ||
        task.lease.ownerId !== ownerId ||
        task.lease.expiresAt <= now
      )
        throw new ProjectExecutionError(
          "lease_denied",
          "Only the current unexpired lease owner can update this task.",
        );
      return operation(record, task, now);
    });
  }

  async #mutateProject<T>(
    projectId: string,
    operation: (record: ProjectExecutionRecord) => {
      record: ProjectExecutionRecord;
      result: T;
    },
  ) {
    return this.#mutate(async (state) => {
      const record = state.projects[projectId];
      if (!record)
        throw new ProjectExecutionError(
          "not_found",
          "Project execution has not been initialized.",
        );
      const outcome = operation(record);
      const parsed = projectExecutionRecordSchema.parse(outcome.record);
      return {
        state: {
          ...state,
          projects: { ...state.projects, [projectId]: parsed },
        },
        result: outcome.result,
      };
    });
  }

  async #save(record: ProjectExecutionRecord) {
    return this.#mutate(async (state) => ({
      state: {
        ...state,
        projects: { ...state.projects, [record.projectId]: record },
      },
      result: record,
    }));
  }
  async #mutate<T>(
    operation: (
      state: z.infer<typeof stateSchema>,
    ) => Promise<{ state: z.infer<typeof stateSchema>; result: T }>,
  ) {
    let result!: T;
    const next = this.#mutation.then(async () => {
      const outcome = await operation(await this.#load());
      await atomicWrite(
        this.#path,
        `${JSON.stringify(stateSchema.parse(outcome.state), null, 2)}\n`,
      );
      result = outcome.result;
    });
    this.#mutation = next.catch(() => undefined);
    await next;
    return result;
  }
  async #load() {
    try {
      return stateSchema.parse(
        migrateStoredExecutionState(
          JSON.parse(await readFile(this.#path, "utf8")),
          this.now(),
        ),
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT")
        return stateSchema.parse({ schemaVersion: 1, projects: {} });
      throw new Error("Project execution state is corrupt.", { cause: error });
    }
  }
}

function migrateStoredExecutionState(value: unknown, now: number): unknown {
  if (
    !value ||
    typeof value !== "object" ||
    !("projects" in value) ||
    !value.projects ||
    typeof value.projects !== "object"
  )
    return value;
  const projects = Object.fromEntries(
    Object.entries(value.projects).map(([projectId, candidate]) => {
      if (
        !candidate ||
        typeof candidate !== "object" ||
        !("tasks" in candidate) ||
        !Array.isArray(candidate.tasks)
      )
        return [projectId, candidate];
      let migrated = false;
      const tasks = candidate.tasks.map((task: unknown) => {
        if (!task || typeof task !== "object") return task;
        const record = task as Record<string, unknown>;
        const validationProfiles = Array.isArray(record.validationProfiles)
          ? record.validationProfiles
          : [];
        const needsLiveProof =
          record.uiChanged === true || validationProfiles.includes("visual");
        if (
          record.status !== "completed" ||
          !needsLiveProof ||
          record.liveJourneyEvidence
        )
          return task;
        migrated = true;
        return {
          ...record,
          status: "needs_user",
          lease: null,
          revision:
            typeof record.revision === "number" ? record.revision + 1 : 1,
          safeMessage:
            "Completion needs attention: run the owner-visible journey for the current revision and attach its passing receipt.",
          updatedAt: now,
        };
      });
      if (!migrated) return [projectId, candidate];
      const record = candidate as Record<string, unknown>;
      return [
        projectId,
        {
          ...record,
          state: "needs_user",
          revision:
            typeof record.revision === "number" ? record.revision + 1 : 1,
          tasks,
          updatedAt: now,
        },
      ];
    }),
  );
  return { ...(value as Record<string, unknown>), projects };
}

export class ProjectExecutionError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
const digestSchema = z.string().regex(/^[a-f0-9]{64}$/);
const gitDigestSchema = z.string().regex(/^[a-f0-9]{40,64}$/);
const validationSchema = z.strictObject({
  tier: z.enum(["fast", "full", "integration"]),
  commandLabel: z.string().trim().min(1).max(200),
  passed: z.boolean(),
  exitCode: z.number().int(),
  evidenceDigest: digestSchema,
});
function executableTasks(
  plan: DeliveryPlanDraft,
  jira: JiraReceipt,
  now: number,
): ExecutionTask[] {
  const subtasks = plan.items.filter((item) => item.type === "subtask");
  const byParent = new Map<string, typeof subtasks>();
  for (const item of subtasks)
    byParent.set(item.parentId!, [
      ...(byParent.get(item.parentId!) ?? []),
      item,
    ]);
  return subtasks.map((item) => {
    const parent = plan.items.find(
      (candidate) => candidate.id === item.parentId,
    );
    const inherited =
      parent?.dependencies.flatMap(
        (dependency) =>
          byParent.get(dependency)?.map((child) => child.id) ?? [],
      ) ?? [];
    const issue = jira.issues[item.id];
    if (!issue)
      throw new ProjectExecutionError(
        "jira_receipt_incomplete",
        `Jira receipt is missing ${item.id}.`,
      );
    if (item.allowedFiles.length === 0 || item.validationProfiles.length === 0)
      throw new ProjectExecutionError(
        "authority_missing",
        `${item.id} does not define bounded file and validation authority.`,
      );
    if (item.allowedFiles.some(isProtectedExecutionPath))
      throw new ProjectExecutionError(
        "protected_path",
        `${item.id} requests a protected credential, environment, or Git path.`,
      );
    const uiChanged = isOwnerFacingUiDeliveryItem(item);
    if (
      uiChanged &&
      (!item.validationProfiles.includes("build") ||
        !item.validationProfiles.includes("visual"))
    )
      throw new ProjectExecutionError(
        "ui_acceptance_missing",
        `${item.id} changes the owner-facing experience but lacks build and visual journey validation.`,
      );
    return {
      id: item.id,
      jiraIssueKey: issue.issueKey,
      title: item.title,
      acceptanceDigest: createHash("sha256")
        .update(
          JSON.stringify({
            acceptanceCriteria: item.acceptanceCriteria,
            definitionOfDone: item.definitionOfDone,
          }),
        )
        .digest("hex"),
      dependsOn: [
        ...new Set([
          ...item.dependencies.filter((id) =>
            subtasks.some((candidate) => candidate.id === id),
          ),
          ...inherited,
        ]),
      ],
      allowedFiles: item.allowedFiles,
      validationProfiles: item.validationProfiles,
      uiChanged,
      requiredCapabilities: uiChanged
        ? ["chat", "structured_output", "tool_calling"]
        : ["chat", "structured_output"],
      privacyClass: "source_code",
      status: "queued",
      revision: 0,
      attempt: 0,
      assignment: null,
      lease: null,
      implementationEvidence: [],
      validations: [],
      reviews: [],
      commitDigest: null,
      integrationDigest: null,
      failureClass: null,
      safeMessage: "Queued behind verified dependencies.",
      updatedAt: now,
    };
  });
}
export function executionEquivalenceSignature(
  record: ProjectExecutionRecord,
  task: ExecutionTask,
) {
  if (!task.acceptanceDigest) return null;
  return createHash("sha256")
    .update(
      JSON.stringify({
        projectId: record.projectId,
        planDigest: record.planDigest,
        acceptanceDigest: task.acceptanceDigest,
        allowedFiles: [...task.allowedFiles].sort(),
        validationProfiles: [...task.validationProfiles].sort(),
        uiChanged: task.uiChanged,
        requiredCapabilities: [...task.requiredCapabilities].sort(),
        privacyClass: task.privacyClass,
      }),
    )
    .digest("hex");
}
export function executionCompletionProofDigest(task: ExecutionTask) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        implementationEvidence: task.implementationEvidence,
        validations: task.validations,
        reviews: task.reviews,
        commitDigest: task.commitDigest,
        integrationDigest: task.integrationDigest,
        liveJourneyEvidence: task.liveJourneyEvidence ?? null,
      }),
    )
    .digest("hex");
}
function isProtectedExecutionPath(path: string) {
  const parts = path
    .replaceAll("\\", "/")
    .toLowerCase()
    .split("/")
    .filter(Boolean);
  return parts.some(
    (part) =>
      part === ".git" ||
      part === "secrets" ||
      part === "credentials" ||
      part === ".ssh" ||
      part === ".aws" ||
      part === ".config" ||
      part === ".env" ||
      part.startsWith(".env."),
  );
}
function replaceTask(
  record: ProjectExecutionRecord,
  task: ExecutionTask,
): ProjectExecutionRecord {
  return {
    ...record,
    revision: record.revision + 1,
    tasks: record.tasks.map((candidate) =>
      candidate.id === task.id ? task : candidate,
    ),
    updatedAt: task.updatedAt,
  };
}
function projectState(
  record: ProjectExecutionRecord,
  now: number,
): ProjectExecutionRecord {
  const state = record.tasks.every((task) => task.status === "completed")
    ? "completed"
    : record.tasks.some((task) => task.status === "quarantined")
      ? "quarantined"
      : record.tasks.some((task) => task.status === "needs_user")
        ? "needs_user"
        : "running";
  return { ...record, state, updatedAt: now };
}

export function hasBlockingReviewDissent(
  reviews: readonly {
    verdict: "pass" | "fail" | "needs_user";
    findings: readonly string[];
  }[],
): boolean {
  return reviews.some(
    (review) =>
      review.verdict !== "pass" ||
      review.findings.some((finding) =>
        /^(?:major|critical):/i.test(finding.trim()),
      ),
  );
}

export function isPreEvidenceExecutionDissent(task: ExecutionTask): boolean {
  return (
    task.status === "needs_user" &&
    task.assignment !== null &&
    task.implementationEvidence.length === 0 &&
    task.validations.length === 0 &&
    task.reviews.length === 0 &&
    task.commitDigest === null &&
    task.integrationDigest === null
  );
}
function hasValidation(task: ExecutionTask, tier: "fast" | "full") {
  return task.validations.some(
    (validation) => validation.tier === tier && validation.passed,
  );
}
function hasValidatedImplementationAwaitingReview(task: ExecutionTask) {
  return (
    task.assignment !== null &&
    task.implementationEvidence.length > 0 &&
    task.reviews.length === 0 &&
    task.failureClass !== "implementation" &&
    hasValidation(task, "fast") &&
    hasValidation(task, "full")
  );
}
function reviewDigest(review: QualityReview) {
  return createHash("sha256").update(JSON.stringify(review)).digest("hex");
}
async function atomicWrite(path: string, content: string) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, content, { encoding: "utf8", mode: 0o600 });
  await chmod(temporary, 0o600);
  await rename(temporary, path);
  await chmod(path, 0o600);
}
