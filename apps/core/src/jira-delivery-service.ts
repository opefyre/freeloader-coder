import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { z } from "zod";

import type { DeliveryPlanDraft } from "../../../packages/orchestration/src/delivery-plan.js";
import type { LocalProjectRegistry } from "./local-project-registry.js";
import type { ProjectDeliveryPlanService } from "./project-delivery-plan-service.js";
import type { ProjectLifecycleService } from "./project-lifecycle-service.js";
import type { CredentialVault } from "../../../packages/providers/src/lifecycle.js";

export const JIRA_CREDENTIAL_REFERENCE = "vault:providers/jira/default";

const issueReceiptSchema = z.strictObject({
  planItemId: z.string().regex(/^plan_[a-f0-9]{16}$/),
  issueId: z.string().trim().min(1).max(100),
  issueKey: z.string().trim().min(2).max(100),
  url: z.string().url().max(2_048),
});

const syncReceiptSchema = z.strictObject({
  schemaVersion: z.literal(1),
  projectId: z.string().regex(/^project_[a-f0-9]{16}$/),
  planDigest: z.string().regex(/^[a-f0-9]{64}$/),
  jiraProjectId: z.string().trim().min(1).max(500),
  issues: z.record(z.string(), issueReceiptSchema),
  links: z.array(z.string().trim().min(1).max(300)).max(10_000),
  completed: z.boolean(),
  updatedAt: z.number().int().nonnegative(),
});
const stateSchema = z.strictObject({ schemaVersion: z.literal(1), receipts: z.record(z.string(), syncReceiptSchema) });

type SyncReceipt = z.infer<typeof syncReceiptSchema>;

export class JiraDeliveryService {
  readonly #path: string;
  #mutation = Promise.resolve();

  constructor(
    stateDirectory: string,
    private readonly projects: Pick<LocalProjectRegistry, "list">,
    private readonly plans: Pick<ProjectDeliveryPlanService, "readDraft">,
    private readonly lifecycles: Pick<ProjectLifecycleService, "activateDelivery">,
    private readonly vault: Pick<CredentialVault, "read">,
    private readonly fetcher: typeof fetch = fetch,
    private readonly now: () => number = Date.now
  ) {
    this.#path = resolve(stateDirectory, "jira-delivery-receipts.json");
  }

