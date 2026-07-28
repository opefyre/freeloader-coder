import assert from "node:assert/strict";
import { mkdtemp, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  citationContractSchema,
  conversationActionSchema,
  conversationMessageSchema,
  intentContractSchema,
  type ConversationMessage
} from "../packages/schemas/src/index.js";
import {
  appendConversationEvent,
  emptyConversationJournal,
  exportConversation,
  JsonConversationJournalStore,
  replayConversation
} from "../packages/storage/src/conversation-journal.js";

const at = "2026-07-28T10:00:00.000Z";
const digest = `sha256:${"a".repeat(64)}`;

test("editing and deleting display content cannot rewrite authoritative execution references", () => {
  let journal = createdJournal();
  journal = appendConversationEvent(journal, {
    type: "conversation.message_appended",
    occurredAt: at,
    message: message({
      messageId: "message-progress",
      sequence: 2,
      type: "progress",
      displayText: "Implementation completed.",
      claim: {
        classification: "evidence",
        references: [{ kind: "event", id: "event-42", digest }]
      },
      taskIds: ["PIPE-52"],
      eventIds: ["event-42"],
      artifactIds: ["artifact-7"]
    })
  });
  journal = appendConversationEvent(journal, {
    type: "conversation.display_edited",
    occurredAt: at,
    messageId: "message-progress",
    displayText: "Edited presentation text."
  });
  journal = appendConversationEvent(journal, {
    type: "conversation.display_deleted",
    occurredAt: at,
    messageId: "message-progress",
    reason: "user_request"
  });

  const projection = replayConversation(journal);
  const projected = projection.messages[0];
  assert.equal(projected?.displayText, "[deleted]");
  assert.equal(projected?.deleted, true);
  assert.equal(projected?.canonical.displayText, "Implementation completed.");
  assert.deepEqual(projected?.canonical.taskIds, ["PIPE-52"]);
  assert.deepEqual(projected?.canonical.eventIds, ["event-42"]);
  assert.deepEqual(projected?.canonical.artifactIds, ["artifact-7"]);
  assert.equal(projected?.canonical.claim?.classification, "evidence");
});

test("progress and result claims require evidence while explanations and inferences remain explicit", () => {
  assert.equal(conversationMessageSchema.safeParse(message({
    messageId: "result-without-proof",
    sequence: 2,
    type: "result",
    displayText: "Done.",
    claim: { classification: "explanation", references: [] }
  })).success, false);
  assert.equal(conversationMessageSchema.safeParse(message({
    messageId: "assistant-explanation",
    sequence: 2,
    type: "assistant",
    displayText: "I recommend splitting this task.",
    claim: { classification: "inference", references: [] }
  })).success, true);
  assert.equal(conversationMessageSchema.safeParse(message({
    messageId: "assistant-unclassified",
    sequence: 2,
    type: "assistant",
    displayText: "This might be done.",
    claim: null
  })).success, false);
});

test("branch, retry, replay, and export preserve ordering and immutable references", () => {
  let journal = createdJournal();
  journal = appendConversationEvent(journal, {
    type: "conversation.message_appended",
    occurredAt: at,
    message: message({
      messageId: "message-user",
      sequence: 2,
      type: "user",
      displayText: "Build the provider control.",
      claim: null
    })
  });
  journal = appendConversationEvent(journal, {
    type: "conversation.branch_created",
    occurredAt: at,
    branchId: "branch-alternative",
    parentBranchId: "branch-main",
    parentMessageId: "message-user"
  });
  journal = appendConversationEvent(journal, {
    type: "conversation.message_appended",
    occurredAt: at,
    message: message({
      messageId: "message-retry",
      branchId: "branch-alternative",
      sequence: 4,
      type: "assistant",
      displayText: "Here is a safer plan.",
      claim: { classification: "explanation", references: [] },
      retryOfMessageId: "message-user",
      citationIds: ["citation-1"],
      actionIds: ["action-1"]
    })
  });

  const first = replayConversation(journal);
  const second = replayConversation(JSON.parse(JSON.stringify(journal)));
  assert.deepEqual(second, first);
  const exported = exportConversation(journal, "2026-07-28T11:00:00.000Z");
  assert.deepEqual(exported.messages.map((item) => item.sequence), [2, 4]);
  assert.deepEqual(exported.messages[1]?.citationIds, ["citation-1"]);
  assert.deepEqual(exported.messages[1]?.actionIds, ["action-1"]);
  assert.equal(
    exported.canonicalDisclaimer,
    "Conversation display is not authoritative execution history."
  );
});

