import { randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { z } from "zod";

import { verifyDiscordRequest, verifyOwnerResponseEnvelope, verifySlackRequest } from "../../../packages/orchestration/src/owner-response-verification.js";

export const ownerResponseDeliverySchema = z.strictObject({
  deliveryId: z.string().regex(/^decision_[a-f0-9]{16}$/),
  provider: z.enum(["slack", "discord"]),
  projectId: z.string().regex(/^project_[a-f0-9]{16}$/),
  revision: z.number().int().nonnegative(),
  channelId: z.string().min(1).max(128),
  ownerActorId: z.string().min(1).max(128),
  response: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("solution"), decision: z.enum(["approved", "declined"]), artifactDigest: z.string().regex(/^[a-f0-9]{64}$/) }),
    z.strictObject({ kind: z.literal("clarification"), questionId: z.string().min(1).max(128), optionId: z.string().min(1).max(128) }),
  ]),
  issuedAt: z.number().int().nonnegative(),
  expiresAt: z.number().int().positive(),
});
export type OwnerResponseDelivery = z.infer<typeof ownerResponseDeliverySchema>;

const stateSchema = z.strictObject({ schemaVersion: z.literal(1), consumed: z.record(z.string(), z.number().int().nonnegative()) });
type LifecycleSource = {
  get(projectId: string): Promise<{ revision: number } | null>;
  answer(projectId: string, input: unknown, idempotencyKey: string): Promise<unknown>;
  decideSolution(projectId: string, input: unknown, idempotencyKey: string): Promise<unknown>;
};
type DeliverySource = { get(provider: "slack" | "discord", deliveryId: string): Promise<OwnerResponseDelivery | null> };

export class SignedOwnerResponseService {
  readonly #path: string;
  #mutation: Promise<unknown> = Promise.resolve();

