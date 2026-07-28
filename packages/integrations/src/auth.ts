import { createHash, randomBytes } from "node:crypto";

export type IntegrationProvider = "github" | "jira";

export interface AuthorizationSession {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly provider: IntegrationProvider;
  readonly stateDigest: string;
  readonly verifierDigest: string;
  readonly challenge: string;
  readonly redirectUri: string;
  readonly requestedScopes: readonly string[];
  readonly createdAt: number;
  readonly expiresAt: number;
  readonly consumedAt: number | null;
}

export interface ConnectedGrant {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly provider: IntegrationProvider;
  readonly accountLabel: string;
  readonly scopes: readonly string[];
  readonly resourceIds: readonly string[];
  readonly vaultReference: string;
  readonly expiresAt: number | null;
  readonly state: "active" | "partial" | "revoked";
  readonly createdAt: number;
}

export interface AuthorizationSecrets {
  readonly state: string;
  readonly verifier: string;
}

export function beginAuthorization(input: {
  readonly provider: IntegrationProvider;
  readonly redirectUri: string;
  readonly requestedScopes: readonly string[];
  readonly now: number;
  readonly ttlMs?: number;
  readonly entropy?: () => string;
}): { readonly session: AuthorizationSession; readonly secrets: AuthorizationSecrets } {
  assertRedirect(input.redirectUri);
  const scopes = normalizeScopes(input.requestedScopes);
  if (scopes.length === 0) throw new Error("At least one authorization scope is required.");
  const entropy = input.entropy ?? (() => randomBytes(32).toString("base64url"));
  const state = entropy();
  const verifier = entropy();
  if (state.length < 32 || verifier.length < 32) {
    throw new Error("Authorization entropy is too short.");
  }
  const id = `auth-${digest(`${input.provider}:${state}`).slice(0, 16)}`;
  return {
    session: {
      schemaVersion: 1,
      id,
      provider: input.provider,
      stateDigest: digest(state),
      verifierDigest: digest(verifier),
      challenge: digestBase64Url(verifier),
      redirectUri: input.redirectUri,
      requestedScopes: scopes,
      createdAt: input.now,
      expiresAt: input.now + (input.ttlMs ?? 10 * 60_000),
      consumedAt: null
    },
    secrets: { state, verifier }
  };
}

export function completeAuthorization(input: {
  readonly session: AuthorizationSession;
  readonly returnedState: string;
  readonly verifier: string;
  readonly authorizationCode: string;
  readonly accountLabel: string;
  readonly grantedScopes: readonly string[];
  readonly resourceIds: readonly string[];
  readonly vaultReference: string;
  readonly now: number;
  readonly expiresAt?: number | null;
}): { readonly session: AuthorizationSession; readonly grant: ConnectedGrant } {
  validateSession(input.session);
  if (input.session.consumedAt !== null) throw new Error("Authorization session was already consumed.");
  if (input.session.expiresAt <= input.now) throw new Error("Authorization session expired.");
  if (!safeDigestEqual(input.session.stateDigest, digest(input.returnedState))) {
    throw new Error("Authorization state did not match.");
  }
  if (!safeDigestEqual(input.session.verifierDigest, digest(input.verifier))) {
    throw new Error("Authorization verifier did not match.");
  }
  if (input.authorizationCode.trim().length < 6) {
    throw new Error("Authorization code is invalid.");
  }
  if (!/^vault:\/\/[a-z0-9][a-z0-9/_-]+$/i.test(input.vaultReference)) {
    throw new Error("Credential material must be stored behind a vault reference.");
  }
  const grantedScopes = normalizeScopes(input.grantedScopes);
  const unexpected = grantedScopes.filter(
    (scope) => !input.session.requestedScopes.includes(scope)
  );
  if (unexpected.length > 0) throw new Error("Provider returned an unrequested scope.");
  const missing = input.session.requestedScopes.filter(
    (scope) => !grantedScopes.includes(scope)
  );
  const resources = [...new Set(input.resourceIds.map((value) => value.trim()).filter(Boolean))].sort();
  return {
    session: { ...input.session, consumedAt: input.now },
    grant: {
      schemaVersion: 1,
      id: `grant-${digest(`${input.session.id}:${input.accountLabel}`).slice(0, 16)}`,
      provider: input.session.provider,
      accountLabel: input.accountLabel.trim() || "Connected account",
      scopes: grantedScopes,
      resourceIds: resources,
      vaultReference: input.vaultReference,
      expiresAt: input.expiresAt ?? null,
      state: missing.length > 0 ? "partial" : "active",
      createdAt: input.now
    }
  };
}

export function reconcileGrant(input: {
  readonly grant: ConnectedGrant;
  readonly observed: "active" | "revoked" | "organization_denied";
}): {
  readonly grant: ConnectedGrant;
  readonly allowNewEffects: boolean;
  readonly action: "continue" | "reconnect" | "ask_organization_owner";
} {
  if (input.observed === "active") {
    return { grant: input.grant, allowNewEffects: input.grant.state === "active", action: "continue" };
  }
  return {
    grant: { ...input.grant, state: "revoked" },
    allowNewEffects: false,
    action: input.observed === "organization_denied" ? "ask_organization_owner" : "reconnect"
  };
}

function validateSession(session: AuthorizationSession): void {
  if (
    session.schemaVersion !== 1 ||
    !session.id.startsWith("auth-") ||
    session.stateDigest.length !== 64 ||
    session.verifierDigest.length !== 64
  ) {
    throw new Error("Authorization session is invalid.");
  }
  assertRedirect(session.redirectUri);
}

function assertRedirect(redirectUri: string): void {
  const url = new URL(redirectUri);
  const local = ["127.0.0.1", "localhost", "::1"].includes(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) {
    throw new Error("Authorization redirect must use HTTPS or a loopback address.");
  }
  if (url.username || url.password || url.hash) {
    throw new Error("Authorization redirect contains unsupported credentials or fragments.");
  }
}

function normalizeScopes(scopes: readonly string[]): readonly string[] {
  return [...new Set(scopes.map((scope) => scope.trim()).filter(Boolean))].sort();
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function digestBase64Url(value: string): string {
  return createHash("sha256").update(value).digest("base64url");
}

function safeDigestEqual(left: string, right: string): boolean {
  return left.length === right.length && left === right;
}
