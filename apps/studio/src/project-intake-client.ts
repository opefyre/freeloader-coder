import { projectIntakeCollectionSchema, projectIntakeSchema, type ProjectIntake } from "../../../packages/runtime/src/project-intakes.js";

const MAX_RESPONSE_BYTES = 1_000_000;
export async function listProjectIntakes(endpoint: string, fetcher: typeof fetch = fetch) { return projectIntakeCollectionSchema.parse(await request(endpoint, "/api/v1/project-intakes", "GET", undefined, undefined, fetcher)); }
export async function createProjectIntake(endpoint: string, projectMode: ProjectIntake["projectMode"], idempotencyKey: string, fetcher: typeof fetch = fetch) { return projectIntakeSchema.parse(await request(endpoint, "/api/v1/project-intakes", "POST", { schemaVersion: 1, projectMode }, idempotencyKey, fetcher)); }
export async function saveProjectIntakeDraft(endpoint: string, intakeId: string, input: unknown, fetcher: typeof fetch = fetch) { return projectIntakeSchema.parse(await request(endpoint, `/api/v1/project-intakes/${assertIntakeId(intakeId)}/draft`, "PUT", input, undefined, fetcher)); }
export async function selectProjectIntakeResources(endpoint: string, intakeId: string, input: unknown, fetcher: typeof fetch = fetch) { return projectIntakeSchema.parse(await request(endpoint, `/api/v1/project-intakes/${assertIntakeId(intakeId)}/resources`, "PUT", input, undefined, fetcher)); }
export async function submitProjectIntake(endpoint: string, intakeId: string, expectedRevision: number, idempotencyKey: string, fetcher: typeof fetch = fetch) { return projectIntakeSchema.parse(await request(endpoint, `/api/v1/project-intakes/${assertIntakeId(intakeId)}/submit`, "POST", { schemaVersion: 1, expectedRevision }, idempotencyKey, fetcher)); }
export async function cancelProjectIntake(endpoint: string, intakeId: string, expectedRevision: number, reason: string, fetcher: typeof fetch = fetch) { return projectIntakeSchema.parse(await request(endpoint, `/api/v1/project-intakes/${assertIntakeId(intakeId)}/cancel`, "POST", { schemaVersion: 1, expectedRevision, reason }, undefined, fetcher)); }

async function request(endpointValue: string, path: string, method: "GET" | "POST" | "PUT", body: unknown, idempotencyKey: string | undefined, fetcher: typeof fetch) {
  const endpoint = new URL(endpointValue); if (endpoint.protocol !== "http:" || !["127.0.0.1", "localhost", "::1"].includes(endpoint.hostname) || endpoint.pathname !== "/" || endpoint.search || endpoint.hash || endpoint.username || endpoint.password) throw new Error("Control-plane endpoint must be loopback HTTP.");
  const response = await fetcher(new URL(path, endpoint), { method, cache: "no-store", credentials: "omit", headers: { Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}), ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const text = await response.text(); if (text.length > MAX_RESPONSE_BYTES) throw new Error("Project intake response is too large.");
  if (!response.ok) throw new Error("Project intake could not be updated."); return JSON.parse(text) as unknown;
}
function assertIntakeId(value: string) { if (!/^intake_[a-f0-9]{20}$/.test(value)) throw new Error("Project intake identity is invalid."); return value; }
