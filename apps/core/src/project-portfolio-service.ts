import type { CredentialVault } from "../../../packages/providers/src/lifecycle.js";
import {
  localProjectCollectionSchema,
  type LocalProjectCollection,
  type LocalProjectSnapshot,
} from "../../../packages/runtime/src/local-projects.js";
import type { ProjectLifecycleRecord } from "../../../packages/orchestration/src/project-lifecycle.js";
import type { ProjectExecutionRecord } from "../../../packages/orchestration/src/project-execution.js";
import { JIRA_CREDENTIAL_REFERENCE } from "./jira-delivery-service.js";

type Projects = { list(): Promise<LocalProjectCollection> };
type Lifecycles = { list(): Promise<readonly ProjectLifecycleRecord[]> };
type Executions = { get(projectId: string): Promise<ProjectExecutionRecord | null> };

type JiraCredential = { siteUrl: string; email: string; apiToken: string };
type JiraObservation = Pick<LocalProjectSnapshot, "latestUpdate" | "progress">;

export class ProjectPortfolioService {
  readonly #cache = new Map<string, { expiresAt: number; observation: JiraObservation }>();

  constructor(
    private readonly projects: Projects,
    private readonly lifecycles: Lifecycles,
    private readonly executions: Executions,
    private readonly vault: Pick<CredentialVault, "read">,
    private readonly fetcher: typeof fetch = fetch,
    private readonly now: () => number = Date.now
  ) {}

  async list(): Promise<LocalProjectCollection> {
    const [collection, lifecycles, stored] = await Promise.all([
      this.projects.list(),
      this.lifecycles.list(),
      this.vault.read(JIRA_CREDENTIAL_REFERENCE),
    ]);
    const lifecycleByProject = new Map(lifecycles.map((record) => [record.projectId, record]));
    const credential = stored ? parseCredential(stored) : null;
    const projects = await Promise.all(collection.projects.map(async (project) => {
      const [execution, jira] = await Promise.all([
        this.executions.get(project.id),
        credential ? this.#observeJira(project, credential).catch(() => null) : Promise.resolve(null),
      ]);
      const lifecycle = lifecycleByProject.get(project.id);
      const executionUpdate = execution ? executionLatestUpdate(execution) : null;
      const latestUpdate = newestUpdate(jira?.latestUpdate ?? null, executionUpdate);
      const state = execution?.state === "needs_user" || execution?.state === "quarantined" || lifecycle?.stage === "blocked"
        ? "warning" as const
        : project.state;
      return {
        ...project,
        lifecycleStage: lifecycle?.stage ?? project.lifecycleStage,
        latestUpdate,
        progress: jira?.progress ?? null,
        state,
        observedAt: this.now(),
      };
    }));
    return localProjectCollectionSchema.parse({ ...collection, observedAt: this.now(), projects });
  }

