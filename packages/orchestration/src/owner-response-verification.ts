import { createHmac, timingSafeEqual, verify } from "node:crypto";
import { z } from "zod";

export const ownerResponseEnvelopeSchema = z.strictObject({
  schemaVersion: z.literal(1),
  provider: z.enum(["telegram", "slack", "discord"]),
  deliveryId: z.string().min(1).max(128),
  projectId: z.string().regex(/^project_[a-f0-9]{16}$/),
  expectedRevision: z.number().int().nonnegative(),
  channelId: z.string().min(1).max(128),
  actorId: z.string().min(1).max(128),
  response: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("solution"), decision: z.enum(["approved", "declined"]), artifactDigest: z.string().regex(/^[a-f0-9]{64}$/) }),
    z.strictObject({ kind: z.literal("clarification"), questionId: z.string().min(1).max(128), optionId: z.string().min(1).max(128) }),
  ]),
  issuedAt: z.number().int().nonnegative(),
  expiresAt: z.number().int().positive(),
});
export type OwnerResponseEnvelope = z.infer<typeof ownerResponseEnvelopeSchema>;

export const verifiedOwnerResponseSchema = ownerResponseEnvelopeSchema.extend({
  verifiedAt: z.number().int().nonnegative(),
  idempotencyKey: z.string().min(1).max(256),
});
export type VerifiedOwnerResponse = z.infer<typeof verifiedOwnerResponseSchema>;

type ExpectedOwnerResponse = {
  provider: OwnerResponseEnvelope["provider"];
  projectId: string;
  revision: number;
  channelId: string;
  actorId: string;
  consumedDeliveryIds: ReadonlySet<string>;
};

export function verifyOwnerResponseEnvelope(input: unknown, expected: ExpectedOwnerResponse, now = Date.now()): VerifiedOwnerResponse {
  const envelope = ownerResponseEnvelopeSchema.parse(input);
  if (envelope.provider !== expected.provider) throw new Error("Owner response provider does not match the delivery.");
  if (envelope.projectId !== expected.projectId || envelope.expectedRevision !== expected.revision) throw new Error("Owner response is stale for the current project revision.");
  if (envelope.channelId !== expected.channelId) throw new Error("Owner response channel is not authorized.");
  if (envelope.actorId !== expected.actorId) throw new Error("Owner response actor is not authorized.");
  if (envelope.issuedAt > now + 60_000) throw new Error("Owner response timestamp is invalid.");
  if (envelope.expiresAt <= now) throw new Error("Owner response has expired.");
  if (envelope.expiresAt <= envelope.issuedAt) throw new Error("Owner response validity window is invalid.");
  if (expected.consumedDeliveryIds.has(envelope.deliveryId)) throw new Error("Owner response has already been consumed.");
  return verifiedOwnerResponseSchema.parse({ ...envelope, verifiedAt: now, idempotencyKey: `${envelope.provider}:${envelope.deliveryId}` });
}

export function verifySlackRequest(rawBody: string, timestamp: string, signature: string, signingSecret: string, now = Date.now()) {
  if (!/^\d{10}$/.test(timestamp) || !/^v0=[a-f0-9]{64}$/.test(signature) || signingSecret.length < 16) return false;
  if (Math.abs(Math.floor(now / 1_000) - Number(timestamp)) > 300) return false;
  const expected = `v0=${createHmac("sha256", signingSecret).update(`v0:${timestamp}:${rawBody}`).digest("hex")}`;
  return safeEqual(signature, expected);
}

export function verifyDiscordRequest(rawBody: string, timestamp: string, signature: string, publicKey: string, now = Date.now()) {
  if (!/^\d{10,13}$/.test(timestamp) || !/^[a-f0-9]{128}$/.test(signature) || !/^[a-f0-9]{64}$/.test(publicKey)) return false;
  const epochMs = timestamp.length === 10 ? Number(timestamp) * 1_000 : Number(timestamp);
  if (!Number.isFinite(epochMs) || Math.abs(now - epochMs) > 300_000) return false;
  const spkiPrefix = Buffer.from("302a300506032b6570032100", "hex");
  try {
    return verify(null, Buffer.from(`${timestamp}${rawBody}`), { key: Buffer.concat([spkiPrefix, Buffer.from(publicKey, "hex")]), format: "der", type: "spki" }, Buffer.from(signature, "hex"));
  } catch { return false; }
}

function safeEqual(left: string, right: string) {
  if (left.length !== right.length) return false;
  return timingSafeEqual(Buffer.from(left), Buffer.from(right));
}
