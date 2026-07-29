export type PresentationMode =
  | "synthetic_fixture"
  | "local_observation"
  | "external_verification";

export type PresentationProvenance = {
  mode: PresentationMode;
  generatedAt: string;
  sourceClasses: readonly string[];
  externallyVerifiedAt: string | null;
};

export type ProvenanceAssessment = {
  label: "Demo workspace" | "Local observation" | "Externally verified";
  canClaimLive: boolean;
  freshness: "current" | "stale" | "not_applicable";
};

const MAX_EXTERNAL_VERIFICATION_AGE_MS = 15 * 60 * 1_000;

export function assessPresentationProvenance(
  provenance: PresentationProvenance,
  now: Date
): ProvenanceAssessment {
  if (provenance.sourceClasses.length === 0) {
    return {
      label: "Demo workspace",
      canClaimLive: false,
      freshness: "stale",
    };
  }

  if (provenance.mode === "synthetic_fixture") {
    return {
      label: "Demo workspace",
      canClaimLive: false,
      freshness: "not_applicable",
    };
  }

  if (provenance.mode === "local_observation") {
    return {
      label: "Local observation",
      canClaimLive: false,
      freshness: "current",
    };
  }

  if (!provenance.externallyVerifiedAt) {
    return {
      label: "Demo workspace",
      canClaimLive: false,
      freshness: "stale",
    };
  }

  const verifiedAt = Date.parse(provenance.externallyVerifiedAt);
  const age = now.getTime() - verifiedAt;
  if (!Number.isFinite(verifiedAt) || age < 0 || age > MAX_EXTERNAL_VERIFICATION_AGE_MS) {
    return {
      label: "Demo workspace",
      canClaimLive: false,
      freshness: "stale",
    };
  }

  return {
    label: "Externally verified",
    canClaimLive: true,
    freshness: "current",
  };
}
