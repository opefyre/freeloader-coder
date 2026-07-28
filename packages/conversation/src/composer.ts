import { z } from "zod";

import { sha256 } from "./sha256.js";

export const attachmentKindSchema = z.enum([
  "image",
  "file",
  "url",
  "project_reference"
]);

export const composerAttachmentSchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9._-]{1,120}$/),
  kind: attachmentKindSchema,
  label: z.string().min(1).max(240),
  mediaType: z.string().min(1).max(160),
  sizeBytes: z.number().int().nonnegative().max(25_000_000),
  locator: z.string().min(1).max(2_000),
  previewText: z.string().max(4_000),
  permission: z.enum(["allowed", "denied"]),
  removed: z.boolean()
}).strict();

export type ComposerAttachment = z.infer<typeof composerAttachmentSchema>;

export interface ComposerFinding {
  readonly id: string;
  readonly severity: "blocking" | "assumption";
  readonly title: string;
  readonly detail: string;
  readonly editable: boolean;
}

export interface PreparedComposerRequest {
  readonly schemaVersion: 1;
  readonly outcome: string;
  readonly targetProjectId: string;
  readonly acceptedAttachmentIds: readonly string[];
  readonly rejectedAttachmentIds: readonly string[];
  readonly removedAttachmentIds: readonly string[];
  readonly citations: readonly {
    readonly id: string;
    readonly attachmentId: string;
    readonly locator: string;
    readonly digest: string;
  }[];
  readonly providerPayload: {
    readonly outcome: string;
    readonly targetProjectId: string;
    readonly context: readonly {
      readonly attachmentId: string;
      readonly kind: z.infer<typeof attachmentKindSchema>;
      readonly locator: string;
      readonly digest: string;
    }[];
    readonly assumptions: readonly string[];
  } | null;
  readonly findings: readonly ComposerFinding[];
}

export function prepareComposerRequest(input: {
  readonly outcome: string;
  readonly targetProjectId: string | null;
  readonly attachments: readonly ComposerAttachment[];
  readonly conflictingInstructions?: boolean | undefined;
  readonly implementationPreference?: string | null | undefined;
}): PreparedComposerRequest {
  const outcome = input.outcome.trim();
  if (outcome.length > 20_000) {
    throw new ComposerSafetyError(
      "invalid-outcome",
      "Describe an outcome in 20,000 characters or fewer."
    );
  }
  if (input.attachments.length > 10) {
    throw new ComposerSafetyError(
      "too-many-attachments",
      "Attach no more than 10 items to one request."
    );
  }
  const findings: ComposerFinding[] = [];
  if (!outcome) {
    findings.push({
      id: "outcome-required",
      severity: "blocking",
      title: "What outcome do you want?",
      detail: "Describe the result you want before this request can be sent.",
      editable: false
    });
  }
  if (!input.targetProjectId) {
    findings.push({
      id: "target-project",
      severity: "blocking",
      title: "Which project should change?",
      detail: "Choose one registered project before this request can be sent.",
      editable: false
    });
  }
  if (input.conflictingInstructions) {
    findings.push({
      id: "conflicting-instructions",
      severity: "blocking",
      title: "Which instruction should win?",
      detail: "The request asks for incompatible outcomes. Resolve the conflict before sending.",
      editable: false
    });
  }
  if (!input.implementationPreference) {
    findings.push({
      id: "implementation-preference",
      severity: "assumption",
      title: "Implementation approach",
      detail: "Use the existing project patterns and smallest reversible change.",
      editable: true
    });
  }

  const accepted: ComposerAttachment[] = [];
  const rejected: string[] = [];
  const removed: string[] = [];
  for (const raw of input.attachments) {
    const attachment = composerAttachmentSchema.parse(raw);
    if (attachment.removed) {
      removed.push(attachment.id);
      continue;
    }
    const rejection = attachmentRejection(attachment);
    if (rejection) {
      rejected.push(attachment.id);
      findings.push({
        id: `attachment-${attachment.id}`,
        severity: "blocking",
        title: `${attachment.label} cannot be included`,
        detail: rejection,
        editable: false
      });
      continue;
    }
    accepted.push(attachment);
  }

  if (containsSensitiveMaterial(outcome)) {
    findings.push({
      id: "outcome-sensitive-content",
      severity: "blocking",
      title: "Remove likely sensitive data",
      detail: "The request appears to contain a credential or personal contact detail.",
      editable: false
    });
  }
  const blocked = findings.some((finding) => finding.severity === "blocking");
  const targetProjectId = input.targetProjectId ?? "unselected";
  const citations = accepted.map((attachment) => ({
    id: `citation-${attachment.id}`,
    attachmentId: attachment.id,
    locator: attachment.locator,
    digest: digestAttachment(attachment)
  }));
  return {
    schemaVersion: 1,
    outcome,
    targetProjectId,
    acceptedAttachmentIds: accepted.map((attachment) => attachment.id),
    rejectedAttachmentIds: rejected,
    removedAttachmentIds: removed,
    citations,
    providerPayload: blocked
      ? null
      : {
          outcome,
          targetProjectId,
          context: accepted.map((attachment) => ({
            attachmentId: attachment.id,
            kind: attachment.kind,
            locator: attachment.locator,
            digest: digestAttachment(attachment)
          })),
          assumptions: findings
            .filter((finding) => finding.severity === "assumption")
            .map((finding) => finding.detail)
        },
    findings
  };
}

export function removeComposerAttachment(
  attachments: readonly ComposerAttachment[],
  attachmentId: string
): readonly ComposerAttachment[] {
  return attachments.map((attachment) =>
    attachment.id === attachmentId
      ? { ...attachment, removed: true }
      : attachment
  );
}

export class ComposerSafetyError extends Error {
  public constructor(
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "ComposerSafetyError";
  }
}

function attachmentRejection(attachment: ComposerAttachment): string | null {
  if (attachment.permission === "denied") {
    return "Permission to use this item was denied.";
  }
  if (
    (attachment.kind === "image" && attachment.sizeBytes > 10_000_000) ||
    (attachment.kind === "file" && attachment.sizeBytes > 5_000_000)
  ) {
    return "The item exceeds the safe per-attachment size limit.";
  }
  if (
    attachment.kind === "image" &&
    !["image/png", "image/jpeg", "image/webp"].includes(attachment.mediaType)
  ) {
    return "Use PNG, JPEG, or WebP images.";
  }
  if (
    attachment.kind === "url" &&
    !attachment.locator.startsWith("https://")
  ) {
    return "Only HTTPS links can be included.";
  }
  if (containsSensitiveMaterial(`${attachment.label}\n${attachment.previewText}`)) {
    return "The preview contains likely credential or personal contact data.";
  }
  return null;
}

function containsSensitiveMaterial(value: string): boolean {
  return /(api[_-]?key|password|private[_-]?key|access[_-]?token)\s*[:=]\s*\S+/i.test(value) ||
    /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(value) ||
    /\b(?:\+?\d[\d ()-]{8,}\d)\b/.test(value);
}

function digestAttachment(attachment: ComposerAttachment): string {
  return `sha256:${sha256([
      attachment.id,
      attachment.kind,
      attachment.mediaType,
      attachment.sizeBytes,
      attachment.locator,
      attachment.previewText
    ].join("\u0000"))}`;
}
