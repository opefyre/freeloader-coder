import { z } from "zod";

import type { CredentialVault } from "../../../packages/providers/src/lifecycle.js";
import { ownerChannelIdentitySchema } from "./owner-response-delivery-planner.js";

const SLACK_CREDENTIAL_REFERENCE = "vault:providers/slack/default";
const DISCORD_CREDENTIAL_REFERENCE = "vault:providers/discord/default";
const credentialSchema = z.object({ accessToken: z.string().min(8).max(16_384), ownerActorId: z.string().min(1).max(128).nullable().optional() }).passthrough();

export class OAuthOwnerIdentityResolver {
  constructor(
    private readonly vault: Pick<CredentialVault, "read">,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  async resolve() {
    const identities = (await Promise.all([this.#slack(), this.#discord()])).flat();
    return identities.map((item) => ownerChannelIdentitySchema.parse(item));
  }

  async #slack() {
    const credential = await this.#credential(SLACK_CREDENTIAL_REFERENCE);
    if (!credential) return [];
    try {
      const response = await this.fetcher("https://slack.com/api/auth.test", {
        headers: { Accept: "application/json", Authorization: `Bearer ${credential.accessToken}` },
        redirect: "error",
      });
      const body = await boundedJson(response);
      if (!response.ok || body.ok !== true || typeof body.team_id !== "string" || typeof credential.ownerActorId !== "string") return [];
      const aliases = new Set([`slack:${body.team_id}`, ...(typeof body.team === "string" ? [`slack:${body.team}`] : [])]);
      return [...aliases].map((connectionId) => ({ provider: "slack" as const, connectionId, ownerActorId: credential.ownerActorId as string }));
    } catch { return []; }
  }

  async #discord() {
    const credential = await this.#credential(DISCORD_CREDENTIAL_REFERENCE);
    if (!credential) return [];
    try {
      const response = await this.fetcher("https://discord.com/api/v10/users/@me", {
        headers: { Accept: "application/json", Authorization: `Bearer ${credential.accessToken}` },
        redirect: "error",
      });
      const body = await boundedJson(response);
      if (!response.ok || typeof body.id !== "string") return [];
      const aliases = new Set([
        `discord:${body.id}`,
        ...(typeof body.global_name === "string" ? [`discord:${body.global_name}`] : []),
        ...(typeof body.username === "string" ? [`discord:${body.username}`] : []),
      ]);
      return [...aliases].map((connectionId) => ({ provider: "discord" as const, connectionId, ownerActorId: body.id as string }));
    } catch { return []; }
  }

  async #credential(reference: string) {
    const stored = await this.vault.read(reference);
    if (!stored) return null;
    try { return credentialSchema.parse(JSON.parse(stored)); }
    catch { return null; }
  }
}

async function boundedJson(response: Response) {
  const text = await response.text();
  if (text.length > 1_000_000) throw new Error("Identity response exceeded the safe limit.");
  return JSON.parse(text) as Record<string, unknown>;
}
