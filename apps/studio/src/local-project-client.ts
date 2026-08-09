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

const MAX_RESPONSE_BYTES = 131_072;

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
  idempotencyKey: string;
  fetcher?: typeof fetch;
}): Promise<ProjectContextSnapshot> {
  assertProjectId(input.projectId);
  return projectContextSnapshotSchema.parse(
    await request({
      endpoint: input.endpoint,
      path: `/api/v1/projects/${input.projectId}/context`,
      method: "POST",
      body: { schemaVersion: 1, outcome: input.outcome },
      idempotencyKey: input.idempotencyKey,
      ...(input.fetcher ? { fetcher: input.fetcher } : {}),
    })
  );
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
