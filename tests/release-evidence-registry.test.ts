import assert from "node:assert/strict";
import test from "node:test";

import {
  evaluateReleaseEvidence,
  releaseEvidenceRegistrySchema,
  type ReleaseEvidenceRegistry,
} from "../packages/evals/src/index.js";

const tickets = [
  "PIPE-125", "PIPE-126", "PIPE-128", "PIPE-130", "PIPE-132",
  "PIPE-140", "PIPE-141", "PIPE-142", "PIPE-170", "PIPE-171",
] as const;
const registry: ReleaseEvidenceRegistry = {
  schemaVersion: 1,
  registryId: "registry-s19-executable-proof",
  candidateId: "candidate-0.8.0-beta.4",
  generatedAt: "2026-07-29T09:00:00.000Z",
  requiredCriteria: Object.fromEntries(tickets.map((ticket) => [ticket, ["AC1", "AC2", "AC3"]])),
  checks: tickets.flatMap((ticket) =>
    ["AC1", "AC2", "AC3"].map((criterionId) => ({
      schemaVersion: 1 as const,
      id: `${ticket.toLowerCase()}-${criterionId.toLowerCase()}`,
      ticketKey: ticket,
      parentKey: "PIPE-42",
      criterionId,
      claim: `${ticket} ${criterionId} has reproducible current release evidence.`,
      domain: "onboarding" as const,
      method: "automated" as const,
      artifact: "tests/release-evidence-registry.test.ts",
      command: "npm run verify",
      owner: "Quality engineering",
      state: "passed" as const,
      negativeFixture: `fixture://${ticket.toLowerCase()}/${criterionId.toLowerCase()}-broken`,
      verifiedAt: "2026-07-29T09:00:00.000Z",
      expiresAt: "2026-08-12T09:00:00.000Z",
      containsSensitiveData: false as const,
    }))
  ),
};

test("the complete Sprint 19 registry is release ready", () => {
  const result = evaluateReleaseEvidence(registry, "2026-07-29T09:00:00.000Z");
  assert.equal(result.ready, true);
  assert.equal(result.passed, 30);
  assert.equal(result.required, 30);
  assert.equal(result.ticketCount, 10);
});

test("missing, failed, stale, future, and waived proof fail closed", () => {
  const scenarios: ReleaseEvidenceRegistry[] = [
    { ...registry, checks: registry.checks.slice(1) },
    changeFirst({ state: "failed" }),
    changeFirst({ expiresAt: "2026-07-29T08:59:59.000Z" }),
    changeFirst({ verifiedAt: "2026-07-29T09:00:01.000Z" }),
    changeFirst({ state: "waived" }),
  ];
  for (const scenario of scenarios) {
    assert.equal(evaluateReleaseEvidence(scenario, "2026-07-29T09:00:00.000Z").ready, false);
  }
});

test("duplicate identities and unsafe or unknown data are rejected", () => {
  assert.throws(() =>
    evaluateReleaseEvidence(
      { ...registry, checks: [registry.checks[0]!, registry.checks[0]!] },
      "2026-07-29T09:00:00.000Z"
    )
  );
  const unsafe = structuredClone(registry) as unknown as Record<string, unknown>;
  const checks = unsafe.checks as Array<Record<string, unknown>>;
  checks[0]!.containsSensitiveData = true;
  unsafe.silentWaiver = true;
  assert.throws(() => releaseEvidenceRegistrySchema.parse(unsafe));
});

function changeFirst(
  patch: Partial<ReleaseEvidenceRegistry["checks"][number]>
): ReleaseEvidenceRegistry {
  return {
    ...registry,
    checks: registry.checks.map((check, index) =>
      index === 0 ? { ...check, ...patch } : check
    ),
  };
}
