import { randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { z } from "zod";

import {
  ownerNotificationPlanSchema,
  type OwnerNotificationPlan,
  type OwnerResponseDeliveryPlanner,
} from "./owner-response-delivery-planner.js";

const stateSchema = z.strictObject({
  schemaVersion: z.literal(1),
  delivered: z.record(
    z.string(),
    z.strictObject({
      provider: z.enum(["slack", "discord"]),
      projectId: z.string().regex(/^project_[a-f0-9]{16}$/),
      projectRevision: z.number().int().nonnegative(),
      deliveredAt: z.number().int().nonnegative(),
      expiresAt: z.number().int().positive(),
    }),
  ),
});

export type OwnerNotificationTransport = {
  provider: "slack" | "discord";
  send(plan: OwnerNotificationPlan): Promise<void>;
};

type RelaySynchronizer = {
  synchronize(): Promise<{ applied: number; pending: number }>;
};

export class OwnerChannelRuntime {
  readonly #path: string;
  readonly #transports: ReadonlyMap<"slack" | "discord", OwnerNotificationTransport>;
  #run: Promise<unknown> = Promise.resolve();

  constructor(
    stateDirectory: string,
    private readonly planner: Pick<OwnerResponseDeliveryPlanner, "plan">,
    transports: readonly OwnerNotificationTransport[],
    private readonly relay: RelaySynchronizer | null,
    private readonly onApplied: () => Promise<void> = async () => undefined,
    private readonly now: () => number = Date.now,
  ) {
    this.#path = resolve(stateDirectory, "owner-channel-runtime.json");
    const entries = new Map<"slack" | "discord", OwnerNotificationTransport>();
    for (const transport of transports) {
      if (entries.has(transport.provider)) throw new Error(`Duplicate ${transport.provider} owner-channel transport.`);
      entries.set(transport.provider, transport);
    }
    this.#transports = entries;
  }

  async synchronize() {
    let result!: { planned: number; delivered: number; deferred: number; applied: number; pending: number };
    const next = this.#run.then(async () => {
      const state = await this.#load();
      const now = this.now();
      const delivered = Object.fromEntries(Object.entries(state.delivered).filter(([, item]) => item.expiresAt > now));
      const plans = (await this.planner.plan()).map((item) => ownerNotificationPlanSchema.parse(item));
      let sent = 0;
      let deferred = 0;

      for (const plan of plans) {
        const key = deliveryKey(plan);
        if (delivered[key]) continue;
        const transport = this.#transports.get(plan.provider);
        if (!transport) { deferred += 1; continue; }
        try {
          await transport.send(plan);
          delivered[key] = {
            provider: plan.provider,
            projectId: plan.projectId,
            projectRevision: plan.projectRevision,
            deliveredAt: this.now(),
            expiresAt: plan.expiresAt,
          };
          sent += 1;
          await this.#save({ schemaVersion: 1, delivered });
        } catch {
          deferred += 1;
        }
      }

      let applied = 0;
      let pending = 0;
      if (this.relay) {
        try {
          const inbound = await this.relay.synchronize();
          applied = inbound.applied;
          pending = inbound.pending;
          if (applied > 0) await this.onApplied();
        } catch {
          pending += 1;
        }
      }

      await this.#save({ schemaVersion: 1, delivered });
      result = { planned: plans.length, delivered: sent, deferred, applied, pending };
    });
    this.#run = next.catch(() => undefined);
    await next;
    return result;
  }

  async #load() {
    try {
      return stateSchema.parse(JSON.parse(await readFile(this.#path, "utf8")));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return stateSchema.parse({ schemaVersion: 1, delivered: {} });
      throw new Error("Owner-channel runtime state is corrupt; channel delivery is disabled.");
    }
  }

  async #save(input: z.infer<typeof stateSchema>) {
    const state = stateSchema.parse(input);
    await mkdir(dirname(this.#path), { recursive: true, mode: 0o700 });
    const temporary = `${this.#path}.${randomBytes(8).toString("hex")}.tmp`;
    await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await chmod(temporary, 0o600);
    await rename(temporary, this.#path);
    await chmod(this.#path, 0o600);
  }
}

function deliveryKey(plan: OwnerNotificationPlan) {
  return `${plan.provider}:${plan.channelId}:${plan.actions.map((item) => item.deliveryId).join(":")}`;
}
