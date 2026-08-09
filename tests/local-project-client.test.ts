import assert from "node:assert/strict";
import test from "node:test";

import {
  addLocalProjectFiles,
  createLocalProject,
  forgetLocalProject,
  generateLocalProjectContext,
  getProjectLifecycle,
  getProjectEligibility,
  answerProjectClarifications,
  listLocalProjects,
  registerLocalProject,
} from "../apps/studio/src/local-project-client.js";

const collection = {
  schemaVersion: 1,
  provenance: "local_observation",
  observedAt: 10_000,
  projects: [],
} as const;

const lifecycle = {
  schemaVersion: 1 as const, projectId: "project_0123456789abcdef", stage: "clarification" as const, revision: 2,
  mission: "Build a portal.", assessment: null,
  questions: [{ id: "question_0123456789abcdef", prompt: "Who can sign up?", whyItMatters: "Identity changes.", options: [{ id: "invite", label: "Invite", consequence: "Admins invite." }, { id: "public", label: "Public", consequence: "Anyone registers." }], allowsCustomAnswer: false, sourceFindingIds: ["identity"] }],
  answers: [], artifacts: [], designApproval: null, jiraEpicId: null, blockedReason: null, updatedAt: 10_000,
};

test("browser client reads and answers selectable clarifications through loopback only", async () => {
  const read = await getProjectLifecycle({ endpoint: "http://127.0.0.1:4312", projectId: lifecycle.projectId, fetcher: async () => Response.json(lifecycle) });
  assert.equal(read.questions.length, 1);
  let body = "";
  const answered = await answerProjectClarifications({ endpoint: "http://127.0.0.1:4312", projectId: lifecycle.projectId, expectedRevision: 2, answers: [{ questionId: "question_0123456789abcdef", optionId: "invite", customAnswer: null, answeredAt: 11_000 }], idempotencyKey: "clarifications:0123456789", fetcher: async (_url, init) => { body = String(init?.body); return Response.json({ ...lifecycle, stage: "context_review", revision: 3, questions: [], answers: [{ questionId: "question_0123456789abcdef", optionId: "invite", customAnswer: null, answeredAt: 11_000 }] }); } });
  assert.equal(answered.answers[0]?.optionId, "invite");
  assert.match(body, /"expectedRevision":2/);
});

test("browser client validates the owner-facing eligibility result", async () => {
  const decision = await getProjectEligibility({ endpoint: "http://127.0.0.1:4312", projectId: lifecycle.projectId, fetcher: async () => Response.json({ schemaVersion: 1, projectId: lifecycle.projectId, requestId: "request_0123456789abcdef0123", eligible: false, assessment: { classification: "small_change", rationale: ["The request is bounded."], affectedDomains: ["frontend"], estimatedDeveloperHours: 1, requiresArchitectureDecision: false, confidence: 0.98 }, evidence: ["One isolated change."], alternatives: ["Handle this as a normal coding task outside the autonomous product lifecycle."], override: null, decidedAt: 10_000 }) });
  assert.equal(decision.eligible, false);
  assert.equal(decision.assessment.classification, "small_change");
});

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

test("browser client requests digest-bound context generation on loopback", async () => {
  let observedUrl = "";
  const result = await generateLocalProjectContext({
    endpoint: "http://127.0.0.1:4312",
    projectId: "project_0123456789abcdef",
    outcome: "Build the complete product",
    idempotencyKey: "context:0123456789",
    fetcher: async (url) => {
      observedUrl = String(url);
      return Response.json({ schemaVersion: 1, projectId: "project_0123456789abcdef", path: "CONTEXT.md", digest: "a".repeat(64), groundingDigest: "b".repeat(64), topologyDigest: "c".repeat(64), observedAt: 10_000, citations: [{ path: "README.md", digest: "d".repeat(64) }] });
    },
  });
  assert.equal(observedUrl, "http://127.0.0.1:4312/api/v1/projects/project_0123456789abcdef/context");
  assert.equal(result.path, "CONTEXT.md");
});

test("browser client creates a private project from a product idea", async () => {
  let observedBody = "";
  const result = await createLocalProject({
    endpoint: "http://127.0.0.1:4312",
    idea: "Build a calm team planning app",
    workspacePath: "/Users/example/projects/calm-planner",
    idempotencyKey: "create:0123456789",
    fetcher: async (_url, init) => {
      observedBody = String(init?.body ?? "");
      return Response.json({
        schemaVersion: 1,
        outcome: "created",
        project: {
          schemaVersion: 1,
          id: "project_0123456789abcdef",
          displayName: "Build a calm team planning app",
          workspaceLabel: "calm-planner",
          lifecycleStage: "intake",
          resources: [],
          latestUpdate: null,
          progress: null,
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
  assert.equal(result.outcome, "created");
  assert.match(observedBody, /"workspacePath":"\/Users\/example\/projects\/calm-planner"/);
  assert.match(observedBody, /calm team planning app/);
  assert.doesNotMatch(observedBody, /path/);
});

test("browser client imports picker-selected files into a project", async () => {
  let observedBody = "";
  const result = await addLocalProjectFiles({
    endpoint: "http://127.0.0.1:4312",
    projectId: "project_0123456789abcdef",
    paths: ["/Users/example/brief.pdf"],
    idempotencyKey: "files:0123456789",
    fetcher: async (_url, init) => {
      observedBody = String(init?.body ?? "");
      return Response.json({ schemaVersion: 1, outcome: "imported", files: [{ label: "brief.pdf", projectRelativePath: ".pipeline/inputs/brief-01234567.pdf", bytes: 42 }] });
    },
  });
  assert.equal(result.files[0]?.label, "brief.pdf");
  assert.match(observedBody, /brief\.pdf/);
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
