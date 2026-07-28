import {
  appendProviderEvent,
  replayProviderJournal,
  type ProviderAttemptRecord,
  type ProviderJournalDocument,
  type ProviderJournalProjection
} from "../../storage/src/provider-journal.js";
import {
  routeProviders,
  type ProviderCandidate,
  type RouteDecision,
  type RouteRequest
} from "../../providers/src/router.js";
import {
  classifyProviderFailure,
  type FailureClass
} from "./retry.js";

export interface ProviderJournalRepository {
  load(input: {
    readonly taskId: string;
    readonly workUnitId: string;
    readonly requestDigest: string;
  }): Promise<ProviderJournalDocument>;
  save(document: ProviderJournalDocument): Promise<void>;
}

export interface ProviderExecutionOutput {
  readonly outputDigest: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
}

export interface ProviderExecutor {
  execute(input: {
    readonly taskId: string;
    readonly workUnitId: string;
    readonly requestDigest: string;
    readonly idempotencyKey: string;
    readonly candidate: ProviderCandidate;
  }): Promise<ProviderExecutionOutput>;
}

export interface ProviderTaskRuntimeResult {
  readonly projection: ProviderJournalProjection;
  readonly route: RouteDecision;
  readonly executedCandidateIds: readonly string[];
  readonly resumed: boolean;
}

