import assert from "node:assert/strict";
import test from "node:test";

import {
  approvalFactsForEffect,
  classifyEffect,
  createEffectApproval,
  createRecommendedEffectPolicy,
  digestEffect,
  evaluateEffectAuthorization,
  expireCapabilityLater,
  revokeCapability
} from "../packages/policy/src/effect-policy.js";
import {
  capabilityGrantSchema,
  effectDescriptorSchema,
  effectPolicySchema,
  type CapabilityGrant,
  type EffectDescriptor
} from "../packages/schemas/src/index.js";

const now = 1_800_000_000_000;
const hash = "a".repeat(64);

function effect(overrides: Partial<EffectDescriptor> = {}): EffectDescriptor {
  return effectDescriptorSchema.parse({
    schemaVersion: 1,
    id: "effect-update",
    projectId: "project-main",
    planDigest: hash,
    action: "Update the project configuration",
    target: {
      kind: "project_folder",
      reference: "project:main/config",
      display: "Main project · configuration",
      sensitivity: "masked"
    },
    category: "local_consequential",
    permissions: ["project.write"],
    reversibility: "reversible",
    cost: {
      mode: "free",
      currency: null,
      maximumMinor: null,
      explanation: "No paid service is used."
    },
    evidenceRequirement: "The file digest and validation result must change as planned.",
    undoOrCompensation: "Restore the saved checkpoint.",
    idempotencyKey: "project-main:update-config:v1",
    timeoutMs: 30_000,
    retry: "never",
    postcondition: "The expected configuration digest is observed.",
    auditEvent: "effect.authorization",
    redaction: ["full_path", "credential"],
    ...overrides
  });
}

function grant(overrides: Partial<CapabilityGrant> = {}): CapabilityGrant {
  return capabilityGrantSchema.parse({
    schemaVersion: 1,
    id: "grant-project",
    projectId: "project-main",
    issuedBy: "user",
    issuerId: "local-user",
    targetKinds: ["project_folder", "connector", "provider", "tool", "external_service"],
    effectCategories: [
      "read_only",
      "local_reversible",
      "local_consequential",
      "external_reversible",
      "external_consequential",
      "credential",
      "permission_expanding",
      "destructive",
      "paid"
    ],
    grantedAt: now - 60_000,
    expiresAt: null,
    revokedAt: null,
    ...overrides
  });
}

test("effects classify by consequence rather than command name", () => {
  assert.equal(classifyEffect({
    location: "local",
    writes: false,
    reversible: true,
    consequential: false,
    accessesCredential: false,
    expandsPermission: false,
    destructive: false,
    maximumCostMinor: 0
  }), "read_only");
  assert.equal(classifyEffect({
    location: "external",
    writes: true,
    reversible: false,
    consequential: true,
    accessesCredential: false,
    expandsPermission: false,
    destructive: false,
    maximumCostMinor: 0
  }), "external_consequential");
  assert.equal(classifyEffect({
    location: "local",
    writes: false,
    reversible: true,
    consequential: false,
    accessesCredential: true,
    expandsPermission: false,
    destructive: false,
    maximumCostMinor: 0
  }), "credential");
  assert.equal(classifyEffect({
    location: "local",
    writes: true,
    reversible: false,
    consequential: true,
    accessesCredential: false,
    expandsPermission: false,
    destructive: true,
    maximumCostMinor: 0
  }), "destructive");
  assert.equal(classifyEffect({
    location: "external",
    writes: true,
    reversible: false,
    consequential: true,
    accessesCredential: false,
    expandsPermission: false,
    destructive: false,
    maximumCostMinor: 1
  }), "paid");
});

test("guided, balanced, autonomous, and project overrides remain bounded by safeguards", () => {
  const local = effect({ category: "local_reversible" });
  const guided = evaluateEffectAuthorization({
    policy: createRecommendedEffectPolicy("project-main", "guided"),
    effect: local,
    grant: grant(),
    approval: null,
    now
  });
  assert.equal(guided.state, "approval_required");

  const balanced = evaluateEffectAuthorization({
    policy: createRecommendedEffectPolicy("project-main", "balanced"),
    effect: local,
    grant: grant(),
    approval: null,
    now
  });
  assert.equal(balanced.allowed, true);

  const autonomousExternal = evaluateEffectAuthorization({
    policy: createRecommendedEffectPolicy("project-main", "autonomous"),
    effect: effect({
      target: {
        kind: "connector",
        reference: "connector:jira",
        display: "Jira workspace",
        sensitivity: "public"
      },
      category: "external_reversible"
    }),
    grant: grant(),
    approval: null,
    now
  });
  assert.equal(autonomousExternal.allowed, true);

  const credentialAutoOverride = effectPolicySchema.parse({
    schemaVersion: 1,
    projectId: "project-main",
    preset: "autonomous",
    overrides: [{ category: "credential", decision: "auto_allow" }]
  });
  assert.equal(evaluateEffectAuthorization({
    policy: credentialAutoOverride,
    effect: effect({ category: "credential" }),
    grant: grant(),
    approval: null,
    now
  }).state, "approval_required");
});

