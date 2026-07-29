import { z } from "zod";

const version = z.literal(1);
const ticketKey = z.string().regex(/^PIPE-\d+$/);
const artifactRef = z.string().regex(
  /^(tests|docs|scripts|packages|apps)\/[a-zA-Z0-9_./-]+$/
);

export const releaseEvidenceCheckSchema = z.strictObject({
  schemaVersion: version,
  id: z.string().regex(/^[a-z0-9][a-z0-9._-]+$/),
  ticketKey,
  parentKey: ticketKey,
  criterionId: z.string().regex(/^AC\d+$/),
  claim: z.string().min(12).max(500),
  domain: z.enum([
    "onboarding", "vault", "providers", "execution", "packaging", "updates",
  ]),
  method: z.enum(["automated", "manual"]),
  artifact: artifactRef,
  command: z.string().min(3).max(240),
  owner: z.string().min(2).max(80),
  state: z.enum(["passed", "failed", "not_run", "stale", "waived"]),
  negativeFixture: z.string().regex(/^fixture:\/\/[a-z0-9._/-]+$/),
  verifiedAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
  containsSensitiveData: z.literal(false),
});
export type ReleaseEvidenceCheck = z.infer<typeof releaseEvidenceCheckSchema>;

export const releaseEvidenceRegistrySchema = z.strictObject({
  schemaVersion: version,
  registryId: z.string().regex(/^registry-[a-z0-9.-]+$/),
  candidateId: z.string().regex(/^candidate-[a-z0-9.-]+$/),
  generatedAt: z.string().datetime(),
  requiredCriteria: z.record(
    ticketKey,
    z.array(z.string().regex(/^AC\d+$/)).min(1).max(50)
  ),
  checks: z.array(releaseEvidenceCheckSchema).min(1).max(1_000),
});
export type ReleaseEvidenceRegistry = z.infer<typeof releaseEvidenceRegistrySchema>;

export interface ReleaseEvidenceDecision {
  readonly ready: boolean;
  readonly passed: number;
  readonly required: number;
  readonly ticketCount: number;
  readonly domainCount: number;
  readonly missing: readonly string[];
  readonly blocked: readonly ReleaseEvidenceCheck[];
  readonly action: string;
}

export function evaluateReleaseEvidence(
  raw: unknown,
  now: string
): ReleaseEvidenceDecision {
  const registry = releaseEvidenceRegistrySchema.parse(raw);
  const identities = new Set<string>();
  for (const check of registry.checks) {
    if (identities.has(check.id)) {
      throw new Error(`Duplicate release evidence identity: ${check.id}.`);
    }
    identities.add(check.id);
  }
  const required = Object.values(registry.requiredCriteria).reduce(
    (total, criteria) => total + criteria.length,
    0
  );
  const missing = Object.entries(registry.requiredCriteria).flatMap(
    ([ticket, criteria]) =>
      criteria
        .filter(
          (criterion) =>
            !registry.checks.some(
              (check) =>
                check.ticketKey === ticket && check.criterionId === criterion
            )
        )
        .map((criterion) => `${ticket}:${criterion}`)
  );
  const blocked = registry.checks.filter(
    (check) =>
      check.state !== "passed" ||
      check.expiresAt <= now ||
      check.verifiedAt > now
  );
  const ready = missing.length === 0 && blocked.length === 0;
  const firstBlocked = blocked[0];
  return {
    ready,
    passed: registry.checks.filter(
      (check) =>
        check.state === "passed" &&
        check.verifiedAt <= now &&
        check.expiresAt > now
    ).length,
    required,
    ticketCount: Object.keys(registry.requiredCriteria).length,
    domainCount: new Set(registry.checks.map((check) => check.domain)).size,
    missing,
    blocked,
    action: ready
      ? "Attach the current registry digest and verification result."
      : missing[0]
        ? `Map ${missing[0]} to reproducible evidence.`
        : firstBlocked?.state === "waived"
          ? `Replace the waiver on ${firstBlocked.id} with passing evidence.`
          : firstBlocked && firstBlocked.expiresAt <= now
            ? `Refresh stale evidence ${firstBlocked.id}.`
            : `Repair ${firstBlocked?.id ?? "the blocked check"} and rerun its command.`,
  };
}
