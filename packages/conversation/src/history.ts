export interface ConversationSearchRecord {
  readonly conversationId: string;
  readonly projectId: string;
  readonly taskIds: readonly string[];
  readonly title: string;
  readonly permittedText: string;
  readonly updatedAt: number;
}

export interface RememberedAssertion {
  readonly id: string;
  readonly projectId: string;
  readonly statement: string;
  readonly source: string;
  readonly confidence: "low" | "medium" | "high";
  readonly scope: "conversation" | "project";
  readonly expiresAt: number | null;
  readonly state: "active" | "corrected" | "deleted";
  readonly correction: string | null;
}

export function searchConversations(input: {
  readonly records: readonly ConversationSearchRecord[];
  readonly query: string;
  readonly allowedProjectIds: ReadonlySet<string>;
  readonly taskId?: string | undefined;
}): readonly ConversationSearchRecord[] {
  const query = input.query.trim().toLowerCase();
  return input.records
    .filter((record) => input.allowedProjectIds.has(record.projectId))
    .filter((record) => !input.taskId || record.taskIds.includes(input.taskId))
    .filter((record) =>
      !query ||
      record.title.toLowerCase().includes(query) ||
      record.permittedText.toLowerCase().includes(query)
    )
    .sort((left, right) => right.updatedAt - left.updatedAt);
}

export function correctAssertion(
  assertion: RememberedAssertion,
  correction: string
): RememberedAssertion {
  const value = correction.trim();
  if (!value) throw new Error("A correction cannot be empty.");
  return {
    ...assertion,
    state: "corrected",
    correction: value
  };
}

export function deleteAssertion(
  assertion: RememberedAssertion
): RememberedAssertion {
  return {
    ...assertion,
    statement: "[deleted]",
    source: "[deleted]",
    state: "deleted",
    correction: null
  };
}

export function activeAssertions(
  assertions: readonly RememberedAssertion[],
  projectId: string,
  now: number
): readonly RememberedAssertion[] {
  return assertions.filter((assertion) =>
    assertion.projectId === projectId &&
    assertion.state !== "deleted" &&
    (assertion.expiresAt === null || assertion.expiresAt > now)
  );
}

export interface ConversationBundleExport {
  readonly schemaVersion: 1;
  readonly projectId: string;
  readonly conversationId: string;
  readonly exportedAt: string;
  readonly disclaimer: "Conversation history is not canonical project truth.";
  readonly sections: {
    readonly conversation: readonly string[];
    readonly plan: readonly string[];
    readonly evidence: readonly string[];
    readonly result: readonly string[];
  };
}

export function exportConversationBundle(input: {
  readonly projectId: string;
  readonly conversationId: string;
  readonly exportedAt: string;
  readonly conversation: readonly string[];
  readonly plan: readonly string[];
  readonly evidence: readonly string[];
  readonly result: readonly string[];
}): ConversationBundleExport {
  return {
    schemaVersion: 1,
    projectId: input.projectId,
    conversationId: input.conversationId,
    exportedAt: input.exportedAt,
    disclaimer: "Conversation history is not canonical project truth.",
    sections: {
      conversation: sanitize(input.conversation),
      plan: sanitize(input.plan),
      evidence: sanitize(input.evidence),
      result: sanitize(input.result)
    }
  };
}

function sanitize(values: readonly string[]): readonly string[] {
  return values.map((value) =>
    value
      .replace(
        /(api[_-]?key|password|access[_-]?token|private[_-]?key)\s*[:=]\s*\S+/gi,
        "$1=[redacted]"
      )
      .replace(/<hidden-prompt>[\s\S]*?<\/hidden-prompt>/gi, "[hidden prompt excluded]")
  );
}

