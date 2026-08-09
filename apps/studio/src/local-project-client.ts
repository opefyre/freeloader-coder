import {
  localProjectCollectionSchema,
  localProjectMutationResponseSchema,
  localProjectFileImportResponseSchema,
  type LocalProjectCollection,
  type LocalProjectMutationResponse,
  type ProjectResourceSelection,
  type LocalProjectFileImportResponse,
  projectContextSnapshotSchema,
  type ProjectContextSnapshot,
} from "../../../packages/runtime/src/local-projects.js";
import { projectLifecycleRecordSchema, type OwnerAnswer, type ProjectLifecycleRecord } from "../../../packages/orchestration/src/project-lifecycle.js";
import { eligibilityDecisionSchema, type EligibilityDecision } from "../../../packages/orchestration/src/eligibility-gate.js";
import { solutionDocumentSchema, projectEgressPermitSchema, solutionRunSchema, type SolutionDocument, type ProjectEgressPermit, type SolutionRun } from "../../../packages/orchestration/src/solution-design.js";
import { deliveryPlanDocumentSchema, deliveryPlanRunSchema, type DeliveryPlanDocument, type DeliveryPlanRun } from "../../../packages/orchestration/src/delivery-plan.js";
import { projectExecutionRecordSchema, type ProjectExecutionRecord } from "../../../packages/orchestration/src/project-execution.js";

const MAX_RESPONSE_BYTES = 1_100_000;

export async function listLocalProjects(input: {
  endpoint: string;
  signal?: AbortSignal;
  fetcher?: typeof fetch;
}): Promise<LocalProjectCollection> {
  return localProjectCollectionSchema.parse(
    await request({
      endpoint: input.endpoint,
      path: "/api/v1/projects",
      method: "GET",
      ...(input.signal ? { signal: input.signal } : {}),
      ...(input.fetcher ? { fetcher: input.fetcher } : {}),
    })
  );
}

export async function registerLocalProject(input: {
  endpoint: string;
  path: string;
  displayName?: string;
  idempotencyKey: string;
  fetcher?: typeof fetch;
}): Promise<LocalProjectMutationResponse> {
  return localProjectMutationResponseSchema.parse(
    await request({
      endpoint: input.endpoint,
      path: "/api/v1/projects",
      method: "POST",
      body: {
        schemaVersion: 1,
        path: input.path,
        ...(input.displayName ? { displayName: input.displayName } : {}),
      },
      idempotencyKey: input.idempotencyKey,
      ...(input.fetcher ? { fetcher: input.fetcher } : {}),
    })
  );
}

export async function createLocalProject(input: {
  endpoint: string;
  idea: string;
  workspacePath: string;
  displayName?: string;
  idempotencyKey: string;
  fetcher?: typeof fetch;
}): Promise<LocalProjectMutationResponse> {
  return localProjectMutationResponseSchema.parse(
    await request({
      endpoint: input.endpoint,
      path: "/api/v1/projects/new",
      method: "POST",
      body: {
        schemaVersion: 1,
        idea: input.idea,
        workspacePath: input.workspacePath,
        ...(input.displayName ? { displayName: input.displayName } : {}),
      },
      idempotencyKey: input.idempotencyKey,
      ...(input.fetcher ? { fetcher: input.fetcher } : {}),
    })
  );
}

export async function setLocalProjectResources(input: {
  endpoint: string;
  projectId: string;
  selection: ProjectResourceSelection;
  idempotencyKey: string;
  fetcher?: typeof fetch;
}): Promise<LocalProjectMutationResponse> {
  assertProjectId(input.projectId);
  return localProjectMutationResponseSchema.parse(
    await request({
      endpoint: input.endpoint,
      path: `/api/v1/projects/${input.projectId}/resources`,
      method: "PUT",
      body: input.selection,
      idempotencyKey: input.idempotencyKey,
      ...(input.fetcher ? { fetcher: input.fetcher } : {}),
    })
  );
}

