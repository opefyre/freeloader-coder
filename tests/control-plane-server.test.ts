import assert from "node:assert/strict";
import { request } from "node:http";
import test from "node:test";

import { createControlPlaneServer } from "../apps/core/src/control-plane.js";
import { assessEligibility } from "../packages/orchestration/src/eligibility-gate.js";
import { advanceProjectLifecycle, createProjectLifecycle } from "../packages/orchestration/src/project-lifecycle.js";
import type {
  ControlPlaneHealth,
  ControlPlaneSnapshot,
} from "../packages/runtime/src/control-plane.js";

const instanceId = "0f86b913-7600-4c6f-a102-2fc6e4250c6f";
const observedAt = 10_000;
const health: ControlPlaneHealth = {
  schemaVersion: 1,
  instanceId,
  status: "ready",
  observedAt,
  uptimeSeconds: 5,
};
const snapshot: ControlPlaneSnapshot = {
  schemaVersion: 1,
  instanceId,
  provenance: "local_observation",
  featureDataMode: "synthetic_fixture",
  observedAt,
  validForMs: 15_000,
  setup: { state: "ready", requiredChecksReady: 6, requiredChecksTotal: 6 },
  services: [
    {
      id: "control_plane",
      state: "available",
      required: true,
      observedAt,
    },
  ],
};

const eligibility = assessEligibility({
  projectId: "project_0123456789abcdef",
  requestId: "request_0123456789abcdef0123",
  projectKind: "new_product",
  affectedDomains: ["frontend", "backend"],
  deliveryStages: ["product", "frontend", "backend", "qa"],
  estimatedDeveloperHours: 80,
  requiresArchitectureDecision: true,
  evidence: ["The request is a multi-stage product build."],
  confidence: 0.95,
}, 4);

