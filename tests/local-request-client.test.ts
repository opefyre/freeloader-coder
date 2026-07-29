import assert from "node:assert/strict";
import test from "node:test";

import {
  advanceLocalExecution,
  advanceLocalPatch,
  approveLocalPatch,
  cancelLocalRequest,
  createLocalRequest,
  listLocalRequests,
  previewLocalPatch,
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

test("request client sends exact patch lifecycle payloads to loopback routes", async () => {
  const observed: Array<{ path: string; body?: string }> = [];
  const fetcher = async (url: URL | RequestInfo, init?: RequestInit) => {
    observed.push({
      path: new URL(String(url)).pathname,
      ...(typeof init?.body === "string" ? { body: init.body } : {}),
    });
    const path = new URL(String(url)).pathname;
    const outcome = path.endsWith("patch-preview")
      ? "patch_previewed"
      : path.endsWith("patch-approve")
        ? "patch_approved"
        : path.endsWith("patch-rollback")
          ? "patch_rolled_back"
          : "patch_applied";
    return Response.json({ schemaVersion: 1, outcome, request });
  };
  await previewLocalPatch({
    endpoint: "http://127.0.0.1:4312",
    requestId: request.id,
    proposal: {
      schemaVersion: 1,
      expectedAuthorityDigest: "a".repeat(64),
      expectedRunDigest: "b".repeat(64),
      path: "README.md",
      expectedBeforeDigest: null,
      replacementContent: "# Replacement\n",
    },
    idempotencyKey: "patch-preview:0123456789",
    fetcher,
  });
  await approveLocalPatch({
    endpoint: "http://127.0.0.1:4312",
    requestId: request.id,
    approval: { schemaVersion: 1, expectedPreviewDigest: "c".repeat(64) },
    idempotencyKey: "patch-approve:0123456789",
    fetcher,
  });
  await advanceLocalPatch({
    endpoint: "http://127.0.0.1:4312",
    requestId: request.id,
    action: "apply",
    idempotencyKey: "patch-apply:0123456789",
    fetcher,
  });
  assert.deepEqual(
    observed.map((entry) => entry.path),
    [
      `/api/v1/requests/${request.id}/patch-preview`,
      `/api/v1/requests/${request.id}/patch-approve`,
      `/api/v1/requests/${request.id}/patch-apply`,
    ]
  );
  assert.match(observed[0]?.body ?? "", /README\.md/);
});

test("request client targets bounded execution start and validation routes", async () => {
  const paths: string[] = [];
  for (const action of ["start", "validate"] as const) {
    const response = await advanceLocalExecution({
      endpoint: "http://127.0.0.1:4312",
      requestId: request.id,
      action,
      idempotencyKey: `execution-${action}:0123456789`,
      fetcher: async (url) => {
        paths.push(new URL(String(url)).pathname);
        return Response.json({
          schemaVersion: 1,
          outcome: action === "start" ? "execution_started" : "execution_validated",
          request,
        });
      },
    });
    assert.equal(response.request?.id, request.id);
  }
  assert.deepEqual(paths, [
    `/api/v1/requests/${request.id}/execution-start`,
    `/api/v1/requests/${request.id}/execution-validate`,
  ]);
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
