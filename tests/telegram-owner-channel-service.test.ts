import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { TelegramOwnerChannelService } from "../apps/core/src/telegram-owner-channel-service.js";
import { localProjectCollectionSchema } from "../packages/runtime/src/local-projects.js";
import { projectLifecycleRecordSchema } from "../packages/orchestration/src/project-lifecycle.js";

const projectId = "project_0123456789abcdef";
const token = "123456789:abcdefghijklmnopqrstuvwxyzABCDE_12345";
const chatId = "-1001234567890";
const ownerUserId = "123456789";
const digest = "a".repeat(64);

test("Telegram owner channel signs, authorizes, consumes, and rejects replayed solution decisions", async () => {
  const root = await mkdtemp(join(tmpdir(), "pipeline-telegram-owner-"));
  try {
    let callbackData = "";
    let poll = 0;
    let decisions = 0;
    const lifecycle = projectLifecycleRecordSchema.parse({ schemaVersion: 1, projectId, stage: "awaiting_design_approval", revision: 3, mission: "Build a reliable product", assessment: null, questions: [], answers: [], artifacts: [{ kind: "solution", projectRelativePath: ".pipeline/SOLUTION.md", digest, revision: 1, createdAt: 100, citations: ["README.md"], reviewerIds: ["reviewer-a", "reviewer-b"], qaPassed: true }], designApproval: null, designFeedback: [], jiraEpicId: null, blockedReason: null, updatedAt: 100 });
    const projects = localProjectCollectionSchema.parse({ schemaVersion: 1, provenance: "local_observation", observedAt: 100, projects: [{ schemaVersion: 1, id: projectId, displayName: "Owner project", workspaceLabel: "owner-project", lifecycleStage: "awaiting_design_approval", resources: [{ id: "binding_0123456789abcdef", kind: "telegram_chat", connectionId: "telegram:bot", resourceId: chatId, label: "Pipeline approvals", url: "https://t.me", role: "notifications", selectedAt: 100 }], latestUpdate: null, progress: null, state: "ready", observedAt: 100, validForMs: 60_000, facts: [], inferences: [], decisions: [], warnings: [] }] });
    const service = new TelegramOwnerChannelService(
      root,
      { list: async () => projects },
      { list: async () => [lifecycle], get: async () => lifecycle, answer: async () => lifecycle, decideSolution: async (_id, input) => { decisions += 1; assert.equal((input as Record<string, unknown>).decision, "approved"); return lifecycle; } },
      { read: async () => JSON.stringify({ schemaVersion: 1, botToken: token, chatId, ownerUserId }) },
      async (input, init) => {
        const method = String(input).split("/").pop();
        const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, any>;
        if (method === "sendMessage") { callbackData = body.reply_markup.inline_keyboard[0][0].callback_data; return Response.json({ ok: true, result: { message_id: 1 } }); }
        if (method === "getUpdates") {
          poll += 1;
          return Response.json({ ok: true, result: poll === 1 ? [] : [{ update_id: poll, callback_query: { id: `callback-${poll}`, data: callbackData, from: { id: Number(ownerUserId) }, message: { chat: { id: Number(chatId) } } } }] });
        }
        return Response.json({ ok: true, result: true });
      },
      () => 1_000
    );
    assert.deepEqual(await service.synchronize(), { sent: 1, handled: 0 });
    assert.match(callbackData, /^ps:[a-f0-9]{16}:[a-f0-9]{16}$/);
    assert.deepEqual(await service.synchronize(), { sent: 0, handled: 1 });
    assert.equal(decisions, 1);
    assert.deepEqual(await service.synchronize(), { sent: 0, handled: 0 });
    assert.equal(decisions, 1, "a replay cannot apply the decision twice");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("Telegram owner channel rejects valid signed responses from a different chat or user", async () => {
  const root = await mkdtemp(join(tmpdir(), "pipeline-telegram-owner-denied-"));
  try {
    let callbackData = "";
    let poll = 0;
    let decisions = 0;
    const lifecycle = projectLifecycleRecordSchema.parse({ schemaVersion: 1, projectId, stage: "awaiting_design_approval", revision: 1, mission: "Build a safe product", assessment: null, questions: [], answers: [], artifacts: [{ kind: "solution", projectRelativePath: ".pipeline/SOLUTION.md", digest, revision: 1, createdAt: 100, citations: ["README.md"], reviewerIds: ["reviewer-a"], qaPassed: true }], designApproval: null, designFeedback: [], jiraEpicId: null, blockedReason: null, updatedAt: 100 });
    const projects = localProjectCollectionSchema.parse({ schemaVersion: 1, provenance: "local_observation", observedAt: 100, projects: [{ schemaVersion: 1, id: projectId, displayName: "Safe project", resources: [{ id: "binding_0123456789abcdef", kind: "telegram_chat", connectionId: "telegram:bot", resourceId: chatId, label: "Approvals", url: "https://t.me", role: "notifications", selectedAt: 100 }], state: "ready", observedAt: 100, validForMs: 60_000, facts: [], inferences: [], decisions: [], warnings: [] }] });
    const service = new TelegramOwnerChannelService(root, { list: async () => projects }, { list: async () => [lifecycle], get: async () => lifecycle, answer: async () => lifecycle, decideSolution: async () => { decisions += 1; return lifecycle; } }, { read: async () => JSON.stringify({ schemaVersion: 1, botToken: token, chatId, ownerUserId }) }, async (input, init) => {
      const method = String(input).split("/").pop(); const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, any>;
      if (method === "sendMessage") { callbackData = body.reply_markup.inline_keyboard[0][0].callback_data; return Response.json({ ok: true, result: {} }); }
      if (method === "getUpdates") { poll += 1; return Response.json({ ok: true, result: poll === 1 ? [] : poll === 2 ? [{ update_id: 2, callback_query: { id: "foreign-chat", data: callbackData, from: { id: Number(ownerUserId) }, message: { chat: { id: -999999999 } } } }] : [{ update_id: 3, callback_query: { id: "foreign-user", data: callbackData, from: { id: 999999999 }, message: { chat: { id: Number(chatId) } } } }] }); }
      return Response.json({ ok: true, result: true });
    }, () => 1_000);
    await service.synchronize(); await service.synchronize(); await service.synchronize();
    assert.equal(decisions, 0);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("Telegram owner channel delivers one independently signed decision to every selected project chat", async () => {
  const root = await mkdtemp(join(tmpdir(), "pipeline-telegram-owner-multi-"));
  try {
    const lifecycle = projectLifecycleRecordSchema.parse({ schemaVersion: 1, projectId, stage: "awaiting_design_approval", revision: 1, mission: "Build a connected product", assessment: null, questions: [], answers: [], artifacts: [{ kind: "solution", projectRelativePath: ".pipeline/SOLUTION.md", digest, revision: 1, createdAt: 100, citations: ["README.md"], reviewerIds: ["reviewer-a", "reviewer-b"], qaPassed: true }], designApproval: null, designFeedback: [], jiraEpicId: null, blockedReason: null, updatedAt: 100 });
    const resources = [chatId, "-1009876543210"].map((resourceId, index) => ({ id: `binding_${String(index + 1).padStart(16, "0")}`, kind: "telegram_chat" as const, connectionId: "telegram:bot", resourceId, label: `Approvals ${index + 1}`, url: "https://t.me", role: "notifications" as const, selectedAt: 100 }));
    const projects = localProjectCollectionSchema.parse({ schemaVersion: 1, provenance: "local_observation", observedAt: 100, projects: [{ schemaVersion: 1, id: projectId, displayName: "Multi-channel project", resources, state: "ready", observedAt: 100, validForMs: 60_000, facts: [], inferences: [], decisions: [], warnings: [] }] });
    const sent = new Set<string>();
    const callbacks = new Set<string>();
    const service = new TelegramOwnerChannelService(root, { list: async () => projects }, { list: async () => [lifecycle], get: async () => lifecycle, answer: async () => lifecycle, decideSolution: async () => lifecycle }, { read: async () => JSON.stringify({ schemaVersion: 1, botToken: token, chatId, ownerUserId }) }, async (input, init) => {
      const method = String(input).split("/").pop(); const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, any>;
      if (method === "sendMessage") { sent.add(String(body.chat_id)); callbacks.add(String(body.reply_markup.inline_keyboard[0][0].callback_data)); return Response.json({ ok: true, result: {} }); }
      return Response.json({ ok: true, result: [] });
    }, () => 1_000);
    assert.deepEqual(await service.synchronize(), { sent: 2, handled: 0 });
    assert.deepEqual(sent, new Set(resources.map((resource) => resource.resourceId)));
    assert.equal(callbacks.size, 2);
    assert.deepEqual(await service.synchronize(), { sent: 0, handled: 0 });
  } finally { await rm(root, { recursive: true, force: true }); }
});
