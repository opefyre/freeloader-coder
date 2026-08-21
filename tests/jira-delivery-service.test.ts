import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { JiraDeliveryService } from "../apps/core/src/jira-delivery-service.js";
import { completeDeliveryPlan } from "./delivery-plan-fixture.js";

const projectId = "project_abcdef0123456789";
const plan = completeDeliveryPlan();
const draft = {
  ...plan,
  revision: 1,
  reviews: [
    { schemaVersion: 1 as const, reviewerId: "delivery-reviewer", discipline: "delivery" as const, verdict: "pass" as const, findings: [] },
    { schemaVersion: 1 as const, reviewerId: "technical-reviewer", discipline: "technical" as const, verdict: "pass" as const, findings: [] },
  ],
};
const digest = "d".repeat(64);

test("Jira delivery resumes a partial creation without duplicate issues and opens delivery only after links pass", async () => {
  const root = await mkdtemp(join(tmpdir(), "jira-delivery-"));
  try {
    let createAttempts = 0;
    let created = 0;
    let failOnce = true;
    const links: unknown[] = [];
    const issueBodies: unknown[] = [];
    const markerQueries: string[] = [];
    const activations: unknown[] = [];
    const fetcher: typeof fetch = async (url, init) => {
      const pathname = new URL(String(url)).pathname;
      if (pathname.endsWith("/myself")) return json({ accountId: "account-1" });
      if (pathname.endsWith("/issuetype/project")) return json([
        { id: "100", name: "Epic" }, { id: "101", name: "Story" }, { id: "102", name: "Task" }, { id: "103", name: "Sub-task" },
      ]);
      if (pathname.includes("/issue/createmeta/")) return json({ fields: [
        { fieldId: "assignee", name: "Assignee" },
        { fieldId: "parent", name: "Parent" },
        { fieldId: "priority", name: "Priority", allowedValues: [{ id: "1", name: "Highest" }, { id: "2", name: "High" }, { id: "3", name: "Medium" }, { id: "4", name: "Low" }, { id: "5", name: "Lowest" }] },
        { fieldId: "customfield_10016", name: "Story point estimate" },
        { fieldId: "customfield_10011", name: "Epic Name" },
      ] });
      if (pathname.endsWith("/search/jql")) { markerQueries.push(new URL(String(url)).searchParams.get("jql") ?? ""); return json({ issues: [] }); }
      if (pathname.endsWith("/issue") && init?.method === "POST") {
        createAttempts += 1;
        if (createAttempts === 3 && failOnce) { failOnce = false; return json({ error: "temporary" }, 503); }
        issueBodies.push(JSON.parse(String(init.body)));
        created += 1;
        return json({ id: String(created), key: `PIPE-${created}` }, 201);
      }
      if (pathname.endsWith("/issueLink")) { links.push(JSON.parse(String(init?.body))); return new Response(null, { status: 204 }); }
      throw new Error(`Unexpected Jira request: ${pathname}`);
    };
    const service = new JiraDeliveryService(
      root,
      { list: async () => ({ schemaVersion: 1, provenance: "local_observation", observedAt: 1, projects: [{ schemaVersion: 1, id: projectId, displayName: "Product", state: "ready", observedAt: 1, validForMs: 60_000, facts: [], inferences: [], decisions: [], warnings: [], resources: [{ id: "binding_abcdef0123456789", kind: "jira_project", connectionId: "jira:account", resourceId: "20000", label: "PIPE · Pipeline", url: "https://example.atlassian.net/jira/software/projects/PIPE", role: "primary", selectedAt: 1 }] }] }) },
      { readDraft: async () => ({ draft, document: { schemaVersion: 1, projectId, projectRelativePath: ".pipeline/BACKLOG.md", revision: 1, digest, markdown: "# Plan", itemCount: 4 } }) },
      { activateDelivery: async (...args: unknown[]) => { activations.push(args); return {} as never; } },
      { read: async () => JSON.stringify({ siteUrl: "https://example.atlassian.net", email: "owner@example.com", apiToken: "secret-token" }) },
      fetcher,
      () => 100
    );
    await assert.rejects(() => service.synchronize(projectId), /Jira rejected delivery synchronization/);
    const partial = await service.get(projectId);
    assert.equal(Object.keys(partial?.issues ?? {}).length, 2);
    assert.equal(partial?.completed, false);
    const complete = await service.synchronize(projectId);
    assert.equal(Object.keys(complete.issues).length, 4);
    assert.equal(complete.completed, true);
    assert.equal(created, 4);
    assert.equal(createAttempts, 5);
    assert.equal(links.length, 1);
    const createdDescriptions = JSON.stringify(issueBodies);
    assert.match(createdDescriptions, /Capabilities: typescript implementation, independent validation/);
    assert.match(createdDescriptions, /Requirement coverage/);
    assert.match(createdDescriptions, /Approval and infrastructure gates/);
    assert.match(createdDescriptions, /Rollback requirements/);
    assert.ok(markerQueries.every((query) => query.includes(`codkesh_${projectId.slice(8)}_`)));
    assert.deepEqual(activations, [[projectId, digest, "PIPE-1"]]);
    const replay = await service.synchronize(projectId);
    assert.equal(replay.completed, true);
    assert.equal(createAttempts, 5);
    const restarted = new JiraDeliveryService(root, {} as never, {} as never, {} as never, {} as never, fetcher, () => 200);
    assert.equal((await restarted.get(projectId))?.completed, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Jira delivery detects an externally edited marker issue and creates nothing", async () => {
  const root = await mkdtemp(join(tmpdir(), "jira-delivery-conflict-"));
  try {
    let creates = 0;
    const fetcher: typeof fetch = async (url, init) => {
      const parsed = new URL(String(url));
      if (parsed.pathname.endsWith("/myself")) return json({ accountId: "account-1" });
      if (parsed.pathname.endsWith("/issuetype/project")) return json([{ id: "100", name: "Epic" }, { id: "101", name: "Story" }, { id: "102", name: "Task" }, { id: "103", name: "Sub-task" }]);
      if (parsed.pathname.includes("/issue/createmeta/")) return json({ fields: { assignee: {}, parent: {}, priority: { allowedValues: [{ id: "3", name: "Medium" }] }, customfield_10016: { name: "Story point estimate" }, customfield_10011: { name: "Epic Name" } } });
      if (parsed.pathname.endsWith("/search/jql")) return json({ issues: [{ id: "1", key: "PIPE-1", fields: { summary: "Human changed this summary" } }] });
      if (parsed.pathname.endsWith("/issue") && init?.method === "POST") { creates += 1; return json({ id: "2", key: "PIPE-2" }, 201); }
      throw new Error(`Unexpected Jira request: ${parsed.pathname}`);
    };
    const service = new JiraDeliveryService(
      root,
      { list: async () => ({ schemaVersion: 1, provenance: "local_observation", observedAt: 1, projects: [{ schemaVersion: 1, id: projectId, displayName: "Product", state: "ready", observedAt: 1, validForMs: 60_000, facts: [], inferences: [], decisions: [], warnings: [], resources: [{ id: "binding_abcdef0123456789", kind: "jira_project", connectionId: "jira:account", resourceId: "20000", label: "PIPE", url: "https://example.atlassian.net/jira/software/projects/PIPE", role: "primary", selectedAt: 1 }] }] }) },
      { readDraft: async () => ({ draft, document: { schemaVersion: 1, projectId, projectRelativePath: ".pipeline/BACKLOG.md", revision: 1, digest, markdown: "# Plan", itemCount: 4 } }) },
      { activateDelivery: async () => ({} as never) },
      { read: async () => JSON.stringify({ siteUrl: "https://example.atlassian.net", email: "owner@example.com", apiToken: "secret-token" }) },
      fetcher,
      () => 100
    );
    await assert.rejects(() => service.synchronize(projectId), /edited in Jira/);
    assert.equal(creates, 0);
  } finally { await rm(root, { recursive: true, force: true }); }
});

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
}