export async function executeProviderTask(input: {
  readonly taskId: string;
  readonly workUnitId: string;
  readonly requestDigest: string;
  readonly candidates: readonly ProviderCandidate[];
  readonly routeRequest: RouteRequest;
  readonly repository: ProviderJournalRepository;
  readonly executor: ProviderExecutor;
}): Promise<ProviderTaskRuntimeResult> {
  let document = await input.repository.load(input);
  let projection = replayProviderJournal(document);
  const route = routeProviders(input.candidates, input.routeRequest);
  const executedCandidateIds: string[] = [];
  const resumed = projection.lastSequence > 0;

  if (projection.lastSequence === 0) {
    document = appendProviderEvent(document, {
      type: "provider.task_initialized",
      occurredAt: input.routeRequest.now,
      workUnitId: input.workUnitId,
      requestDigest: input.requestDigest
    });
    await input.repository.save(document);
    projection = replayProviderJournal(document);
  }
  if (projection.status === "succeeded" || projection.status === "needs_user") {
    return { projection, route, executedCandidateIds, resumed };
  }
  if (
    projection.status === "deferred" &&
    projection.retryAt !== null &&
    projection.retryAt > input.routeRequest.now
  ) {
    return { projection, route, executedCandidateIds, resumed };
  }

  if (projection.status === "ready" || projection.status === "deferred") {
    document = appendProviderEvent(document, {
      type: "provider.run_started",
      occurredAt: input.routeRequest.now,
      runNumber: projection.runNumber + 1
    });
    await input.repository.save(document);
    projection = replayProviderJournal(document);
  }

  const routeAlreadyRecorded = document.events.some(
    (event) =>
      event.type === "provider.route_recorded" &&
      event.runNumber === projection.runNumber
  );
  if (!routeAlreadyRecorded) {
    document = appendProviderEvent(document, {
      type: "provider.route_recorded",
      occurredAt: input.routeRequest.now,
      runNumber: projection.runNumber,
      request: {
        role: input.routeRequest.role,
        kind: input.routeRequest.kind,
        dataClass: input.routeRequest.dataClass,
        minimumPrivacy: input.routeRequest.minimumPrivacy,
        estimatedInputTokens: input.routeRequest.estimatedInputTokens,
        requestedOutputTokens: input.routeRequest.requestedOutputTokens,
        allowPaid: input.routeRequest.allowPaid,
        ...(input.routeRequest.costPolicy
          ? {
              costPolicy: {
                ...input.routeRequest.costPolicy,
                paidUseGrants: input.routeRequest.costPolicy.paidUseGrants.map((grant) => ({
                  ...grant
                }))
              }
            }
          : {}),
        ...(input.routeRequest.paidConfirmationDigest
          ? { paidConfirmationDigest: input.routeRequest.paidConfirmationDigest }
          : {}),
        now: input.routeRequest.now,
        ...(input.routeRequest.preferredProviderIds
          ? { preferredProviderIds: [...input.routeRequest.preferredProviderIds] }
          : {}),
        ...(input.routeRequest.avoidedProviderIds
          ? { avoidedProviderIds: [...input.routeRequest.avoidedProviderIds] }
          : {})
      },
      candidates: input.candidates.map((candidate) => ({
        ...candidate,
        roles: [...candidate.roles],
        kinds: [...candidate.kinds],
        dataClasses: [...candidate.dataClasses],
        ...(candidate.replacementProviderIds
          ? { replacementProviderIds: [...candidate.replacementProviderIds] }
          : {}),
        usage: {
          ...candidate.usage,
          requestTimestamps: [...candidate.usage.requestTimestamps],
          tokenSamples: candidate.usage.tokenSamples.map((sample) => ({ ...sample }))
        }
      }))
    });
    await input.repository.save(document);
    projection = replayProviderJournal(document);
  }

  const interrupted = projection.attempts.filter(
    (attempt) => attempt.runNumber === projection.runNumber && attempt.status === "started"
  );
  for (const attempt of interrupted) {
    document = appendProviderEvent(document, {
      type: "provider.call_failed",
      occurredAt: input.routeRequest.now,
      idempotencyKey: attempt.idempotencyKey,
      failureClass: "gateway_interrupted",
      failureCode: "runtime-restarted",
      retryAt: input.routeRequest.now + 30_000
    });
  }
  if (interrupted.length > 0) {
    await input.repository.save(document);
    projection = replayProviderJournal(document);
  }

  const attemptedThisRun = new Set(
    projection.attempts
      .filter((attempt) => attempt.runNumber === projection.runNumber)
      .map((attempt) => attempt.candidateId)
  );
  const retryTimes: number[] = [
    ...route.rejected.flatMap((rejection) =>
      rejection.retryAt === null ? [] : [rejection.retryAt]
    ),
    ...projection.attempts.flatMap((attempt) =>
      attempt.retryAt === null ? [] : [attempt.retryAt]
    )
  ];
  const failureClasses: FailureClass[] = [];

  for (const candidate of route.eligible) {
    if (attemptedThisRun.has(candidate.id)) continue;
    const idempotencyKey = providerIdempotencyKey({
      taskId: input.taskId,
      workUnitId: input.workUnitId,
      requestDigest: input.requestDigest,
      candidateId: candidate.id,
      runNumber: projection.runNumber
    });
    const attempt: ProviderAttemptRecord = {
      idempotencyKey,
      runNumber: projection.runNumber,
      candidateId: candidate.id,
      providerId: candidate.providerId,
      modelId: candidate.modelId,
      status: "started",
      startedAt: input.routeRequest.now,
      finishedAt: null,
      failureClass: null,
      failureCode: null,
      retryAt: null,
      outputDigest: null,
      inputTokens: null,
      outputTokens: null
    };
    document = appendProviderEvent(document, {
      type: "provider.call_started",
      occurredAt: input.routeRequest.now,
      attempt
    });
    await input.repository.save(document);
    executedCandidateIds.push(candidate.id);

    try {
      const output = await input.executor.execute({
        taskId: input.taskId,
        workUnitId: input.workUnitId,
        requestDigest: input.requestDigest,
        idempotencyKey,
        candidate
      });
      validateExecutionOutput(output);
      document = appendProviderEvent(document, {
        type: "provider.call_succeeded",
        occurredAt: input.routeRequest.now,
        idempotencyKey,
        ...output
      });
      await input.repository.save(document);
      projection = replayProviderJournal(document);
      return { projection, route, executedCandidateIds, resumed };
    } catch (error) {
      const observation = classifyProviderFailure(providerErrorDetails(error));
      failureClasses.push(observation.failureClass);
      if (observation.retryAt !== null) retryTimes.push(observation.retryAt);
      document = appendProviderEvent(document, {
        type: "provider.call_failed",
        occurredAt: input.routeRequest.now,
        idempotencyKey,
        failureClass: observation.failureClass,
        failureCode: observation.code,
        retryAt: observation.retryAt
      });
      await input.repository.save(document);
      projection = replayProviderJournal(document);
    }
  }

  const hasRetryableFailure =
    route.rejected.some((rejection) => rejection.retryAt !== null) ||
    failureClasses.some((failureClass) =>
      ["capacity_deferred", "gateway_interrupted", "rate_limit", "transient_provider"].includes(
        failureClass
      )
    ) ||
    interrupted.length > 0;
  if (hasRetryableFailure) {
    const retryAt = retryTimes.length > 0
      ? Math.min(...retryTimes.filter((value) => value > input.routeRequest.now))
      : input.routeRequest.now + 60_000;
    document = appendProviderEvent(document, {
      type: "provider.task_deferred",
      occurredAt: input.routeRequest.now,
      retryAt: Number.isFinite(retryAt) ? retryAt : input.routeRequest.now + 60_000,
      reason: "No free provider can complete this work right now; the canonical task is preserved."
    });
  } else {
    document = appendProviderEvent(document, {
      type: "provider.task_needs_user",
      occurredAt: input.routeRequest.now,
      reason: explainUnavailableRoute(route, failureClasses)
    });
  }
  await input.repository.save(document);
  projection = replayProviderJournal(document);
  return { projection, route, executedCandidateIds, resumed };
}

