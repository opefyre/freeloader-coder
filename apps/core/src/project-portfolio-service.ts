import type { CredentialVault } from "../../../packages/providers/src/lifecycle.js";
import {
  localProjectCollectionSchema,
  type LocalProjectCollection,
  type LocalProjectSnapshot,
} from "../../../packages/runtime/src/local-projects.js";
import type { ProjectLifecycleRecord } from "../../../packages/orchestration/src/project-lifecycle.js";
import {
  summarizeExecutionRecovery,
  type ProjectExecutionRecord,
} from "../../../packages/orchestration/src/project-execution.js";
import { resolveCurrentJiraCredential } from "./jira-oauth-credential.js";
import {
  reconcileProjectProgress,
  type ExecutionProgressObservation,
  type JiraProgressObservation,
} from "../../../packages/runtime/src/project-progress-reconciliation.js";

type Projects = { list(): Promise<LocalProjectCollection> };
type Lifecycles = { list(): Promise<readonly ProjectLifecycleRecord[]> };
type Executions = {
  get(projectId: string): Promise<ProjectExecutionRecord | null>;
};

type JiraCredential =
  | { kind: "basic"; siteUrl: string; email: string; apiToken: string }
  | { kind: "oauth"; accessToken: string };
type JiraObservation = Pick<
  LocalProjectSnapshot,
  "latestUpdate" | "progress"
> & { evidence: JiraProgressObservation };

