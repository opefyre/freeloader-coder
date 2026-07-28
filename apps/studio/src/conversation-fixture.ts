import type {
  ComposerAttachment,
  ConversationSearchRecord,
  RememberedAssertion,
  WorkTimelineEvent
} from "../../../packages/conversation/src/index.js";

export const composerAttachmentOptions: Readonly<Record<string, ComposerAttachment>> = {
  image: {
    id: "attachment-image",
    kind: "image",
    label: "settings-mobile.png",
    mediaType: "image/png",
    sizeBytes: 842_000,
    locator: "local selection · settings-mobile.png",
    previewText: "Mobile settings screen showing the current connection layout.",
    permission: "allowed",
    removed: false
  },
  file: {
    id: "attachment-file",
    kind: "file",
    label: "provider-notes.md",
    mediaType: "text/markdown",
    sizeBytes: 12_400,
    locator: "project file · docs/provider-notes.md",
    previewText: "Requirements for provider status and repair paths.",
    permission: "allowed",
    removed: false
  },
  url: {
    id: "attachment-url",
    kind: "url",
    label: "Provider documentation",
    mediaType: "text/html",
    sizeBytes: 0,
    locator: "https://example.com/provider-docs",
    previewText: "User-selected external provider documentation.",
    permission: "allowed",
    removed: false
  },
  project: {
    id: "attachment-project",
    kind: "project_reference",
    label: "Provider settings surface",
    mediaType: "application/x.pipeline-project-reference",
    sizeBytes: 0,
    locator: "project-main · apps/studio/src/components/providers",
    previewText: "Selected project component reference.",
    permission: "allowed",
    removed: false
  },
  unsafe: {
    id: "attachment-unsafe",
    kind: "file",
    label: "copied-config.txt",
    mediaType: "text/plain",
    sizeBytes: 2_100,
    locator: "local selection · copied-config.txt",
    previewText: "access_token=synthetic-sensitive-value",
    permission: "allowed",
    removed: false
  }
};

export const conversationTimelineEvents: readonly WorkTimelineEvent[] = [
  {
    sequence: 1,
    eventId: "event-ready",
    taskId: "PIPE-54",
    stage: "readiness",
    occurredAt: 1_800_000_000_000,
    title: "Request grounded",
    detail: "Outcome, project, and safe context were confirmed.",
    level: "summary",
    evidenceIds: ["intent-7"],
    state: "verified",
    leaseActive: false,
    serviceActive: true
  },
  {
    sequence: 2,
    eventId: "event-plan",
    taskId: "PIPE-54",
    stage: "decomposition",
    occurredAt: 1_800_000_001_000,
    title: "Plan created",
    detail: "Three reversible work units with one dependency.",
    level: "summary",
    evidenceIds: ["task-graph-7"],
    state: "verified",
    leaseActive: false,
    serviceActive: true
  },
  {
    sequence: 3,
    eventId: "event-implementation",
    taskId: "PIPE-54",
    stage: "implementation",
    occurredAt: 1_800_000_002_000,
    title: "Implementing the composer",
    detail: "One worker owns the current lease.",
    level: "summary",
    evidenceIds: ["lease-7"],
    state: "working",
    leaseActive: true,
    serviceActive: true
  },
  {
    sequence: 4,
    eventId: "event-tool-1",
    taskId: "PIPE-54",
    stage: "implementation",
    occurredAt: 1_800_000_003_000,
    title: "Inspected conversation contracts",
    detail: "Read-only repository access.",
    level: "technical",
    evidenceIds: ["tool-receipt-1"],
    state: "verified",
    leaseActive: true,
    serviceActive: true
  },
  {
    sequence: 5,
    eventId: "event-tool-2",
    taskId: "PIPE-54",
    stage: "implementation",
    occurredAt: 1_800_000_004_000,
    title: "Updated scoped product files",
    detail: "Reversible workspace changes only.",
    level: "technical",
    evidenceIds: ["tool-receipt-2"],
    state: "verified",
    leaseActive: true,
    serviceActive: true
  },
  {
    sequence: 6,
    eventId: "event-validation",
    taskId: "PIPE-54",
    stage: "validation",
    occurredAt: 1_800_000_005_000,
    title: "Validation waits for implementation",
    detail: "No test result has been claimed yet.",
    level: "summary",
    evidenceIds: [],
    state: "waiting",
    leaseActive: false,
    serviceActive: true
  }
];

export const conversationHistory: readonly ConversationSearchRecord[] = [
  {
    conversationId: "conversation-connection-ui",
    projectId: "project-main",
    taskIds: ["PIPE-49"],
    title: "Provider connection experience",
    permittedText: "Guided provider setup, repair, masking, and revocation.",
    updatedAt: 1_800_000_100_000
  },
  {
    conversationId: "conversation-runtime",
    projectId: "project-main",
    taskIds: ["PIPE-37", "PIPE-38"],
    title: "Clone-to-running setup",
    permittedText: "Preflight, local services, interruption, and repair.",
    updatedAt: 1_800_000_050_000
  },
  {
    conversationId: "conversation-other-project",
    projectId: "project-other",
    taskIds: ["OTHER-1"],
    title: "Private unrelated project",
    permittedText: "This must never appear in Main project search.",
    updatedAt: 1_800_000_200_000
  }
];

export const rememberedAssertions: readonly RememberedAssertion[] = [
  {
    id: "memory-design",
    projectId: "project-main",
    statement: "Use the existing warm amber design tokens and avoid gradients.",
    source: "User instruction · conversation-connection-ui",
    confidence: "high",
    scope: "project",
    expiresAt: null,
    state: "active",
    correction: null
  },
  {
    id: "memory-review",
    projectId: "project-main",
    statement: "Keep diffs and test logs as the primary review experience.",
    source: "User decision · product blueprint",
    confidence: "high",
    scope: "project",
    expiresAt: 1_900_000_000_000,
    state: "active",
    correction: null
  }
];

