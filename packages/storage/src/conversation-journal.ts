import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import {
  conversationJournalSchema,
  type ConversationJournal,
  type ConversationJournalEvent,
  type ConversationMessage
} from "../../schemas/src/index.js";

export type ConversationJournalEventInput = ConversationJournalEvent extends infer Event
  ? Event extends ConversationJournalEvent
    ? Omit<Event, "schemaVersion" | "sequence" | "eventId" | "conversationId">
    : never
  : never;

export interface ConversationBranch {
  readonly branchId: string;
  readonly parentBranchId: string | null;
  readonly parentMessageId: string | null;
}

export interface ConversationDisplayMessage {
  readonly canonical: ConversationMessage;
  readonly displayText: string;
  readonly deleted: boolean;
}

export interface ConversationProjection {
  readonly conversationId: string;
  readonly projectId: string;
  readonly lastSequence: number;
  readonly branches: readonly ConversationBranch[];
  readonly messages: readonly ConversationDisplayMessage[];
  readonly retention: {
    readonly mode: "keep" | "delete_at";
    readonly deleteAt: string | null;
  };
}

export interface ConversationExport {
  readonly schemaVersion: 1;
  readonly conversationId: string;
  readonly projectId: string;
  readonly exportedAt: string;
  readonly canonicalDisclaimer: "Conversation display is not authoritative execution history.";
  readonly branches: readonly ConversationBranch[];
  readonly messages: readonly {
    readonly sequence: number;
    readonly messageId: string;
    readonly branchId: string;
    readonly type: ConversationMessage["type"];
    readonly displayText: string;
    readonly deleted: boolean;
    readonly claim: ConversationMessage["claim"];
    readonly taskIds: readonly string[];
    readonly eventIds: readonly string[];
    readonly artifactIds: readonly string[];
    readonly citationIds: readonly string[];
    readonly approvalIds: readonly string[];
    readonly actionIds: readonly string[];
  }[];
}

export class JsonConversationJournalStore {
  public constructor(private readonly filePath: string) {}

  public async load(conversationId: string): Promise<ConversationJournal> {
    try {
      const journal = conversationJournalSchema.parse(
        JSON.parse(await readFile(this.filePath, "utf8"))
      );
      if (journal.conversationId !== conversationId) {
        throw new Error("Stored conversation identity does not match.");
      }
      replayConversation(journal);
      return journal;
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        return emptyConversationJournal(conversationId);
      }
      throw error;
    }
  }

  public async save(journal: ConversationJournal): Promise<void> {
    const validated = conversationJournalSchema.parse(journal);
    replayConversation(validated);
    await mkdir(dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.next`;
    await writeFile(temporaryPath, `${JSON.stringify(validated, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600
    });
    await rename(temporaryPath, this.filePath);
  }
}

export function emptyConversationJournal(conversationId: string): ConversationJournal {
  return conversationJournalSchema.parse({
    schemaVersion: 1,
    conversationId,
    events: []
  });
}

export function appendConversationEvent(
  journal: ConversationJournal,
  input: ConversationJournalEventInput
): ConversationJournal {
  const sequence = journal.events.length + 1;
  const event = {
    ...input,
    schemaVersion: 1,
    sequence,
    eventId: `${journal.conversationId}:conversation:${sequence}`,
    conversationId: journal.conversationId
  } as ConversationJournalEvent;
  const next = conversationJournalSchema.parse({
    ...journal,
    events: [...journal.events, event]
  });
  replayConversation(next);
  return next;
}

