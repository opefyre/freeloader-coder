import assert from "node:assert/strict";
import test from "node:test";

import {
  cancelLocalRequest,
  createLocalRequest,
  listLocalRequests,
} from "../apps/studio/src/local-request-client.js";

const request = {
  schemaVersion: 1,
  id: "request_0123456789abcdef0123",
  projectId: "project_0123456789abcdef",
  outcome: "Build request intake.",
  readiness: "ready",
  state: "queued",
  provenance: "local_request",
  createdAt: 10_000,
  updatedAt: 10_000,
  findings: [],
  workPreview: {
    provenance: "deterministic_local_preview",
    title: "Build request intake.",
    outcome: "Build request intake.",
    assumptions: [],
    exclusions: ["No provider selected."],
    checks: ["Run tests"],
    estimatedMinutes: 45,
  },
  run: null,
} as const;

test("request client sends idempotent loopback mutations and validates responses", async () => {
  const observed: { url: string; init?: RequestInit }[] = [];
  const created = await createLocalRequest({
    endpoint: "http://127.0.0.1:4312",
    projectId: request.projectId,
    outcome: request.outcome,
    idempotencyKey: "request:0123456789",
    fetcher: async (url, init) => {
      observed.push({ url: String(url), ...(init ? { init } : {}) });
      return Response.json({ schemaVersion: 1, outcome: "created", request });
    },
  });
  assert.equal(created.request?.id, request.id);
  assert.equal(observed[0]?.url, "http://127.0.0.1:4312/api/v1/requests");
  assert.equal(
    (observed[0]?.init?.headers as Record<string, string>)["Idempotency-Key"],
    "request:0123456789"
  );
});

test("request client rejects remote endpoints, malformed responses, and bad identities", async () => {
  await assert.rejects(() =>
    listLocalRequests({
      endpoint: "https://example.com",
      fetcher: async () => Response.json({}),
    })
  );
  await assert.rejects(() =>
    listLocalRequests({
      endpoint: "http://127.0.0.1:4312",
      fetcher: async () =>
        Response.json({
          schemaVersion: 1,
          provenance: "local_observation",
          observedAt: 10_000,
          requests: [{ ...request, privatePath: "/tmp/x" }],
        }),
    })
  );
  await assert.rejects(() =>
    cancelLocalRequest({
      endpoint: "http://127.0.0.1:4312",
      requestId: "invalid",
      idempotencyKey: "cancel:0123456789",
    })
  );
});
