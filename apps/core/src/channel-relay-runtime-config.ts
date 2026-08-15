import { z } from "zod";

import type { CredentialVault } from "../../../packages/providers/src/lifecycle.js";

export const CHANNEL_RELAY_CREDENTIAL_REFERENCE = "vault:providers/channel-relay/default";

const relaySchema = z.strictObject({ endpoint: z.string().url(), token: z.string().min(24).max(500) });

export async function resolveChannelRelayRuntimeConfig(
  vault: Pick<CredentialVault, "read">,
  environment: Record<string, string | undefined> = process.env,
) {
  const endpoint = environment.CODKESH_CHANNEL_RELAY_URL?.trim();
  const token = environment.CODKESH_CHANNEL_RELAY_TOKEN?.trim();
  if (endpoint || token) return validate(endpoint, token);
  const stored = await vault.read(CHANNEL_RELAY_CREDENTIAL_REFERENCE);
  if (!stored) return null;
  try {
    const parsed = relaySchema.parse(JSON.parse(stored));
    return validate(parsed.endpoint, parsed.token);
  } catch {
    throw new Error("The channel-relay vault entry is invalid; owner-channel responses are disabled.");
  }
}

function validate(endpoint: string | undefined, token: string | undefined) {
  if (!endpoint && !token) return null;
  if (!endpoint || !token) throw new Error("The channel relay requires both an endpoint and a token.");
  const parsed = relaySchema.parse({ endpoint, token });
  const url = new URL(parsed.endpoint);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.pathname !== "/") throw new Error("The channel relay must use a clean HTTPS origin.");
  return { endpoint: url.origin, token: parsed.token } as const;
}