export function replayConversation(journal: ConversationJournal): ConversationProjection {
  conversationJournalSchema.parse(journal);
  let projectId = "";
  let lastSequence = 0;
  let retention: ConversationProjection["retention"] = { mode: "keep", deleteAt: null };
  const branches: ConversationBranch[] = [];
  const messages: ConversationDisplayMessage[] = [];
  const eventIds = new Set<string>();

  for (const event of journal.events) {
    if (event.sequence !== lastSequence + 1) throw new Error("Conversation event sequence is not contiguous.");
    if (event.conversationId !== journal.conversationId) throw new Error("Conversation identity changed.");
    if (eventIds.has(event.eventId)) throw new Error("Conversation event is duplicated.");
    eventIds.add(event.eventId);
    if (event.type === "conversation.created") {
      if (event.sequence !== 1 || projectId) throw new Error("Conversation creation must be first and unique.");
      projectId = event.projectId;
      retention = event.retention;
      branches.push({
        branchId: event.rootBranchId,
        parentBranchId: null,
        parentMessageId: null
      });
    } else if (!projectId) {
      throw new Error("Conversation must be created before other events.");
    } else if (event.type === "conversation.branch_created") {
      if (branches.some((branch) => branch.branchId === event.branchId)) {
        throw new Error("Conversation branch is duplicated.");
      }
      if (!branches.some((branch) => branch.branchId === event.parentBranchId)) {
        throw new Error("Conversation parent branch does not exist.");
      }
      if (!messages.some((message) => message.canonical.messageId === event.parentMessageId)) {
        throw new Error("Conversation branch point does not exist.");
      }
      branches.push({
        branchId: event.branchId,
        parentBranchId: event.parentBranchId,
        parentMessageId: event.parentMessageId
      });
    } else if (event.type === "conversation.message_appended") {
      if (event.message.conversationId !== journal.conversationId) {
        throw new Error("Message belongs to another conversation.");
      }
      if (event.message.sequence !== event.sequence) {
        throw new Error("Message ordering does not match its event.");
      }
      if (!branches.some((branch) => branch.branchId === event.message.branchId)) {
        throw new Error("Message branch does not exist.");
      }
      if (messages.some((message) => message.canonical.messageId === event.message.messageId)) {
        throw new Error("Message identity is duplicated.");
      }
      if (
        event.message.retryOfMessageId &&
        !messages.some((message) => message.canonical.messageId === event.message.retryOfMessageId)
      ) {
        throw new Error("Retried message does not exist.");
      }
      messages.push({
        canonical: event.message,
        displayText: event.message.displayText,
        deleted: false
      });
    } else {
      const messageIndex = messages.findIndex(
        (message) => message.canonical.messageId === event.messageId
      );
      if (messageIndex < 0) throw new Error("Display mutation references an unknown message.");
      const current = messages[messageIndex] as ConversationDisplayMessage;
      messages[messageIndex] = event.type === "conversation.display_edited"
        ? { ...current, displayText: event.displayText }
        : { ...current, displayText: "[deleted]", deleted: true };
    }
    lastSequence = event.sequence;
  }

  return {
    conversationId: journal.conversationId,
    projectId,
    lastSequence,
    branches,
    messages,
    retention
  };
}

export function exportConversation(
  journal: ConversationJournal,
  exportedAt: string
): ConversationExport {
  const projection = replayConversation(journal);
  return {
    schemaVersion: 1,
    conversationId: projection.conversationId,
    projectId: projection.projectId,
    exportedAt,
    canonicalDisclaimer: "Conversation display is not authoritative execution history.",
    branches: projection.branches,
    messages: projection.messages.map((message) => ({
      sequence: message.canonical.sequence,
      messageId: message.canonical.messageId,
      branchId: message.canonical.branchId,
      type: message.canonical.type,
      displayText: message.deleted
        ? "[deleted]"
        : message.canonical.redaction === "none"
          ? message.displayText
          : message.canonical.redactedDisplayText ?? "[redacted]",
      deleted: message.deleted,
      claim: message.canonical.claim,
      taskIds: message.canonical.taskIds,
      eventIds: message.canonical.eventIds,
      artifactIds: message.canonical.artifactIds,
      citationIds: message.canonical.citationIds,
      approvalIds: message.canonical.approvalIds,
      actionIds: message.canonical.actionIds
    }))
  };
}