  async #observeJira(project: LocalProjectSnapshot, credential: JiraCredential): Promise<JiraObservation | null> {
    const binding = project.resources?.find((resource) => resource.kind === "jira_project" && resource.role === "primary")
      ?? project.resources?.find((resource) => resource.kind === "jira_project");
    if (!binding?.url) return null;
    const selected = new URL(binding.url);
    if (selected.origin !== credential.siteUrl) return null;
    const key = projectKey(selected.pathname);
    if (!key) return null;
    const cacheKey = `${credential.siteUrl}:${key}`;
    const cached = this.#cache.get(cacheKey);
    if (cached && cached.expiresAt > this.now()) return cached.observation;
    const authorization = `Basic ${Buffer.from(`${credential.email}:${credential.apiToken}`, "utf8").toString("base64")}`;
    const jql = `project = "${escapeJql(key)}" ORDER BY updated DESC`;
    const headers = { Accept: "application/json", Authorization: authorization };
    const issues: ReturnType<typeof parseIssue>[] = [];
    let nextPageToken: string | null = null;
    for (let page = 0; page < 50; page += 1) {
      const url = new URL("/rest/api/3/search/jql", credential.siteUrl);
      url.searchParams.set("jql", jql);
      url.searchParams.set("maxResults", "100");
      url.searchParams.set("fields", "summary,status,updated");
      if (nextPageToken) url.searchParams.set("nextPageToken", nextPageToken);
      const response = await this.fetcher(url, { headers, redirect: "error" });
      if (!response.ok) throw new Error(`Jira project observation failed (${response.status}).`);
      const text = await response.text();
      if (text.length > 2_000_000) throw new Error("Jira project observation is too large.");
      const body = JSON.parse(text) as Record<string, unknown>;
      const pageIssues = Array.isArray(body.issues) ? body.issues.map(parseIssue) : [];
      issues.push(...pageIssues);
      nextPageToken = typeof body.nextPageToken === "string" && body.nextPageToken.length > 0 ? body.nextPageToken : null;
      if (body.isLast === true || !nextPageToken || pageIssues.length === 0) break;
    }
    if (nextPageToken) throw new Error("Jira project exceeds the safe 5,000-item observation limit.");
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
        percent: total === 0 ? 0 : Math.round((Math.min(completed, total) / total) * 100),
        observedAt,
      },
      latestUpdate: latest ? {
        summary: `${latest.key} · ${latest.summary}`,
        source: "jira",
        occurredAt: latest.updatedAt,
        url: `${credential.siteUrl}/browse/${encodeURIComponent(latest.key)}`,
      } : null,
    };
    this.#cache.set(cacheKey, { expiresAt: observedAt + 60_000, observation });
    return observation;
  }
}

function parseCredential(value: string): JiraCredential {
  const parsed = JSON.parse(value) as Record<string, unknown>;
  if (typeof parsed.siteUrl !== "string" || typeof parsed.email !== "string" || typeof parsed.apiToken !== "string") throw new Error("Stored Jira credential is invalid.");
  const site = new URL(parsed.siteUrl);
  if (site.protocol !== "https:" || !site.hostname.endsWith(".atlassian.net") || site.port) throw new Error("Stored Jira site is invalid.");
  return { siteUrl: site.origin, email: parsed.email, apiToken: parsed.apiToken };
}

function projectKey(pathname: string) {
  const software = pathname.match(/\/projects\/([^/]+)/);
  return software?.[1] ? decodeURIComponent(software[1]) : null;
}

function parseIssue(value: unknown) {
  if (!value || typeof value !== "object") throw new Error("Jira issue is invalid.");
  const issue = value as Record<string, any>;
  if (typeof issue.key !== "string" || typeof issue.fields?.summary !== "string" || typeof issue.fields?.updated !== "string") throw new Error("Jira issue is incomplete.");
  const statusName = String(issue.fields?.status?.name ?? "").toLowerCase();
  const category = String(issue.fields?.status?.statusCategory?.key ?? "").toLowerCase();
  const updatedAt = Date.parse(issue.fields.updated);
  if (!Number.isFinite(updatedAt)) throw new Error("Jira issue update time is invalid.");
  return { key: issue.key, summary: issue.fields.summary.slice(0, 450), updatedAt, done: category === "done", blocked: /blocked|impediment/.test(statusName) };
}

function executionLatestUpdate(record: ProjectExecutionRecord): LocalProjectSnapshot["latestUpdate"] {
  const task = [...record.tasks].sort((left, right) => right.updatedAt - left.updatedAt)[0];
  if (!task) return null;
  return {
    summary: `${task.jiraIssueKey} · ${task.safeMessage}`.slice(0, 500),
    source: "pipeline",
    occurredAt: task.updatedAt,
    url: null,
  };
}

function newestUpdate(left: LocalProjectSnapshot["latestUpdate"], right: LocalProjectSnapshot["latestUpdate"]) {
  if (!left) return right ?? null;
  if (!right) return left;
  return left.occurredAt >= right.occurredAt ? left : right;
}

function escapeJql(value: string) { return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"'); }