test("conversation replay rejects tampering, invalid branches, stale retries, gaps, and duplicates", () => {
  const base = createdJournal();
  assert.throws(() => appendConversationEvent(base, {
    type: "conversation.branch_created",
    occurredAt: at,
    branchId: "orphan",
    parentBranchId: "missing",
    parentMessageId: "missing"
  }), /parent branch/);
  assert.throws(() => appendConversationEvent(base, {
    type: "conversation.message_appended",
    occurredAt: at,
    message: message({
      messageId: "bad-retry",
      sequence: 2,
      type: "assistant",
      displayText: "Retry",
      claim: { classification: "explanation", references: [] },
      retryOfMessageId: "missing"
    })
  }), /Retried message/);
  const withGap = {
    ...base,
    events: [{ ...base.events[0]!, sequence: 2 }]
  };
  assert.throws(() => replayConversation(withGap), /not contiguous/);
  const duplicate = {
    ...base,
    events: [...base.events, { ...base.events[0]!, sequence: 2 }]
  };
  assert.throws(() => replayConversation(duplicate), /duplicated|first and unique/);
});

test("intent, citation, and action boundaries reject invented fields and unproven completion", () => {
  assert.equal(intentContractSchema.safeParse({
    schemaVersion: 1,
    intentId: "intent-1",
    sourceMessageId: "message-user",
    outcome: "Create a safe provider control.",
    targetProjectId: "project-1",
    constraints: ["Free-only"],
    acceptanceCriteria: ["No paid route"],
    status: "accepted"
  }).success, true);
  assert.equal(citationContractSchema.safeParse({
    schemaVersion: 1,
    citationId: "citation-1",
    sourceKind: "event",
    sourceId: "event-42",
    locator: "event sequence 42",
    contentDigest: digest,
    trust: "observed",
    capturedAt: at,
    hiddenPrompt: "forbidden"
  }).success, false);
  assert.equal(conversationActionSchema.safeParse({
    schemaVersion: 1,
    actionId: "action-1",
    sourceMessageId: "message-user",
    taskId: "PIPE-52",
    effect: "reversible_write",
    status: "observed",
    approvalId: null,
    idempotencyKey: "action-1-once",
    evidenceEventIds: [],
    postcondition: "unknown"
  }).success, false);
  assert.equal(conversationActionSchema.safeParse({
    schemaVersion: 1,
    actionId: "action-danger",
    sourceMessageId: "message-user",
    taskId: "PIPE-52",
    effect: "irreversible_write",
    status: "proposed",
    approvalId: null,
    idempotencyKey: "action-danger-once",
    evidenceEventIds: [],
    postcondition: "not_attempted"
  }).success, false);
});

test("journal persistence is atomic/private and export honors redaction without losing references", async () => {
  const root = await mkdtemp(join(tmpdir(), "conversation-journal-"));
  const path = join(root, "conversation.json");
  const store = new JsonConversationJournalStore(path);
  let journal = createdJournal();
  journal = appendConversationEvent(journal, {
    type: "conversation.message_appended",
    occurredAt: at,
    message: message({
      messageId: "message-redacted",
      sequence: 2,
      type: "assistant",
      displayText: "Internal display with sensitive synthetic context.",
      claim: {
        classification: "evidence",
        references: [{ kind: "artifact", id: "artifact-safe", digest }]
      },
      artifactIds: ["artifact-safe"],
      redaction: "full",
      redactedDisplayText: "[redacted]"
    })
  });
  await store.save(journal);
  const restored = await store.load("conversation-1");
  assert.deepEqual(restored, journal);
  assert.equal((await stat(path)).mode & 0o777, 0o600);
  const exported = exportConversation(restored, at);
  assert.equal(exported.messages[0]?.displayText, "[redacted]");
  assert.deepEqual(exported.messages[0]?.artifactIds, ["artifact-safe"]);
  await assert.rejects(() => store.load("another-conversation"), /identity does not match/);
});

function createdJournal() {
  return appendConversationEvent(emptyConversationJournal("conversation-1"), {
    type: "conversation.created",
    occurredAt: at,
    projectId: "project-1",
    rootBranchId: "branch-main",
    retention: { mode: "keep", deleteAt: null }
  });
}

function message(
  overrides: Partial<ConversationMessage> & Pick<ConversationMessage, "messageId" | "sequence" | "type" | "displayText">
): ConversationMessage {
  return {
    schemaVersion: 1,
    messageId: overrides.messageId,
    conversationId: "conversation-1",
    branchId: overrides.branchId ?? "branch-main",
    sequence: overrides.sequence,
    createdAt: at,
    type: overrides.type,
    displayText: overrides.displayText,
    claim: overrides.claim ?? null,
    intentIds: overrides.intentIds ?? [],
    citationIds: overrides.citationIds ?? [],
    actionIds: overrides.actionIds ?? [],
    artifactIds: overrides.artifactIds ?? [],
    approvalIds: overrides.approvalIds ?? [],
    taskIds: overrides.taskIds ?? [],
    eventIds: overrides.eventIds ?? [],
    retryOfMessageId: overrides.retryOfMessageId ?? null,
    redaction: overrides.redaction ?? "none",
    redactedDisplayText: overrides.redactedDisplayText ?? null
  };
}