export async function addLocalProjectFiles(input: {
  endpoint: string;
  projectId: string;
  paths: readonly string[];
  idempotencyKey: string;
  fetcher?: typeof fetch;
}): Promise<LocalProjectFileImportResponse> {
  assertProjectId(input.projectId);
  return localProjectFileImportResponseSchema.parse(
    await request({
      endpoint: input.endpoint,
      path: `/api/v1/projects/${input.projectId}/files`,
      method: "POST",
      body: { schemaVersion: 1, paths: input.paths },
      idempotencyKey: input.idempotencyKey,
      ...(input.fetcher ? { fetcher: input.fetcher } : {}),
    })
  );
}

export async function generateLocalProjectContext(input: {
  endpoint: string;
  projectId: string;
  outcome: string;
  requestId: string;
  projectKind: "new_product" | "existing_product";
  idempotencyKey: string;
  fetcher?: typeof fetch;
}): Promise<ProjectContextSnapshot> {
  assertProjectId(input.projectId);
  return projectContextSnapshotSchema.parse(
    await request({
      endpoint: input.endpoint,
      path: `/api/v1/projects/${input.projectId}/context`,
      method: "POST",
      body: { schemaVersion: 1, outcome: input.outcome, requestId: input.requestId, projectKind: input.projectKind },
      idempotencyKey: input.idempotencyKey,
      ...(input.fetcher ? { fetcher: input.fetcher } : {}),
    })
  );
}

export async function getProjectLifecycle(input: { endpoint: string; projectId: string; fetcher?: typeof fetch }): Promise<ProjectLifecycleRecord> {
  assertProjectId(input.projectId);
  return projectLifecycleRecordSchema.parse(await request({ endpoint: input.endpoint, path: `/api/v1/projects/${input.projectId}/lifecycle`, method: "GET", ...(input.fetcher ? { fetcher: input.fetcher } : {}) }));
}

export async function getProjectEligibility(input: { endpoint: string; projectId: string; fetcher?: typeof fetch }): Promise<EligibilityDecision> {
  assertProjectId(input.projectId);
  return eligibilityDecisionSchema.parse(await request({ endpoint: input.endpoint, path: `/api/v1/projects/${input.projectId}/eligibility`, method: "GET", ...(input.fetcher ? { fetcher: input.fetcher } : {}) }));
}

export async function getProjectSolution(input: { endpoint: string; projectId: string; fetcher?: typeof fetch }): Promise<SolutionDocument> {
  assertProjectId(input.projectId);
  return solutionDocumentSchema.parse(await request({ endpoint: input.endpoint, path: `/api/v1/projects/${input.projectId}/solution`, method: "GET", ...(input.fetcher ? { fetcher: input.fetcher } : {}) }));
}

export async function decideProjectSolution(input: { endpoint: string; projectId: string; expectedRevision: number; artifactDigest: string; decision: "approved" | "declined" | "revision_requested"; feedback: string | null; idempotencyKey: string; fetcher?: typeof fetch }): Promise<ProjectLifecycleRecord> {
  assertProjectId(input.projectId);
  return projectLifecycleRecordSchema.parse(await request({ endpoint: input.endpoint, path: `/api/v1/projects/${input.projectId}/solution-decision`, method: "POST", body: { schemaVersion: 1, expectedRevision: input.expectedRevision, artifactDigest: input.artifactDigest, decision: input.decision, feedback: input.feedback }, idempotencyKey: input.idempotencyKey, ...(input.fetcher ? { fetcher: input.fetcher } : {}) }));
}

export async function getProjectProviderConsent(input: { endpoint: string; projectId: string; fetcher?: typeof fetch }): Promise<ProjectEgressPermit | null> {
  assertProjectId(input.projectId); return projectEgressPermitSchema.nullable().parse(await request({ endpoint: input.endpoint, path: `/api/v1/projects/${input.projectId}/provider-consent`, method: "GET", ...(input.fetcher ? { fetcher: input.fetcher } : {}) }));
}

