import assert from "node:assert/strict";
import test from "node:test";

import { ProjectPortfolioService } from "../apps/core/src/project-portfolio-service.js";
import { localProjectCollectionSchema } from "../packages/runtime/src/local-projects.js";

const now = Date.parse("2026-08-09T12:00:00.000Z");
const projectId = "project_0123456789abcdef";

function collection() {
  return localProjectCollectionSchema.parse({
    schemaVersion: 1,
    provenance: "local_observation",
    observedAt: now - 1_000,
    projects: [{
      schemaVersion: 1,
      id: projectId,
      displayName: "Pipeline Studio",
      workspaceLabel: "pipeline-studio",
      lifecycleStage: "intake",
      resources: [{ id: "binding_0123456789abcdef", kind: "jira_project", connectionId: "jira:default", resourceId: "10132", label: "PIPE · Coding Pipeline", url: "https://opefyre.atlassian.net/jira/software/projects/PIPE", role: "primary", selectedAt: now - 10_000 }],
      latestUpdate: null,
      progress: null,
      state: "ready",
      observedAt: now - 1_000,
      validForMs: 60_000,
      facts: [], inferences: [], decisions: [], warnings: [],
    }],
  });
}

test("portfolio derives progress from selected Jira and latest state from canonical execution", async () => {
  let requests = 0;
  const service = new ProjectPortfolioService(
    { list: async () => collection() },
    { list: async () => [{ schemaVersion: 1, projectId, stage: "delivery", revision: 4, mission: "Deliver the project portfolio", questions: [], answers: [], assessment: null, artifacts: [], designApproval: null, designFeedback: [], jiraEpicId: "PIPE-90", blockedReason: null, updatedAt: now - 500 }] },
    { get: async () => ({ schemaVersion: 1, projectId, planDigest: "a".repeat(64), state: "running", revision: 2, updatedAt: now - 100, tasks: [{ id: "plan_0123456789abcdef", jiraIssueKey: "PIPE-99", title: "Implement portfolio", dependsOn: [], allowedFiles: ["src/index.ts"], validationProfiles: ["unit"], uiChanged: false, requiredCapabilities: ["chat"], privacyClass: "source_code", status: "validating", revision: 2, attempt: 0, assignment: null, lease: null, implementationEvidence: [], validations: [], reviews: [], commitDigest: null, integrationDigest: null, failureClass: null, safeMessage: "Deterministic validation is running.", updatedAt: now - 100 }] }) },
    { read: async () => JSON.stringify({ siteUrl: "https://opefyre.atlassian.net", email: "owner@example.com", apiToken: "secret" }) },
    async () => {
      requests += 1;
      return Response.json({
        total: 3,
        issues: [
          { key: "PIPE-99", fields: { summary: "Implement portfolio", updated: "2026-08-09T11:59:00.000Z", status: { name: "In Progress", statusCategory: { key: "indeterminate" } } } },
          { key: "PIPE-98", fields: { summary: "Blocked integration", updated: "2026-08-09T11:00:00.000Z", status: { name: "Blocked", statusCategory: { key: "indeterminate" } } } },
          { key: "PIPE-97", fields: { summary: "Create foundation", updated: "2026-08-09T10:00:00.000Z", status: { name: "Done", statusCategory: { key: "done" } } } },
        ],
      });
    },
    () => now
  );
  const first = await service.list();
  const project = first.projects[0]!;
  assert.equal(project.lifecycleStage, "delivery");
  assert.deepEqual(project.progress, { source: "jira", completed: 1, total: 3, blocked: 1, percent: 33, observedAt: now });
  assert.equal(project.latestUpdate?.source, "pipeline");
  assert.match(project.latestUpdate?.summary ?? "", /PIPE-99/);
  assert.equal(project.reconciliation?.confidence, "verified");
  assert.deepEqual(project.reconciliation?.disagreements, []);
  assert.equal(project.reconciliation?.latest?.source, "execution");
  await service.list();
  assert.equal(requests, 1, "Jira polling is bounded by the freshness cache");
});

test("portfolio labels Jira as unknown when authentication or observation is unavailable", async () => {
  const service = new ProjectPortfolioService(
    { list: async () => collection() },
    { list: async () => [] },
    { get: async () => null },
    { read: async () => null },
    async () => { throw new Error("must not request Jira without credentials"); },
    () => now
  );
  const project = (await service.list()).projects[0]!;
  assert.equal(project.progress, null);
  assert.equal(project.latestUpdate, null);
  assert.equal(project.reconciliation?.confidence, "unknown");
  assert.equal(project.reconciliation?.disagreements[0]?.code, "missing_jira");
});

test("portfolio observes the selected Jira project through the browser OAuth credential", async () => {
  const urls: string[] = [];
  const service = new ProjectPortfolioService(
    { list: async () => collection() },
    { list: async () => [] },
    { get: async () => null },
    { read: async () => JSON.stringify({ accessToken: "oauth-access-token", expiresAt: now + 120_000 }) },
    async (input, init) => {
      urls.push(String(input));
      assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer oauth-access-token");
      if (String(input).includes("accessible-resources")) return Response.json([{ id: "cloud-123", url: "https://opefyre.atlassian.net" }]);
      return Response.json({
        isLast: true,
        issues: [{
          key: "PIPE-1",
          fields: { summary: "OAuth observed", updated: "2026-08-09T11:59:00.000Z", status: { name: "Done", statusCategory: { key: "done" } } },
        }],
      });
    },
    () => now,
  );
  const project = (await service.list()).projects[0]!;
  assert.equal(project.progress?.percent, 100);
  assert.equal(project.reconciliation?.confidence, "verified");
  assert.ok(urls.some((url) => url === "https://api.atlassian.com/ex/jira/cloud-123/rest/api/3/search/jql?jql=project+%3D+%22PIPE%22+ORDER+BY+updated+DESC&maxResults=100&fields=summary%2Cstatus%2Cupdated"));
});
