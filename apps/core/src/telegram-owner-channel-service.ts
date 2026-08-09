import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { z } from "zod";

import type { CredentialVault } from "../../../packages/providers/src/lifecycle.js";
import type { LocalProjectCollection } from "../../../packages/runtime/src/local-projects.js";
import type { OwnerAnswer, ProjectLifecycleRecord } from "../../../packages/orchestration/src/project-lifecycle.js";
import { telegramConnectionInputSchema } from "../../../packages/runtime/src/integration-connections.js";
import { TELEGRAM_CREDENTIAL_REFERENCE } from "./integration-connection-service.js";

const deliverySchema = z.strictObject({
  id: z.string().regex(/^notice_[a-f0-9]{16}$/),
  projectId: z.string().regex(/^project_[a-f0-9]{16}$/),
  revision: z.number().int().nonnegative(),
  kind: z.enum(["solution", "clarification"]),
  questionId: z.string().nullable(),
  optionId: z.string().nullable(),
  decision: z.enum(["approved", "declined"]).nullable(),
  artifactDigest: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
  chatId: z.string().min(1).max(100),
  expiresAt: z.number().int().nonnegative(),
  usedAt: z.number().int().nonnegative().nullable(),
});
const stateSchema = z.strictObject({
  schemaVersion: z.literal(1),
  signingSecret: z.string().regex(/^[a-f0-9]{64}$/),
  updateOffset: z.number().int().nonnegative(),
  deliveries: z.record(z.string(), deliverySchema),
  clarificationAnswers: z.record(z.string(), z.record(z.string(), z.string())),
});
type State = z.infer<typeof stateSchema>;
type Delivery = z.infer<typeof deliverySchema>;

type Projects = { list(): Promise<LocalProjectCollection> };
type Lifecycles = {
  list(): Promise<readonly ProjectLifecycleRecord[]>;
  get(projectId: string): Promise<ProjectLifecycleRecord | null>;
  answer(projectId: string, input: unknown, idempotencyKey: string): Promise<ProjectLifecycleRecord>;
  decideSolution(projectId: string, input: unknown, idempotencyKey: string): Promise<ProjectLifecycleRecord>;
};

export class TelegramOwnerChannelService {
  readonly #path: string;
  #mutation: Promise<unknown> = Promise.resolve();

