import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  parentClosureCandidate,
  ProjectExecutionJiraObserver,
} from "../apps/core/src/project-execution-jira-observer.js";
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
      if (parsed.pathname.endsWith("/comment") && init?.method === "POST") {
        comments.push(JSON.parse(String(init.body)));
        return json({ id: "1" }, 201);
      }
      if (parsed.pathname.endsWith("/comment")) return json({ comments });
      if (parsed.pathname.endsWith("/transitions") && init?.method === "POST") {
        transitionPosts += 1;
        status = "Done";
        return new Response(null, { status: 204 });
      }
      if (parsed.pathname.endsWith("/transitions"))
        return json({
          transitions: [{ id: "31", name: "Done", to: { name: "Done" } }],
        });
      if (parsed.pathname.includes("/issue/PIPE-4"))
        return json({ fields: { status: { name: status } } });
      throw new Error(`Unexpected request: ${parsed.pathname}`);
    };
    const record = completedRecord();
    const observer = new ProjectExecutionJiraObserver(
      root,
      { get: async () => record },
      {
        get: async () => ({
          completed: true,
          issues: { [taskId]: { issueKey: "PIPE-4" } },
        }),
      },
      plans(),
      {
        read: async () =>
          JSON.stringify({
            siteUrl: "https://example.atlassian.net",
            email: "owner@example.com",
            apiToken: "secret",
          }),
      },
      fetcher,
      () => 200,
    );
    assert.deepEqual(await observer.synchronize(projectId), {
      synchronized: 1,
      pending: 0,
    });
    assert.equal(comments.length, 1);
    assert.equal(transitionPosts, 1);
    assert.match(JSON.stringify(comments[0]), /pipeline_exec_/);
    assert.match(JSON.stringify(comments[0]), /Codkesh/);
    assert.deepEqual(await observer.synchronize(projectId), {
      synchronized: 0,
      pending: 0,
    });
    assert.equal(comments.length, 1);
    assert.equal(transitionPosts, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Jira observer detects an external workflow edit instead of overwriting it", async () => {
  const root = await mkdtemp(join(tmpdir(), "execution-jira-conflict-"));
  try {
    let transitionPosts = 0;
    const fetcher: typeof fetch = async (url, init) => {
      const parsed = new URL(String(url));
      if (parsed.pathname.endsWith("/comment") && init?.method === "POST")
        return json({ id: "1" }, 201);
      if (parsed.pathname.endsWith("/comment")) return json({ comments: [] });
      if (parsed.pathname.endsWith("/transitions") && init?.method === "POST") {
        transitionPosts += 1;
        return new Response(null, { status: 204 });
      }
      if (parsed.pathname.includes("/issue/PIPE-4"))
        return json({ fields: { status: { name: "Blocked by owner" } } });
      throw new Error(`Unexpected request: ${parsed.pathname}`);
    };
    const observer = new ProjectExecutionJiraObserver(
      root,
      { get: async () => completedRecord() },
      {
        get: async () => ({
          completed: true,
          issues: { [taskId]: { issueKey: "PIPE-4" } },
        }),
      },
      plans(),
      {
        read: async () =>
          JSON.stringify({
            siteUrl: "https://example.atlassian.net",
            email: "owner@example.com",
            apiToken: "secret",
          }),
      },
      fetcher,
      () => 200,
    );
    await assert.rejects(
      () => observer.synchronize(projectId),
      /will not overwrite that external change/,
    );
    assert.equal(transitionPosts, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Jira observer may close an untouched initial issue when execution finishes before the polling interval", async () => {
  const root = await mkdtemp(join(tmpdir(), "execution-jira-fast-completion-"));
  try {
    let status = "To Do";
    let transitionPosts = 0;
    const comments: unknown[] = [];
    const fetcher: typeof fetch = async (url, init) => {
      const parsed = new URL(String(url));
      if (parsed.pathname.endsWith("/comment") && init?.method === "POST") {
        comments.push(JSON.parse(String(init.body)));
        return json({ id: "1" }, 201);
      }
      if (parsed.pathname.endsWith("/comment")) return json({ comments });
      if (parsed.pathname.endsWith("/transitions") && init?.method === "POST") {
        transitionPosts += 1;
        status = "Done";
        return new Response(null, { status: 204 });
      }
      if (parsed.pathname.endsWith("/transitions"))
        return json({
          transitions: [{ id: "31", name: "Done", to: { name: "Done" } }],
        });
      if (parsed.pathname.includes("/issue/PIPE-4"))
        return json({ fields: { status: { name: status } } });
      throw new Error(`Unexpected request: ${parsed.pathname}`);
    };
    const observer = new ProjectExecutionJiraObserver(
      root,
      { get: async () => completedRecord() },
      {
        get: async () => ({
          completed: true,
          issues: { [taskId]: { issueKey: "PIPE-4" } },
        }),
      },
      plans(),
      {
        read: async () =>
          JSON.stringify({
            siteUrl: "https://example.atlassian.net",
            email: "owner@example.com",
            apiToken: "secret",
          }),
      },
      fetcher,
      () => 200,
    );
    assert.deepEqual(await observer.synchronize(projectId), {
      synchronized: 1,
      pending: 0,
    });
    assert.equal(transitionPosts, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
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
      {
        get: async () => ({
          completed: true,
          issues: { [taskId]: { issueKey: "PIPE-4" } },
        }),
      },
      plans(),
      {
        read: async () =>
          JSON.stringify({
            siteUrl: "https://example.atlassian.net",
            email: "owner@example.com",
            apiToken: "secret",
          }),
      },
      async () => {
        jiraRequests += 1;
        return json({});
      },
      () => 200,
    );
    await assert.rejects(
      () => observer.synchronize(projectId),
      /closure blocked.*Two independent reviewers/i,
    );
    assert.equal(
      jiraRequests,
      0,
      "false completion must not comment on or transition Jira",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

function completedRecord(): ProjectExecutionRecord {
  return {
    schemaVersion: 1,
    projectId,
    planDigest: digest,
    state: "completed",
    revision: 6,
    updatedAt: 100,
    tasks: [
      {
        id: taskId,
        jiraIssueKey: "PIPE-4",
        title: "Implement feature",
        dependsOn: [],
        allowedFiles: ["src/feature.ts", "tests/feature.test.ts"],
        validationProfiles: ["typecheck", "unit"],
        uiChanged: true,
        requiredCapabilities: ["chat", "structured_output", "tool_calling"],
        privacyClass: "source_code",
        status: "completed",
        revision: 6,
        attempt: 0,
        assignment: {
          providerId: "groq",
          modelId: "coder",
          deviceId: "spare",
          selectedAt: 100,
          reasons: ["All execution gates passed."],
        },
        lease: null,
        implementationEvidence: [digest],
        validations: [
          {
            tier: "fast",
            commandLabel: "fast",
            passed: true,
            exitCode: 0,
            evidenceDigest: digest,
            observedAt: 100,
          },
          {
            tier: "full",
            commandLabel: "full",
            passed: true,
            exitCode: 0,
            evidenceDigest: digest,
            observedAt: 100,
          },
          {
            tier: "integration",
            commandLabel: "integration",
            passed: true,
            exitCode: 0,
            evidenceDigest: digest,
            observedAt: 100,
          },
        ],
        reviews: [
          {
            reviewerId: "functional",
            providerId: "gemini",
            role: "functional",
            verdict: "pass",
            evidenceDigest: digest,
            findings: [],
            observedAt: 100,
          },
          {
            reviewerId: "design",
            providerId: "cloudflare",
            role: "design",
            verdict: "pass",
            evidenceDigest: digest,
            findings: [],
            observedAt: 100,
          },
        ],
        commitDigest: digest,
        integrationDigest: digest,
        liveJourneyEvidence: {
          journeyId: "owner-feature-journey",
          revisionDigest: digest,
          reference: `validation://PIPE-4/live-journey/${digest}`,
          runtime: "browser",
          viewport: "1440x900",
          passed: true,
          assertions: [
            {
              name: "Owner completes the approved journey",
              passed: true,
              evidenceDigest: digest,
            },
          ],
          observedAt: 100,
        },
        failureClass: null,
        safeMessage: "All gates passed.",
        updatedAt: 100,
      },
    ],
  };
}

test("Jira parent closure bounds repeated descendant proof by semantic identity", () => {
  const task = completedRecord().tasks[0]!;
  const descendants = Array.from({ length: 12 }, (_, index) => ({
    ...structuredClone(task),
    id: `plan_${(index + 4).toString(16).padStart(16, "0")}`,
    jiraIssueKey: `PIPE-${index + 4}`,
  }));
  const candidate = parentClosureCandidate(
    "PIPE-1",
    ["All approved delivery outcomes are proven."],
    descendants,
    descendants.map((item) => item.jiraIssueKey),
  );

  assert.deepEqual(candidate.passedValidationProfiles, [
    "fast",
    "full",
    "integration",
  ]);
  assert.deepEqual(candidate.reviewerIds, ["gemini", "cloudflare"]);
});

test("Jira observer refuses a generic integration digest when distinct live proof is missing", async () => {
  const root = await mkdtemp(join(tmpdir(), "execution-jira-no-live-proof-"));
  try {
    const record = completedRecord();
    delete record.tasks[0]!.liveJourneyEvidence;
    let jiraRequests = 0;
    const observer = new ProjectExecutionJiraObserver(
      root,
      { get: async () => record },
      {
        get: async () => ({
          completed: true,
          issues: { [taskId]: { issueKey: "PIPE-4" } },
        }),
      },
      plans(),
      {
        read: async () =>
          JSON.stringify({
            siteUrl: "https://example.atlassian.net",
            email: "owner@example.com",
            apiToken: "secret",
          }),
      },
      async () => {
        jiraRequests += 1;
        return json({});
      },
      () => 200,
    );
    await assert.rejects(
      () => observer.synchronize(projectId),
      /resolved observed live journey/i,
    );
    assert.equal(jiraRequests, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Jira observer refuses live proof from another revision", async () => {
  const root = await mkdtemp(
    join(tmpdir(), "execution-jira-stale-live-proof-"),
  );
  try {
    const record = completedRecord();
    record.tasks[0]!.liveJourneyEvidence!.revisionDigest = "e".repeat(64);
    const observer = new ProjectExecutionJiraObserver(
      root,
      { get: async () => record },
      {
        get: async () => ({
          completed: true,
          issues: { [taskId]: { issueKey: "PIPE-4" } },
        }),
      },
      plans(),
      {
        read: async () =>
          JSON.stringify({
            siteUrl: "https://example.atlassian.net",
            email: "owner@example.com",
            apiToken: "secret",
          }),
      },
      async () => json({}),
      () => 200,
    );
    await assert.rejects(
      () => observer.synchronize(projectId),
      /resolved observed live journey/i,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Jira observer closes a complete hierarchy bottom-up and remains idempotent after restart", async () => {
  const root = await mkdtemp(join(tmpdir(), "execution-jira-hierarchy-"));
  try {
    const ids = [
      "plan_0000000000000001",
      "plan_0000000000000002",
      "plan_0000000000000003",
      taskId,
    ];
    const keys = ["PIPE-1", "PIPE-2", "PIPE-3", "PIPE-4"];
    const statuses = new Map(keys.map((key) => [key, "To Do"]));
    const comments = new Map<string, unknown[]>();
    const transitioned: string[] = [];
    const fetcher: typeof fetch = async (url, init) => {
      const parsed = new URL(String(url));
      const key = decodeURIComponent(
        parsed.pathname.match(/\/issue\/([^/]+)/)?.[1] ?? "",
      );
      if (parsed.pathname.endsWith("/comment") && init?.method === "POST") {
        comments.set(key, [
          ...(comments.get(key) ?? []),
          JSON.parse(String(init.body)),
        ]);
        return json({ id: "1" }, 201);
      }
      if (parsed.pathname.endsWith("/comment"))
        return json({ comments: comments.get(key) ?? [] });
      if (parsed.pathname.endsWith("/transitions") && init?.method === "POST") {
        transitioned.push(key);
        statuses.set(key, "Done");
        return new Response(null, { status: 204 });
      }
      if (parsed.pathname.endsWith("/transitions"))
        return json({
          transitions: [{ id: "31", name: "Done", to: { name: "Done" } }],
        });
      if (key) return json({ fields: { status: { name: statuses.get(key) } } });
      throw new Error(`Unexpected request: ${parsed.pathname}`);
    };
    const hierarchyPlan = {
      readDraft: async () => ({
        draft: {
          items: [
            {
              id: ids[0],
              type: "epic",
              parentId: null,
              acceptanceCriteria: [
                "All approved delivery outcomes are proven.",
              ],
            },
            {
              id: ids[1],
              type: "story",
              parentId: ids[0],
              acceptanceCriteria: ["The owner story is proven end to end."],
            },
            {
              id: ids[2],
              type: "task",
              parentId: ids[1],
              acceptanceCriteria: ["The bounded delivery task is proven."],
            },
            {
              id: ids[3],
              type: "subtask",
              parentId: ids[2],
              acceptanceCriteria: [
                "The executable change passes its owner journey.",
              ],
            },
          ],
        } as any,
      }),
    };
    const delivery = {
      completed: true,
      issues: Object.fromEntries(
        ids.map((id, index) => [id, { issueKey: keys[index]! }]),
      ),
    };
    const observer = new ProjectExecutionJiraObserver(
      root,
      { get: async () => completedRecord() },
      { get: async () => delivery },
      hierarchyPlan,
      {
        read: async () =>
          JSON.stringify({
            siteUrl: "https://example.atlassian.net",
            email: "owner@example.com",
            apiToken: "secret",
          }),
      },
      fetcher,
      () => 200,
    );
    assert.deepEqual(await observer.synchronize(projectId), {
      synchronized: 4,
      pending: 0,
    });
    assert.deepEqual(transitioned, ["PIPE-4", "PIPE-3", "PIPE-2", "PIPE-1"]);
    const restarted = new ProjectExecutionJiraObserver(
      root,
      { get: async () => completedRecord() },
      { get: async () => delivery },
      hierarchyPlan,
      {
        read: async () =>
          JSON.stringify({
            siteUrl: "https://example.atlassian.net",
            email: "owner@example.com",
            apiToken: "secret",
          }),
      },
      fetcher,
      () => 300,
    );
    assert.deepEqual(await restarted.synchronize(projectId), {
      synchronized: 0,
      pending: 0,
    });
    assert.deepEqual(transitioned, ["PIPE-4", "PIPE-3", "PIPE-2", "PIPE-1"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

function plans() {
  return {
    readDraft: async () => ({
      draft: {
        items: [
          {
            id: taskId,
            acceptanceCriteria: [
              "The feature works for the approved owner journey.",
              "The verified result remains accessible after refresh.",
            ],
          },
        ],
      } as any,
    }),
  };
}

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