export async function grantProjectProviderConsent(input: { endpoint: string; projectId: string; contextDigest: string; dataClass: "non_personal_test" | "source_code"; providerIds: readonly string[]; expiresAt: number; idempotencyKey: string; fetcher?: typeof fetch }): Promise<ProjectEgressPermit> {
  assertProjectId(input.projectId); return projectEgressPermitSchema.parse(await request({ endpoint: input.endpoint, path: `/api/v1/projects/${input.projectId}/provider-consent`, method: "POST", body: { schemaVersion: 1, contextDigest: input.contextDigest, dataClass: input.dataClass, providerIds: input.providerIds, expiresAt: input.expiresAt, acknowledgment: "I authorize this exact project context for the selected free providers." }, idempotencyKey: input.idempotencyKey, ...(input.fetcher ? { fetcher: input.fetcher } : {}) }));
}

export async function revokeProjectProviderConsent(input: { endpoint: string; projectId: string; idempotencyKey: string; fetcher?: typeof fetch }): Promise<void> {
  assertProjectId(input.projectId); await request({ endpoint: input.endpoint, path: `/api/v1/projects/${input.projectId}/provider-consent`, method: "DELETE", idempotencyKey: input.idempotencyKey, ...(input.fetcher ? { fetcher: input.fetcher } : {}) });
}

export async function generateProjectSolution(input: { endpoint: string; projectId: string; idempotencyKey: string; fetcher?: typeof fetch }): Promise<SolutionRun> {
  assertProjectId(input.projectId); return solutionRunSchema.parse(await request({ endpoint: input.endpoint, path: `/api/v1/projects/${input.projectId}/solution-generate`, method: "POST", idempotencyKey: input.idempotencyKey, ...(input.fetcher ? { fetcher: input.fetcher } : {}) }));
}

export async function getProjectSolutionRun(input: { endpoint: string; projectId: string; fetcher?: typeof fetch }): Promise<SolutionRun | null> {
  assertProjectId(input.projectId); return solutionRunSchema.nullable().parse(await request({ endpoint: input.endpoint, path: `/api/v1/projects/${input.projectId}/solution-run`, method: "GET", ...(input.fetcher ? { fetcher: input.fetcher } : {}) }));
}

export async function getProjectBacklog(input: { endpoint: string; projectId: string; fetcher?: typeof fetch }): Promise<DeliveryPlanDocument> {
  assertProjectId(input.projectId);
  return deliveryPlanDocumentSchema.parse(await request({ endpoint: input.endpoint, path: `/api/v1/projects/${input.projectId}/backlog`, method: "GET", ...(input.fetcher ? { fetcher: input.fetcher } : {}) }));
}

export async function generateProjectBacklog(input: { endpoint: string; projectId: string; idempotencyKey: string; fetcher?: typeof fetch }): Promise<DeliveryPlanRun> {
  assertProjectId(input.projectId);
  return deliveryPlanRunSchema.parse(await request({ endpoint: input.endpoint, path: `/api/v1/projects/${input.projectId}/backlog-generate`, method: "POST", idempotencyKey: input.idempotencyKey, ...(input.fetcher ? { fetcher: input.fetcher } : {}) }));
}

export async function getProjectBacklogRun(input: { endpoint: string; projectId: string; fetcher?: typeof fetch }): Promise<DeliveryPlanRun | null> {
  assertProjectId(input.projectId);
  return deliveryPlanRunSchema.nullable().parse(await request({ endpoint: input.endpoint, path: `/api/v1/projects/${input.projectId}/backlog-run`, method: "GET", ...(input.fetcher ? { fetcher: input.fetcher } : {}) }));
}

export async function getProjectExecution(input: { endpoint: string; projectId: string; fetcher?: typeof fetch }): Promise<ProjectExecutionRecord | null> {
  assertProjectId(input.projectId);
  return projectExecutionRecordSchema.nullable().parse(await request({ endpoint: input.endpoint, path: `/api/v1/projects/${input.projectId}/execution`, method: "GET", ...(input.fetcher ? { fetcher: input.fetcher } : {}) }));
}