test("bypass, stale approval, changed target, duplicate submission, and replay are blocked", () => {
  const consequential = effect();
  const policy = createRecommendedEffectPolicy("project-main", "balanced");
  assert.equal(evaluateEffectAuthorization({
    policy,
    effect: consequential,
    grant: null,
    approval: null,
    now
  }).reason, "capability-missing");

  const approval = createEffectApproval({
    id: "approval-effect",
    effect: consequential,
    approvedBy: "local-user",
    approvedAt: now - 1_000,
    ttlMs: 500
  });
  assert.equal(evaluateEffectAuthorization({
    policy,
    effect: consequential,
    grant: grant(),
    approval,
    now
  }).reason, "approval-stale");

  const currentApproval = createEffectApproval({
    id: "approval-current",
    effect: consequential,
    approvedBy: "local-user",
    approvedAt: now,
    ttlMs: 60_000
  });
  const changedTarget = effect({
    target: {
      kind: "project_folder",
      reference: "project:other/config",
      display: "Other project · configuration",
      sensitivity: "masked"
    }
  });
  assert.equal(evaluateEffectAuthorization({
    policy,
    effect: changedTarget,
    grant: grant(),
    approval: currentApproval,
    now
  }).reason, "effect-changed");

  assert.equal(evaluateEffectAuthorization({
    policy,
    effect: consequential,
    grant: grant(),
    approval: currentApproval,
    now,
    completedIdempotencyKeys: new Set([consequential.idempotencyKey])
  }).state, "duplicate");

  const replayedInOtherProject = effect({
    projectId: "project-other",
    id: "effect-other"
  });
  assert.equal(evaluateEffectAuthorization({
    policy,
    effect: replayedInOtherProject,
    grant: grant(),
    approval: currentApproval,
    now
  }).reason, "project-mismatch");
});

test("models and plugins cannot issue capability grants", () => {
  for (const issuedBy of ["model", "plugin"]) {
    assert.throws(
      () => capabilityGrantSchema.parse({
        ...grant(),
        issuedBy
      }),
      /Invalid option/
    );
  }
});

test("approval facts always show target, effect, cost, evidence, and undo", () => {
  const facts = approvalFactsForEffect(effect());
  assert.deepEqual(facts.map((fact) => fact.label), [
    "Target",
    "Effect",
    "Cost",
    "Evidence",
    "Undo or compensation"
  ]);
  assert.equal(facts.every((fact) => fact.value.length > 0), true);
  assert.equal(digestEffect(effect()).length, 64);
});

test("revocation blocks new work immediately and reconciles active work by stage", () => {
  const revoked = revokeCapability({
    grant: grant(),
    revokedAt: now,
    activeEffects: [
      {
        id: "not-started",
        stage: "not_started",
        category: "external_consequential",
        reversibility: "compensatable"
      },
      {
        id: "local-running",
        stage: "running",
        category: "local_reversible",
        reversibility: "reversible"
      },
      {
        id: "external-started",
        stage: "effect_started",
        category: "external_consequential",
        reversibility: "compensatable"
      }
    ]
  });
  assert.equal(revoked.blocksNewWork, true);
  assert.deepEqual(revoked.activeWork.map((entry) => entry.action), [
    "cancel_before_effect",
    "pause_after_safe_step",
    "observe_until_reconciled"
  ]);
  assert.equal(evaluateEffectAuthorization({
    policy: createRecommendedEffectPolicy("project-main"),
    effect: effect({ category: "local_reversible" }),
    grant: revoked.grant,
    approval: null,
    now
  }).reason, "capability-revoked");
});

test("expiry and schema validation reject stale or malformed policy state", () => {
  const expiring = expireCapabilityLater(grant(), now + 1);
  assert.equal(evaluateEffectAuthorization({
    policy: createRecommendedEffectPolicy("project-main"),
    effect: effect({ category: "local_reversible" }),
    grant: expiring,
    approval: null,
    now: now + 1
  }).reason, "capability-expired");
  assert.throws(
    () => effectPolicySchema.parse({
      schemaVersion: 1,
      projectId: "project-main",
      preset: "balanced",
      overrides: [
        { category: "read_only", decision: "ask" },
        { category: "read_only", decision: "deny" }
      ]
    }),
    /duplicate category/
  );
});
