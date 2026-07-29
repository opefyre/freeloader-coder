import assert from "node:assert/strict";
import test from "node:test";

import {
  forgetLocalProject,
  listLocalProjects,
  registerLocalProject,
} from "../apps/studio/src/local-project-client.js";

const collection = {
  schemaVersion: 1,
  provenance: "local_observation",
  observedAt: 10_000,
  projects: [],
} as const;

test("browser client sends bounded loopback registration and validates responses", async () => {
  const observed: { url: string; init?: RequestInit }[] = [];
  const result = await registerLocalProject({
    endpoint: "http://127.0.0.1:4312",
    path: "/Users/example/Projects/app",
    idempotencyKey: "register:0123456789",
    fetcher: async (url, init) => {
      observed.push({ url: String(url), ...(init ? { init } : {}) });
      return Response.json({
        schemaVersion: 1,
        outcome: "registered",
        project: {
          schemaVersion: 1,
          id: "project_0123456789abcdef",
          displayName: "app",
          state: "warning",
          observedAt: 10_000,
          validForMs: 60_000,
          facts: [],
          inferences: [],
          decisions: [],
          warnings: ["Git status not evaluated."],
        },
      });
    },
  });
  assert.equal(result.outcome, "registered");
  assert.equal(observed[0]?.url, "http://127.0.0.1:4312/api/v1/projects");
  assert.equal(observed[0]?.init?.method, "POST");
  assert.equal(
    (observed[0]?.init?.headers as Record<string, string>)["Idempotency-Key"],
    "register:0123456789"
  );
});

test("browser client rejects remote endpoints, malformed data, and oversized data", async () => {
  await assert.rejects(() =>
    listLocalProjects({
      endpoint: "https://example.com",
      fetcher: async () => Response.json(collection),
    })
  );
  await assert.rejects(() =>
    listLocalProjects({
      endpoint: "http://127.0.0.1:4312",
      fetcher: async () => Response.json({ ...collection, privatePath: "/tmp/secret" }),
    })
  );
  await assert.rejects(() =>
    listLocalProjects({
      endpoint: "http://127.0.0.1:4312",
      fetcher: async () =>
        new Response("{}", {
          status: 200,
          headers: { "Content-Length": "131073" },
        }),
    })
  );
  await assert.rejects(() =>
    forgetLocalProject({
      endpoint: "http://127.0.0.1:4312",
      projectId: "invalid",
      fetcher: fetch,
    })
  );
});
