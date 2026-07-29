import { z } from "zod";

const version = z.literal(1);
const path = z
  .string()
  .regex(/^(?:(?:\.github|docs)\/[a-zA-Z0-9._/-]+|CODE_OF_CONDUCT\.md)$/);

export const openSourceAdoptionPolicySchema = z.strictObject({
  schemaVersion: version,
  license: z.strictObject({
    spdxId: z.enum(["Apache-2.0", "MIT"]),
    state: z.enum(["proposed", "approved"]),
    licensePath: z.literal("LICENSE"),
    decisionPath: path,
    patentGrantExplicit: z.boolean(),
  }),
  contribution: z.strictObject({
    terms: z.enum(["dco", "cla"]),
    contributorGuidePath: path,
    codeOfConductPath: path,
    securityPolicyPath: path,
    issueTemplatesPath: z.literal(".github/ISSUE_TEMPLATE"),
  }),
  dependencyPolicy: z.strictObject({
    lockfileRequired: z.literal(true),
    exactVersionsRequired: z.literal(true),
    scriptsTreatedAsEffects: z.literal(true),
    allowedLicenses: z.array(z.string().min(2).max(80)).min(1).max(100),
    deniedLicenses: z.array(z.string().min(2).max(80)).min(1).max(100),
    policyPath: path,
  }),
  trademark: z.strictObject({
    productName: z.string().min(2).max(80),
    nominativeUseAllowed: z.literal(true),
    endorsementRequiresPermission: z.literal(true),
    modifiedDistributionMustAvoidConfusion: z.literal(true),
    policyPath: path,
  }),
  reviewedAt: z.string().datetime(),
  nextReviewAt: z.string().datetime(),
});
export type OpenSourceAdoptionPolicy = z.infer<
  typeof openSourceAdoptionPolicySchema
>;

export interface AdoptionPolicyAssessment {
  readonly adoptable: boolean;
  readonly blockers: readonly string[];
  readonly warnings: readonly string[];
  readonly userRights: readonly string[];
  readonly contributorPath: readonly string[];
}

export function assessOpenSourceAdoption(
  raw: unknown,
  now: string
): AdoptionPolicyAssessment {
  const policy = openSourceAdoptionPolicySchema.parse(raw);
  const blockers = [
    ...(policy.license.state !== "approved"
      ? ["The repository license decision is not approved."]
      : []),
    ...(policy.nextReviewAt <= now
      ? ["The open-source policy review is overdue."]
      : []),
  ];
  const warnings = [
    ...(!policy.license.patentGrantExplicit
      ? ["The selected license has no explicit patent grant."]
      : []),
  ];
  return {
    adoptable: blockers.length === 0,
    blockers,
    warnings,
    userRights: [
      `Use, modify, and distribute under ${policy.license.spdxId}.`,
      "Inspect dependency and release evidence before adoption.",
      "Report vulnerabilities privately without publishing secrets.",
    ],
    contributorPath: [
      `Follow ${policy.contribution.contributorGuidePath}.`,
      `Accept the ${policy.contribution.terms.toUpperCase()} contribution terms.`,
      `Follow ${policy.contribution.codeOfConductPath}.`,
    ],
  };
}