test("clarification endpoints are origin-bound, revision-bound, and idempotent", async () => {
  const projectId = "project_0123456789abcdef";
  let lifecycle = advanceProjectLifecycle(createProjectLifecycle({ projectId, mission: "Build a portal.", now: 1 }), { type: "begin_context_review" }, 2);
  lifecycle = advanceProjectLifecycle(lifecycle, {
    type: "context_completed",
    artifact: { kind: "context", projectRelativePath: ".pipeline/CONTEXT.md", digest: "a".repeat(64), revision: 1, createdAt: 3, citations: ["local://README.md"], reviewerIds: ["reviewer"], qaPassed: true },
    questions: [{ id: "question_0123456789abcdef", prompt: "Who can sign up?", whyItMatters: "Identity architecture changes.", options: [{ id: "invite", label: "Invite", consequence: "Admins invite." }, { id: "public", label: "Public", consequence: "Anyone registers." }], allowsCustomAnswer: false, sourceFindingIds: ["identity"] }],
  }, 3);
  const calls: string[] = [];
  const eligibilityCalls: string[] = [];
  const solutionCalls: string[] = [];
  const consentCalls: string[] = [];
  const permit = { schemaVersion: 1 as const, projectId, contextDigest: "a".repeat(64), dataClass: "source_code" as const, providerIds: ["groq"], approvedAt: 4, expiresAt: 9_999_999_999_999 };
  const solutionRun = { schemaVersion: 1 as const, projectId, state: "queued" as const, attempts: 0, retryAt: null, safeMessage: "Solution research is queued.", updatedAt: 4 };
  const backlogRun = { schemaVersion: 1 as const, projectId, state: "queued" as const, attempts: 0, retryAt: null, safeMessage: "Delivery planning is queued.", updatedAt: 4 };
  const backlog = { schemaVersion: 1 as const, projectId, projectRelativePath: ".pipeline/BACKLOG.md" as const, revision: 1, digest: "c".repeat(64), markdown: "# Delivery plan\n\nReviewed content.", itemCount: 4 };
  const execution = { schemaVersion: 1 as const, projectId, planDigest: "c".repeat(64), state: "running" as const, revision: 0, tasks: [{ id: "plan_0000000000000004", jiraIssueKey: "PIPE-4", title: "Implement bounded work", dependsOn: [], allowedFiles: ["src/work.ts"], validationProfiles: ["unit" as const], uiChanged: false, requiredCapabilities: ["chat"], privacyClass: "source_code" as const, status: "queued" as const, revision: 0, attempt: 0, assignment: null, lease: null, implementationEvidence: [], validations: [], reviews: [], commitDigest: null, integrationDigest: null, failureClass: null, safeMessage: "Queued.", updatedAt: 4 }], updatedAt: 4 };
  const server = createControlPlaneServer({
    host: "127.0.0.1", port: 0, allowedOrigins: ["http://127.0.0.1:4310"], health: () => health, snapshot: () => snapshot,
    projectLifecycles: {
      get: () => lifecycle,
      answer: (_projectId, input, key) => { calls.push(`${key}:${JSON.stringify(input)}`); return { ...lifecycle, stage: "context_review", questions: [], revision: lifecycle.revision + 1 }; },
      eligibility: () => eligibility,
      assess: (_projectId, input, key) => {
        eligibilityCalls.push(`${key}:${JSON.stringify(input)}`);
        return { lifecycle: { ...lifecycle, stage: "solution_design", assessment: eligibility.assessment, questions: [], revision: lifecycle.revision + 1 }, decision: eligibility };
      },
      publishSolution: (_projectId, input) => { solutionCalls.push(`publish:${JSON.stringify(input)}`); return lifecycle; },
      getSolution: () => ({ schemaVersion: 1, projectId, projectRelativePath: ".pipeline/SOLUTION.md", revision: 1, digest: "b".repeat(64), markdown: "# Complete solution\n\nReviewed content." }),
      getSolutionHistory: () => [{ schemaVersion: 1, projectId, projectRelativePath: ".pipeline/SOLUTION.md", revision: 1, digest: "b".repeat(64), markdown: "# Complete solution\n\nReviewed content." }],
      decideSolution: (_projectId, input, key) => { solutionCalls.push(`${key}:${JSON.stringify(input)}`); return lifecycle; },
      solutionRun: () => solutionRun,
      generateSolution: () => solutionRun,
      getBacklog: () => backlog,
      backlogRun: () => backlogRun,
      generateBacklog: () => backlogRun,
      getExecution: () => execution,
      getEgressConsent: () => permit,
      grantEgressConsent: (_projectId, input) => { consentCalls.push(JSON.stringify(input)); return permit; },
      revokeEgressConsent: () => { consentCalls.push("revoked"); },
    },
  });
  const port = await server.listen();
  const endpoint = `http://127.0.0.1:${port}/api/v1/projects/${projectId}`;
  try {
    const read = await fetch(`${endpoint}/lifecycle`, { headers: { Origin: "http://127.0.0.1:4310" } });
    assert.equal(read.status, 200);
    assert.equal((await read.json() as { stage: string }).stage, "clarification");
    const denied = await fetch(`${endpoint}/lifecycle`, { headers: { Origin: "https://example.com" } });
    assert.equal(denied.status, 403);
    const missingKey = await fetch(`${endpoint}/clarifications`, { method: "POST", headers: { Origin: "http://127.0.0.1:4310", "Content-Type": "application/json" }, body: JSON.stringify({ schemaVersion: 1, expectedRevision: lifecycle.revision, answers: [] }) });
    assert.equal(missingKey.status, 400);
    const answered = await fetch(`${endpoint}/clarifications`, { method: "POST", headers: { Origin: "http://127.0.0.1:4310", "Content-Type": "application/json", "Idempotency-Key": "clarification-answer-001" }, body: JSON.stringify({ schemaVersion: 1, expectedRevision: lifecycle.revision, answers: [{ questionId: "question_0123456789abcdef", optionId: "invite", customAnswer: null, answeredAt: 4 }] }) });
    assert.equal(answered.status, 200);
    assert.equal(calls.length, 1);
    const eligibilityRead = await fetch(`${endpoint}/eligibility`, { headers: { Origin: "http://127.0.0.1:4310" } });
    assert.equal(eligibilityRead.status, 200);
    assert.equal((await eligibilityRead.json() as { eligible: boolean }).eligible, true);
    const assessed = await fetch(`${endpoint}/eligibility`, {
      method: "POST",
      headers: { Origin: "http://127.0.0.1:4310", "Content-Type": "application/json", "Idempotency-Key": "eligibility-assessment-001" },
      body: JSON.stringify({ schemaVersion: 1, expectedRevision: lifecycle.revision, requestId: eligibility.requestId, projectKind: "new_product", affectedDomains: ["frontend", "backend"], deliveryStages: ["product", "frontend", "backend", "qa"], estimatedDeveloperHours: 80, requiresArchitectureDecision: true, evidence: ["The request is a multi-stage product build."], confidence: 0.95 }),
    });
    assert.equal(assessed.status, 200);
    assert.equal((await assessed.json() as { lifecycle: { stage: string } }).lifecycle.stage, "solution_design");
    assert.equal(eligibilityCalls.length, 1);
    const solutionArtifact = { kind: "solution", projectRelativePath: ".pipeline/SOLUTION.md", digest: "b".repeat(64), revision: 1, createdAt: 5, citations: ["local://CONTEXT.md"], reviewerIds: ["product-reviewer", "technical-reviewer"], qaPassed: true };
    const publishedSolution = await fetch(`${endpoint}/solution`, { method: "POST", headers: { Origin: "http://127.0.0.1:4310", "Content-Type": "application/json", "Idempotency-Key": "solution-publish-001" }, body: JSON.stringify(solutionArtifact) });
    assert.equal(publishedSolution.status, 200);
    const readSolution = await fetch(`${endpoint}/solution`, { headers: { Origin: "http://127.0.0.1:4310" } });
    assert.equal(readSolution.status, 200);
    assert.match((await readSolution.json() as { markdown: string }).markdown, /Complete solution/);
    const solutionHistory = await fetch(`${endpoint}/solution-history`, { headers: { Origin: "http://127.0.0.1:4310" } });
    assert.equal(solutionHistory.status, 200);
    assert.equal((await solutionHistory.json() as Array<{ revision: number }>)[0]?.revision, 1);
    const solutionDecision = await fetch(`${endpoint}/solution-decision`, { method: "POST", headers: { Origin: "http://127.0.0.1:4310", "Content-Type": "application/json", "Idempotency-Key": "solution-decision-001" }, body: JSON.stringify({ schemaVersion: 1, expectedRevision: lifecycle.revision, artifactDigest: solutionArtifact.digest, decision: "approved", feedback: null }) });
    assert.equal(solutionDecision.status, 200);
    assert.equal(solutionCalls.length, 2);
    const consentRead = await fetch(`${endpoint}/provider-consent`, { headers: { Origin: "http://127.0.0.1:4310" } });
    assert.equal(consentRead.status, 200);
    const consentGrant = await fetch(`${endpoint}/provider-consent`, { method: "POST", headers: { Origin: "http://127.0.0.1:4310", "Content-Type": "application/json", "Idempotency-Key": "provider-consent-001" }, body: JSON.stringify({ schemaVersion: 1, contextDigest: "a".repeat(64), dataClass: "source_code", providerIds: ["groq"], expiresAt: 9_999_999_999_999, acknowledgment: "I authorize this exact project context for the selected free providers." }) });
    assert.equal(consentGrant.status, 200);
    const generation = await fetch(`${endpoint}/solution-generate`, { method: "POST", headers: { Origin: "http://127.0.0.1:4310", "Idempotency-Key": "solution-generation-001" } });
    assert.equal(generation.status, 202);
    assert.equal((await generation.json() as { state: string }).state, "queued");
    const runRead = await fetch(`${endpoint}/solution-run`, { headers: { Origin: "http://127.0.0.1:4310" } });
    assert.equal(runRead.status, 200);
    const missingBacklogKey = await fetch(`${endpoint}/backlog-generate`, { method: "POST", headers: { Origin: "http://127.0.0.1:4310" } });
    assert.equal(missingBacklogKey.status, 400);
    const backlogGeneration = await fetch(`${endpoint}/backlog-generate`, { method: "POST", headers: { Origin: "http://127.0.0.1:4310", "Idempotency-Key": "backlog-generation-001" } });
    assert.equal(backlogGeneration.status, 202);
    assert.equal((await backlogGeneration.json() as { state: string }).state, "queued");
    const backlogRunRead = await fetch(`${endpoint}/backlog-run`, { headers: { Origin: "http://127.0.0.1:4310" } });
    assert.equal(backlogRunRead.status, 200);
    const backlogRead = await fetch(`${endpoint}/backlog`, { headers: { Origin: "http://127.0.0.1:4310" } });
    assert.equal(backlogRead.status, 200);
    assert.equal((await backlogRead.json() as { itemCount: number }).itemCount, 4);
    const executionRead = await fetch(`${endpoint}/execution`, { headers: { Origin: "http://127.0.0.1:4310" } });
    assert.equal(executionRead.status, 200);
    assert.equal((await executionRead.json() as { tasks: unknown[] }).tasks.length, 1);
    const revoked = await fetch(`${endpoint}/provider-consent`, { method: "DELETE", headers: { Origin: "http://127.0.0.1:4310", "Idempotency-Key": "provider-consent-revoke-001" } });
    assert.equal(revoked.status, 200);
    assert.equal(consentCalls.length, 2);
  } finally { await server.close(); }
});

