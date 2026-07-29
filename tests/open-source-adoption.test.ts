import assert from "node:assert/strict";
import test from "node:test";

import {
  assessOpenSourceAdoption,
  openSourceAdoptionPolicySchema,
} from "../packages/governance/src/open-source.js";

const approvedPolicy = {
  schemaVersion: 1,
  license: {
    spdxId: "Apache-2.0",
    state: "approved",
    licensePath: "LICENSE",
    decisionPath: "docs/governance/open-source-adoption.md",
    patentGrantExplicit: true,
  },
  contribution: {
    terms: "dco",
    contributorGuidePath: "docs/contributing/README.md",
    codeOfConductPath: "CODE_OF_CONDUCT.md",
    securityPolicyPath: "docs/support/reporting.md",
    issueTemplatesPath: ".github/ISSUE_TEMPLATE",
  },
  dependencyPolicy: {
    lockfileRequired: true,
    exactVersionsRequired: true,
    scriptsTreatedAsEffects: true,
    allowedLicenses: ["Apache-2.0", "MIT", "BSD-3-Clause", "ISC"],
    deniedLicenses: ["AGPL-3.0", "SSPL-1.0", "BUSL-1.1", "UNKNOWN"],
    policyPath: "docs/governance/open-source-adoption.md",
  },
  trademark: {
    productName: "Pipeline Studio",
    nominativeUseAllowed: true,
    endorsementRequiresPermission: true,
    modifiedDistributionMustAvoidConfusion: true,
    policyPath: "docs/governance/open-source-adoption.md",
  },
  reviewedAt: "2026-07-29T09:00:00.000Z",
  nextReviewAt: "2026-10-29T09:00:00.000Z",
} as const;

test("approved Apache policy exposes adoption and contribution rights", () => {
  const assessment = assessOpenSourceAdoption(
    approvedPolicy,
    "2026-07-29T10:00:00.000Z"
  );
  assert.equal(assessment.adoptable, true);
  assert.match(assessment.userRights[0] ?? "", /Apache-2.0/);
  assert.match(assessment.contributorPath[1] ?? "", /DCO/);
});

test("unapproved or overdue policy fails adoption closed", () => {
  const proposed = assessOpenSourceAdoption(
    {
      ...approvedPolicy,
      license: { ...approvedPolicy.license, state: "proposed" },
    },
    "2026-11-01T00:00:00.000Z"
  );
  assert.equal(proposed.adoptable, false);
  assert.deepEqual(proposed.blockers, [
    "The repository license decision is not approved.",
    "The open-source policy review is overdue.",
  ]);
});

test("open-source policy rejects weakened dependency and trademark controls", () => {
  assert.throws(() =>
    openSourceAdoptionPolicySchema.parse({
      ...approvedPolicy,
      dependencyPolicy: {
        ...approvedPolicy.dependencyPolicy,
        lockfileRequired: false,
      },
    })
  );
  assert.throws(() =>
    openSourceAdoptionPolicySchema.parse({
      ...approvedPolicy,
      trademark: {
        ...approvedPolicy.trademark,
        endorsementRequiresPermission: false,
      },
    })
  );
});