  async get(projectId: string) {
    return (await this.#load()).receipts[projectId] ?? null;
  }

  async synchronize(projectId: string): Promise<SyncReceipt> {
    const [{ draft, document }, collection, stored] = await Promise.all([
      this.plans.readDraft(projectId),
      this.projects.list(),
      this.vault.read(JIRA_CREDENTIAL_REFERENCE),
    ]);
    if (!stored) throw new JiraDeliveryNeedsUserError("Connect Jira in Settings before creating the delivery plan.");
    const project = collection.projects.find((candidate) => candidate.id === projectId);
    if (!project) throw new JiraDeliveryNeedsUserError("The local project is no longer registered.");
    const binding = project.resources?.find((resource) => resource.kind === "jira_project" && resource.role === "primary") ?? project.resources?.find((resource) => resource.kind === "jira_project");
    if (!binding?.url) throw new JiraDeliveryNeedsUserError("Choose a Jira project for this project before delivery begins.");
    const credential = parseCredential(stored);
    const selected = parseSelectedProject(binding.url, binding.resourceId, credential.siteUrl);
    let receipt = await this.#initialReceipt(projectId, document.digest, selected.projectId);
    if (receipt.completed) return receipt;
    const client = new JiraClient(credential, this.fetcher);
    const catalog = await client.catalog(selected.projectId);
    for (const item of orderedItems(draft)) {
      if (receipt.issues[item.id]) continue;
      const marker = `pipeline_plan_${item.id.slice(5)}`;
      const observed = await client.findByMarker(selected.projectKey, marker);
      let issue = observed;
      if (observed && observed.summary !== null && observed.summary !== item.title) {
        throw new JiraDeliveryNeedsUserError(`${observed.key} was edited in Jira after Codkesh planned it. Review the conflict before synchronization continues.`);
      }
      if (!issue) {
        const parent = item.parentId ? receipt.issues[item.parentId] : undefined;
        issue = await client.createIssue({
          projectId: selected.projectId,
          plan: draft,
          item,
          marker,
          issueTypeId: catalog.issueTypeIds[item.type],
          accountId: catalog.accountId,
          parentKey: (item.type === "story" || item.type === "subtask") && catalog.fields[item.type].parent ? parent?.issueKey ?? null : null,
          fieldCatalog: catalog.fields[item.type],
        });
      }
      receipt = await this.#save({ ...receipt, issues: { ...receipt.issues, [item.id]: { planItemId: item.id, issueId: issue.id, issueKey: issue.key, url: `${credential.siteUrl}/browse/${encodeURIComponent(issue.key)}` } }, updatedAt: this.now() });
    }
    for (const item of draft.items) {
      if ((item.type === "task" || (item.type === "story" && !catalog.fields.story.parent)) && item.parentId) receipt = await this.#ensureLink(client, receipt, "Relates", item.id, item.parentId);
      for (const dependency of item.dependencies) receipt = await this.#ensureLink(client, receipt, "Blocks", dependency, item.id);
    }
    const epic = draft.items.find((item) => item.type === "epic");
    const epicKey = epic ? receipt.issues[epic.id]?.issueKey : null;
    if (!epicKey || Object.keys(receipt.issues).length !== draft.items.length) throw new Error("Jira delivery receipt is incomplete.");
    await this.lifecycles.activateDelivery(projectId, document.digest, epicKey);
    return this.#save({ ...receipt, completed: true, updatedAt: this.now() });
  }

  async #ensureLink(client: JiraClient, receipt: SyncReceipt, type: string, fromId: string, toId: string) {
    const signature = `${type}:${fromId}:${toId}`;
    if (receipt.links.includes(signature)) return receipt;
    const from = receipt.issues[fromId];
    const to = receipt.issues[toId];
    if (!from || !to) throw new Error("Jira relationship references an issue that was not created.");
    await client.link(type, from.issueKey, to.issueKey);
    return this.#save({ ...receipt, links: [...receipt.links, signature], updatedAt: this.now() });
  }

