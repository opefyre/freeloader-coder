import { z } from "zod";

import type { CredentialVault } from "../../../packages/providers/src/lifecycle.js";
import { JIRA_CREDENTIAL_REFERENCE } from "./jira-delivery-service.js";

export const JIRA_REFRESH_CREDENTIAL_REFERENCE = "vault:providers/jira/refresh";

const oauthCredentialSchema = z.object({
  accessToken: z.string().min(8),
  expiresAt: z.number().int().positive(),
}).passthrough();
const refreshCredentialSchema = z.object({
  brokerRefreshGrant: z.string().min(8),
}).passthrough();
const brokerResponseSchema = z.object({
  credential: z.object({
    access_token: z.string().min(8),
    refresh_grant: z.string().min(8),
    expires_in: z.number().positive().max(86_400).default(3_600),
  }).passthrough(),
}).passthrough();

type RenewableVault = Pick<CredentialVault, "read"> & Partial<Pick<CredentialVault, "write">>;

export async function resolveCurrentJiraCredential(
  vault: RenewableVault,
  fetcher: typeof fetch = fetch,
  now: () => number = Date.now,
): Promise<string | null> {
  const stored = await vault.read(JIRA_CREDENTIAL_REFERENCE);
  if (!stored) return null;
  const parsed = safeObject(stored);
  if (!parsed || typeof parsed.accessToken !== "string") return stored;
  const credential = oauthCredentialSchema.safeParse(parsed);
  if (!credential.success || credential.data.expiresAt > now() + 60_000) return stored;
  if (!vault.write) throw new Error("Jira authorization expired and secure renewal is unavailable.");
  const refreshStored = await vault.read(JIRA_REFRESH_CREDENTIAL_REFERENCE);
  const refresh = refreshStored ? refreshCredentialSchema.safeParse(safeObject(refreshStored)) : null;
  if (!refresh?.success) throw new Error("Jira authorization expired. Reconnect Jira in Settings.");
  const response = await fetcher("https://pipeline-studio-oauth.opefyre.workers.dev/v1/oauth/refresh", {
    method: "POST",
    headers: { Origin: "http://127.0.0.1:4310", "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ provider: "jira", refreshGrant: refresh.data.brokerRefreshGrant }),
    redirect: "error",
  });
  const text = await response.text();
  if (!response.ok || text.length > 64_000) throw new Error("Jira authorization could not be renewed safely.");
  let result: z.infer<typeof brokerResponseSchema>;
  try { result = brokerResponseSchema.parse(JSON.parse(text)); } catch { throw new Error("Jira authorization renewal returned invalid data."); }
  const renewed = JSON.stringify({ accessToken: result.credential.access_token, refreshToken: null, expiresAt: now() + result.credential.expires_in * 1_000 });
  await vault.write(JIRA_CREDENTIAL_REFERENCE, renewed);
  await vault.write(JIRA_REFRESH_CREDENTIAL_REFERENCE, JSON.stringify({ brokerRefreshGrant: result.credential.refresh_grant }));
  return renewed;
}

function safeObject(value: string): Record<string, unknown> | null {
  try { const parsed = JSON.parse(value) as unknown; return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : null; } catch { return null; }
}
