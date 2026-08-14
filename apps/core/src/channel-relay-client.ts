import { z } from "zod";

import type { SignedOwnerResponseService } from "./signed-owner-response-service.js";

const responseSchema = z.strictObject({ schemaVersion: z.literal(1), relayId: z.string().uuid(), provider: z.enum(["slack", "discord"]), deliveryId: z.string().regex(/^decision_[a-f0-9]{16}$/), channelId: z.string().min(1).max(128), actorId: z.string().min(1).max(128), receivedAt: z.number().int().nonnegative() });
const collectionSchema = z.strictObject({ schemaVersion: z.literal(1), responses: z.array(responseSchema).max(50) });

export class ChannelRelayClient {
  readonly #origin: string;
  constructor(endpoint: string, private readonly token: string, private readonly responses: Pick<SignedOwnerResponseService, "acceptRelayed">, private readonly fetcher: typeof fetch = fetch) {
    const url = new URL(endpoint); if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) throw new Error("Channel relay must use a clean HTTPS endpoint."); this.#origin = url.origin;
    if (token.length < 24 || token.length > 500) throw new Error("Channel relay token is invalid.");
  }
  async synchronize() {
    const pulled = collectionSchema.parse(await this.#json("/v1/channels/responses/pull")); const acknowledged: string[] = []; const failed: string[] = [];
    for (const item of pulled.responses) { try { await this.responses.acceptRelayed(item); acknowledged.push(item.relayId); } catch { failed.push(item.relayId); } }
    if (acknowledged.length) await this.#json("/v1/channels/responses/ack", { relayIds: acknowledged });
    return { applied: acknowledged.length, pending: failed.length };
  }
  async #json(path: string, body?: unknown) { const response = await this.fetcher(`${this.#origin}${path}`, { method: "POST", headers: { Authorization: `Bearer ${this.token}`, ...(body ? { "Content-Type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}), redirect: "error" }); const text = await response.text(); if (!response.ok || text.length > 1_000_000) throw new Error("Channel relay request failed safely."); try { return JSON.parse(text); } catch { throw new Error("Channel relay returned invalid data."); } }
}
