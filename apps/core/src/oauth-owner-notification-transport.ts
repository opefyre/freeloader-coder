import { z } from "zod";

import type { CredentialVault } from "../../../packages/providers/src/lifecycle.js";
import { ownerNotificationPlanSchema, type OwnerNotificationPlan } from "./owner-response-delivery-planner.js";
import type { OwnerNotificationTransport } from "./owner-channel-runtime.js";

const SLACK_CREDENTIAL_REFERENCE = "vault:providers/slack/default";
const credentialSchema = z.object({ accessToken: z.string().min(8).max(16_384) }).passthrough();
const slackResponseSchema = z.object({ ok: z.boolean(), channel: z.string().min(1).max(128).optional(), ts: z.string().min(1).max(64).optional(), error: z.string().min(1).max(200).optional() }).passthrough();

export class SlackOwnerNotificationTransport implements OwnerNotificationTransport {
  readonly provider = "slack" as const;
  constructor(private readonly vault: Pick<CredentialVault, "read">, private readonly fetcher: typeof fetch = fetch) {}

  async send(input: OwnerNotificationPlan): Promise<void> {
    const plan = ownerNotificationPlanSchema.parse(input);
    if (plan.provider !== "slack") throw new Error("Slack transport received a non-Slack plan.");
    const credential = await this.#credential();
    if (!credential) throw new Error("Slack is not connected.");
    const response = await this.fetcher("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: { Accept: "application/json", Authorization: `Bearer ${credential.accessToken}`, "Content-Type": "application/json; charset=utf-8" },
      redirect: "error",
      body: JSON.stringify({
        channel: plan.channelId,
        text: `${plan.title}: ${plan.message}`,
        unfurl_links: false,
        unfurl_media: false,
        blocks: [
          { type: "header", text: { type: "plain_text", text: plan.title.slice(0, 150), emoji: false } },
          { type: "section", text: { type: "mrkdwn", text: escapeSlack(plan.message) } },
          { type: "actions", block_id: `codkesh:${plan.projectId}:${plan.projectRevision}`.slice(0, 255), elements: plan.actions.map((action) => ({ type: "button", action_id: `codkesh_owner_response:${action.label.toLowerCase()}`, text: { type: "plain_text", text: action.label, emoji: false }, value: action.deliveryId, style: action.label === "Approve" ? "primary" : "danger" })) },
          { type: "context", elements: [{ type: "mrkdwn", text: `Expires <!date^${Math.floor(plan.expiresAt / 1_000)}^{date_short_pretty} at {time}|soon>.` }] },
        ],
      }),
    });
    const body = slackResponseSchema.parse(await boundedJson(response));
    if (!response.ok || !body.ok || body.channel !== plan.channelId || !body.ts) throw new Error(`Slack delivery failed${body.error ? `: ${body.error}` : "."}`);
  }

  async acknowledge(channelId: string, messageTs: string): Promise<void> {
    if (!/^\d{10,20}\.\d{1,10}$/.test(messageTs)) throw new Error("Slack source message timestamp is invalid.");
    const credential = await this.#credential();
    if (!credential) throw new Error("Slack is not connected.");
    const response = await this.fetcher("https://slack.com/api/chat.update", {
      method: "POST",
      headers: { Accept: "application/json", Authorization: `Bearer ${credential.accessToken}`, "Content-Type": "application/json; charset=utf-8" },
      redirect: "error",
      body: JSON.stringify({ channel: channelId, ts: messageTs, text: "Decision received by Codkesh. The signed response was verified.", blocks: [], attachments: [] }),
    });
    const body = slackResponseSchema.parse(await boundedJson(response));
    if (!response.ok || !body.ok || body.channel !== channelId || body.ts !== messageTs) throw new Error(`Slack source-message update failed${body.error ? `: ${body.error}` : "."}`);
  }

  async #credential() {
    const stored = await this.vault.read(SLACK_CREDENTIAL_REFERENCE);
    if (!stored) return null;
    try { return credentialSchema.parse(JSON.parse(stored)); } catch { return null; }
  }
}

function escapeSlack(value: string) { return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
async function boundedJson(response: Response) { const text = await response.text(); if (text.length > 64_000) throw new Error("Slack response exceeded the safe limit."); return JSON.parse(text) as unknown; }