export class ProjectPortfolioService {
  readonly #cache = new Map<
    string,
    { expiresAt: number; observation: JiraObservation }
  >();
  #oauthSites: {
    expiresAt: number;
    sites: readonly { id: string; url: string }[];
  } | null = null;

  constructor(
    private readonly projects: Projects,
    private readonly lifecycles: Lifecycles,
    private readonly executions: Executions,
    private readonly vault: Pick<CredentialVault, "read"> &
      Partial<Pick<CredentialVault, "write">>,
    private readonly fetcher: typeof fetch = fetch,
    private readonly now: () => number = Date.now,
  ) {}

  async list(): Promise<LocalProjectCollection> {
    const [collection, lifecycles, stored] = await Promise.all([
      this.projects.list(),
      this.lifecycles.list(),
      resolveCurrentJiraCredential(this.vault, this.fetcher, this.now).catch(
        () => null,
      ),
    ]);
    const lifecycleByProject = new Map(
      lifecycles.map((record) => [record.projectId, record]),
    );
    const credential = parseCredentialSafely(stored);
    const projects = await Promise.all(
      collection.projects.map(async (project) => {
        const [execution, jira] = await Promise.all([
          this.executions.get(project.id).catch(() => null),
          credential
            ? this.#observeJira(project, credential).catch(() => null)
            : Promise.resolve(null),
        ]);
        const lifecycle = lifecycleByProject.get(project.id);
        const verifiedTerminalCompletion =
          lifecycle?.stage === "complete" &&
          jira !== null &&
          jira.evidence.total > 0 &&
          jira.evidence.completed === jira.evidence.total &&
          jira.evidence.blocked === 0 &&
          jira.evidence.freshUntil >= this.now();
        const executionUpdate =
          execution && !verifiedTerminalCompletion
            ? executionLatestUpdate(execution)
            : null;
        const latestUpdate = newestUpdate(
          jira?.latestUpdate ?? null,
          executionUpdate,
        );
        const executionEvidence = execution
          ? executionObservation(execution)
          : null;
        const reconciliation = reconcileProjectProgress({
          projectId: project.id,
          jira: jira?.evidence ?? null,
          execution: executionEvidence,
          lifecycle: lifecycle
            ? { stage: lifecycle.stage, updatedAt: lifecycle.updatedAt }
            : null,
          now: this.now(),
        });
        const state = verifiedTerminalCompletion
          ? ("ready" as const)
          : execution?.state === "needs_user" ||
              execution?.state === "quarantined" ||
              lifecycle?.stage === "blocked"
            ? ("warning" as const)
            : project.state;
        return {
          ...project,
          lifecycleStage: lifecycle?.stage ?? project.lifecycleStage,
          latestUpdate,
          progress: reconciliation.progress
            ? {
                source: "jira" as const,
                ...reconciliation.progress,
                percent: reconciliation.progress.percent ?? 0,
                observedAt: jira?.evidence.observedAt ?? this.now(),
              }
            : null,
          reconciliation,
          state,
          observedAt: this.now(),
        };
      }),
    );
    return localProjectCollectionSchema.parse({
      ...collection,
      observedAt: this.now(),
      projects,
    });
  }

  async #observeJira(
    project: LocalProjectSnapshot,
    credential: JiraCredential,
  ): Promise<JiraObservation | null> {
    const binding =
      project.resources?.find(
        (resource) =>
          resource.kind === "jira_project" && resource.role === "primary",
      ) ??
      project.resources?.find((resource) => resource.kind === "jira_project");
    if (!binding?.url) return null;
    const selected = new URL(binding.url);
    const key = projectKey(selected.pathname);
    if (!key) return null;
    const access = await this.#jiraAccess(credential, selected.origin);
    if (!access) return null;
    const cacheKey = `${project.id}:${selected.origin}:${key}`;
    const cached = this.#cache.get(cacheKey);
    if (cached && cached.expiresAt > this.now()) return cached.observation;
    const jql = `project = "${escapeJql(key)}" ORDER BY updated DESC`;
    const headers = {
      Accept: "application/json",
      Authorization: access.authorization,
    };
    const issues: ReturnType<typeof parseIssue>[] = [];
    let nextPageToken: string | null = null;
    for (let page = 0; page < 50; page += 1) {
      const url = new URL(`${access.apiBase}/rest/api/3/search/jql`);
      url.searchParams.set("jql", jql);
      url.searchParams.set("maxResults", "100");
      url.searchParams.set("fields", "summary,status,updated");
      if (nextPageToken) url.searchParams.set("nextPageToken", nextPageToken);
      const response = await this.fetcher(url, { headers, redirect: "error" });
      if (!response.ok)
        throw new Error(
          `Jira project observation failed (${response.status}).`,
        );
      const text = await response.text();
      if (text.length > 2_000_000)
        throw new Error("Jira project observation is too large.");
      const body = JSON.parse(text) as Record<string, unknown>;
      const pageIssues = Array.isArray(body.issues)
        ? body.issues.map(parseIssue)
        : [];
      issues.push(...pageIssues);
      nextPageToken =
        typeof body.nextPageToken === "string" && body.nextPageToken.length > 0
          ? body.nextPageToken
          : null;
      if (body.isLast === true || !nextPageToken || pageIssues.length === 0)
        break;
    }
    if (nextPageToken)
      throw new Error(
        "Jira project exceeds the safe 5,000-item observation limit.",
      );
    const observedAt = this.now();
    const total = issues.length;
    const completed = issues.filter((issue) => issue.done).length;
    const blocked = issues.filter((issue) => issue.blocked).length;
    const latest = issues[0] ?? null;
    const observation: JiraObservation = {
      progress: {
        source: "jira",
        completed: Math.min(completed, total),
        total,
        blocked: Math.min(blocked, total),
        percent:
          total === 0
            ? 0
            : Math.round((Math.min(completed, total) / total) * 100),
        observedAt,
      },
      latestUpdate: latest
        ? {
            summary: `${latest.key} · ${latest.summary}`,
            source: "jira",
            occurredAt: latest.updatedAt,
            url: `${selected.origin}/browse/${encodeURIComponent(latest.key)}`,
          }
        : null,
      evidence: {
        projectId: project.id,
        completed,
        total,
        blocked,
        observedAt,
        freshUntil: observedAt + 60_000,
        latest: latest
          ? {
              issueKey: latest.key,
              summary: latest.summary,
              occurredAt: latest.updatedAt,
              url: `${selected.origin}/browse/${encodeURIComponent(latest.key)}`,
            }
          : null,
        issues: new Map(issues.map((issue) => [issue.key, issue.state])),
      },
    };
    this.#cache.set(cacheKey, { expiresAt: observedAt + 60_000, observation });
    return observation;
  }

  async #jiraAccess(credential: JiraCredential, selectedOrigin: string) {
    if (credential.kind === "basic") {
      if (selectedOrigin !== credential.siteUrl) return null;
      return {
        apiBase: credential.siteUrl,
        authorization: `Basic ${Buffer.from(`${credential.email}:${credential.apiToken}`, "utf8").toString("base64")}`,
      };
    }
    if (!this.#oauthSites || this.#oauthSites.expiresAt <= this.now()) {
      const response = await this.fetcher(
        "https://api.atlassian.com/oauth/token/accessible-resources",
        {
          headers: {
            Accept: "application/json",
            Authorization: `Bearer ${credential.accessToken}`,
          },
          redirect: "error",
        },
      );
      const text = await response.text();
      if (!response.ok || text.length > 1_000_000)
        throw new Error("Jira OAuth site discovery failed safely.");
      const body = JSON.parse(text) as unknown;
      if (!Array.isArray(body))
        throw new Error("Jira OAuth site discovery returned invalid data.");
      const sites = body.flatMap((item) =>
        item &&
        typeof item === "object" &&
        typeof (item as Record<string, unknown>).id === "string" &&
        typeof (item as Record<string, unknown>).url === "string"
          ? [
              {
                id: String((item as Record<string, unknown>).id),
                url: new URL(String((item as Record<string, unknown>).url))
                  .origin,
              },
            ]
          : [],
      );
      this.#oauthSites = { expiresAt: this.now() + 300_000, sites };
    }
    const site = this.#oauthSites.sites.find(
      (item) => item.url === selectedOrigin,
    );
    return site
      ? {
          apiBase: `https://api.atlassian.com/ex/jira/${encodeURIComponent(site.id)}`,
          authorization: `Bearer ${credential.accessToken}`,
        }
      : null;
  }
}

