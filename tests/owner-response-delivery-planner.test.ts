import assert from "node:assert/strict";
import test from "node:test";

import { localProjectCollectionSchema } from "../packages/runtime/src/local-projects.js";
import { OwnerResponseDeliveryPlanner } from "../apps/core/src/owner-response-delivery-planner.js";

const projectId = "project_0123456789abcdef"; const digest = "a".repeat(64);
const projects = localProjectCollectionSchema.parse({ schemaVersion: 1, provenance: "local_observation", observedAt: 100, projects: [{ schemaVersion: 1, id: projectId, displayName: "Owner <secret> *project*", resources: [
  { id: "binding_0123456789abcdef", kind: "slack_channel", connectionId: "slack:workspace", resourceId: "C-owner", label: "#approvals", url: "https://app.slack.com", role: "notifications", selectedAt: 100 },
  { id: "binding_abcdef0123456789", kind: "discord_channel", connectionId: "discord:guild", resourceId: "D-owner", label: "approvals", url: "https://discord.com", role: "notifications", selectedAt: 100 },
], state: "ready", observedAt: 100, validForMs: 60_000, facts: [], inferences: [], decisions: [], warnings: [] }] });
const lifecycle = { projectId, stage: "awaiting_design_approval", revision: 9, artifacts: [{ kind: "solution", digest }] } as any;

test("planner creates opaque, sanitized, project-bound plans only for selected authorized channels", async () => {
  const registrations: any[] = [];
  const planner = new OwnerResponseDeliveryPlanner({ list: async () => projects }, { list: async () => [lifecycle] }, { register: async (input: any) => { registrations.push(input); return { ...input, deliveryId: `decision_${String(registrations.length).padStart(16, "0")}`, issuedAt: 1, expiresAt: 86_401_000 }; } } as any, async () => [{ provider: "slack", connectionId: "slack:workspace", ownerActorId: "U-owner" }]);
  const plans = await planner.plan(); assert.equal(plans.length, 1); assert.equal(plans[0]?.provider, "slack"); assert.equal(plans[0]?.channelId, "C-owner"); assert.equal(plans[0]?.title, "Owner secret project");
  assert.deepEqual(plans[0]?.actions.map((item) => item.label), ["Approve", "Decline"]); assert.ok(registrations.every((item) => item.projectId === projectId && item.revision === 9 && item.ownerActorId === "U-owner"));
  assert.doesNotMatch(JSON.stringify(plans), /digest|credential|token|source|workspace path/i);
});

test("planner remains inert outside approval stage and without an exact connection identity", async () => {
  const noIdentity = new OwnerResponseDeliveryPlanner({ list: async () => projects }, { list: async () => [lifecycle] }, { register: async () => assert.fail("must not register") } as any, async () => []);
  assert.deepEqual(await noIdentity.plan(), []);
  const wrongStage = new OwnerResponseDeliveryPlanner({ list: async () => projects }, { list: async () => [{ ...lifecycle, stage: "execution" }] }, { register: async () => assert.fail("must not register") } as any, async () => [{ provider: "slack", connectionId: "slack:workspace", ownerActorId: "U-owner" }]);
  assert.deepEqual(await wrongStage.plan(), []);
});
