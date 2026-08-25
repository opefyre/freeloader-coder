import { createHash } from "node:crypto";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { z } from "zod";

import type { CredentialVault } from "../../../packages/providers/src/lifecycle.js";
import type { ExecutionTask, ProjectExecutionRecord } from "../../../packages/orchestration/src/project-execution.js";
import type { DeliveryPlanDraft, DeliveryPlanContent } from "../../../packages/orchestration/src/delivery-plan.js";
import { assertJiraClosureEligible, JiraClosurePolicyError, type JiraClosureEvidence } from "../../../packages/orchestration/src/jira-closure-policy.js";
import { JIRA_CREDENTIAL_REFERENCE } from "./jira-delivery-service.js";
import { resolveCurrentJiraCredential } from "./jira-oauth-credential.js";

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
    private readonly plans: { readDraft(projectId: string): Promise<{ draft: DeliveryPlanDraft }> },
    private readonly vault: Pick<CredentialVault, "read"> & Partial<Pick<CredentialVault, "write">>,
    private readonly fetcher: typeof fetch = fetch,
    private readonly now: () => number = Date.now
  ) { this.#path = resolve(stateDirectory, "project-execution-jira-receipts.json"); }

  async synchronize(projectId: string) {
    const [execution, delivery, plan, secret] = await Promise.all([
      this.executions.get(projectId), this.delivery.get(projectId), this.plans.readDraft(projectId), resolveCurrentJiraCredential(this.vault, this.fetcher, this.now),
    ]);
    if (!execution || !delivery?.completed) return { synchronized: 0, pending: 0 };
    if (!secret) throw new ProjectExecutionJiraObserverError("jira_disconnected", "Reconnect Jira to publish implementation evidence.");
    const credential = parseCredential(secret);
    const client = new ExecutionJiraClient(await resolveExecutionJiraAccess(credential, this.fetcher), this.fetcher);
    let synchronized = 0;
    for (const task of execution.tasks) {
      if (task.revision === 0) continue;
      const issueKey = delivery.issues[task.id]?.issueKey;
      if (!issueKey) throw new ProjectExecutionJiraObserverError("receipt_incomplete", `Jira receipt is missing ${task.id}.`);
      const marker = markerFor(task);
      const receipts = (await this.#load()).receipts;
      const stored = receipts[marker];
      if (stored?.commentObserved && stored.transitionObserved) continue;
      const desiredStatus = jiraStatus(task.status);
      if (desiredStatus === "Done") {
        const item = plan.draft.items.find((candidate) => candidate.id === task.id);
        if (!item) throw new ProjectExecutionJiraObserverError("closure_plan_missing", `${issueKey} cannot close because its reviewed plan item is missing.`);
        try { assertJiraClosureEligible(closureCandidate(task, item.acceptanceCriteria)); }
        catch (error) {
          if (error instanceof JiraClosurePolicyError) throw new ProjectExecutionJiraObserverError("closure_evidence_incomplete", error.message);
          throw error;
        }
      }
      const commentObserved = stored?.commentObserved || await client.hasMarker(issueKey, marker);
      if (!commentObserved) await client.comment(issueKey, marker, evidenceSummary(task));
      let transitionObserved = stored?.transitionObserved ?? false;
      const previouslyObservedWorkflow = Object.values(receipts).some((receipt) =>
        receipt.projectId === projectId && receipt.taskId === task.id && receipt.status !== null && receipt.transitionObserved
      );
      if (!transitionObserved) transitionObserved = desiredStatus === null || await client.ensureStatus(issueKey, desiredStatus, { allowInitialAdvance: !previouslyObservedWorkflow });
      await this.#save({ marker, projectId, taskId: task.id, revision: task.revision, issueKey, status: desiredStatus, commentObserved: true, transitionObserved, observedAt: this.now() });
      if (transitionObserved) synchronized += 1;
    }
    synchronized += await this.#synchronizeParents(projectId, execution, delivery, plan.draft, client);
    const state = await this.#load();
    const executablePending = execution.tasks.filter((task) => task.revision > 0 && !state.receipts[markerFor(task)]?.transitionObserved).length;
    const parentPending = plan.draft.items.filter((item) => ["task", "story", "epic"].includes(item.type) && !parentReceiptObserved(item, plan.draft, state.receipts)).length;
    const pending = executablePending + parentPending;
    return { synchronized, pending };
  }

  async #synchronizeParents(projectId: string, execution: ProjectExecutionRecord, delivery: DeliveryReceipt, plan: DeliveryPlanDraft, client: ExecutionJiraClient) {
    let synchronized = 0;
    for (const item of parentClosureOrder(plan)) {
      const issueKey = delivery.issues[item.id]?.issueKey;
      if (!issueKey) throw new ProjectExecutionJiraObserverError("receipt_incomplete", `Jira receipt is missing ${item.id}.`);
      const children = plan.items.filter((candidate) => candidate.parentId === item.id);
      const state = await this.#load();
      const childReceipts = children.map((child) => latestObservedReceipt(child.id, state.receipts));
      if (childReceipts.some((receipt) => !receipt?.transitionObserved || receipt.status !== "Done")) continue;
      const descendants = descendantExecutionTasks(item.id, plan, execution);
      if (descendants.length === 0) continue;
      const marker = parentMarker(item.id, childReceipts.map((receipt) => receipt!.marker));
      const stored = state.receipts[marker];
      if (stored?.commentObserved && stored.transitionObserved) continue;
      try { assertJiraClosureEligible(parentClosureCandidate(issueKey, item.acceptanceCriteria, descendants, childReceipts.map((receipt) => receipt!.issueKey))); }
      catch (error) {
        if (error instanceof JiraClosurePolicyError) continue;
        throw error;
      }
      const commentObserved = stored?.commentObserved || await client.hasMarker(issueKey, marker);
      if (!commentObserved) await client.comment(issueKey, marker, parentEvidenceSummary(descendants, childReceipts.map((receipt) => receipt!.issueKey)));
      const transitionObserved = stored?.transitionObserved || await client.ensureStatus(issueKey, "Done", { allowInitialAdvance: true });
      await this.#save({ marker, projectId, taskId: item.id, revision: Math.max(...descendants.map((task) => task.revision)), issueKey, status: "Done", commentObserved: true, transitionObserved, observedAt: this.now() });
      if (transitionObserved) synchronized += 1;
    }
    return synchronized;
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
  constructor(private readonly access: { apiBase: string; authorization: string }, private readonly fetcher: typeof fetch) { this.#headers = { Accept: "application/json", "Content-Type": "application/json", Authorization: access.authorization }; }
  async hasMarker(issueKey: string, marker: string) { const response = await this.json(`/rest/api/3/issue/${encodeURIComponent(issueKey)}/comment?maxResults=100&orderBy=-created`); return Array.isArray(response.comments) && response.comments.some((comment: unknown) => JSON.stringify(comment).includes(marker)); }
  async comment(issueKey: string, marker: string, summary: string) { await this.json(`/rest/api/3/issue/${encodeURIComponent(issueKey)}/comment`, { method: "POST", body: JSON.stringify({ body: document([summary, marker]) }) }); }
  async ensureStatus(issueKey: string, desired: string, options: { allowInitialAdvance: boolean }) {
    const issue = await this.json(`/rest/api/3/issue/${encodeURIComponent(issueKey)}?fields=status`);
    const current = String(issue.fields?.status?.name ?? "");
    if (current.toLowerCase() === desired.toLowerCase()) return true;
    const initialAdvance = options.allowInitialAdvance && desired === "Done" && initialStatuses().includes(current.toLowerCase());
    if (!initialAdvance && !safePredecessors(desired).includes(current.toLowerCase())) {
      throw new ProjectExecutionJiraObserverError("external_edit", `${issueKey} is ${current || "in an unknown status"} in Jira. Codkesh will not overwrite that external change.`);
    }
    const response = await this.json(`/rest/api/3/issue/${encodeURIComponent(issueKey)}/transitions`);
    const transitions = Array.isArray(response.transitions) ? response.transitions : [];
    const match = transitions.find((transition: any) => String(transition?.to?.name ?? transition?.name ?? "").toLowerCase() === desired.toLowerCase());
    if (!match?.id) throw new ProjectExecutionJiraObserverError("transition_unavailable", `${issueKey} cannot transition to ${desired}.`);
    await this.json(`/rest/api/3/issue/${encodeURIComponent(issueKey)}/transitions`, { method: "POST", body: JSON.stringify({ transition: { id: String(match.id) } }) }, true);
    const observed = await this.json(`/rest/api/3/issue/${encodeURIComponent(issueKey)}?fields=status`);
    return String(observed.fields?.status?.name ?? "").toLowerCase() === desired.toLowerCase();
  }
  async json(path: string, init: RequestInit = {}, emptyOkay = false): Promise<any> { const response = await this.fetcher(`${this.access.apiBase}${path}`, { ...init, headers: this.#headers, redirect: "error" }); if (!response.ok) throw new ProjectExecutionJiraObserverError("jira_rejected", `Jira rejected execution synchronization (${response.status}).`); const text = await response.text(); if (text.length > 2_000_000) throw new ProjectExecutionJiraObserverError("response_too_large", "Jira response is too large."); if (!text && emptyOkay) return {}; try { return JSON.parse(text); } catch { throw new ProjectExecutionJiraObserverError("invalid_response", "Jira returned invalid JSON."); } }
}

function jiraStatus(status: ExecutionTask["status"]): string | null { if (["running", "validating", "healing"].includes(status)) return "In Progress"; if (["reviewing", "integrating"].includes(status)) return "In Review"; if (status === "completed") return "Done"; return null; }
function safePredecessors(desired: string) { if (desired === "In Progress") return ["to do", "open", "selected for development"]; if (desired === "In Review") return ["in progress"]; if (desired === "Done") return ["in progress", "in review"]; return []; }
function initialStatuses() { return ["to do", "open", "selected for development"]; }
function markerFor(task: ExecutionTask) { return `pipeline_exec_${hash(`${task.id}:${task.revision}:${task.status}`).slice(0, 24)}`; }
function parentMarker(itemId: string, childMarkers: readonly string[]) { return `pipeline_exec_${hash(`${itemId}:${[...childMarkers].sort().join(":")}:Done`).slice(0, 24)}`; }
function evidenceSummary(task: ExecutionTask) { const passed = task.validations.filter((item) => item.passed).map((item) => item.tier).join(", ") || "none"; const reviewers = task.reviews.map((item) => `${item.role}:${item.verdict}`).join(", ") || "none"; return `Codkesh acceptance evidence · ${task.status.replaceAll("_", " ")} · attempt ${task.attempt + 1}. Deterministic validation: ${passed}. Independent reviews: ${reviewers}. Commit: ${task.commitDigest?.slice(0, 12) ?? "pending"}. ${task.safeMessage}`; }
function closureCandidate(task: ExecutionTask, criteria: readonly string[]) {
  const integration = task.validations.findLast((item) => item.tier === "integration" && item.passed);
  const acceptanceCriteria = criteria.map((text, index) => ({ id: `AC-${index + 1}`, text }));
  const evidence: JiraClosureEvidence[] = acceptanceCriteria.flatMap((criterion): JiraClosureEvidence[] => [
    ...(integration ? [{ criterionId: criterion.id, kind: "deterministic_test" as const, reference: `validation://${task.jiraIssueKey}/${criterion.id}`, digest: integration.evidenceDigest, observedAt: integration.observedAt, provenance: "observed" as const, resolved: true }] : []),
    ...task.reviews.filter((review) => review.verdict === "pass").map((review) => ({ criterionId: criterion.id, kind: "independent_review" as const, reference: `review://${task.jiraIssueKey}/${criterion.id}/${encodeURIComponent(review.reviewerId)}`, digest: review.evidenceDigest, observedAt: review.observedAt, provenance: "observed" as const, resolved: true })),
  ]);
  if (task.commitDigest && acceptanceCriteria[0]) evidence.push({ criterionId: acceptanceCriteria[0].id, kind: "commit", reference: `commit://${task.jiraIssueKey}/${task.commitDigest}`, digest: task.commitDigest, observedAt: task.updatedAt, provenance: "observed", resolved: true });
  const liveJourney = task.liveJourneyEvidence;
  if (liveJourney?.passed && liveJourney.revisionDigest === task.commitDigest && liveJourney.assertions.every((assertion) => assertion.passed) && acceptanceCriteria[0]) {
    evidence.push({ criterionId: acceptanceCriteria[0].id, kind: "live_journey", reference: liveJourney.reference, digest: hash(JSON.stringify(liveJourney)), observedAt: liveJourney.observedAt, provenance: "observed", resolved: true });
  }
  return {
    issueKey: task.jiraIssueKey, kind: "work_item" as const, acceptanceCriteria, evidence,
    requiredValidationProfiles: ["fast", "full", "integration"],
    passedValidationProfiles: task.validations.filter((item) => item.passed).map((item) => item.tier),
    reviewerIds: task.reviews.filter((review) => review.verdict === "pass").map((review) => review.providerId),
    implementerId: task.assignment?.providerId ?? "missing-implementer",
    commitDigest: task.commitDigest,
    liveJourneyRequired: task.uiChanged || task.validationProfiles.includes("visual"),
    closureComment: evidenceSummary(task), children: [], priorTransitions: [],
  };
}
type PlanItem = DeliveryPlanContent["items"][number];
function parentClosureOrder(plan: DeliveryPlanDraft) {
  const rank = { task: 0, story: 1, epic: 2 } as const;
  return plan.items.filter((item): item is PlanItem & { type: keyof typeof rank } => item.type !== "subtask").sort((left, right) => rank[left.type] - rank[right.type] || left.id.localeCompare(right.id));
}
function latestObservedReceipt(itemId: string, receipts: Record<string, z.infer<typeof receiptSchema>>) {
  return Object.values(receipts).filter((receipt) => receipt.taskId === itemId).sort((left, right) => right.observedAt - left.observedAt || right.revision - left.revision)[0];
}
function parentReceiptObserved(item: PlanItem, plan: DeliveryPlanDraft, receipts: Record<string, z.infer<typeof receiptSchema>>) {
  const children = plan.items.filter((candidate) => candidate.parentId === item.id);
  const childMarkers = children.map((child) => latestObservedReceipt(child.id, receipts)?.marker).filter((marker): marker is string => Boolean(marker));
  if (childMarkers.length !== children.length) return false;
  return Boolean(receipts[parentMarker(item.id, childMarkers)]?.transitionObserved);
}
function descendantExecutionTasks(itemId: string, plan: DeliveryPlanDraft, execution: ProjectExecutionRecord): ExecutionTask[] {
  const descendants = new Set<string>();
  const visit = (parentId: string) => { for (const item of plan.items.filter((candidate) => candidate.parentId === parentId)) { descendants.add(item.id); visit(item.id); } };
  visit(itemId);
  return execution.tasks.filter((task) => descendants.has(task.id) && task.status === "completed");
}
function parentClosureCandidate(issueKey: string, criteria: readonly string[], descendants: readonly ExecutionTask[], childIssueKeys: readonly string[]) {
  const acceptanceCriteria = criteria.map((text, index) => ({ id: `AC-${index + 1}`, text }));
  const integrations = descendants.flatMap((task) => task.validations.filter((item) => item.tier === "integration" && item.passed));
  const reviews = descendants.flatMap((task) => task.reviews.filter((review) => review.verdict === "pass"));
  const commitTask = descendants.find((task) => task.commitDigest);
  const liveTask = descendants.find((task) => task.liveJourneyEvidence?.passed && task.liveJourneyEvidence.revisionDigest === task.commitDigest);
  const evidence: JiraClosureEvidence[] = acceptanceCriteria.flatMap((criterion): JiraClosureEvidence[] => [
    ...(integrations[0] ? [{ criterionId: criterion.id, kind: "deterministic_test" as const, reference: `validation://${issueKey}/${criterion.id}/descendants`, digest: integrations[0].evidenceDigest, observedAt: integrations[0].observedAt, provenance: "observed" as const, resolved: true }] : []),
    ...reviews.slice(0, 2).map((review) => ({ criterionId: criterion.id, kind: "independent_review" as const, reference: `review://${issueKey}/${criterion.id}/${encodeURIComponent(review.reviewerId)}`, digest: review.evidenceDigest, observedAt: review.observedAt, provenance: "observed" as const, resolved: true })),
  ]);
  if (commitTask?.commitDigest && acceptanceCriteria[0]) evidence.push({ criterionId: acceptanceCriteria[0].id, kind: "commit", reference: `commit://${issueKey}/${commitTask.commitDigest}`, digest: commitTask.commitDigest, observedAt: commitTask.updatedAt, provenance: "observed", resolved: true });
  if (liveTask?.liveJourneyEvidence && acceptanceCriteria[0]) evidence.push({ criterionId: acceptanceCriteria[0].id, kind: "live_journey", reference: liveTask.liveJourneyEvidence.reference, digest: hash(JSON.stringify(liveTask.liveJourneyEvidence)), observedAt: liveTask.liveJourneyEvidence.observedAt, provenance: "observed", resolved: true });
  return { issueKey, kind: "parent" as const, acceptanceCriteria, evidence, requiredValidationProfiles: ["fast", "full", "integration"], passedValidationProfiles: descendants.flatMap((task) => task.validations.filter((item) => item.passed).map((item) => item.tier)), reviewerIds: reviews.map((review) => review.providerId), implementerId: "parent-aggregation", commitDigest: commitTask?.commitDigest ?? null, liveJourneyRequired: descendants.some((task) => task.uiChanged || task.validationProfiles.includes("visual")), closureComment: parentEvidenceSummary(descendants, childIssueKeys), children: childIssueKeys.map((child) => ({ issueKey: child, done: true, proofComplete: true })), priorTransitions: [] };
}
function parentEvidenceSummary(descendants: readonly ExecutionTask[], childIssueKeys: readonly string[]) { return `Codkesh parent acceptance evidence is complete. Verified children: ${childIssueKeys.join(", ")}. Deterministic validation, independent review, and commit evidence aggregate ${descendants.length} executable descendant${descendants.length === 1 ? "" : "s"}.`; }
type ExecutionJiraCredential = { kind: "oauth"; accessToken: string } | { kind: "basic"; siteUrl: string; email: string; apiToken: string };
function parseCredential(value: string): ExecutionJiraCredential { let parsed: Record<string, unknown>; try { parsed = JSON.parse(value) as Record<string, unknown>; } catch { throw new ProjectExecutionJiraObserverError("credential_invalid", "Stored Jira credential is invalid."); } if (typeof parsed.accessToken === "string" && parsed.accessToken.length >= 8) return { kind: "oauth", accessToken: parsed.accessToken }; if (typeof parsed.siteUrl !== "string" || typeof parsed.email !== "string" || typeof parsed.apiToken !== "string") throw new ProjectExecutionJiraObserverError("credential_invalid", "Stored Jira credential is invalid."); const site = new URL(parsed.siteUrl); if (site.protocol !== "https:" || !site.hostname.endsWith(".atlassian.net") || site.port) throw new ProjectExecutionJiraObserverError("credential_invalid", "Stored Jira site is invalid."); return { kind: "basic", siteUrl: site.origin, email: parsed.email, apiToken: parsed.apiToken }; }
async function resolveExecutionJiraAccess(credential: ExecutionJiraCredential, fetcher: typeof fetch) { if (credential.kind === "basic") return { apiBase: credential.siteUrl, authorization: `Basic ${Buffer.from(`${credential.email}:${credential.apiToken}`, "utf8").toString("base64")}` }; const response = await fetcher("https://api.atlassian.com/oauth/token/accessible-resources", { headers: { Accept: "application/json", Authorization: `Bearer ${credential.accessToken}` }, redirect: "error" }); const text = await response.text(); if (!response.ok || text.length > 1_000_000) throw new ProjectExecutionJiraObserverError("site_discovery_failed", "Jira OAuth site discovery failed safely."); let body: unknown; try { body = JSON.parse(text); } catch { throw new ProjectExecutionJiraObserverError("site_discovery_invalid", "Jira OAuth site discovery returned invalid data."); } if (!Array.isArray(body) || body.length !== 1 || !body[0] || typeof body[0] !== "object" || typeof (body[0] as Record<string, unknown>).id !== "string") throw new ProjectExecutionJiraObserverError("site_ambiguous", "Choose one accessible Jira site before publishing execution evidence."); return { apiBase: `https://api.atlassian.com/ex/jira/${encodeURIComponent(String((body[0] as Record<string, unknown>).id))}`, authorization: `Bearer ${credential.accessToken}` }; }
function document(lines: readonly string[]) { return { type: "doc", version: 1, content: lines.map((text) => ({ type: "paragraph", content: [{ type: "text", text }] })) }; }
function hash(value: string) { return createHash("sha256").update(value).digest("hex"); }
async function atomicWrite(path: string, content: string) { await mkdir(dirname(path), { recursive: true, mode: 0o700 }); const temporary = `${path}.${process.pid}.tmp`; await writeFile(temporary, content, { encoding: "utf8", mode: 0o600 }); await chmod(temporary, 0o600); await rename(temporary, path); await chmod(path, 0o600); }