  async #initialReceipt(projectId: string, planDigest: string, jiraProjectId: string) {
    const existing = await this.get(projectId);
    if (existing && (existing.planDigest !== planDigest || existing.jiraProjectId !== jiraProjectId)) {
      throw new JiraDeliveryNeedsUserError("The approved plan or selected Jira project changed after synchronization began. Review the existing Jira issues before continuing.");
    }
    return existing ?? this.#save({ schemaVersion: 1, projectId, planDigest, jiraProjectId, issues: {}, links: [], completed: false, updatedAt: this.now() });
  }

  async #save(receipt: SyncReceipt) {
    return this.#mutate(async (state) => ({ state: { ...state, receipts: { ...state.receipts, [receipt.projectId]: syncReceiptSchema.parse(receipt) } }, result: receipt }));
  }

  async #mutate<T>(operation: (state: z.infer<typeof stateSchema>) => Promise<{ state: z.infer<typeof stateSchema>; result: T }>) {
    let result!: T;
    const next = this.#mutation.then(async () => {
      const outcome = await operation(await this.#load());
      await atomicWrite(this.#path, `${JSON.stringify(stateSchema.parse(outcome.state), null, 2)}\n`);
      result = outcome.result;
    });
    this.#mutation = next.catch(() => undefined);
    await next;
    return result;
  }

  async #load() {
    try { return stateSchema.parse(JSON.parse(await readFile(this.#path, "utf8"))); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return stateSchema.parse({ schemaVersion: 1, receipts: {} }); throw new Error("Jira delivery receipt state is corrupt."); }
  }
}

export class JiraDeliveryNeedsUserError extends Error {}

class JiraClient {
  readonly #headers: Record<string, string>;
  constructor(private readonly credential: JiraCredential, private readonly fetcher: typeof fetch) {
    this.#headers = { Accept: "application/json", "Content-Type": "application/json", Authorization: `Basic ${Buffer.from(`${credential.email}:${credential.apiToken}`, "utf8").toString("base64")}` };
  }

  async catalog(projectId: string) {
    const [myself, issueTypes] = await Promise.all([
      this.json("/rest/api/3/myself"),
      this.json(`/rest/api/3/issuetype/project?projectId=${encodeURIComponent(projectId)}`),
    ]);
    if (typeof myself.accountId !== "string" || !Array.isArray(issueTypes)) throw new JiraDeliveryNeedsUserError("Jira did not return the account or issue types needed for delivery.");
    const issueTypeIds = Object.fromEntries((["epic", "story", "task", "subtask"] as const).map((type) => {
      const names = type === "subtask" ? ["sub-task", "subtask"] : [type];
      const match = issueTypes.find((candidate) => candidate && typeof candidate === "object" && names.includes(String((candidate as Record<string, unknown>).name).toLowerCase()));
      if (!match || typeof (match as Record<string, unknown>).id !== "string") throw new JiraDeliveryNeedsUserError(`The selected Jira project does not provide a ${type} issue type.`);
      return [type, String((match as Record<string, unknown>).id)];
    })) as Record<DeliveryPlanDraft["items"][number]["type"], string>;
    const metadata = await Promise.all((["epic", "story", "task", "subtask"] as const).map(async (type) => {
      const response = await this.json(`/rest/api/3/issue/createmeta/${encodeURIComponent(projectId)}/issuetypes/${encodeURIComponent(issueTypeIds[type])}?maxResults=200`);
      const fields = response && typeof response === "object" && !Array.isArray(response) && (response as Record<string, unknown>).fields;
      if (!fields || typeof fields !== "object" || Array.isArray(fields)) throw new JiraDeliveryNeedsUserError(`Jira did not return create fields for ${type} issues.`);
      return [type, parseCreateFields(fields as Record<string, unknown>)] as const;
    }));
    const fields = Object.fromEntries(metadata) as Record<DeliveryPlanDraft["items"][number]["type"], JiraCreateFields>;
    for (const type of ["epic", "story", "task", "subtask"] as const) if (!fields[type].assignee) throw new JiraDeliveryNeedsUserError(`Jira does not allow assigning ${type} issues to the connected account.`);
    if (!fields.story.storyPoints || !fields.task.storyPoints) throw new JiraDeliveryNeedsUserError("The selected Jira project must expose story points for Story and Task issues.");
    if (!fields.subtask.parent) throw new JiraDeliveryNeedsUserError("The selected Jira project must support parent links for subtasks.");
    return { accountId: myself.accountId, issueTypeIds, fields };
  }

  async findByMarker(projectKey: string, marker: string) {
    const query = `project = "${escapeJql(projectKey)}" AND labels = "${marker}"`;
    const result = await this.json(`/rest/api/3/search/jql?jql=${encodeURIComponent(query)}&maxResults=2&fields=key,summary`, { method: "GET" });
    const issues = Array.isArray(result.issues) ? result.issues : [];
    if (issues.length > 1) throw new JiraDeliveryNeedsUserError(`Jira contains duplicate pipeline markers for ${marker}.`);
    return issues.length === 1 ? parseIssue(issues[0]) : null;
  }

  async createIssue(input: { projectId: string; plan: DeliveryPlanDraft; item: DeliveryPlanDraft["items"][number]; marker: string; issueTypeId: string; accountId: string; parentKey: string | null; fieldCatalog: JiraCreateFields }) {
    const fields: Record<string, unknown> = {
      project: { id: input.projectId },
      issuetype: { id: input.issueTypeId },
      summary: input.item.title,
      description: adf(input.item, input.plan),
      labels: [input.marker],
      assignee: { accountId: input.accountId },
    };
    if (input.fieldCatalog.priority) fields.priority = { id: priorityId(input.fieldCatalog, input.item.priority) };
    if (input.item.storyPoints !== null && input.fieldCatalog.storyPoints) fields[input.fieldCatalog.storyPoints] = input.item.storyPoints;
    if (input.item.type === "epic" && input.fieldCatalog.epicName) fields[input.fieldCatalog.epicName] = input.item.title;
    if (input.parentKey) fields.parent = { key: input.parentKey };
    return parseIssue(await this.json("/rest/api/3/issue", { method: "POST", body: JSON.stringify({ fields }) }));
  }

  async link(type: string, inwardKey: string, outwardKey: string) {
    await this.json("/rest/api/3/issueLink", { method: "POST", body: JSON.stringify({ type: { name: type }, inwardIssue: { key: inwardKey }, outwardIssue: { key: outwardKey } }) }, true);
  }

  async json(path: string, init: RequestInit = {}, emptyOkay = false): Promise<any> {
    const response = await this.fetcher(`${this.credential.siteUrl}${path}`, { ...init, headers: this.#headers, redirect: "error" });
    if (!response.ok) throw new JiraDeliveryNeedsUserError(`Jira rejected delivery synchronization (${response.status}). Review project permissions and fields.`);
    const text = await response.text();
    if (text.length > 2_000_000) throw new Error("Jira response is too large.");
    if (!text && emptyOkay) return {};
    try { return JSON.parse(text); } catch { throw new Error("Jira returned invalid JSON."); }
  }
}

type JiraCredential = { siteUrl: string; email: string; apiToken: string };
function parseCredential(value: string): JiraCredential {
  const parsed = JSON.parse(value) as Record<string, unknown>;
  if (typeof parsed.siteUrl !== "string" || typeof parsed.email !== "string" || typeof parsed.apiToken !== "string") throw new Error("Stored Jira credential is invalid.");
  const siteUrl = new URL(parsed.siteUrl);
  if (siteUrl.protocol !== "https:" || !siteUrl.hostname.endsWith(".atlassian.net") || siteUrl.port) throw new Error("Stored Jira site is invalid.");
  return { siteUrl: siteUrl.origin, email: parsed.email, apiToken: parsed.apiToken };
}
function parseSelectedProject(urlValue: string, projectId: string, siteUrl: string) {
  const url = new URL(urlValue);
  if (url.origin !== siteUrl) throw new JiraDeliveryNeedsUserError("The selected Jira project belongs to a different connected Jira site.");
  const match = url.pathname.match(/\/projects\/([^/]+)/);
  if (!match?.[1]) throw new JiraDeliveryNeedsUserError("The selected Jira project key could not be verified.");
  return { projectId, projectKey: decodeURIComponent(match[1]) };
}
function orderedItems(plan: DeliveryPlanDraft) { const rank = { epic: 0, story: 1, task: 2, subtask: 3 }; return [...plan.items].sort((a, b) => rank[a.type] - rank[b.type]); }
function parseIssue(value: unknown) { if (!value || typeof value !== "object") throw new Error("Jira issue response is invalid."); const issue = value as Record<string, unknown>; if (typeof issue.id !== "string" || typeof issue.key !== "string") throw new Error("Jira issue response is incomplete."); const fields = issue.fields && typeof issue.fields === "object" ? issue.fields as Record<string, unknown> : null; return { id: issue.id, key: issue.key, summary: typeof fields?.summary === "string" ? fields.summary : null }; }
function escapeJql(value: string) { return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"'); }
type JiraCreateFields = { assignee: boolean; parent: boolean; storyPoints: string | null; epicName: string | null; priority: readonly { id: string; name: string }[] | null };
function parseCreateFields(fields: Record<string, unknown>): JiraCreateFields {
  let storyPoints: string | null = null;
  let epicName: string | null = null;
  for (const [id, raw] of Object.entries(fields)) {
    if (!raw || typeof raw !== "object") continue;
    const name = String((raw as Record<string, unknown>).name ?? "").toLowerCase();
    if (["story points", "story point estimate"].includes(name)) storyPoints = id;
    if (name === "epic name") epicName = id;
  }
  const priorityRaw = fields.priority && typeof fields.priority === "object" ? (fields.priority as Record<string, unknown>).allowedValues : null;
  const priority = Array.isArray(priorityRaw) ? priorityRaw.flatMap((raw) => raw && typeof raw === "object" && typeof (raw as Record<string, unknown>).id === "string" && typeof (raw as Record<string, unknown>).name === "string" ? [{ id: String((raw as Record<string, unknown>).id), name: String((raw as Record<string, unknown>).name) }] : []) : null;
  return { assignee: Boolean(fields.assignee), parent: Boolean(fields.parent), storyPoints, epicName, priority };
}
function priorityId(fields: JiraCreateFields, requested: DeliveryPlanDraft["items"][number]["priority"]) {
  const priorities = fields.priority ?? [];
  const normalized = requested.replaceAll("_", " ").toLowerCase();
  const exact = priorities.find((priority) => priority.name.toLowerCase() === normalized);
  const fallbackOrder = requested === "highest" ? ["highest", "high"] : requested === "lowest" ? ["lowest", "low"] : [requested, "medium"];
  const fallback = fallbackOrder.map((name) => priorities.find((priority) => priority.name.toLowerCase() === name)).find(Boolean);
  if (!exact && !fallback) throw new JiraDeliveryNeedsUserError(`Jira does not provide a usable ${requested} priority.`);
  return (exact ?? fallback)!.id;
}
function adf(item: DeliveryPlanDraft["items"][number], plan: DeliveryPlanDraft) { const coverage = plan.coverage.filter((entry) => entry.itemIds.includes(item.id)); const gates = plan.gates.filter((gate) => gate.beforeItemIds.includes(item.id)); const paragraphs = [item.description, `Plan ID: ${item.id}`, `Parent: ${item.parentId ?? "None"}`, `Estimate: ${item.estimatedMinutes} minutes${item.storyPoints ? ` / ${item.storyPoints} points` : ""}`, `Capabilities: ${item.roleCapabilities.join(", ")}`, `Allowed files: ${item.allowedFiles.join(", ") || "None"}`, `Validation: ${item.validationProfiles.join(", ") || "None"}`, "Requirement coverage", ...(coverage.length ? coverage.map((entry) => `• ${entry.requirement}: ${entry.validationProfiles.join(", ")}`) : ["• Inherited through child work."]), "Approval and infrastructure gates", ...(gates.length ? gates.map((gate) => `• ${gate.kind} — ${gate.title}: ${gate.rationale}`) : ["• None for this item."]), "Acceptance criteria", ...item.acceptanceCriteria.map((entry) => `• ${entry}`), "Definition of Done", ...item.definitionOfDone.map((entry) => `• ${entry}`), "Implementation notes", ...item.implementationNotes.map((entry) => `• ${entry}`), "Rollback requirements", ...item.rollbackRequirements.map((entry) => `• ${entry}`), "Sources", ...item.citations.map((entry) => `• ${entry}`)]; return { type: "doc", version: 1, content: paragraphs.map((text) => ({ type: "paragraph", content: [{ type: "text", text }] })) }; }
async function atomicWrite(path: string, content: string) { await mkdir(dirname(path), { recursive: true, mode: 0o700 }); const temporary = `${path}.${process.pid}.tmp`; await writeFile(temporary, content, { encoding: "utf8", mode: 0o600 }); await chmod(temporary, 0o600); await rename(temporary, path); await chmod(path, 0o600); }
