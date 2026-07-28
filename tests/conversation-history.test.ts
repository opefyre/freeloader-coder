import assert from "node:assert/strict";
import test from "node:test";

import {
  activeAssertions,
  correctAssertion,
  deleteAssertion,
  exportConversationBundle,
  searchConversations,
  type ConversationSearchRecord,
  type RememberedAssertion
} from "../packages/conversation/src/index.js";

const records: readonly ConversationSearchRecord[] = [
  {
    conversationId: "allowed",
    projectId: "project-main",
    taskIds: ["PIPE-55"],
    title: "Conversation search",
    permittedText: "Search current project decisions.",
    updatedAt: 20
  },
  {
    conversationId: "denied",
    projectId: "project-other",
    taskIds: ["OTHER-1"],
    title: "Private other project",
    permittedText: "Never reveal this content.",
    updatedAt: 30
  }
];

const assertion: RememberedAssertion = {
  id: "memory-1",
  projectId: "project-main",
  statement: "Use warm amber tokens.",
  source: "User decision",
  confidence: "high",
  scope: "project",
  expiresAt: null,
  state: "active",
  correction: null
};

test("search is constrained by project permission before text matching", () => {
  const result = searchConversations({
    records,
    query: "project",
    allowedProjectIds: new Set(["project-main"])
  });
  assert.deepEqual(result.map((record) => record.conversationId), ["allowed"]);
  assert.equal(JSON.stringify(result).includes("Never reveal"), false);
});

test("remembered assertions expose source, confidence, scope, expiry, correction, and deletion", () => {
  const corrected = correctAssertion(assertion, "Use the established amber token.");
  assert.equal(corrected.state, "corrected");
  assert.equal(corrected.correction, "Use the established amber token.");

  const deleted = deleteAssertion(assertion);
  assert.equal(deleted.statement, "[deleted]");
  assert.equal(deleted.source, "[deleted]");
  assert.deepEqual(
    activeAssertions([assertion, deleted], "project-main", 100)
      .map((item) => item.id),
    ["memory-1"]
  );
});

test("selected export removes credentials and hidden prompts and denies canonical-truth wording", () => {
  const bundle = exportConversationBundle({
    projectId: "project-main",
    conversationId: "allowed",
    exportedAt: "2026-07-28T15:30:00.000Z",
    conversation: [
      "access_token=synthetic-sensitive-material",
      "<hidden-prompt>private operating instructions</hidden-prompt>"
    ],
    plan: ["Reversible plan"],
    evidence: ["Observed event"],
    result: ["Validated result"]
  });
  const serialized = JSON.stringify(bundle);
  assert.doesNotMatch(serialized, /synthetic-sensitive-material|private operating instructions/);
  assert.equal(
    bundle.disclaimer,
    "Conversation history is not canonical project truth."
  );
});

