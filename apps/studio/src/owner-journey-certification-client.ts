import {
  externalLearningCollectionSchema,
  externalLearningSessionSchema,
  ownerJourneyCertificationPreviewSchema,
  ownerJourneyCertificationRunResponseSchema,
  ownerJourneyCertificationSnapshotSchema,
  ownerJourneyTrustSnapshotSchema,
  ownerPilotCollectionSchema,
  ownerPilotReviewSchema,
  ownerPilotSessionSchema,
  ownerPilotImprovementCollectionSchema,
  ownerPilotImprovementDraftSchema,
  type ExternalLearningCollection,
  type ExternalLearningSession,
  type OwnerJourneyCertificationPreview,
  type OwnerJourneyCertificationRunResponse,
  type OwnerJourneyCertificationSnapshot,
  type OwnerJourneyTrustSnapshot,
  type OwnerPilotCollection,
  type OwnerPilotReview,
  type OwnerPilotSession,
  type OwnerPilotImprovementCollection,
  type OwnerPilotImprovementDraft,
  ownerCertificationEvidencePacketSchema,
  type OwnerCertificationEvidencePacket,
} from "../../../packages/runtime/src/owner-journey-certification.js";

const MAX_BYTES = 300_000;
export async function getOwnerJourneyCertification(
  endpoint: string,
  signal?: AbortSignal,
): Promise<OwnerJourneyCertificationSnapshot> {
  return ownerJourneyCertificationSnapshotSchema.parse(
    await request(
      new URL("/api/v1/owner-journey-certification", loopback(endpoint)),
      { method: "GET", ...(signal ? { signal } : {}) },
    ),
  );
}
export async function getOwnerJourneyTrust(
  endpoint: string,
  signal?: AbortSignal,
): Promise<OwnerJourneyTrustSnapshot> {
  return ownerJourneyTrustSnapshotSchema.parse(
    await request(new URL("/api/v1/owner-journey-trust", loopback(endpoint)), {
      method: "GET",
      ...(signal ? { signal } : {}),
    }),
  );
}
export async function tickOwnerJourneyTrust(
  endpoint: string,
  idempotencyKey: string,
): Promise<OwnerJourneyTrustSnapshot> {
  return ownerJourneyTrustSnapshotSchema.parse(
    await request(
      new URL("/api/v1/owner-journey-trust/tick", loopback(endpoint)),
      { method: "POST", headers: { "Idempotency-Key": idempotencyKey } },
    ),
  );
}
export async function previewOwnerJourneyCertification(
  endpoint: string,
): Promise<OwnerJourneyCertificationPreview> {
  return ownerJourneyCertificationPreviewSchema.parse(
    await request(
      new URL(
        "/api/v1/owner-journey-certification/preview",
        loopback(endpoint),
      ),
      { method: "POST" },
    ),
  );
}
export async function runOwnerJourneyCertification(
  endpoint: string,
  idempotencyKey: string,
): Promise<OwnerJourneyCertificationRunResponse> {
  return ownerJourneyCertificationRunResponseSchema.parse(
    await request(
      new URL("/api/v1/owner-journey-certification/run", loopback(endpoint)),
      { method: "POST", headers: { "Idempotency-Key": idempotencyKey } },
    ),
  );
}
export async function listExternalOwnerLearning(
  endpoint: string,
): Promise<ExternalLearningCollection> {
  return externalLearningCollectionSchema.parse(
    await request(
      new URL("/api/v1/external-owner-learning", loopback(endpoint)),
      { method: "GET" },
    ),
  );
}
export async function createExternalOwnerLearning(
  endpoint: string,
  input: unknown,
  idempotencyKey: string,
): Promise<ExternalLearningSession> {
  return externalLearningSessionSchema.parse(
    await request(
      new URL("/api/v1/external-owner-learning", loopback(endpoint)),
      json(input, idempotencyKey),
    ),
  );
}
export async function completeExternalOwnerLearning(
  endpoint: string,
  id: string,
  input: unknown,
): Promise<ExternalLearningSession> {
  return externalLearningSessionSchema.parse(
    await request(
      new URL(
        `/api/v1/external-owner-learning/${id}/complete`,
        loopback(endpoint),
      ),
      json(input),
    ),
  );
}
export async function withdrawExternalOwnerLearning(
  endpoint: string,
  id: string,
  expectedRevision: number,
): Promise<ExternalLearningSession> {
  return externalLearningSessionSchema.parse(
    await request(
      new URL(
        `/api/v1/external-owner-learning/${id}/withdraw`,
        loopback(endpoint),
      ),
      json({ expectedRevision }),
    ),
  );
}
export async function listOwnerPilot(
  endpoint: string,
): Promise<OwnerPilotCollection> {
  return ownerPilotCollectionSchema.parse(
    await request(new URL("/api/v1/owner-pilot", loopback(endpoint)), {
      method: "GET",
    }),
  );
}
export async function getOwnerPilotReview(
  endpoint: string,
): Promise<OwnerPilotReview> {
  return ownerPilotReviewSchema.parse(
    await request(new URL("/api/v1/owner-pilot/review", loopback(endpoint)), {
      method: "GET",
    }),
  );
}
export async function createOwnerPilot(
  endpoint: string,
  input: unknown,
  idempotencyKey: string,
): Promise<OwnerPilotSession> {
  return ownerPilotSessionSchema.parse(
    await request(
      new URL("/api/v1/owner-pilot", loopback(endpoint)),
      json(input, idempotencyKey),
    ),
  );
}
export async function advanceOwnerPilot(
  endpoint: string,
  id: string,
  input: unknown,
): Promise<OwnerPilotSession> {
  return ownerPilotSessionSchema.parse(
    await request(
      new URL(`/api/v1/owner-pilot/${id}/advance`, loopback(endpoint)),
      json(input),
    ),
  );
}
export async function completeOwnerPilot(
  endpoint: string,
  id: string,
  input: unknown,
): Promise<OwnerPilotSession> {
  return ownerPilotSessionSchema.parse(
    await request(
      new URL(`/api/v1/owner-pilot/${id}/complete`, loopback(endpoint)),
      json(input),
    ),
  );
}
export async function withdrawOwnerPilot(
  endpoint: string,
  id: string,
  expectedRevision: number,
): Promise<OwnerPilotSession> {
  return ownerPilotSessionSchema.parse(
    await request(
      new URL(`/api/v1/owner-pilot/${id}/withdraw`, loopback(endpoint)),
      json({ expectedRevision }),
    ),
  );
}
export async function listOwnerPilotImprovements(endpoint: string): Promise<OwnerPilotImprovementCollection> {
  return ownerPilotImprovementCollectionSchema.parse(await request(new URL("/api/v1/owner-pilot/improvements", loopback(endpoint)), { method: "GET" }));
}
export async function previewOwnerPilotImprovements(endpoint: string, input: unknown, idempotencyKey: string): Promise<OwnerPilotImprovementDraft> {
  return ownerPilotImprovementDraftSchema.parse(await request(new URL("/api/v1/owner-pilot/improvements", loopback(endpoint)), json(input, idempotencyKey)));
}
export async function editOwnerPilotImprovements(endpoint: string, id: string, input: unknown): Promise<OwnerPilotImprovementDraft> {
  return ownerPilotImprovementDraftSchema.parse(await request(new URL(`/api/v1/owner-pilot/improvements/${id}/edit`, loopback(endpoint)), json(input)));
}
export async function approveOwnerPilotImprovements(endpoint: string, id: string, input: unknown): Promise<OwnerPilotImprovementDraft> {
  return ownerPilotImprovementDraftSchema.parse(await request(new URL(`/api/v1/owner-pilot/improvements/${id}/approve`, loopback(endpoint)), json(input)));
}
export async function declineOwnerPilotImprovements(endpoint: string, id: string, input: unknown): Promise<OwnerPilotImprovementDraft> {
  return ownerPilotImprovementDraftSchema.parse(await request(new URL(`/api/v1/owner-pilot/improvements/${id}/decline`, loopback(endpoint)), json(input)));
}

