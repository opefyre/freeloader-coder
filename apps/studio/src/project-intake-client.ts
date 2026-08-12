import { projectIntakeCollectionSchema, projectIntakeSchema, type ProjectIntake } from "../../../packages/runtime/src/project-intakes.js";

const MAX_RESPONSE_BYTES = 1_000_000;
export async function listProjectIntakes(endpoint: string, fetcher: typeof fetch = fetch) { return projectIntakeCollectionSchema.parse(await request(endpoint, "/api/v1/project-intakes", "GET", undefined, undefined, fetcher)); }
export async function createProjectIntake(endpoint: string, projectMode: ProjectIntake["projectMode"], idempotencyKey: string, fetcher: typeof fetch = fetch) { return projectIntakeSchema.parse(await request(endpoint, "/api/v1/project-intakes", "POST", { schemaVersion: 1, projectMode }, idempotencyKey, fetcher)); }
export async function saveProjectIntakeDraft(endpoint: string, intakeId: string, input: unknown, fetcher: typeof fetch = fetch) { return projectIntakeSchema.parse(await request(endpoint, `/api/v1/project-intakes/${assertIntakeId(intakeId)}/draft`, "PUT", input, undefined, fetcher)); }
export async function selectProjectIntakeResources(endpoint: string, intakeId: string, input: unknown, fetcher: typeof fetch = fetch) { return projectIntakeSchema.parse(await request(endpoint, `/api/v1/project-intakes/${assertIntakeId(intakeId)}/resources`, "PUT", input, undefined, fetcher)); }
export async function submitProjectIntake(endpoint: string, intakeId: string, expectedRevision: number, idempotencyKey: string, fetcher: typeof fetch = fetch) { return projectIntakeSchema.parse(await request(endpoint, `/api/v1/project-intakes/${assertIntakeId(intakeId)}/submit`, "POST", { schemaVersion: 1, expectedRevision }, idempotencyKey, fetcher)); }
export async function cancelProjectIntake(endpoint: string, intakeId: string, expectedRevision: number, reason: string, fetcher: typeof fetch = fetch) { return projectIntakeSchema.parse(await request(endpoint, `/api/v1/project-intakes/${assertIntakeId(intakeId)}/cancel`, "POST", { schemaVersion: 1, expectedRevision, reason }, undefined, fetcher)); }
export async function saveResumableProjectIntakeDraft(endpoint: string, current: ProjectIntake | null, input: {
  mode: ProjectIntake["projectMode"]; idea: string; workspaceReference: string | null; workspaceLabel: string | null;
  attachments: readonly { kind: string; value: string }[]; idempotencyKey: string;
}, fetcher: typeof fetch = fetch) {
  const intake = !current || current.projectMode !== input.mode || !["draft", "resource_selection"].includes(current.state)
    ? await createProjectIntake(endpoint, input.mode, input.idempotencyKey, fetcher)
    : current;
  const attachmentReferences = input.attachments.map(({ kind, value }) => encodeProjectIntakeReference(kind, value));
  if (intake.idea === input.idea && intake.workspaceReference === input.workspaceReference &&
    intake.workspaceLabel === input.workspaceLabel && sameReferences(intake.attachmentReferences, attachmentReferences)) return intake;
  return saveProjectIntakeDraft(endpoint, intake.id, {
    schemaVersion: 1, expectedRevision: intake.revision, idea: input.idea,
    workspaceReference: input.workspaceReference, workspaceLabel: input.workspaceLabel,
    attachmentReferences,
  }, fetcher);
}

async function request(endpointValue: string, path: string, method: "GET" | "POST" | "PUT", body: unknown, idempotencyKey: string | undefined, fetcher: typeof fetch) {
  const endpoint = new URL(endpointValue); if (endpoint.protocol !== "http:" || !["127.0.0.1", "localhost", "::1"].includes(endpoint.hostname) || endpoint.pathname !== "/" || endpoint.search || endpoint.hash || endpoint.username || endpoint.password) throw new Error("Control-plane endpoint must be loopback HTTP.");
  const response = await fetcher(new URL(path, endpoint), { method, cache: "no-store", credentials: "omit", headers: { Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}), ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const text = await response.text(); if (text.length > MAX_RESPONSE_BYTES) throw new Error("Project intake response is too large.");
  if (!response.ok) throw new Error("Project intake could not be updated."); return JSON.parse(text) as unknown;
}
function assertIntakeId(value: string) { if (!/^intake_[a-f0-9]{20}$/.test(value)) throw new Error("Project intake identity is invalid."); return value; }
export function encodeProjectIntakeReference(kind: string, value: string): string {
  const encoded = btoa(unescape(encodeURIComponent(value))).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
  return `${kind}:${encoded.slice(0, 160)}`;
}
export function decodeProjectIntakeReference(reference: string | null, kind: string): string | null {
  if (!reference?.startsWith(`${kind}:`)) return null;
  try {
    const encoded = reference.slice(kind.length + 1).replaceAll("-", "+").replaceAll("_", "/");
    return decodeURIComponent(escape(atob(encoded.padEnd(Math.ceil(encoded.length / 4) * 4, "="))));
  } catch { return null; }
}
function sameReferences(left: readonly string[], right: readonly string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
