import { z } from "zod";

import type { LocalProjectCollection } from "../../../packages/runtime/src/local-projects.js";
import type { ProjectLifecycleRecord } from "../../../packages/orchestration/src/project-lifecycle.js";
import type { OwnerResponseDeliveryStore } from "./owner-response-delivery-store.js";

export const ownerChannelIdentitySchema = z.strictObject({
  provider: z.enum(["slack", "discord"]),
  connectionId: z.string().min(1).max(160),
  ownerActorId: z.string().min(1).max(128),
});
export const ownerNotificationPlanSchema = z.strictObject({
  schemaVersion: z.literal(1),
  provider: z.enum(["slack", "discord"]),
  projectId: z.string().regex(/^project_[a-f0-9]{16}$/),
  projectRevision: z.number().int().nonnegative(),
  channelId: z.string().min(1).max(128),
  title: z.string().min(1).max(200),
  message: z.string().min(1).max(500),
  actions: z.array(z.strictObject({ label: z.enum(["Approve", "Decline"]), deliveryId: z.string().regex(/^decision_[a-f0-9]{16}$/) })).length(2),
  expiresAt: z.number().int().positive(),
});
export type OwnerNotificationPlan = z.infer<typeof ownerNotificationPlanSchema>;

type Projects = { list(): Promise<LocalProjectCollection> };
type Lifecycles = { list(): Promise<readonly ProjectLifecycleRecord[]> };

export class OwnerResponseDeliveryPlanner {
  constructor(
    private readonly projects: Projects,
    private readonly lifecycles: Lifecycles,
    private readonly deliveries: Pick<OwnerResponseDeliveryStore, "register">,
    private readonly identities: () => Promise<readonly z.infer<typeof ownerChannelIdentitySchema>[]>,
  ) {}

  async plan(): Promise<readonly OwnerNotificationPlan[]> {
    const [projects, lifecycles, identitiesRaw] = await Promise.all([this.projects.list(), this.lifecycles.list(), this.identities()]);
    const identities = identitiesRaw.map((item) => ownerChannelIdentitySchema.parse(item));
    const plans: OwnerNotificationPlan[] = [];
    for (const lifecycle of lifecycles) {
      if (lifecycle.stage !== "awaiting_design_approval") continue;
      const project = projects.projects.find((candidate) => candidate.id === lifecycle.projectId);
      const artifact = lifecycle.artifacts.find((item) => item.kind === "solution");
      if (!project || !artifact) continue;
      for (const resource of project.resources ?? []) {
        const provider = resource.kind === "slack_channel" ? "slack" : resource.kind === "discord_channel" ? "discord" : null;
        if (!provider || resource.role !== "notifications") continue;
        const identity = identities.find((item) => item.provider === provider && item.connectionId === resource.connectionId);
        if (!identity) continue;
        const common = { provider, projectId: project.id, revision: lifecycle.revision, channelId: resource.resourceId, ownerActorId: identity.ownerActorId } as const;
        const approve = await this.deliveries.register({ ...common, response: { kind: "solution", decision: "approved", artifactDigest: artifact.digest }, idempotencyKey: `${resource.resourceId}:solution:${lifecycle.revision}:approved`, ttlMs: 86_400_000 });
        const decline = await this.deliveries.register({ ...common, response: { kind: "solution", decision: "declined", artifactDigest: artifact.digest }, idempotencyKey: `${resource.resourceId}:solution:${lifecycle.revision}:declined`, ttlMs: 86_400_000 });
        plans.push(ownerNotificationPlanSchema.parse({ schemaVersion: 1, provider, projectId: project.id, projectRevision: lifecycle.revision, channelId: resource.resourceId, title: safeTitle(project.displayName), message: "The reviewed solution is ready. Implementation remains paused until you decide.", actions: [{ label: "Approve", deliveryId: approve.deliveryId }, { label: "Decline", deliveryId: decline.deliveryId }], expiresAt: Math.min(approve.expiresAt, decline.expiresAt) }));
      }
    }
    return plans;
  }
}

function safeTitle(value: string) { return value.replace(/[<>`*_~]/g, "").replace(/\s+/g, " ").trim().slice(0, 200) || "Codkesh project"; }
