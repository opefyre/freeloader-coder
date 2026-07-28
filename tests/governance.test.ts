import assert from "node:assert/strict";
import test from "node:test";

import {
  assessGovernance,
  changeConsent,
  governancePolicySchema,
  privacyPreferencesSchema,
  supplyChainGateSchema,
  verifySupplyChain,
  type DataFlow,
  type GovernancePolicy,
  type PrivacyPreferences,
  type SupplyChainGate,
} from "../packages/governance/src/index.js";

const governance: GovernancePolicy = {
  schemaVersion: 1,
  reviewedAt: "2026-07-28T20:25:00.000Z",
  nextReviewAt: "2026-10-28T20:25:00.000Z",
  roles: [
    {
      schemaVersion: 1,
      id: "maintainer",
      title: "Maintainer",
      responsibilities: ["Keep the repository healthy."],
      authority: ["Merge verified changes."],
      selectedBy: "Public nomination and maintainer consensus.",
      term: "Reviewed every six months.",
      activeHolder: "Declared maintainer",
      fallbackRoleId: "release-owner",
    },
    {
      schemaVersion: 1,
      id: "release-owner",
      title: "Release owner",
      responsibilities: ["Verify one release evidence package."],
      authority: ["Pause release promotion."],
      selectedBy: "Named in the release evidence package.",
      term: "One release lifecycle.",
      activeHolder: null,
      fallbackRoleId: "maintainer",
    },
  ],
  decisions: [
    {
      schemaVersion: 1,
      id: "adr-0001",
      title: "Local-first canonical state",
      state: "accepted",
      decidedAt: "2026-07-27T08:00:00.000Z",
      owners: ["maintainer"],
      releaseIds: ["release-0.8.0-beta.2"],
      context: "Users require an inspectable local system.",
      decision: "Canonical task and evidence state remains local.",
      consequences: ["The core workflow remains available offline."],
      sourcePath: "docs/decisions/adr-0001-local-first.md",
    },
  ],
  roadmapProcessDefined: true,
  triageProcessDefined: true,
  moderationProcessDefined: true,
  successionProcessDefined: true,
  securityEmergencyProcessDefined: true,
  officialAdapterRuleDefined: true,
  conflictDisclosurePath: "docs/governance/disclosures.md",
  fundingDisclosurePath: "docs/governance/disclosures.md",
};

const supplyGate: SupplyChainGate = {
  schemaVersion: 1,
  gateId: "supply-0.8.0-beta.2",
  releaseId: "release-0.8.0-beta.2",
  sourceCommit: "89f0827",
  lockfileDigest: `sha256:${"4".repeat(64)}`,
  checks: [
    "dependency",
    "secret",
    "build",
    "artifact",
    "provenance",
    "signature",
    "license",
  ].map((category, index) => ({
    schemaVersion: 1 as const,
    id: `check-${index}`,
    category: category as
      | "dependency"
      | "secret"
      | "build"
      | "artifact"
      | "provenance"
      | "signature"
      | "license",
    label: `Required check ${index}`,
    required: true,
    state: "passed" as const,
    observedAt: "2026-07-28T20:25:00.000Z",
    evidenceRef: `evidence://check-${index}`,
    remediation: "Repair the fixture and rerun the complete gate.",
  })),
  allowedLicenses: ["MIT"],
  deniedPackages: [],
  generatedAt: "2026-07-28T20:25:00.000Z",
};

const flows: readonly DataFlow[] = [
  {
    schemaVersion: 1,
    id: "optional-telemetry",
    category: "optional_telemetry",
    data: ["feature event"],
    destination: "Configured telemetry endpoint",
    purpose: "Measure coarse product reliability.",
    defaultEnabled: false,
    requiresConsent: true,
    retention: "30 days",
    deletionSupported: true,
    containsSecrets: false,
    containsPersonalData: false,
  },
  {
    schemaVersion: 1,
    id: "training-eligible-ai",
    category: "third_party_ai",
    data: ["redacted test prompt"],
    destination: "Eligible AI provider",
    purpose: "Use free test-pipeline capacity.",
    defaultEnabled: false,
    requiresConsent: true,
    retention: "Provider policy applies",
    deletionSupported: false,
    containsSecrets: false,
    containsPersonalData: false,
  },
];