test("loopback server exposes only validated read-only health and snapshot data", async () => {
  const controlPlane = createControlPlaneServer({
    host: "127.0.0.1",
    port: 0,
    allowedOrigins: ["http://127.0.0.1:4310"],
    health: () => health,
    snapshot: () => snapshot,
  });
  const port = await controlPlane.listen();
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/v1/snapshot`, {
      headers: { Origin: "http://127.0.0.1:4310" },
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(response.headers.get("access-control-allow-origin"), "http://127.0.0.1:4310");
    assert.deepEqual(await response.json(), snapshot);

    const healthResponse = await fetch(`http://127.0.0.1:${port}/api/v1/health`);
    assert.equal(healthResponse.status, 200);
    assert.deepEqual(await healthResponse.json(), health);
  } finally {
    await controlPlane.close();
  }
});

test("server rejects foreign origins, writes, bodies, and unknown endpoints", async () => {
  const controlPlane = createControlPlaneServer({
    host: "127.0.0.1",
    port: 0,
    allowedOrigins: ["http://127.0.0.1:4310"],
    health: () => health,
    snapshot: () => snapshot,
  });
  const port = await controlPlane.listen();
  const base = `http://127.0.0.1:${port}`;
  try {
    assert.equal(
      (
        await fetch(`${base}/api/v1/snapshot`, {
          headers: { Origin: "https://example.com" },
        })
      ).status,
      403
    );
    assert.equal(
      (await fetch(`${base}/api/v1/snapshot`, { method: "POST" })).status,
      405
    );
    assert.equal(await rawStatus(`${base}/api/v1/snapshot`, { "Content-Length": "1" }), 413);
    assert.equal((await fetch(`${base}/api/v1/unknown`)).status, 404);
  } finally {
    await controlPlane.close();
  }
});

