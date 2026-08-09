import assert from "node:assert/strict";
import test from "node:test";

import {
  addLocalProjectFiles,
  createLocalProject,
  forgetLocalProject,
  generateLocalProjectContext,
  getProjectLifecycle,
  getProjectEligibility,
  getProjectSolution,
  decideProjectSolution,
  answerProjectClarifications,
  generateProjectSolution,
  getProjectProviderConsent,
  getProjectSolutionRun,
  generateProjectBacklog,
  getProjectBacklog,
  getProjectBacklogRun,
  getProjectExecution,
  grantProjectProviderConsent,
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

test("browser client reads and decides an exact solution artifact", async () => {
  const document = { schemaVersion: 1 as const, projectId: lifecycle.projectId, projectRelativePath: ".pipeline/SOLUTION.md" as const, revision: 1, digest: "b".repeat(64), markdown: "# Complete solution\n\nReviewed content." };
  const read = await getProjectSolution({ endpoint: "http://127.0.0.1:4312", projectId: lifecycle.projectId, fetcher: async () => Response.json(document) });
  assert.equal(read.digest, document.digest);
  let body = "";
  await decideProjectSolution({ endpoint: "http://127.0.0.1:4312", projectId: lifecycle.projectId, expectedRevision: 2, artifactDigest: document.digest, decision: "revision_requested", feedback: "Clarify the rollout.", idempotencyKey: "solution:decision:012345", fetcher: async (_url, init) => { body = String(init?.body); return Response.json({ ...lifecycle, stage: "solution_design", revision: 3, designFeedback: [{ artifactDigest: document.digest, feedback: "Clarify the rollout.", requestedAt: 11_000 }] }); } });
  assert.match(body, /revision_requested/);
  assert.match(body, /Clarify the rollout/);
});

test("browser client binds provider consent and solution generation to exact loopback routes", async () => {
  const projectId = lifecycle.projectId;
  const permit = { schemaVersion: 1 as const, projectId, contextDigest: "c".repeat(64), dataClass: "non_personal_test" as const, providerIds: ["groq"], approvedAt: 10_000, expiresAt: 20_000 };
  const run = { schemaVersion: 1 as const, projectId, state: "queued" as const, attempts: 0, retryAt: null, safeMessage: "Solution research is queued.", updatedAt: 10_000 };
  const calls: Array<{ url: string; method?: string; key?: string; body?: string }> = [];
  const fetcher: typeof fetch = async (url, init) => {
    const method = init?.method;
    const key = (init?.headers as Record<string, string> | undefined)?.["Idempotency-Key"];
    calls.push({ url: String(url), ...(method ? { method } : {}), ...(key ? { key } : {}), body: String(init?.body ?? "") });
    if (String(url).endsWith("/solution-generate")) return Response.json(run);
    if (String(url).endsWith("/solution-run")) return Response.json(run);
    return Response.json(permit);
  };
  assert.deepEqual(await getProjectProviderConsent({ endpoint: "http://127.0.0.1:4312", projectId, fetcher }), permit);
  assert.deepEqual(await grantProjectProviderConsent({ endpoint: "http://127.0.0.1:4312", projectId, contextDigest: permit.contextDigest, dataClass: permit.dataClass, providerIds: permit.providerIds, expiresAt: permit.expiresAt, idempotencyKey: "consent:0123456789", fetcher }), permit);
  assert.deepEqual(await generateProjectSolution({ endpoint: "http://127.0.0.1:4312", projectId, idempotencyKey: "generate:0123456789", fetcher }), run);
  assert.deepEqual(await getProjectSolutionRun({ endpoint: "http://127.0.0.1:4312", projectId, fetcher }), run);
  assert.deepEqual(calls.map((call) => new URL(call.url).pathname), [`/api/v1/projects/${projectId}/provider-consent`, `/api/v1/projects/${projectId}/provider-consent`, `/api/v1/projects/${projectId}/solution-generate`, `/api/v1/projects/${projectId}/solution-run`]);
  assert.match(calls[1]?.body ?? "", /selected free providers/);
  assert.equal(calls[2]?.key, "generate:0123456789");
});

test("browser client binds delivery planning to exact loopback routes", async () => {
  const projectId = lifecycle.projectId;
  const run = { schemaVersion: 1 as const, projectId, state: "queued" as const, attempts: 0, retryAt: null, safeMessage: "Delivery planning is queued.", updatedAt: 10_000 };
  const backlog = { schemaVersion: 1 as const, projectId, projectRelativePath: ".pipeline/BACKLOG.md" as const, revision: 1, digest: "c".repeat(64), markdown: "# Delivery plan\n\nReviewed content.", itemCount: 4 };
  const calls: Array<{ url: string; key?: string }> = [];
  const fetcher: typeof fetch = async (url, init) => {
    const key = (init?.headers as Record<string, string> | undefined)?.["Idempotency-Key"];
    calls.push({ url: String(url), ...(key ? { key } : {}) });
    return Response.json(String(url).endsWith("/backlog") ? backlog : run);
  };
  assert.deepEqual(await generateProjectBacklog({ endpoint: "http://127.0.0.1:4312", projectId, idempotencyKey: "backlog:0123456789", fetcher }), run);
  assert.deepEqual(await getProjectBacklogRun({ endpoint: "http://127.0.0.1:4312", projectId, fetcher }), run);
  assert.deepEqual(await getProjectBacklog({ endpoint: "http://127.0.0.1:4312", projectId, fetcher }), backlog);
  assert.deepEqual(calls.map((call) => new URL(call.url).pathname), [`/api/v1/projects/${projectId}/backlog-generate`, `/api/v1/projects/${projectId}/backlog-run`, `/api/v1/projects/${projectId}/backlog`]);
  assert.equal(calls[0]?.key, "backlog:0123456789");
});

test("browser client reads durable project execution from the exact loopback route", async () => {
  const projectId = lifecycle.projectId;
  const execution = { schemaVersion: 1 as const, projectId, planDigest: "d".repeat(64), state: "running" as const, revision: 0, tasks: [{ id: "plan_0000000000000004", jiraIssueKey: "PIPE-4", title: "Implement bounded work", dependsOn: [], uiChanged: false, requiredCapabilities: ["chat"], privacyClass: "source_code" as const, status: "queued" as const, revision: 0, attempt: 0, assignment: null, lease: null, implementationEvidence: [], validations: [], reviews: [], commitDigest: null, integrationDigest: null, failureClass: null, safeMessage: "Queued.", updatedAt: 1 }], updatedAt: 1 };
  let observed = "";
  assert.deepEqual(await getProjectExecution({ endpoint: "http://127.0.0.1:4312", projectId, fetcher: async (url) => { observed = String(url); return Response.json(execution); } }), execution);
  assert.equal(new URL(observed).pathname, `/api/v1/projects/${projectId}/execution`);
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
  let observedBody = "";
  const result = await generateLocalProjectContext({
    endpoint: "http://127.0.0.1:4312",
    projectId: "project_0123456789abcdef",
    outcome: "Build the complete product",
    requestId: "request_0123456789abcdef0123",
    projectKind: "new_product",
    idempotencyKey: "context:0123456789",
    fetcher: async (url, init) => {
      observedUrl = String(url);
      observedBody = String(init?.body ?? "");
      return Response.json({ schemaVersion: 1, projectId: "project_0123456789abcdef", path: "CONTEXT.md", digest: "a".repeat(64), groundingDigest: "b".repeat(64), topologyDigest: "c".repeat(64), observedAt: 10_000, citations: [{ path: "README.md", digest: "d".repeat(64) }] });
    },
  });
  assert.equal(observedUrl, "http://127.0.0.1:4312/api/v1/projects/project_0123456789abcdef/context");
  assert.equal(result.path, "CONTEXT.md");
  assert.match(observedBody, /"requestId":"request_0123456789abcdef0123"/);
  assert.match(observedBody, /"projectKind":"new_product"/);
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