export async function getOwnerCertificationEvidence(endpoint: string): Promise<OwnerCertificationEvidencePacket> {
  return ownerCertificationEvidencePacketSchema.parse(await request(new URL("/api/v1/owner-certification-evidence", loopback(endpoint)), { method: "GET" }));
}

export function ownerCertificationEvidenceFilename(packet: OwnerCertificationEvidencePacket): string {
  return `codkesh-owner-evidence-${packet.packetDigest.slice(0, 12)}.json`;
}
function json(body: unknown, idempotencyKey?: string): RequestInit {
  return {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
    },
    body: JSON.stringify(body),
  };
}
async function request(url: URL, init: RequestInit) {
  const response = await fetch(url, {
    ...init,
    credentials: "omit",
    cache: "no-store",
  });
  const text = await response.text();
  if (new TextEncoder().encode(text).byteLength > MAX_BYTES)
    throw new Error("Certification response is too large.");
  if (!response.ok) {
    try {
      const value = JSON.parse(text) as { error?: unknown };
      throw new Error(
        typeof value.error === "string"
          ? value.error
          : "Certification request failed.",
      );
    } catch (error) {
      if (
        error instanceof Error &&
        error.message !== "Unexpected end of JSON input"
      )
        throw error;
      throw new Error("Certification request failed.");
    }
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error("Certification response is malformed.");
  }
}
function loopback(value: string) {
  const url = new URL(value);
  if (
    url.protocol !== "http:" ||
    !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
    url.username ||
    url.password
  )
    throw new Error("Certification endpoint must use loopback HTTP.");
  return url;
}