function rawStatus(url: string, headers: Record<string, string>): Promise<number> {
  return new Promise((resolvePromise, reject) => {
    const outgoing = request(url, { method: "GET", headers }, (response) => {
      response.resume();
      response.once("end", () => resolvePromise(response.statusCode ?? 0));
    });
    outgoing.once("error", reject);
    outgoing.end();
  });
}

test("server refuses wildcard hosts and non-loopback allowed origins", () => {
  assert.throws(() =>
    createControlPlaneServer({
      host: "0.0.0.0" as "127.0.0.1",
      port: 4_312,
      allowedOrigins: ["http://127.0.0.1:4310"],
      health: () => health,
      snapshot: () => snapshot,
    })
  );
  assert.throws(() =>
    createControlPlaneServer({
      host: "127.0.0.1",
      port: 4_312,
      allowedOrigins: ["https://example.com"],
      health: () => health,
      snapshot: () => snapshot,
    })
  );
});

test("project endpoints require origin, schema, idempotency, and bounded semantics", async () => {
  const project = {
    schemaVersion: 1 as const,
    id: "project_0123456789abcdef",
    displayName: "Sample",
    workspaceLabel: "sample",
    lifecycleStage: "intake" as const,
    resources: [],
    latestUpdate: null,
    progress: null,
    state: "warning" as const,
    observedAt,
    validForMs: 60_000,
    facts: [],
    inferences: [],
    decisions: [],
    warnings: ["Git status was not evaluated."],
  };
  const calls: string[] = [];
  const controlPlane = createControlPlaneServer({
    host: "127.0.0.1",
    port: 0,
    allowedOrigins: ["http://127.0.0.1:4310"],
    health: () => health,
    snapshot: () => snapshot,
    projects: {
      list: () => ({
        schemaVersion: 1,
        provenance: "local_observation",
        observedAt,
        projects: [project],
      }),
      register: (input) => {
        calls.push(`register:${JSON.stringify(input)}`);
        return project;
      },
      create: (input, idempotencyKey) => {
        calls.push(`create:${idempotencyKey}:${JSON.stringify(input)}`);
        return project;
      },
      rescan: (projectId) => {
        calls.push(`rescan:${projectId}`);
        return project;
      },
      setResources: (projectId, input) => {
        calls.push(`resources:${projectId}:${JSON.stringify(input)}`);
        return project;
      },
      addFiles: (projectId, input) => {
        calls.push(`files:${projectId}:${JSON.stringify(input)}`);
        return { schemaVersion: 1, outcome: "imported", files: [{ label: "brief.pdf", projectRelativePath: ".pipeline/inputs/brief-01234567.pdf", bytes: 42 }] };
      },
      generateContext: (projectId, input) => {
        calls.push(`context:${projectId}:${JSON.stringify(input)}`);
        return { schemaVersion: 1, projectId, path: "CONTEXT.md", digest: "a".repeat(64), groundingDigest: "b".repeat(64), topologyDigest: "c".repeat(64), observedAt, citations: [{ path: "README.md", digest: "d".repeat(64) }] };
      },
      forget: (projectId) => {
        calls.push(`forget:${projectId}`);
      },
    },
  });
  const port = await controlPlane.listen();
  const base = `http://127.0.0.1:${port}`;
  const origin = "http://127.0.0.1:4310";
  try {
    const list = await fetch(`${base}/api/v1/projects`, {
      headers: { Origin: origin },
    });
    assert.equal(list.status, 200);
    assert.equal((await list.json() as { projects: unknown[] }).projects.length, 1);

    const missingKey = await fetch(`${base}/api/v1/projects`, {
      method: "POST",
      headers: { Origin: origin, "Content-Type": "application/json" },
      body: JSON.stringify({ schemaVersion: 1, path: "/tmp/project" }),
    });
    assert.equal(missingKey.status, 400);
    assert.deepEqual(await missingKey.json(), {
      error: "A valid idempotency key is required.",
    });

    const register = await fetch(`${base}/api/v1/projects`, {
      method: "POST",
      headers: {
        Origin: origin,
        "Content-Type": "application/json",
        "Idempotency-Key": "register:0123456789",
      },
      body: JSON.stringify({ schemaVersion: 1, path: "/tmp/project" }),
    });
    assert.equal(register.status, 200);

    const create = await fetch(`${base}/api/v1/projects/new`, {
      method: "POST",
      headers: {
        Origin: origin,
        "Content-Type": "application/json",
        "Idempotency-Key": "create:0123456789",
      },
      body: JSON.stringify({ schemaVersion: 1, idea: "Build a garden planner", workspacePath: "/Users/example/projects/garden-planner" }),
    });
    assert.equal(create.status, 200);
    const resources = await fetch(`${base}/api/v1/projects/${project.id}/resources`, {
      method: "PUT",
      headers: { Origin: origin, "Content-Type": "application/json", "Idempotency-Key": "resources:0123456789" },
      body: JSON.stringify({
        schemaVersion: 1,
        resources: [{
          kind: "jira_project",
          connectionId: "jira-main",
          resourceId: "10000",
          label: "PIPE",
          url: "https://example.atlassian.net/jira/software/projects/PIPE",
          role: "primary",
        }],
      }),
    });
    assert.equal(resources.status, 200);
    const files = await fetch(`${base}/api/v1/projects/${project.id}/files`, {
      method: "POST",
      headers: { Origin: origin, "Content-Type": "application/json", "Idempotency-Key": "files:0123456789" },
      body: JSON.stringify({ schemaVersion: 1, paths: ["/Users/example/brief.pdf"] }),
    });
    assert.equal(files.status, 200);
    const context = await fetch(`${base}/api/v1/projects/${project.id}/context`, {
      method: "POST",
      headers: { Origin: origin, "Content-Type": "application/json", "Idempotency-Key": "context:0123456789" },
      body: JSON.stringify({ schemaVersion: 1, outcome: "Build the complete product" }),
    });
    assert.equal(context.status, 200);
    assert.equal((await context.json() as { path: string }).path, "CONTEXT.md");
    assert.equal((await create.json() as { outcome: string }).outcome, "created");

    const rescan = await fetch(
      `${base}/api/v1/projects/project_0123456789abcdef/rescan`,
      { method: "POST", headers: { Origin: origin } }
    );
    assert.equal(rescan.status, 200);

    const forget = await fetch(
      `${base}/api/v1/projects/project_0123456789abcdef/registration`,
      { method: "DELETE", headers: { Origin: origin } }
    );
    assert.equal(forget.status, 200);
    assert.equal(calls.length, 7);

    assert.equal(
      (
        await fetch(`${base}/api/v1/projects`, {
          headers: { Origin: "https://example.com" },
        })
      ).status,
      403
    );
  } finally {
    await controlPlane.close();
  }
});