export function providerIdempotencyKey(input: {
  readonly taskId: string;
  readonly workUnitId: string;
  readonly requestDigest: string;
  readonly candidateId: string;
  readonly runNumber: number;
}): string {
  return [
    input.taskId,
    input.workUnitId,
    input.requestDigest,
    input.candidateId,
    `run-${input.runNumber}`
  ].join(":");
}

function providerErrorDetails(error: unknown): {
  readonly status: number | null;
  readonly code?: string;
  readonly retryAt?: number | null;
} {
  if (typeof error !== "object" || error === null) return { status: null };
  const value = error as { status?: unknown; code?: unknown; retryAt?: unknown };
  return {
    status: typeof value.status === "number" ? value.status : null,
    ...(typeof value.code === "string" ? { code: value.code } : {}),
    ...(typeof value.retryAt === "number" || value.retryAt === null
      ? { retryAt: value.retryAt }
      : {})
  };
}

function validateExecutionOutput(output: ProviderExecutionOutput): void {
  if (
    !output.outputDigest ||
    !/^sha256:[a-f0-9]{64}$/.test(output.outputDigest) ||
    output.inputTokens < 0 ||
    output.outputTokens < 0 ||
    !Number.isFinite(output.inputTokens) ||
    !Number.isFinite(output.outputTokens)
  ) {
    throw Object.assign(new Error("Provider execution output is invalid."), {
      code: "invalid-provider-output"
    });
  }
}

function explainUnavailableRoute(
  route: RouteDecision,
  failures: readonly FailureClass[]
): string {
  if (failures.includes("permission")) {
    return "Provider authorization needs repair before this work can continue.";
  }
  if (route.rejected.every((rejection) => rejection.reason === "paid-disabled")) {
    return "Only paid providers are eligible and paid usage is disabled.";
  }
  if (route.rejected.some((rejection) =>
    [
      "unknown-cost",
      "billing-enabled-project",
      "paid-authorization-missing",
      "paid-authorization-mismatch",
      "paid-authorization-expired",
      "paid-authorization-revoked",
      "paid-connection-not-approved",
      "paid-route-not-approved",
      "paid-confirmation-invalid",
      "paid-budget-exceeded"
    ].includes(rejection.reason)
  )) {
    return "Cost safeguards denied every available route. Free-only remains active; inspect provider billing state or create a bounded paid-use authorization.";
  }
  const retired = route.rejected.filter((rejection) => rejection.reason === "provider-retired");
  if (retired.length === route.rejected.length && retired.length > 0) {
    return retired.map((rejection) => rejection.detail).join(" ");
  }
  return "No eligible provider is configured for this work.";
}
