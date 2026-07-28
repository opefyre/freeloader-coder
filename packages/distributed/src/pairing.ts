import { createHash, randomBytes } from "node:crypto";

import { z } from "zod";

const fingerprint = z.string().regex(/^sha256:[a-f0-9]{64}$/);

export const pairingRequestSchema = z.strictObject({
  schemaVersion: z.literal(1),
  id: z.string().regex(/^pair_[a-f0-9]{16}$/),
  codeDigest: z.string().regex(/^[a-f0-9]{64}$/),
  controllerFingerprint: fingerprint,
  createdAt: z.number().int().nonnegative(),
  expiresAt: z.number().int().positive(),
  usedAt: z.number().int().nonnegative().nullable()
});

export const pairedDeviceSchema = z.strictObject({
  schemaVersion: z.literal(1),
  id: z.string().regex(/^device_[a-f0-9]{16}$/),
  name: z.string().trim().min(1).max(120),
  owner: z.string().trim().min(1).max(120),
  fingerprint,
  controllerFingerprint: fingerprint,
  networkPath: z.enum(["lan", "private_network"]),
  permissions: z.array(z.enum(["models", "execution", "validation", "review"])).min(1),
  pairedAt: z.number().int().nonnegative(),
  revokedAt: z.number().int().nonnegative().nullable(),
  credentialVersion: z.number().int().positive()
});

export type PairingRequest = z.infer<typeof pairingRequestSchema>;
export type PairedDevice = z.infer<typeof pairedDeviceSchema>;

export class PairingAuthority {
  readonly #requests = new Map<string, PairingRequest>();
  readonly #devices = new Map<string, PairedDevice>();

  issue(input: {
    readonly controllerFingerprint: string;
    readonly now: number;
    readonly ttlMs: number;
    readonly code?: string;
  }): { readonly request: PairingRequest; readonly code: string } {
    if (input.ttlMs < 30_000 || input.ttlMs > 10 * 60_000) {
      throw new Error("Pairing codes must expire between 30 seconds and 10 minutes.");
    }
    const code = input.code ?? randomBytes(4).toString("hex").toUpperCase();
    if (!/^[A-F0-9]{8}$/.test(code)) throw new Error("Pairing code is malformed.");
    const request = pairingRequestSchema.parse({
      schemaVersion: 1,
      id: `pair_${digest(`${code}:${input.now}`).slice(0, 16)}`,
      codeDigest: digest(code),
      controllerFingerprint: input.controllerFingerprint,
      createdAt: input.now,
      expiresAt: input.now + input.ttlMs,
      usedAt: null
    });
    this.#requests.set(request.id, request);
    return { request, code };
  }

  confirm(input: {
    readonly requestId: string;
    readonly code: string;
    readonly now: number;
    readonly deviceName: string;
    readonly owner: string;
    readonly deviceFingerprint: string;
    readonly observedControllerFingerprint: string;
    readonly networkPath: PairedDevice["networkPath"];
    readonly permissions: PairedDevice["permissions"];
    readonly controllerConfirmed: boolean;
  }): PairedDevice {
    const request = this.#requests.get(input.requestId);
    if (!request) throw new Error("Pairing request is unknown.");
    if (request.usedAt !== null) throw new Error("Pairing code replay was rejected.");
    if (request.expiresAt <= input.now) throw new Error("Pairing code expired.");
    if (request.codeDigest !== digest(input.code)) throw new Error("Pairing code is invalid.");
    if (request.controllerFingerprint !== input.observedControllerFingerprint) {
      throw new Error("Mutual controller identity verification failed.");
    }
    if (!input.controllerConfirmed) throw new Error("Controller confirmation is required.");
    const device = pairedDeviceSchema.parse({
      schemaVersion: 1,
      id: `device_${digest(input.deviceFingerprint).slice(0, 16)}`,
      name: input.deviceName,
      owner: input.owner,
      fingerprint: input.deviceFingerprint,
      controllerFingerprint: request.controllerFingerprint,
      networkPath: input.networkPath,
      permissions: input.permissions,
      pairedAt: input.now,
      revokedAt: null,
      credentialVersion: 1
    });
    this.#requests.set(request.id, { ...request, usedAt: input.now });
    this.#devices.set(device.id, device);
    return device;
  }

  revoke(deviceId: string, now: number): PairedDevice {
    const device = this.#devices.get(deviceId);
    if (!device) throw new Error("Paired device is unknown.");
    const revoked = {
      ...device,
      revokedAt: now,
      credentialVersion: device.credentialVersion + 1
    };
    this.#devices.set(deviceId, revoked);
    return revoked;
  }

  canLease(deviceId: string): boolean {
    const device = this.#devices.get(deviceId);
    return device !== undefined && device.revokedAt === null;
  }
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
