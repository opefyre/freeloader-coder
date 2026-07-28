import { createHash } from "node:crypto";

export interface JiraSelection {
  readonly schemaVersion: 1;
  readonly cloudId: string;
  readonly siteLabel: string;
  readonly projectId: string;
  readonly projectKey: string;
  readonly boardId: string | null;
  readonly issueIds: readonly string[];
  readonly issueKeys: readonly string[];
  readonly sourceRevision: string;
  readonly selectedAt: number;
  readonly unavailableFields: readonly string[];
}

export function createJiraSelection(input: Omit<JiraSelection, "schemaVersion">): JiraSelection {
  if (!input.cloudId.trim() || !input.projectId.trim() || !input.projectKey.trim()) {
    throw new Error("Jira site and project identifiers are required.");
  }
  if (input.issueIds.length === 0 || input.issueIds.length !== input.issueKeys.length) {
    throw new Error("Jira selection requires matching stable issue IDs and keys.");
  }
  if (!/^[a-f0-9]{64}$/.test(input.sourceRevision)) {
    throw new Error("Jira source revision is invalid.");
  }
  return {
    schemaVersion: 1,
    ...input,
    issueIds: [...new Set(input.issueIds)].sort(),
    issueKeys: [...new Set(input.issueKeys)].sort(),
    unavailableFields: [...new Set(input.unavailableFields)].sort()
  };
}

export interface JiraIssueInput {
  readonly id: string;
  readonly key: string;
  readonly summary: string;
  readonly description: string;
  readonly acceptanceCriteria: readonly string[];
  readonly dependencies: readonly string[];
  readonly sourceRevision: string;
}

export interface GroundedTask {
  readonly id: string;
  readonly title: string;
  readonly sourceIssueId: string;
  readonly sourceIssueKey: string;
  readonly sourceRevision: string;
  readonly citations: readonly string[];
  readonly dependencies: readonly string[];
}

export interface JiraTaskGraph {
  readonly id: string;
  readonly issueId: string;
  readonly sourceRevision: string;
  readonly groundingDigest: string;
  readonly tasks: readonly GroundedTask[];
  readonly state: "ready" | "needs_clarification" | "stale";
  readonly questions: readonly string[];
}

export function importJiraTaskGraph(input: {
  readonly issue: JiraIssueInput;
  readonly projectGroundingDigest: string;
  readonly observedSourceRevision: string;
  readonly activeGraphs: readonly JiraTaskGraph[];
}): JiraTaskGraph {
  if (!/^[a-f0-9]{64}$/.test(input.projectGroundingDigest)) {
    throw new Error("Project grounding digest is invalid.");
  }
  const existing = input.activeGraphs.find((graph) => graph.issueId === input.issue.id);
  if (existing) return existing;
  const stale = input.issue.sourceRevision !== input.observedSourceRevision;
  const questions: string[] = [];
  if (!input.issue.description.trim()) questions.push("What outcome should this work produce?");
  if (input.issue.acceptanceCriteria.length === 0) {
    questions.push("What observable checks prove this issue is complete?");
  }
  const citations = [
    `jira://${input.issue.id}@${input.issue.sourceRevision}`,
    `project-grounding://${input.projectGroundingDigest}`
  ];
  const tasks = [
    {
      id: `task-${digest(`${input.issue.id}:implementation`).slice(0, 12)}`,
      title: input.issue.summary,
      sourceIssueId: input.issue.id,
      sourceIssueKey: input.issue.key,
      sourceRevision: input.issue.sourceRevision,
      citations,
      dependencies: [...input.issue.dependencies].sort()
    },
    {
      id: `task-${digest(`${input.issue.id}:verification`).slice(0, 12)}`,
      title: `Verify ${input.issue.key} acceptance criteria`,
      sourceIssueId: input.issue.id,
      sourceIssueKey: input.issue.key,
      sourceRevision: input.issue.sourceRevision,
      citations,
      dependencies: []
    }
  ];
  return {
    id: `graph-${digest(`${input.issue.id}:${input.issue.sourceRevision}`).slice(0, 16)}`,
    issueId: input.issue.id,
    sourceRevision: input.issue.sourceRevision,
    groundingDigest: input.projectGroundingDigest,
    tasks,
    state: stale ? "stale" : questions.length > 0 ? "needs_clarification" : "ready",
    questions
  };
}

export function evaluateJiraDataPolicy(input: {
  readonly issueVisibility: "public" | "private";
  readonly providerDataClasses: readonly string[];
}): {
  readonly allowed: boolean;
  readonly reason: string;
} {
  if (input.issueVisibility === "public") {
    return { allowed: true, reason: "Public issue content is allowed." };
  }
  const allowed = input.providerDataClasses.includes("private_project");
  return {
    allowed,
    reason: allowed
      ? "Provider is approved for private project content."
      : "Private Jira content remains local for this provider."
  };
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
