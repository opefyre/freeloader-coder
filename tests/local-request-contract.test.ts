import assert from "node:assert/strict";
import test from "node:test";

import {
  localRequestCreationSchema,
  localRequestSchema,
  validateLocalRequestCollection,
} from "../packages/runtime/src/local-requests.js";

const request = {
  schemaVersion: 1,
  id: "request_0123456789abcdef0123",
  projectId: "project_0123456789abcdef",
  outcome: "Add a durable local request queue.",
  readiness: "ready",
  state: "queued",
  provenance: "local_request",
  createdAt: 10_000,
  updatedAt: 10_000,
  findings: [{
    code: "implementation_assumption",
    severity: "assumption",
    title: "Implementation approach",
    detail: "Use existing project patterns.",
  }],
  workPreview: {
    provenance: "deterministic_local_preview",
    title: "Add a durable local request queue.",
    outcome: "Add a durable local request queue.",
    assumptions: ["Use existing project patterns."],
    exclusions: ["No provider has been selected."],
    checks: ["Run repository validation"],
    estimatedMinutes: 45,
  },
} as const;

test("local request contracts preserve truthful bounded public state", () => {
  assert.deepEqual(localRequestSchema.parse(request), request);
  assert.deepEqual(
    localRequestCreationSchema.parse({
      schemaVersion: 1,
      projectId: request.projectId,
      outcome: `  ${request.outcome}  `,
    }),
    { schemaVersion: 1, projectId: request.projectId, outcome: request.outcome }
  );
  const collection = validateLocalRequestCollection({
    schemaVersion: 1,
    provenance: "local_observation",
    observedAt: 10_001,
    requests: [request],
  });
  assert.equal(JSON.stringify(collection).includes("/Users/"), false);
});

test("request contracts reject unknown fields, duplicate identities, and false states", () => {
  assert.throws(() => localRequestSchema.parse({ ...request, privatePath: "/tmp/x" }));
  assert.throws(() =>
    validateLocalRequestCollection({
      schemaVersion: 1,
      provenance: "local_observation",
      observedAt: 10_001,
      requests: [request, request],
    })
  );
  assert.throws(() => localRequestSchema.parse({ ...request, state: "running" }));
});
