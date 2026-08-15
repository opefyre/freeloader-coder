import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { ProjectExecutionJiraObserver } from "../apps/core/src/project-execution-jira-observer.js";
import type { ProjectExecutionRecord } from "../packages/orchestration/src/project-execution.js";

const projectId = "project_abcdef0123456789";
const taskId = "plan_0000000000000004";
const digest = "d".repeat(64);

test("Jira observer publishes verified completion once and reconciles remote state", async () => {
  const root = await mkdtemp(join(tmpdir(), "execution-jira-observer-"));
  try {
    let status = "In Progress";
    const comments: unknown[] = [];
    let transitionPosts = 0;
    const fetcher: typeof fetch = async (url, init) => {
      const parsed = new URL(String(url));
      if (parsed.pathname.endsWith("/comment") && init?.method === "POST") { comments.push(JSON.parse(String(init.body))); return json({ id: "1" }, 201); }
      if (parsed.pathname.endsWith("/comment")) return json({ comments });
      if (parsed.pathname.endsWith("/transitions") && init?.method === "POST") { transitionPosts += 1; status = "Done"; return new Response(null, { status: 204 }); }
      if (parsed.pathname.endsWith("/transitions")) return json({ transitions: [{ id: "31", name: "Done", to: { name: "Done" } }] });
      if (parsed.pathname.includes("/issue/PIPE-4")) return json({ fields: { status: { name: status } } });
      throw new Error(`Unexpected request: ${parsed.pathname}`);
    };
    const record = completedRecord();
    const observer = new ProjectExecutionJiraObserver(
      root,
      { get: async () => record },
      { get: async () => ({ completed: true, issues: { [taskId]: { issueKey: "PIPE-4" } } }) },
      plans(),
      { read: async () => JSON.stringify({ siteUrl: "https://example.atlassian.net", email: "owner@example.com", apiToken: "secret" }) },
      fetcher,
      () => 200
    );
    assert.deepEqual(await observer.synchronize(projectId), { synchronized: 1, pending: 0 });
    assert.equal(comments.length, 1);
    assert.equal(transitionPosts, 1);
    assert.match(JSON.stringify(comments[0]), /pipeline_exec_/);
    assert.match(JSON.stringify(comments[0]), /Codkesh/);
    assert.deepEqual(await observer.synchronize(projectId), { synchronized: 0, pending: 0 });
    assert.equal(comments.length, 1);
    assert.equal(transitionPosts, 1);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("Jira observer detects an external workflow edit instead of overwriting it", async () => {
  const root = await mkdtemp(join(tmpdir(), "execution-jira-conflict-"));
  try {
    let transitionPosts = 0;
    const fetcher: typeof fetch = async (url, init) => {
      const parsed = new URL(String(url));
      if (parsed.pathname.endsWith("/comment") && init?.method === "POST") return json({ id: "1" }, 201);
      if (parsed.pathname.endsWith("/comment")) return json({ comments: [] });
      if (parsed.pathname.endsWith("/transitions") && init?.method === "POST") { transitionPosts += 1; return new Response(null, { status: 204 }); }
      if (parsed.pathname.includes("/issue/PIPE-4")) return json({ fields: { status: { name: "Blocked by owner" } } });
      throw new Error(`Unexpected request: ${parsed.pathname}`);
    };
    const observer = new ProjectExecutionJiraObserver(
      root,
      { get: async () => completedRecord() },
      { get: async () => ({ completed: true, issues: { [taskId]: { issueKey: "PIPE-4" } } }) },
      plans(),
      { read: async () => JSON.stringify({ siteUrl: "https://example.atlassian.net", email: "owner@example.com", apiToken: "secret" }) },
      fetcher,
      () => 200
    );
    await assert.rejects(() => observer.synchronize(projectId), /will not overwrite that external change/);
    assert.equal(transitionPosts, 0);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("Jira observer rejects false completion before any Jira comment or transition", async () => {
  const root = await mkdtemp(join(tmpdir(), "execution-jira-false-closure-"));
  try {
    const record = completedRecord();
    record.tasks[0]!.reviews = record.tasks[0]!.reviews.slice(0, 1);
    let jiraRequests = 0;
    const observer = new ProjectExecutionJiraObserver(
      root,
      { get: async () => record },
      { get: async () => ({ completed: true, issues: { [taskId]: { issueKey: "PIPE-4" } } }) },
      plans(),
      { read: async () => JSON.stringify({ siteUrl: "https://example.atlassian.net", email: "owner@example.com", apiToken: "secret" }) },
      async () => { jiraRequests += 1; return json({}); },
      () => 200
    );
    await assert.rejects(() => observer.synchronize(projectId), /closure blocked.*Two independent reviewers/i);
    assert.equal(jiraRequests, 0, "false completion must not comment on or transition Jira");
  } finally { await rm(root, { recursive: true, force: true }); }
});

function completedRecord(): ProjectExecutionRecord {
  return {
    schemaVersion: 1, projectId, planDigest: digest, state: "completed", revision: 6, updatedAt: 100,
    tasks: [{
      id: taskId, jiraIssueKey: "PIPE-4", title: "Implement feature", dependsOn: [], allowedFiles: ["src/feature.ts", "tests/feature.test.ts"], validationProfiles: ["typecheck", "unit"], uiChanged: true,
      requiredCapabilities: ["chat", "structured_output", "tool_calling"], privacyClass: "source_code", status: "completed",
      revision: 6, attempt: 0, assignment: { providerId: "groq", modelId: "coder", deviceId: "spare", selectedAt: 100, reasons: ["All execution gates passed."] }, lease: null,
      implementationEvidence: [digest], validations: [{ tier: "fast", commandLabel: "fast", passed: true, exitCode: 0, evidenceDigest: digest, observedAt: 100 }, { tier: "full", commandLabel: "full", passed: true, exitCode: 0, evidenceDigest: digest, observedAt: 100 }, { tier: "integration", commandLabel: "integration", passed: true, exitCode: 0, evidenceDigest: digest, observedAt: 100 }],
      reviews: [{ reviewerId: "functional", providerId: "gemini", role: "functional", verdict: "pass", evidenceDigest: digest, findings: [], observedAt: 100 }, { reviewerId: "design", providerId: "cloudflare", role: "design", verdict: "pass", evidenceDigest: digest, findings: [], observedAt: 100 }],
      commitDigest: digest, integrationDigest: digest, failureClass: null, safeMessage: "All gates passed.", updatedAt: 100,
    }],
  };
}

function plans() {
  return { readDraft: async () => ({ draft: { items: [{ id: taskId, acceptanceCriteria: ["The feature works for the approved owner journey.", "The verified result remains accessible after refresh."] }] } as any }) };
}

function json(value: unknown, status = 200) { return new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } }); }
