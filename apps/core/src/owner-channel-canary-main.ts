import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";

import { createOperatingSystemCredentialBackend } from "../../../packages/vault/src/backends.js";
import { SqliteCredentialMetadataRepository } from "../../../packages/vault/src/repository.js";
import { OperatingSystemCredentialVault, ProviderCredentialVaultBridge } from "../../../packages/vault/src/vault.js";
import { LocalSensitiveCommandRunner } from "./sensitive-command-runner.js";
import { OwnerResponseDeliveryStore } from "./owner-response-delivery-store.js";
import { SlackOwnerNotificationTransport } from "./oauth-owner-notification-transport.js";

const argumentsSchema = z.strictObject({
  projectId: z.string().regex(/^project_[a-f0-9]{16}$/),
  channelId: z.string().min(1).max(128),
  ownerActorId: z.string().min(1).max(128),
});

const input = argumentsSchema.parse({ projectId: process.argv[2], channelId: process.argv[3], ownerActorId: process.argv[4] });
const stateDirectory = resolve(process.env.PIPELINE_STUDIO_STATE_DIR ?? ".pipeline-studio");
await mkdir(stateDirectory, { recursive: true, mode: 0o700 });
const lifecycleState = z.object({ records: z.array(z.object({ projectId: z.string(), revision: z.number().int() }).passthrough()) }).parse(JSON.parse(await readFile(resolve(stateDirectory, "project-lifecycles.json"), "utf8")));
const lifecycle = lifecycleState.records.find((item) => item.projectId === input.projectId);
if (!lifecycle) throw new Error("Canary project lifecycle was not found.");

const credentialBackend = createOperatingSystemCredentialBackend({
  platform: process.platform === "darwin" ? "darwin" : process.platform === "win32" ? "win32" : "linux",
  available: true,
  runner: new LocalSensitiveCommandRunner(),
});
const vault = new ProviderCredentialVaultBridge(
  new OperatingSystemCredentialVault(credentialBackend, new SqliteCredentialMetadataRepository(resolve(stateDirectory, "credential-metadata.sqlite"))),
  Date.now,
);
const deliveries = new OwnerResponseDeliveryStore(stateDirectory);
const nonce = randomBytes(8).toString("hex");
const common = { provider: "slack" as const, projectId: input.projectId, revision: lifecycle.revision, channelId: input.channelId, ownerActorId: input.ownerActorId };
const approve = await deliveries.register({ ...common, response: { kind: "verification", decision: "approved", nonce }, idempotencyKey: `verification:${nonce}:approved`, ttlMs: 86_400_000 });
const decline = await deliveries.register({ ...common, response: { kind: "verification", decision: "declined", nonce }, idempotencyKey: `verification:${nonce}:declined`, ttlMs: 86_400_000 });
const plan = {
  schemaVersion: 1 as const,
  provider: "slack" as const,
  projectId: input.projectId,
  projectRevision: lifecycle.revision,
  channelId: input.channelId,
  title: "Codkesh approval round-trip check",
  message: "Disposable verification only. Choose either option; no project, code, Jira item, or deployment will change.",
  actions: [{ label: "Approve" as const, deliveryId: approve.deliveryId }, { label: "Decline" as const, deliveryId: decline.deliveryId }],
  expiresAt: Math.min(approve.expiresAt, decline.expiresAt),
};
await new SlackOwnerNotificationTransport(vault).send(plan);
await writeFile(resolve(stateDirectory, "slack-live-canary.json"), `${JSON.stringify({ schemaVersion: 1, plan, ownerActorId: input.ownerActorId, sentAt: Date.now() }, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
process.stdout.write(`${JSON.stringify({ sent: true, projectId: input.projectId, revision: lifecycle.revision, channelId: input.channelId, approveDeliveryId: approve.deliveryId, declineDeliveryId: decline.deliveryId, expiresAt: plan.expiresAt })}\n`);