const preferences: PrivacyPreferences = {
  schemaVersion: 1,
  optionalTelemetry: false,
  thirdPartyTrainingEligible: true,
  supportDiagnostics: false,
  paidUsage: false,
  updatedAt: "2026-07-28T20:25:00.000Z",
};

test("governance is ready only when all required processes and fallbacks exist", () => {
  const result = assessGovernance(
    governance,
    "2026-07-28T20:25:00.000Z"
  );
  assert.equal(result.ready, true);
  assert.deepEqual(result.blockers, []);
  assert.equal(result.releaseLinkedDecisions, 1);
  assert.equal(result.documentedFallbacks, 2);
});

test("governance reports stale review and never treats it as ready", () => {
  const result = assessGovernance(
    { ...governance, nextReviewAt: "2026-07-01T00:00:00.000Z" },
    "2026-07-28T20:25:00.000Z"
  );
  assert.equal(result.ready, false);
  assert.match(result.warnings.join(" "), /overdue/i);
});

test("governance rejects an undocumented fallback role", () => {
  const broken = structuredClone(governance);
  broken.roles[0]!.fallbackRoleId = "unknown-role";
  const result = assessGovernance(broken, "2026-07-28T20:25:00.000Z");
  assert.equal(result.ready, false);
  assert.match(result.blockers.join(" "), /unknown role/i);
});

test("governance schemas reject unknown fields", () => {
  assert.throws(() =>
    governancePolicySchema.parse({ ...governance, silentApproval: true })
  );
});

test("a complete supply-chain gate is promotable", () => {
  const result = verifySupplyChain(supplyGate);
  assert.equal(result.promotable, true);
  assert.equal(result.passedCount, 7);
  assert.deepEqual(result.failures, []);
});

test("a provenance mismatch deterministically blocks promotion", () => {
  const broken = structuredClone(supplyGate);
  broken.checks[4]!.state = "failed";
  broken.checks[4]!.evidenceRef = "fixture://mismatched-provenance";
  const result = verifySupplyChain(broken);
  assert.equal(result.promotable, false);
  assert.equal(result.failures[0]?.category, "provenance");
  assert.match(result.action, /repair/i);
});

test("stale and not-run required checks both block promotion", () => {
  const broken = structuredClone(supplyGate);
  broken.checks[0]!.state = "stale";
  broken.checks[1]!.state = "not_run";
  const result = verifySupplyChain(broken);
  assert.equal(result.promotable, false);
  assert.equal(result.stale.length, 1);
  assert.equal(result.pending.length, 1);
});

test("supply-chain fixtures cannot contain unknown or malformed fields", () => {
  assert.throws(() =>
    supplyChainGateSchema.parse({
      ...supplyGate,
      sourceCommit: "not-a-commit",
      credential: "forbidden",
    })
  );
});

test("consent changes are prospective and explain their effect", () => {
  const result = changeConsent(
    preferences,
    "enable_telemetry",
    "2026-07-28T20:30:00.000Z",
    flows
  );
  assert.equal(result.next.optionalTelemetry, true);
  assert.equal(result.prospectiveOnly, true);
  assert.match(result.effects.join(" "), /future anonymous/i);
});

test("provider retention limitations remain visible in consent results", () => {
  const result = changeConsent(
    preferences,
    "deny_training",
    "2026-07-28T20:30:00.000Z",
    flows
  );
  assert.equal(result.next.thirdPartyTrainingEligible, false);
  assert.equal(result.deletionAvailable, false);
  assert.match(result.effects.join(" "), /no longer allowed/i);
});

test("paid usage cannot be enabled through privacy preferences", () => {
  assert.throws(() =>
    privacyPreferencesSchema.parse({ ...preferences, paidUsage: true })
  );
});
