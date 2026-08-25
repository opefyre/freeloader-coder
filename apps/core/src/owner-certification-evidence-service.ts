import { createHash } from "node:crypto";

import {
  ownerCertificationEvidencePacketSchema,
  type OwnerCertificationEvidencePacket,
  type OwnerJourneyCertificationSnapshot,
  type OwnerJourneyTrustSnapshot,
  type OwnerPilotImprovementCollection,
  type OwnerPilotReview,
} from "../../../packages/runtime/src/owner-journey-certification.js";

type Sources = {
  certification: () => Promise<OwnerJourneyCertificationSnapshot>;
  trust: () => Promise<OwnerJourneyTrustSnapshot>;
  review: () => Promise<OwnerPilotReview>;
  improvements: () => Promise<OwnerPilotImprovementCollection>;
};

export class OwnerCertificationEvidenceService {
  constructor(private readonly sources: Sources) {}

  async packet(): Promise<OwnerCertificationEvidencePacket> {
    const [certification, trust, review, improvements] = await Promise.all([
      this.sources.certification(), this.sources.trust(), this.sources.review(), this.sources.improvements(),
    ]);
    const receipt = certification.lastPassedReceipt;
    const generatedAt = Math.max(
      receipt ? Date.parse(receipt.completedAt) : 0,
      ...improvements.drafts.map((item) => item.updatedAt),
      0,
    );
    const content = {
      schemaVersion: 1 as const,
      provenance: "local_owner_certification_evidence" as const,
      generatedAt,
      automaticSpendLimitUsd: 0 as const,
      externalEffects: 0 as const,
      certification: {
        state: certification.state,
        certificationId: receipt?.certificationId ?? null,
        completedAt: receipt?.completedAt ?? null,
        stages: receipt?.stages.map(({ name, evidenceDigest }) => ({ name, evidenceDigest })) ?? [],
        limitations: receipt?.limitations ?? ["No passing local owner-journey certification is currently available."],
      },
      readiness: {
        state: trust.readiness.state,
        completedSessions: trust.learning.completedSessions,
        minimumSampleSize: 3 as const,
        nextAction: trust.readiness.nextAction,
        reasons: trust.readiness.reasons,
      },
      pilotReview: {
        state: review.state,
        completionRatePercent: review.completionRatePercent,
        medianTimeToPreviewSeconds: review.medianTimeToPreviewSeconds,
        trustAtLeastFourPercent: review.trustAtLeastFourPercent,
        rankedFrictions: [...review.rankedFrictions].sort((left, right) => right.count - left.count || left.category.localeCompare(right.category)),
        evidenceDigest: review.evidenceDigest,
        limitations: review.limitations,
      },
      improvementHandoffs: [...improvements.drafts]
        .sort((left, right) => left.id.localeCompare(right.id))
        .map(({ id, state, revision, jiraProjectKey, previewDigest, receipts, lastError }) => ({
          id, state, revision, jiraProjectKey, previewDigest,
          receipts: [...receipts].sort((left, right) => left.improvementId.localeCompare(right.improvementId)),
          lastError,
        })),
      privacy: { prompts: false as const, sourceCode: false as const, attachments: false as const, credentials: false as const, absolutePaths: false as const, personalIdentifiers: false as const, sessionNotes: false as const, privateJiraContent: false as const },
      limitations: [
        "This packet proves local product behavior and bounded owner-pilot evidence, not external adoption or live provider availability.",
        "Only privacy-safe aggregates, digests, states, and owner-approved Jira receipts are included.",
      ],
    };
    const packetDigest = createHash("sha256").update(canonical(content)).digest("hex");
    return ownerCertificationEvidencePacketSchema.parse({ ...content, packetDigest });
  }
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  return JSON.stringify(value);
}
