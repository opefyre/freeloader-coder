import { createHash } from "node:crypto";

export interface JiraSyncReceipt {
  readonly marker: string;
  readonly issueId: string;
  readonly appliedFields: readonly string[];
  readonly observedRevision: string;
  readonly verifiedAt: number;
}

export function planJiraSync(input: {
  readonly issueId: string;
  readonly issueKey: string;
  readonly sourceRevision: string;
  readonly currentRevision: string;
  readonly requestedStatus: "In Progress" | "In Review" | "Done" | null;
  readonly comment: string | null;
  readonly links: readonly string[];
  readonly evidence: {
    readonly deterministicChecksPassed: boolean;
    readonly reviewQuorumPassed: boolean;
    readonly modelClaimOnly: boolean;
  };
  readonly permissionState: "ready" | "revoked" | "partial";
  readonly existingReceipts: readonly JiraSyncReceipt[];
}): {
  readonly state: "ready" | "already_verified" | "conflict" | "permission_denied" | "evidence_blocked";
  readonly marker: string;
  readonly changes: readonly string[];
  readonly existingReceipt: JiraSyncReceipt | null;
  readonly decision: string;
} {
  const fields = [
    ...(input.requestedStatus ? [`status:${input.requestedStatus}`] : []),
    ...(input.comment?.trim() ? ["comment"] : []),
    ...input.links.map((link) => `link:${safeLink(link)}`)
  ];
  const marker = `pipeline-studio:${digest(
    `${input.issueId}:${input.sourceRevision}:${fields.join("|")}`
  ).slice(0, 24)}`;
  const existingReceipt = input.existingReceipts.find(
    (receipt) => receipt.marker === marker
  ) ?? null;
  if (existingReceipt) {
    return {
      state: "already_verified",
      marker,
      changes: [],
      existingReceipt,
      decision: "The exact Jira update already exists; no write will be repeated."
    };
  }
  if (input.permissionState !== "ready") {
    return {
      state: "permission_denied",
      marker,
      changes: fields,
      existingReceipt: null,
      decision: "Keep local evidence and reconnect or narrow the requested update."
    };
  }
  if (input.sourceRevision !== input.currentRevision) {
    return {
      state: "conflict",
      marker,
      changes: fields,
      existingReceipt: null,
      decision: `Review the newer ${input.issueKey} revision before writing.`
    };
  }
  const doneRequested = input.requestedStatus === "Done";
  const verified =
    input.evidence.deterministicChecksPassed &&
    input.evidence.reviewQuorumPassed &&
    !input.evidence.modelClaimOnly;
  if (doneRequested && !verified) {
    return {
      state: "evidence_blocked",
      marker,
      changes: fields,
      existingReceipt: null,
      decision: "Keep Jira below Done until deterministic checks and review quorum pass."
    };
  }
  return {
    state: "ready",
    marker,
    changes: fields,
    existingReceipt: null,
    decision: "Show the exact status, comment, links, and evidence summary for approval."
  };
}

export function verifyJiraSync(input: {
  readonly marker: string;
  readonly issueId: string;
  readonly expectedFields: readonly string[];
  readonly observedFields: readonly string[];
  readonly observedRevision: string;
  readonly matchingMarkers: number;
  readonly now: number;
}): JiraSyncReceipt {
  if (input.matchingMarkers !== 1) {
    throw new Error("Jira sync verification did not observe exactly one idempotency marker.");
  }
  const missing = input.expectedFields.filter(
    (field) => !input.observedFields.includes(field)
  );
  if (missing.length > 0) throw new Error(`Jira sync is missing: ${missing.join(", ")}.`);
  return {
    marker: input.marker,
    issueId: input.issueId,
    appliedFields: [...input.expectedFields].sort(),
    observedRevision: input.observedRevision,
    verifiedAt: input.now
  };
}

function safeLink(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:") throw new Error("Jira evidence links must use HTTPS.");
  return url.href;
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