test("native picker endpoints expose only validated local selections", async () => {
  const controlPlane = createControlPlaneServer({
    host: "127.0.0.1", port: 0,
    allowedOrigins: ["http://127.0.0.1:4310"],
    health: () => health, snapshot: () => snapshot,
    nativePicker: {
      folder: () => ({ schemaVersion: 1, outcome: "selected", selections: [{ path: "/Users/example/project", label: "project" }] }),
      files: () => ({ schemaVersion: 1, outcome: "cancelled", selections: [] }),
    },
  });
  const port = await controlPlane.listen();
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/v1/system/pick-folder`, { method: "POST", headers: { Origin: "http://127.0.0.1:4310" } });
    assert.equal(response.status, 200);
    assert.equal((await response.json() as { selections: unknown[] }).selections.length, 1);
  } finally {
    await controlPlane.close();
  }
});

test("integration discovery is local, read-only by default, and explicit when probing", async () => {
  let probes = 0;
  let jiraConnections = 0;
  const collection = { schemaVersion: 1 as const, provenance: "local_observation" as const, observedAt, connections: [{ schemaVersion: 1 as const, provider: "github" as const, state: "ready" as const, accountLabel: "owner", authMethod: "github_device_oauth" as const, observedAt, resources: [], nextAction: "Choose repositories inside a project." }] };
  const controlPlane = createControlPlaneServer({ host: "127.0.0.1", port: 0, allowedOrigins: ["http://127.0.0.1:4310"], health: () => health, snapshot: () => snapshot, integrationConnections: { list: () => collection, probeGitHub: () => { probes += 1; return collection; }, connectJira: () => { jiraConnections += 1; return collection; }, disconnectJira: () => collection } });
  const port = await controlPlane.listen();
  const base = `http://127.0.0.1:${port}`;
  try {
    assert.equal((await fetch(`${base}/api/v1/integration-connections`)).status, 200);
    assert.equal(probes, 0);
    assert.equal((await fetch(`${base}/api/v1/integration-connections/github/probe`, { method: "POST" })).status, 400);
    const response = await fetch(`${base}/api/v1/integration-connections/github/probe`, { method: "POST", headers: { Origin: "http://127.0.0.1:4310", "Idempotency-Key": "github-probe:123456789" } });
    assert.equal(response.status, 200);
    assert.equal(probes, 1);
    assert.equal((await fetch(`${base}/api/v1/integration-connections/jira`, { method: "POST", headers: { Origin: "http://127.0.0.1:4310", "Content-Type": "application/json" }, body: "{}" })).status, 400);
    assert.equal((await fetch(`${base}/api/v1/integration-connections/jira`, { method: "POST", headers: { Origin: "http://127.0.0.1:4310", "Content-Type": "application/json", "Idempotency-Key": "jira-connect:123456789" }, body: "{}" })).status, 200);
    assert.equal(jiraConnections, 1);
  } finally { await controlPlane.close(); }
});