export async function answerProjectClarifications(input: { endpoint: string; projectId: string; expectedRevision: number; answers: readonly OwnerAnswer[]; idempotencyKey: string; fetcher?: typeof fetch }): Promise<ProjectLifecycleRecord> {
  assertProjectId(input.projectId);
  return projectLifecycleRecordSchema.parse(await request({ endpoint: input.endpoint, path: `/api/v1/projects/${input.projectId}/clarifications`, method: "POST", body: { schemaVersion: 1, expectedRevision: input.expectedRevision, answers: input.answers }, idempotencyKey: input.idempotencyKey, ...(input.fetcher ? { fetcher: input.fetcher } : {}) }));
}

export async function rescanLocalProject(input: {
  endpoint: string;
  projectId: string;
  fetcher?: typeof fetch;
}): Promise<LocalProjectMutationResponse> {
  assertProjectId(input.projectId);
  return localProjectMutationResponseSchema.parse(
    await request({
      endpoint: input.endpoint,
      path: `/api/v1/projects/${input.projectId}/rescan`,
      method: "POST",
      ...(input.fetcher ? { fetcher: input.fetcher } : {}),
    })
  );
}

export async function forgetLocalProject(input: {
  endpoint: string;
  projectId: string;
  fetcher?: typeof fetch;
}): Promise<LocalProjectMutationResponse> {
  assertProjectId(input.projectId);
  return localProjectMutationResponseSchema.parse(
    await request({
      endpoint: input.endpoint,
      path: `/api/v1/projects/${input.projectId}/registration`,
      method: "DELETE",
      ...(input.fetcher ? { fetcher: input.fetcher } : {}),
    })
  );
}

async function request(input: {
  endpoint: string;
  path: string;
  method: "GET" | "POST" | "PUT" | "DELETE";
  body?: unknown;
  idempotencyKey?: string;
  signal?: AbortSignal;
  fetcher?: typeof fetch;
}): Promise<unknown> {
  const endpoint = validateEndpoint(input.endpoint);
  const response = await (input.fetcher ?? fetch)(new URL(input.path, endpoint), {
    method: input.method,
    cache: "no-store",
    credentials: "omit",
    headers: {
      Accept: "application/json",
      ...(input.body ? { "Content-Type": "application/json" } : {}),
      ...(input.idempotencyKey ? { "Idempotency-Key": input.idempotencyKey } : {}),
    },
    ...(input.body ? { body: JSON.stringify(input.body) } : {}),
    ...(input.signal ? { signal: input.signal } : {}),
  });
  const declaredLength = Number(response.headers.get("content-length") ?? 0);
  if (declaredLength > MAX_RESPONSE_BYTES) {
    throw new Error("Local project response is too large.");
  }
  const text = await response.text();
  if (text.length > MAX_RESPONSE_BYTES) {
    throw new Error("Local project response is too large.");
  }
  if (!response.ok) {
    let message = "The local project request could not be completed.";
    try {
      const parsed = JSON.parse(text) as { error?: unknown };
      if (typeof parsed.error === "string" && parsed.error.length <= 500) {
        message = parsed.error;
      }
    } catch {
      // Keep the bounded generic error.
    }
    throw new Error(message);
  }
  return JSON.parse(text) as unknown;
}

function validateEndpoint(value: string): URL {
  const endpoint = new URL(value);
  if (
    endpoint.protocol !== "http:" ||
    !["127.0.0.1", "localhost", "::1"].includes(endpoint.hostname) ||
    endpoint.username ||
    endpoint.password ||
    endpoint.pathname !== "/" ||
    endpoint.search ||
    endpoint.hash
  ) {
    throw new Error("Control-plane endpoint must be an origin-only loopback HTTP URL.");
  }
  return endpoint;
}

function assertProjectId(value: string): void {
  if (!/^project_[a-f0-9]{16}$/.test(value)) {
    throw new Error("Local project identity is invalid.");
  }
}
