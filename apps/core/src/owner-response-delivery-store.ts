import { createHash, randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { z } from "zod";

import { ownerResponseDeliverySchema, type OwnerResponseDelivery } from "./signed-owner-response-service.js";

const stateSchema = z.strictObject({
  schemaVersion: z.literal(1),
  deliveries: z.record(z.string(), ownerResponseDeliverySchema),
});
const registerSchema = ownerResponseDeliverySchema.omit({ deliveryId: true, issuedAt: true, expiresAt: true }).extend({
  idempotencyKey: z.string().regex(/^[a-z0-9:._-]{8,200}$/i),
  ttlMs: z.number().int().min(60_000).max(86_400_000).default(86_400_000),
});

export class OwnerResponseDeliveryStore {
  readonly #path: string;
  #mutation: Promise<unknown> = Promise.resolve();
  constructor(stateDirectory: string, private readonly now: () => number = Date.now) { this.#path = resolve(stateDirectory, "owner-response-deliveries.json"); }

  async register(input: unknown): Promise<OwnerResponseDelivery> {
    const parsed = registerSchema.parse(input);
    const { idempotencyKey, ttlMs, ...content } = parsed;
    return this.#mutate((state) => {
      const digest = createHash("sha256").update(`${content.provider}:${content.projectId}:${idempotencyKey}`).digest("hex").slice(0, 16);
      const deliveryId = `decision_${digest}`;
      const prior = state.deliveries[deliveryId];
      if (prior) {
        const candidate = ownerResponseDeliverySchema.parse({ ...content, deliveryId, issuedAt: prior.issuedAt, expiresAt: prior.expiresAt });
        if (JSON.stringify(prior) !== JSON.stringify(candidate)) throw new Error("Owner response delivery idempotency key was reused with different content.");
        return { state, result: prior };
      }
      const issuedAt = this.now();
      const delivery = ownerResponseDeliverySchema.parse({ ...content, deliveryId, issuedAt, expiresAt: issuedAt + ttlMs });
      return { state: { ...state, deliveries: { ...state.deliveries, [deliveryId]: delivery } }, result: delivery };
    });
  }

  async get(provider: "slack" | "discord", deliveryId: string): Promise<OwnerResponseDelivery | null> {
    const state = await this.#load(); const delivery = state.deliveries[deliveryId];
    return delivery?.provider === provider ? delivery : null;
  }

  async list(projectId?: string): Promise<readonly OwnerResponseDelivery[]> {
    const state = await this.#load();
    return Object.values(state.deliveries).filter((item) => !projectId || item.projectId === projectId).sort((left, right) => left.issuedAt - right.issuedAt || left.deliveryId.localeCompare(right.deliveryId));
  }

  async pruneExpired(): Promise<number> {
    return this.#mutate((state) => { const retained = Object.fromEntries(Object.entries(state.deliveries).filter(([, item]) => item.expiresAt > this.now())); return { state: { ...state, deliveries: retained }, result: Object.keys(state.deliveries).length - Object.keys(retained).length }; });
  }

  async #load() { try { return stateSchema.parse(JSON.parse(await readFile(this.#path, "utf8"))); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return stateSchema.parse({ schemaVersion: 1, deliveries: {} }); throw new Error("Owner response delivery registry is corrupt; outbound decisions are disabled."); } }
  async #mutate<T>(operation: (state: z.infer<typeof stateSchema>) => { state: z.infer<typeof stateSchema>; result: T }): Promise<T> { let result!: T; const next = this.#mutation.then(async () => { const outcome = operation(await this.#load()); const state = stateSchema.parse(outcome.state); await atomicWrite(this.#path, `${JSON.stringify(state, null, 2)}\n`); result = outcome.result; }); this.#mutation = next.catch(() => undefined); await next; return result; }
}

async function atomicWrite(path: string, content: string) { await mkdir(dirname(path), { recursive: true, mode: 0o700 }); const temporary = `${path}.${randomBytes(8).toString("hex")}.tmp`; await writeFile(temporary, content, { encoding: "utf8", mode: 0o600 }); await chmod(temporary, 0o600); await rename(temporary, path); await chmod(path, 0o600); }
