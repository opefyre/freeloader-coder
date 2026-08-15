import { resolve } from "node:path";
import { z } from "zod";

import { createOperatingSystemCredentialBackend } from "../../../packages/vault/src/backends.js";
import { SqliteCredentialMetadataRepository } from "../../../packages/vault/src/repository.js";
import { OperatingSystemCredentialVault, ProviderCredentialVaultBridge } from "../../../packages/vault/src/vault.js";
import { SlackOwnerNotificationTransport } from "./oauth-owner-notification-transport.js";
import { LocalSensitiveCommandRunner } from "./sensitive-command-runner.js";

const channelId = z.string().min(1).max(128).parse(process.argv[2]);
const requestedMessageTs = process.argv[3] ? z.string().regex(/^\d{10,20}\.\d{1,10}$/).parse(process.argv[3]) : null;
const stateDirectory = resolve(process.env.PIPELINE_STUDIO_STATE_DIR ?? ".pipeline-studio");
const backend = createOperatingSystemCredentialBackend({
  platform: process.platform === "darwin" ? "darwin" : process.platform === "win32" ? "win32" : "linux",
  available: true,
  runner: new LocalSensitiveCommandRunner(),
});
const vault = new ProviderCredentialVaultBridge(
  new OperatingSystemCredentialVault(backend, new SqliteCredentialMetadataRepository(resolve(stateDirectory, "credential-metadata.sqlite"))),
  Date.now,
);
const stored = await vault.read("vault:providers/slack/default");
const credential = z.object({ accessToken: z.string().min(8).max(16_384) }).passthrough().parse(JSON.parse(stored ?? "null"));
const historyResponse = await fetch(`https://slack.com/api/conversations.history?channel=${encodeURIComponent(channelId)}&limit=25`, {
  headers: { Accept: "application/json", Authorization: `Bearer ${credential.accessToken}` },
  redirect: "error",
});
const history = z.object({
  ok: z.boolean(),
  error: z.string().optional(),
  messages: z.array(z.object({ ts: z.string(), text: z.string().optional() }).passthrough()).optional(),
}).passthrough().parse(await historyResponse.json());
if (!historyResponse.ok || !history.ok) throw new Error(`Slack history lookup failed${history.error ? `: ${history.error}` : "."}`);
const message = requestedMessageTs
  ? history.messages?.find((item) => item.ts === requestedMessageTs)
  : history.messages?.find((item) => item.text?.startsWith("Codkesh approval round-trip check:"));
if (!message || !/^\d{10,20}\.\d{1,10}$/.test(message.ts)) throw new Error("Latest Codkesh verification message was not found.");
await new SlackOwnerNotificationTransport(vault).acknowledge(channelId, message.ts);
const verificationResponse = await fetch(`https://slack.com/api/conversations.history?channel=${encodeURIComponent(channelId)}&latest=${encodeURIComponent(message.ts)}&inclusive=true&limit=1`, {
  headers: { Accept: "application/json", Authorization: `Bearer ${credential.accessToken}` },
  redirect: "error",
});
const verification = z.object({ ok: z.boolean(), messages: z.array(z.object({ ts: z.string(), blocks: z.array(z.object({ type: z.string() }).passthrough()).optional() }).passthrough()).optional() }).passthrough().parse(await verificationResponse.json());
const verifiedMessage = verification.messages?.find((item) => item.ts === message.ts);
const remainingActionBlocks = verifiedMessage?.blocks?.filter((block) => block.type === "actions").length ?? 0;
if (!verificationResponse.ok || !verification.ok || !verifiedMessage || remainingActionBlocks !== 0) {
  process.stdout.write(`${JSON.stringify({ verificationHttpOk: verificationResponse.ok, verificationApiOk: verification.ok, messageFound: Boolean(verifiedMessage), returnedMessages: verification.messages?.map((item) => ({ ts: item.ts, blockTypes: item.blocks?.map((block) => block.type) ?? [] })) ?? [] })}\n`);
  throw new Error("Slack source-message update could not be verified.");
}
process.stdout.write(`${JSON.stringify({ updated: true, verified: true, channelId, messageTs: message.ts, remainingActionBlocks: 0 })}\n`);
