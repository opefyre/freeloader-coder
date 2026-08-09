import { createHash } from "node:crypto";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { z } from "zod";

import type { CredentialVault } from "../../../packages/providers/src/lifecycle.js";
import type { ExecutionTask, ProjectExecutionRecord } from "../../../packages/orchestration/src/project-execution.js";
import { JIRA_CREDENTIAL_REFERENCE } from "./jira-delivery-service.js";

const receiptSchema = z.strictObject({
  marker: z.string().regex(/^pipeline_exec_[a-f0-9]{24}$/),
  projectId: z.string().regex(/^project_[a-f0-9]{16}$/),
  taskId: z.string().regex(/^plan_[a-f0-9]{16}$/),
  revision: z.number().int().nonnegative(),
  issueKey: z.string().trim().min(2).max(100),
  status: z.string().trim().min(1).max(100).nullable(),
  commentObserved: z.boolean(),
  transitionObserved: z.boolean(),
  observedAt: z.number().int().nonnegative(),
});
const stateSchema = z.strictObject({ schemaVersion: z.literal(1), receipts: z.record(z.string(), receiptSchema) });
type DeliveryReceipt = { completed: boolean; issues: Record<string, { issueKey: string }> };

export class ProjectExecutionJiraObserver {
  readonly #path: string;
  #mutation = Promise.resolve();

