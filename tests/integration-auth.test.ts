import assert from "node:assert/strict";
import test from "node:test";

import {
  beginAuthorization,
  completeAuthorization,
  reconcileGrant
} from "../packages/integrations/src/index.js";

const now = 1_800_000_000_000;

test("authorization is PKCE-bound, short-lived, least-privilege, and vault-only", () => {
  const values = [
    "state-value-with-at-least-thirty-two-characters",
    "verifier-value-with-at-least-thirty-two-characters"
  ];
  const started = beginAuthorization({
    provider: "jira",
    redirectUri: "http://127.0.0.1:4311/oauth/jira/callback",
    requestedScopes: ["read:jira-work", "offline_access", "read:jira-work"],
    now,
    entropy: () => values.shift() ?? "unexpected"
  });
  assert.equal(started.session.requestedScopes.length, 2);
  assert.notEqual(started.session.stateDigest, started.secrets.state);
  assert.notEqual(started.session.verifierDigest, started.secrets.verifier);
  assert.equal(started.session.expiresAt, now + 600_000);

  const completed = completeAuthorization({
    session: started.session,
    returnedState: started.secrets.state,
    verifier: started.secrets.verifier,
    authorizationCode: "short-lived-code",
    accountLabel: "Opefyre Jira",
    grantedScopes: ["offline_access", "read:jira-work"],
    resourceIds: ["cloud-2", "cloud-1"],
    vaultReference: "vault://jira/grant-1",
    now: now + 1_000
  });
  assert.equal(completed.grant.state, "active");
  assert.deepEqual(completed.grant.resourceIds, ["cloud-1", "cloud-2"]);
  assert.equal(completed.session.consumedAt, now + 1_000);
});

test("authorization rejects CSRF, replay, insecure redirects, broad returned scope, and raw credentials", () => {
  assert.throws(
    () => beginAuthorization({
      provider: "github",
      redirectUri: "http://example.com/callback",
      requestedScopes: ["identity:read"],
      now,
      entropy: () => "secure-random-value-with-thirty-two-chars"
    }),
    /HTTPS or a loopback/
  );
  const values = [
    "state-value-with-at-least-thirty-two-characters",
    "verifier-value-with-at-least-thirty-two-characters"
  ];
  const started = beginAuthorization({
    provider: "github",
    redirectUri: "https://connect.example.test/github/callback",
    requestedScopes: ["identity:read"],
    now,
    entropy: () => values.shift() ?? "unexpected"
  });
  const base = {
    session: started.session,
    returnedState: started.secrets.state,
    verifier: started.secrets.verifier,
    authorizationCode: "device-code",
    accountLabel: "GitHub account",
    grantedScopes: ["identity:read"] as const,
    resourceIds: ["repo-1"],
    vaultReference: "vault://github/grant-1",
    now: now + 1_000
  };
  assert.throws(() => completeAuthorization({ ...base, returnedState: "wrong-state" }), /state/);
  assert.throws(
    () => completeAuthorization({ ...base, grantedScopes: ["identity:read", "admin:org"] }),
    /unrequested/
  );
  assert.throws(
    () => completeAuthorization({ ...base, vaultReference: "raw-token-value" }),
    /vault reference/
  );
  const completed = completeAuthorization(base);
  assert.throws(
    () => completeAuthorization({ ...base, session: completed.session }),
    /already consumed/
  );
});

test("revocation and organization policy denial stop new effects safely", () => {
  const grant = {
    schemaVersion: 1 as const,
    id: "grant-123",
    provider: "github" as const,
    accountLabel: "Opefyre",
    scopes: ["contents:read"],
    resourceIds: ["repo-1"],
    vaultReference: "vault://github/grant-1",
    expiresAt: null,
    state: "active" as const,
    createdAt: now
  };
  assert.deepEqual(reconcileGrant({ grant, observed: "revoked" }), {
    grant: { ...grant, state: "revoked" },
    allowNewEffects: false,
    action: "reconnect"
  });
  assert.equal(
    reconcileGrant({ grant, observed: "organization_denied" }).action,
    "ask_organization_owner"
  );
});