  constructor(
    stateDirectory: string,
    private readonly deliveries: DeliverySource,
    private readonly lifecycles: LifecycleSource,
    private readonly onAccepted: (projectId: string) => Promise<void> = async () => undefined,
    private readonly now: () => number = Date.now,
  ) { this.#path = resolve(stateDirectory, "signed-owner-responses.json"); }

  async acceptSlack(rawBody: string, headers: { timestamp: string; signature: string }, signingSecret: string) {
    if (!verifySlackRequest(rawBody, headers.timestamp, headers.signature, signingSecret, this.now())) throw new SignedOwnerResponseError("signature_invalid", "Slack response signature is invalid or stale.");
    let payload: unknown;
    try { payload = JSON.parse(new URLSearchParams(rawBody).get("payload") ?? "null"); }
    catch { throw new SignedOwnerResponseError("payload_invalid", "Slack response payload is invalid."); }
    const parsed = z.strictObject({
      type: z.literal("block_actions"),
      user: z.strictObject({ id: z.string().min(1).max(128) }).passthrough(),
      channel: z.strictObject({ id: z.string().min(1).max(128) }).passthrough(),
      actions: z.array(z.object({ action_id: z.string().regex(/^codkesh_owner_response:(approve|decline)$/), value: z.string().regex(/^decision_[a-f0-9]{16}$/) }).passthrough()).length(1),
    }).passthrough().safeParse(payload);
    if (!parsed.success) throw new SignedOwnerResponseError("payload_invalid", "Slack response payload is not a Codkesh owner decision.");
    return this.#apply("slack", parsed.data.actions[0]!.value, parsed.data.channel.id, parsed.data.user.id);
  }

  async acceptDiscord(rawBody: string, headers: { timestamp: string; signature: string }, publicKey: string) {
    if (!verifyDiscordRequest(rawBody, headers.timestamp, headers.signature, publicKey, this.now())) throw new SignedOwnerResponseError("signature_invalid", "Discord response signature is invalid or stale.");
    let payload: unknown;
    try { payload = JSON.parse(rawBody); }
    catch { throw new SignedOwnerResponseError("payload_invalid", "Discord response payload is invalid."); }
    const parsed = z.object({
      type: z.literal(3),
      channel_id: z.string().min(1).max(128),
      member: z.object({ user: z.object({ id: z.string().min(1).max(128) }).passthrough() }).passthrough().optional(),
      user: z.object({ id: z.string().min(1).max(128) }).passthrough().optional(),
      data: z.object({ custom_id: z.string().regex(/^codkesh:decision_[a-f0-9]{16}$/) }).passthrough(),
    }).passthrough().safeParse(payload);
    const actorId = parsed.success ? parsed.data.member?.user.id ?? parsed.data.user?.id : undefined;
    if (!parsed.success || !actorId) throw new SignedOwnerResponseError("payload_invalid", "Discord response payload is not a Codkesh owner decision.");
    return this.#apply("discord", parsed.data.data.custom_id.slice("codkesh:".length), parsed.data.channel_id, actorId);
  }

  async acceptRelayed(input: unknown) {
    const parsed = z.strictObject({ schemaVersion: z.literal(1), relayId: z.string().uuid(), provider: z.enum(["slack", "discord"]), deliveryId: z.string().regex(/^decision_[a-f0-9]{16}$/), channelId: z.string().min(1).max(128), actorId: z.string().min(1).max(128), receivedAt: z.number().int().nonnegative() }).parse(input);
    if (this.now() - parsed.receivedAt > 600_000 || parsed.receivedAt > this.now() + 60_000) throw new SignedOwnerResponseError("relay_stale", "Relayed owner response is stale.");
    return this.#apply(parsed.provider, parsed.deliveryId, parsed.channelId, parsed.actorId);
  }

  async #apply(provider: "slack" | "discord", deliveryId: string, channelId: string, actorId: string) {
    const delivery = await this.deliveries.get(provider, deliveryId);
    if (!delivery) throw new SignedOwnerResponseError("delivery_unknown", "Owner response delivery is unknown.");
    const lifecycle = await this.lifecycles.get(delivery.projectId);
    if (!lifecycle) throw new SignedOwnerResponseError("project_unknown", "Owner response project is unavailable.");
    const state = await this.#load();
    let verified;
    try {
      verified = verifyOwnerResponseEnvelope({ schemaVersion: 1, provider, deliveryId, projectId: delivery.projectId, expectedRevision: delivery.revision, channelId, actorId, response: delivery.response, issuedAt: delivery.issuedAt, expiresAt: delivery.expiresAt }, { provider, projectId: delivery.projectId, revision: lifecycle.revision, channelId: delivery.channelId, actorId: delivery.ownerActorId, consumedDeliveryIds: new Set(Object.keys(state.consumed)) }, this.now());
    } catch (error) { throw new SignedOwnerResponseError("authorization_denied", error instanceof Error ? error.message : "Owner response was denied."); }
    if (delivery.response.kind === "solution") {
      await this.lifecycles.decideSolution(delivery.projectId, { schemaVersion: 1, expectedRevision: delivery.revision, artifactDigest: delivery.response.artifactDigest, decision: delivery.response.decision, feedback: null }, verified.idempotencyKey);
    } else {
      await this.lifecycles.answer(delivery.projectId, { schemaVersion: 1, expectedRevision: delivery.revision, answers: [{ questionId: delivery.response.questionId, optionId: delivery.response.optionId, customAnswer: null, answeredAt: this.now() }] }, verified.idempotencyKey);
    }
    await this.onAccepted(delivery.projectId);
    // A response is terminal only after every durable downstream projection has
    // reconciled. If Jira or the Action Center is temporarily unavailable, leave
    // the delivery retryable; lifecycle mutation is protected by the same
    // idempotency key on the next attempt.
    await this.#consume(deliveryId);
    return { projectId: delivery.projectId, deliveryId, applied: true as const };
  }

  async #consume(deliveryId: string) { await this.#mutate((state) => ({ ...state, consumed: { ...state.consumed, [deliveryId]: this.now() } })); }
  async #load() { try { return stateSchema.parse(JSON.parse(await readFile(this.#path, "utf8"))); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return stateSchema.parse({ schemaVersion: 1, consumed: {} }); throw new SignedOwnerResponseError("state_corrupt", "Owner response state is corrupt; channel decisions are disabled."); } }
  async #mutate(operation: (state: z.infer<typeof stateSchema>) => z.infer<typeof stateSchema>) { const next = this.#mutation.then(async () => { const state = stateSchema.parse(operation(await this.#load())); await atomicWrite(this.#path, `${JSON.stringify(state, null, 2)}\n`); return state; }); this.#mutation = next.catch(() => undefined); return next; }
}

export class SignedOwnerResponseError extends Error { constructor(readonly code: string, message: string) { super(message); } }
async function atomicWrite(path: string, content: string) { await mkdir(dirname(path), { recursive: true, mode: 0o700 }); const temporary = `${path}.${randomBytes(8).toString("hex")}.tmp`; await writeFile(temporary, content, { encoding: "utf8", mode: 0o600 }); await chmod(temporary, 0o600); await rename(temporary, path); await chmod(path, 0o600); }
