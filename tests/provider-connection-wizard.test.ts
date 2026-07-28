import assert from "node:assert/strict";
import test from "node:test";

import {
  providerConnectionGuides,
  recordProviderValidation,
  repairForValidationFailure,
  requestSecureEntry,
  revokeWizardConnection,
  startProviderWizard
} from "../packages/providers/src/wizard.js";

test("every supported provider has exact setup, free-status, data-use, and revocation guidance", () => {
  assert.deepEqual(
    providerConnectionGuides.map((guide) => guide.id),
    [
      "groq",
      "gemini",
      "openrouter",
      "cloudflare",
      "github-models",
      "cerebras",
      "mistral",
      "zhipu",
      "sambanova",
      "deepseek",
      "local-model-runtime"
    ]
  );
  for (const guide of providerConnectionGuides) {
    assert.match(guide.dashboardUrl, /^https?:\/\/127\.0\.0\.1|^https:\/\//);
    assert.ok(guide.steps.length >= 4);
    assert.ok(guide.freeStatus);
    assert.ok(guide.dataUse);
    assert.ok(guide.minimumPermission);
    assert.ok(guide.revocation);
  }
});

test("successful validation returns only a masked vault reference", () => {
  const session = requestSecureEntry(startProviderWizard("groq"));
  const connected = recordProviderValidation({
    session,
    outcome: "passed",
    credentialFingerprint: "31d7c4e9a2bf"
  });
  assert.equal(connected.stage, "connected");
  assert.equal(connected.maskedCredential, "vault:•••• · a2bf");
  assert.equal(JSON.stringify(connected).includes("fixture-access"), false);
});

test("local discovery connects without inventing a credential", () => {
  const connected = recordProviderValidation({
    session: requestSecureEntry(startProviderWizard("local-model-runtime")),
    outcome: "passed"
  });
  assert.equal(connected.stage, "connected");
  assert.equal(connected.credentialState, "not_received");
  assert.equal(connected.maskedCredential, null);
});

test("each validation failure provides one specific, safe repair path", () => {
  for (const failure of [
    "invalid",
    "expired",
    "wrong_project",
    "paid_only",
    "insufficient_permission",
    "offline"
  ] as const) {
    const repaired = recordProviderValidation({
      session: startProviderWizard("gemini"),
      outcome: failure
    });
    assert.equal(repaired.stage, "repair");
    assert.equal(repaired.validationFailure, failure);
    assert.equal(repaired.maskedCredential, null);
    assert.equal(repaired.message, repairForValidationFailure(failure));
  }
});

test("revocation removes the masked reference and returns to setup", () => {
  const connected = recordProviderValidation({
    session: startProviderWizard("openrouter"),
    outcome: "passed",
    credentialFingerprint: "31d7c4e9a2bf"
  });
  const revoked = revokeWizardConnection(connected);
  assert.equal(revoked.credentialState, "revoked");
  assert.equal(revoked.maskedCredential, null);
  assert.equal(revoked.stage, "instructions");
});