function parseCredentialSafely(value: string | null): JiraCredential | null {
  if (!value) return null;
  try {
    return parseCredential(value);
  } catch {
    // A stale or partially migrated optional Jira credential must not make the
    // local project portfolio unavailable. The connection UI remains the
    // recovery surface while local project and execution data stay visible.
    return null;
  }
}

function parseCredential(value: string): JiraCredential {
  const parsed = JSON.parse(value) as Record<string, unknown>;
  if (typeof parsed.accessToken === "string" && parsed.accessToken.length >= 8)
    return { kind: "oauth", accessToken: parsed.accessToken };
  if (
    typeof parsed.siteUrl !== "string" ||
    typeof parsed.email !== "string" ||
    typeof parsed.apiToken !== "string"
  )
    throw new Error("Stored Jira credential is invalid.");
  const site = new URL(parsed.siteUrl);
  if (
    site.protocol !== "https:" ||
    !site.hostname.endsWith(".atlassian.net") ||
    site.port
  )
    throw new Error("Stored Jira site is invalid.");
  return {
    kind: "basic",
    siteUrl: site.origin,
    email: parsed.email,
    apiToken: parsed.apiToken,
  };
}

function projectKey(pathname: string) {
  const software = pathname.match(/\/projects\/([^/]+)/);
  return software?.[1] ? decodeURIComponent(software[1]) : null;
}

function parseIssue(value: unknown) {
  if (!value || typeof value !== "object")
    throw new Error("Jira issue is invalid.");
  const issue = value as Record<string, any>;
  if (
    typeof issue.key !== "string" ||
    typeof issue.fields?.summary !== "string" ||
    typeof issue.fields?.updated !== "string"
  )
    throw new Error("Jira issue is incomplete.");
  const statusName = String(issue.fields?.status?.name ?? "").toLowerCase();
  const category = String(
    issue.fields?.status?.statusCategory?.key ?? "",
  ).toLowerCase();
  const updatedAt = Date.parse(issue.fields.updated);
  if (!Number.isFinite(updatedAt))
    throw new Error("Jira issue update time is invalid.");
  const blocked = /blocked|impediment/.test(statusName);
  return {
    key: issue.key,
    summary: issue.fields.summary.slice(0, 450),
    updatedAt,
    done: category === "done",
    blocked,
    state: blocked
      ? ("blocked" as const)
      : category === "done"
        ? ("done" as const)
        : category === "new"
          ? ("todo" as const)
          : ("active" as const),
  };
}

function executionObservation(
  record: ProjectExecutionRecord,
): ExecutionProgressObservation {
  const latest =
    [...record.tasks].sort(
      (left, right) => right.updatedAt - left.updatedAt,
    )[0] ?? null;
  return {
    projectId: record.projectId,
    observedAt: record.updatedAt,
    latest: latest
      ? {
          issueKey: latest.jiraIssueKey,
          summary: latest.safeMessage,
          occurredAt: latest.updatedAt,
        }
      : null,
    issues: new Map(
      record.tasks.map((task) => [
        task.jiraIssueKey,
        executionState(task.status),
      ]),
    ),
  };
}

function executionState(
  status: ProjectExecutionRecord["tasks"][number]["status"],
): "todo" | "active" | "done" | "blocked" {
  if (status === "completed") return "done";
  if (status === "needs_user" || status === "quarantined") return "blocked";
  if (status === "queued") return "todo";
  return "active";
}

function executionLatestUpdate(
  record: ProjectExecutionRecord,
): LocalProjectSnapshot["latestUpdate"] {
  const task = [...record.tasks].sort(
    (left, right) => right.updatedAt - left.updatedAt,
  )[0];
  if (!task) return null;
  const recovery = summarizeExecutionRecovery(record);
  return {
    summary:
      `${recovery.activeJiraIssueKey ?? "Delivery"} · ${recovery.nextAction} ${recovery.completedTasks}/${recovery.totalTasks} tasks complete.`.slice(
        0,
        500,
      ),
    source: "pipeline",
    occurredAt: task.updatedAt,
    url: null,
  };
}

function newestUpdate(
  left: LocalProjectSnapshot["latestUpdate"],
  right: LocalProjectSnapshot["latestUpdate"],
) {
  if (!left) return right ?? null;
  if (!right) return left;
  return left.occurredAt >= right.occurredAt ? left : right;
}

function escapeJql(value: string) {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}