  constructor(
    stateDirectory: string,
    private readonly executions: { get(projectId: string): Promise<ProjectExecutionRecord | null> },
    private readonly delivery: { get(projectId: string): Promise<DeliveryReceipt | null> },
    private readonly vault: Pick<CredentialVault, "read">,
    private readonly fetcher: typeof fetch = fetch,
    private readonly now: () => number = Date.now
  ) { this.#path = resolve(stateDirectory, "project-execution-jira-receipts.json"); }

  async synchronize(projectId: string) {
    const [execution, delivery, secret] = await Promise.all([
      this.executions.get(projectId), this.delivery.get(projectId), this.vault.read(JIRA_CREDENTIAL_REFERENCE),
    ]);
    if (!execution || !delivery?.completed) return { synchronized: 0, pending: 0 };
    if (!secret) throw new ProjectExecutionJiraObserverError("jira_disconnected", "Reconnect Jira to publish implementation evidence.");
    const credential = parseCredential(secret);
    const client = new ExecutionJiraClient(credential, this.fetcher);
    let synchronized = 0;
    for (const task of execution.tasks) {
      if (task.revision === 0) continue;
      const issueKey = delivery.issues[task.id]?.issueKey;
      if (!issueKey) throw new ProjectExecutionJiraObserverError("receipt_incomplete", `Jira receipt is missing ${task.id}.`);
      const marker = markerFor(task);
      const stored = (await this.#load()).receipts[marker];
      if (stored?.commentObserved && stored.transitionObserved) continue;
      const desiredStatus = jiraStatus(task.status);
      const commentObserved = stored?.commentObserved || await client.hasMarker(issueKey, marker);
      if (!commentObserved) await client.comment(issueKey, marker, evidenceSummary(task));
      let transitionObserved = stored?.transitionObserved ?? false;
      if (!transitionObserved) transitionObserved = desiredStatus === null || await client.ensureStatus(issueKey, desiredStatus);
      await this.#save({ marker, projectId, taskId: task.id, revision: task.revision, issueKey, status: desiredStatus, commentObserved: true, transitionObserved, observedAt: this.now() });
      if (transitionObserved) synchronized += 1;
    }
    const state = await this.#load();
    const pending = execution.tasks.filter((task) => task.revision > 0 && !state.receipts[markerFor(task)]?.transitionObserved).length;
    return { synchronized, pending };
  }

  async #save(receipt: z.infer<typeof receiptSchema>) {
    return this.#mutate(async (state) => ({ state: { ...state, receipts: { ...state.receipts, [receipt.marker]: receiptSchema.parse(receipt) } }, result: receipt }));
  }
  async #mutate<T>(operation: (state: z.infer<typeof stateSchema>) => Promise<{ state: z.infer<typeof stateSchema>; result: T }>) { let result!: T; const next = this.#mutation.then(async () => { const outcome = await operation(await this.#load()); await atomicWrite(this.#path, `${JSON.stringify(stateSchema.parse(outcome.state), null, 2)}\n`); result = outcome.result; }); this.#mutation = next.catch(() => undefined); await next; return result; }
  async #load() { try { return stateSchema.parse(JSON.parse(await readFile(this.#path, "utf8"))); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return stateSchema.parse({ schemaVersion: 1, receipts: {} }); throw new ProjectExecutionJiraObserverError("state_corrupt", "Jira execution receipt state is corrupt."); } }
}

export class ProjectExecutionJiraObserverError extends Error { constructor(readonly code: string, message: string) { super(message); } }

class ExecutionJiraClient {
  readonly #headers: Record<string, string>;
  constructor(private readonly credential: { siteUrl: string; email: string; apiToken: string }, private readonly fetcher: typeof fetch) { this.#headers = { Accept: "application/json", "Content-Type": "application/json", Authorization: `Basic ${Buffer.from(`${credential.email}:${credential.apiToken}`, "utf8").toString("base64")}` }; }
  async hasMarker(issueKey: string, marker: string) { const response = await this.json(`/rest/api/3/issue/${encodeURIComponent(issueKey)}/comment?maxResults=100&orderBy=-created`); return Array.isArray(response.comments) && response.comments.some((comment: unknown) => JSON.stringify(comment).includes(marker)); }
  async comment(issueKey: string, marker: string, summary: string) { await this.json(`/rest/api/3/issue/${encodeURIComponent(issueKey)}/comment`, { method: "POST", body: JSON.stringify({ body: document([summary, marker]) }) }); }
  async ensureStatus(issueKey: string, desired: string) {
    const issue = await this.json(`/rest/api/3/issue/${encodeURIComponent(issueKey)}?fields=status`);
    if (String(issue.fields?.status?.name ?? "").toLowerCase() === desired.toLowerCase()) return true;
    const response = await this.json(`/rest/api/3/issue/${encodeURIComponent(issueKey)}/transitions`);
    const transitions = Array.isArray(response.transitions) ? response.transitions : [];
    const match = transitions.find((transition: any) => String(transition?.to?.name ?? transition?.name ?? "").toLowerCase() === desired.toLowerCase());
    if (!match?.id) throw new ProjectExecutionJiraObserverError("transition_unavailable", `${issueKey} cannot transition to ${desired}.`);
    await this.json(`/rest/api/3/issue/${encodeURIComponent(issueKey)}/transitions`, { method: "POST", body: JSON.stringify({ transition: { id: String(match.id) } }) }, true);
    const observed = await this.json(`/rest/api/3/issue/${encodeURIComponent(issueKey)}?fields=status`);
    return String(observed.fields?.status?.name ?? "").toLowerCase() === desired.toLowerCase();
  }
  async json(path: string, init: RequestInit = {}, emptyOkay = false): Promise<any> { const response = await this.fetcher(`${this.credential.siteUrl}${path}`, { ...init, headers: this.#headers, redirect: "error" }); if (!response.ok) throw new ProjectExecutionJiraObserverError("jira_rejected", `Jira rejected execution synchronization (${response.status}).`); const text = await response.text(); if (text.length > 2_000_000) throw new ProjectExecutionJiraObserverError("response_too_large", "Jira response is too large."); if (!text && emptyOkay) return {}; try { return JSON.parse(text); } catch { throw new ProjectExecutionJiraObserverError("invalid_response", "Jira returned invalid JSON."); } }
}

function jiraStatus(status: ExecutionTask["status"]): string | null { if (["running", "validating", "healing"].includes(status)) return "In Progress"; if (["reviewing", "integrating"].includes(status)) return "In Review"; if (status === "completed") return "Done"; return null; }
function markerFor(task: ExecutionTask) { return `pipeline_exec_${hash(`${task.id}:${task.revision}:${task.status}`).slice(0, 24)}`; }
function evidenceSummary(task: ExecutionTask) { const passed = task.validations.filter((item) => item.passed).map((item) => item.tier).join(", ") || "none"; const reviewers = task.reviews.map((item) => `${item.role}:${item.verdict}`).join(", ") || "none"; return `Pipeline Studio · ${task.status.replaceAll("_", " ")} · attempt ${task.attempt + 1}. Checks: ${passed}. Reviews: ${reviewers}. Commit: ${task.commitDigest?.slice(0, 12) ?? "pending"}. ${task.safeMessage}`; }
function parseCredential(value: string) { let parsed: Record<string, unknown>; try { parsed = JSON.parse(value) as Record<string, unknown>; } catch { throw new ProjectExecutionJiraObserverError("credential_invalid", "Stored Jira credential is invalid."); } if (typeof parsed.siteUrl !== "string" || typeof parsed.email !== "string" || typeof parsed.apiToken !== "string") throw new ProjectExecutionJiraObserverError("credential_invalid", "Stored Jira credential is invalid."); const site = new URL(parsed.siteUrl); if (site.protocol !== "https:" || !site.hostname.endsWith(".atlassian.net") || site.port) throw new ProjectExecutionJiraObserverError("credential_invalid", "Stored Jira site is invalid."); return { siteUrl: site.origin, email: parsed.email, apiToken: parsed.apiToken }; }
function document(lines: readonly string[]) { return { type: "doc", version: 1, content: lines.map((text) => ({ type: "paragraph", content: [{ type: "text", text }] })) }; }
function hash(value: string) { return createHash("sha256").update(value).digest("hex"); }
async function atomicWrite(path: string, content: string) { await mkdir(dirname(path), { recursive: true, mode: 0o700 }); const temporary = `${path}.${process.pid}.tmp`; await writeFile(temporary, content, { encoding: "utf8", mode: 0o600 }); await chmod(temporary, 0o600); await rename(temporary, path); await chmod(path, 0o600); }