  constructor(
    stateDirectory: string,
    private readonly projects: Projects,
    private readonly lifecycles: Lifecycles,
    private readonly vault: Pick<CredentialVault, "read">,
    private readonly fetcher: typeof fetch = fetch,
    private readonly now: () => number = Date.now
  ) { this.#path = resolve(stateDirectory, "telegram-owner-channel.json"); }

  async synchronize() {
    const credential = await this.#credential();
    if (!credential) return { sent: 0, handled: 0 };
    const [projects, lifecycles] = await Promise.all([this.projects.list(), this.lifecycles.list()]);
    let sent = 0;
    for (const lifecycle of lifecycles) {
      const project = projects.projects.find((candidate) => candidate.id === lifecycle.projectId);
      const channel = project?.resources?.find((resource) => resource.kind === "telegram_chat" && resource.role === "notifications");
      if (!project || !channel) continue;
      if (lifecycle.stage === "awaiting_design_approval") sent += await this.#sendSolution(credential, lifecycle, channel.resourceId, project.displayName);
      if (lifecycle.stage === "clarification") sent += await this.#sendClarifications(credential, lifecycle, channel.resourceId, project.displayName);
    }
    return { sent, handled: await this.#poll(credential) };
  }

  async #sendSolution(credential: z.infer<typeof telegramConnectionInputSchema>, lifecycle: ProjectLifecycleRecord, chatId: string, projectName: string) {
    const artifact = lifecycle.artifacts.find((item) => item.kind === "solution");
    if (!artifact) return 0;
    const state = await this.#load();
    const seed = `${lifecycle.projectId}:${lifecycle.revision}:${artifact.digest}:solution`;
    if (Object.values(state.deliveries).some((item) => `${item.projectId}:${item.revision}:${item.artifactDigest}:solution` === seed)) return 0;
    const buttons = (["approved", "declined"] as const).map((decision) => {
      const delivery = this.#delivery({ projectId: lifecycle.projectId, revision: lifecycle.revision, kind: "solution", questionId: null, optionId: null, decision, artifactDigest: artifact.digest, chatId });
      return { text: decision === "approved" ? "Approve" : "Decline", callback_data: this.#callback(delivery, state.signingSecret), delivery };
    });
    await this.#send(credential, chatId, `${projectName}\n\nThe reviewed solution is ready. Planning remains safely paused until you decide.`, [buttons.map(({ text, callback_data }) => ({ text, callback_data }))]);
    await this.#storeDeliveries(buttons.map((item) => item.delivery));
    return 1;
  }

  async #sendClarifications(credential: z.infer<typeof telegramConnectionInputSchema>, lifecycle: ProjectLifecycleRecord, chatId: string, projectName: string) {
    let sent = 0;
    for (const question of lifecycle.questions) {
      const state = await this.#load();
      const alreadySent = Object.values(state.deliveries).some((item) => item.projectId === lifecycle.projectId && item.revision === lifecycle.revision && item.questionId === question.id);
      if (alreadySent) continue;
      const deliveries = question.options.map((option) => this.#delivery({ projectId: lifecycle.projectId, revision: lifecycle.revision, kind: "clarification", questionId: question.id, optionId: option.id, decision: null, artifactDigest: null, chatId }));
      const rows = deliveries.map((delivery, index) => [{ text: question.options[index]!.label, callback_data: this.#callback(delivery, state.signingSecret) }]);
      await this.#send(credential, chatId, `${projectName}\n\n${question.prompt}\n\n${question.whyItMatters}`, rows);
      await this.#storeDeliveries(deliveries);
      sent += 1;
    }
    return sent;
  }

  async #poll(credential: z.infer<typeof telegramConnectionInputSchema>) {
    const state = await this.#load();
    const body = await this.#telegram(credential, "getUpdates", { offset: state.updateOffset, timeout: 0, allowed_updates: ["callback_query"] });
    const updates = Array.isArray(body.result) ? body.result as Array<Record<string, unknown>> : [];
    let handled = 0;
    let offset = state.updateOffset;
    for (const update of updates) {
      const updateId = typeof update.update_id === "number" ? update.update_id : -1;
      if (updateId >= 0) offset = Math.max(offset, updateId + 1);
      const callback = update.callback_query && typeof update.callback_query === "object" ? update.callback_query as Record<string, unknown> : null;
      if (!callback || typeof callback.id !== "string" || typeof callback.data !== "string") continue;
      const chat = callback.message && typeof callback.message === "object" && (callback.message as Record<string, unknown>).chat && typeof (callback.message as Record<string, unknown>).chat === "object" ? (callback.message as Record<string, any>).chat as Record<string, unknown> : null;
      const outcome = await this.#handleCallback(callback.data, chat ? String(chat.id ?? "") : "");
      await this.#telegram(credential, "answerCallbackQuery", { callback_query_id: callback.id, text: outcome, show_alert: false });
      if (outcome.startsWith("Saved") || outcome.startsWith("Decision")) handled += 1;
    }
    if (offset !== state.updateOffset) await this.#mutate((current) => ({ ...current, updateOffset: offset }));
    return handled;
  }

  async #handleCallback(data: string, chatId: string) {
    const match = data.match(/^ps:([a-f0-9]{16}):([a-f0-9]{16})$/);
    if (!match) return "This response is not recognized.";
    const state = await this.#load();
    const id = `notice_${match[1]}`;
    const delivery = state.deliveries[id];
    if (!delivery || !timingSafeSignature(match[2]!, this.#signature(delivery, state.signingSecret))) return "This response is not authorized.";
    if (delivery.chatId !== chatId) return "This chat is not authorized.";
    if (delivery.usedAt !== null) return "This response was already used.";
    if (delivery.expiresAt <= this.now()) return "This response expired. Open Studio for the current decision.";
    const lifecycle = await this.lifecycles.get(delivery.projectId);
    if (!lifecycle || lifecycle.revision !== delivery.revision) return "The project has moved on. Open Studio for the current decision.";
    if (delivery.kind === "solution" && delivery.decision && delivery.artifactDigest) {
      await this.lifecycles.decideSolution(delivery.projectId, { schemaVersion: 1, expectedRevision: delivery.revision, artifactDigest: delivery.artifactDigest, decision: delivery.decision, feedback: null }, `telegram:${delivery.id}`);
      await this.#consume(delivery.id);
      return "Decision saved. The pipeline will continue safely.";
    }
    if (!delivery.questionId || !delivery.optionId) return "This response is incomplete.";
    const answerKey = `${delivery.projectId}:${delivery.revision}`;
    const answers = { ...(state.clarificationAnswers[answerKey] ?? {}), [delivery.questionId]: delivery.optionId };
    await this.#mutate((current) => ({ ...current, deliveries: { ...current.deliveries, [delivery.id]: { ...delivery, usedAt: this.now() } }, clarificationAnswers: { ...current.clarificationAnswers, [answerKey]: answers } }));
    if (!lifecycle.questions.every((question) => answers[question.id])) return "Saved. Answer the remaining project question(s).";
    const ownerAnswers: OwnerAnswer[] = lifecycle.questions.map((question) => ({ questionId: question.id, optionId: answers[question.id]!, customAnswer: null, answeredAt: this.now() }));
    await this.lifecycles.answer(delivery.projectId, { schemaVersion: 1, expectedRevision: delivery.revision, answers: ownerAnswers }, `telegram:${answerKey}`);
    return "Saved. All project questions are answered.";
  }

  #delivery(input: Omit<Delivery, "id" | "expiresAt" | "usedAt">): Delivery {
    const entropy = randomBytes(16).toString("hex");
    return deliverySchema.parse({ ...input, id: `notice_${createHash("sha256").update(entropy).digest("hex").slice(0, 16)}`, expiresAt: this.now() + 24 * 60 * 60_000, usedAt: null });
  }
  #callback(delivery: Delivery, secret: string) { return `ps:${delivery.id.slice(7)}:${this.#signature(delivery, secret)}`; }
  #signature(delivery: Delivery, secret: string) { return createHmac("sha256", secret).update(`${delivery.id}:${delivery.projectId}:${delivery.revision}:${delivery.chatId}`).digest("hex").slice(0, 16); }
  async #consume(id: string) { await this.#mutate((state) => ({ ...state, deliveries: { ...state.deliveries, [id]: { ...state.deliveries[id]!, usedAt: this.now() } } })); }
  async #storeDeliveries(deliveries: readonly Delivery[]) { await this.#mutate((state) => ({ ...state, deliveries: { ...state.deliveries, ...Object.fromEntries(deliveries.map((item) => [item.id, item])) } })); }
  async #credential() { const stored = await this.vault.read(TELEGRAM_CREDENTIAL_REFERENCE); return stored ? telegramConnectionInputSchema.parse(JSON.parse(stored)) : null; }
  async #send(credential: z.infer<typeof telegramConnectionInputSchema>, chatId: string, text: string, inline_keyboard: readonly (readonly { text: string; callback_data: string }[])[]) { await this.#telegram(credential, "sendMessage", { chat_id: chatId, text, reply_markup: { inline_keyboard } }); }
  async #telegram(credential: z.infer<typeof telegramConnectionInputSchema>, method: string, payload: unknown): Promise<Record<string, any>> { const response = await this.fetcher(`https://api.telegram.org/bot${credential.botToken}/${method}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload), redirect: "error" }); const text = await response.text(); if (!response.ok || text.length > 1_000_000) throw new Error(`Telegram ${method} failed safely.`); const body = JSON.parse(text) as Record<string, any>; if (body.ok !== true) throw new Error(`Telegram ${method} was rejected.`); return body; }
  async #load(): Promise<State> { try { return stateSchema.parse(JSON.parse(await readFile(this.#path, "utf8"))); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") { const initial = stateSchema.parse({ schemaVersion: 1, signingSecret: randomBytes(32).toString("hex"), updateOffset: 0, deliveries: {}, clarificationAnswers: {} }); await atomicWrite(this.#path, `${JSON.stringify(initial, null, 2)}\n`); return initial; } throw new Error("Telegram owner-channel state is corrupt; responses are disabled until repaired."); } }
  async #mutate(operation: (state: State) => State) { const next = this.#mutation.then(async () => { const state = stateSchema.parse(operation(await this.#load())); await atomicWrite(this.#path, `${JSON.stringify(state, null, 2)}\n`); return state; }); this.#mutation = next.catch(() => undefined); return next; }
}

function timingSafeSignature(left: string, right: string) { if (left.length !== right.length) return false; return timingSafeEqual(Buffer.from(left, "utf8"), Buffer.from(right, "utf8")); }
async function atomicWrite(path: string, content: string) { await mkdir(dirname(path), { recursive: true, mode: 0o700 }); const temporary = `${path}.${randomBytes(8).toString("hex")}.tmp`; await writeFile(temporary, content, { encoding: "utf8", mode: 0o600 }); await chmod(temporary, 0o600); await rename(temporary, path); await chmod(path, 0o600); }