test("project listing remains available when project creation is not configured", async () => {
  const controlPlane = createControlPlaneServer({
    host: "127.0.0.1",
    port: 0,
    allowedOrigins: ["http://127.0.0.1:4310"],
    health: () => health,
    snapshot: () => snapshot,
    projects: {
      list: () => ({
        schemaVersion: 1,
        provenance: "local_observation",
        observedAt,
        projects: [],
      }),
      register: () => { throw new Error("not used"); },
      rescan: () => { throw new Error("not used"); },
      forget: () => { throw new Error("not used"); },
    },
  });
  const port = await controlPlane.listen();
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/v1/projects`, {
      headers: { Origin: "http://127.0.0.1:4310" },
    });
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json() as { projects: unknown[] }).projects, []);
  } finally {
    await controlPlane.close();
  }
});

test("request endpoints expose only durable queue metadata with guarded mutations", async () => {
  const queued = {
    schemaVersion: 1 as const,
    id: "request_0123456789abcdef0123",
    projectId: "project_0123456789abcdef",
    outcome: "Build request intake.",
    readiness: "ready" as const,
    state: "queued" as const,
    provenance: "local_request" as const,
    createdAt: observedAt,
    updatedAt: observedAt,
    findings: [],
    workPreview: {
      provenance: "deterministic_local_preview" as const,
      title: "Build request intake.",
      outcome: "Build request intake.",
      assumptions: [],
      exclusions: ["No provider selected."],
      checks: ["Run tests"],
      estimatedMinutes: 45,
    },
    run: null,
  };
  const calls: string[] = [];
  const controlPlane = createControlPlaneServer({
    host: "127.0.0.1",
    port: 0,
    allowedOrigins: ["http://127.0.0.1:4310"],
    health: () => health,
    snapshot: () => snapshot,
    requests: {
      list: () => ({
        schemaVersion: 1,
        provenance: "local_observation",
        observedAt,
        requests: [queued],
      }),
      create: (input, key) => {
        calls.push(`create:${key}:${JSON.stringify(input)}`);
        return queued;
      },
      cancel: (id) => {
        calls.push(`cancel:${id}`);
        return { ...queued, state: "cancelled" as const };
      },
      approve: (id) => {
        calls.push(`approve:${id}`);
        return queued;
      },
      updatePlan: (id, input) => {
        calls.push(`plan-edit:${id}:${JSON.stringify(input)}`);
        return queued;
      },
      approvePlan: (id, input) => {
        calls.push(`plan-approve:${id}:${JSON.stringify(input)}`);
        return queued;
      },
      archive: (id) => {
        calls.push(`archive:${id}`);
      },
    },
  });
  const port = await controlPlane.listen();
  const base = `http://127.0.0.1:${port}`;
  const headers = { Origin: "http://127.0.0.1:4310" };
  try {
    assert.equal((await fetch(`${base}/api/v1/requests`, { headers })).status, 200);
    assert.equal(
      (
        await fetch(`${base}/api/v1/requests/${queued.id}/approve`, {
          method: "POST",
          headers: { ...headers, "Idempotency-Key": "approve:01234567" },
        })
      ).status,
      200
    );
    assert.equal(
      (
        await fetch(`${base}/api/v1/requests/${queued.id}/plan-edit`, {
          method: "POST",
          headers: {
            ...headers,
            "Content-Type": "application/json",
            "Idempotency-Key": "plan-edit:01234567",
          },
          body: JSON.stringify({
            schemaVersion: 1,
            type: "edit_task",
            expectedRevision: 1,
            taskId: "task_0123456789ab",
            title: "Review the real plan",
            estimatedMinutes: 45,
          }),
        })
      ).status,
      200
    );
    assert.equal(
      (
        await fetch(`${base}/api/v1/requests/${queued.id}/plan-approve`, {
          method: "POST",
          headers: {
            ...headers,
            "Content-Type": "application/json",
            "Idempotency-Key": "plan-approve:01234567",
          },
          body: JSON.stringify({ schemaVersion: 1, expectedRevision: 1 }),
        })
      ).status,
      200
    );
    assert.equal(
      (
        await fetch(`${base}/api/v1/requests`, {
          method: "POST",
          headers: { ...headers, "Content-Type": "application/json" },
          body: JSON.stringify({
            schemaVersion: 1,
            projectId: queued.projectId,
            outcome: queued.outcome,
          }),
        })
      ).status,
      400
    );
    assert.equal(
      (
        await fetch(`${base}/api/v1/requests`, {
          method: "POST",
          headers: {
            ...headers,
            "Content-Type": "application/json",
            "Idempotency-Key": "request:0123456789",
          },
          body: JSON.stringify({
            schemaVersion: 1,
            projectId: queued.projectId,
            outcome: queued.outcome,
          }),
        })
      ).status,
      200
    );
    assert.equal(
      (
        await fetch(`${base}/api/v1/requests/${queued.id}/cancel`, {
          method: "POST",
          headers: { ...headers, "Idempotency-Key": "cancel:0123456789" },
        })
      ).status,
      200
    );
    assert.equal(
      (
        await fetch(`${base}/api/v1/requests/${queued.id}/archive`, {
          method: "DELETE",
          headers: { ...headers, "Idempotency-Key": "archive:0123456789" },
        })
      ).status,
      200
    );
    assert.equal(calls.length, 6);
    assert.equal(calls.some((call) => call.startsWith(`plan-edit:${queued.id}:`)), true);
    assert.equal(calls.some((call) => call.startsWith(`plan-approve:${queued.id}:`)), true);
  } finally {
    await controlPlane.close();
  }
});
