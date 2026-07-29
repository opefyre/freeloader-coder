import { z } from "zod";

const version = z.literal(1);

export const evidenceMappingSchema = z.strictObject({
  schemaVersion: version,
  id: z.string().regex(/^[a-z0-9][a-z0-9._-]+$/),
  ticketKey: z.string().regex(/^PIPE-\d+$/),
  parentKey: z.string().regex(/^PIPE-\d+$/),
  criterionId: z.string().regex(/^AC\d+$/),
  claim: z.string().min(8).max(500),
  method: z.enum(["automated", "manual"]),
  artifact: z.string().regex(/^(tests|docs|scripts|packages|apps)\/[a-zA-Z0-9_./-]+$/),
  owner: z.string().min(2).max(80),
  status: z.enum(["passed", "failed", "not_run", "stale"]),
  negativeFixture: z.string().regex(/^fixture:\/\/[a-z0-9._/-]+$/),
  containsSensitiveData: z.literal(false),
  reproducibleCommand: z.string().min(3).max(240),
});
export type EvidenceMapping = z.infer<typeof evidenceMappingSchema>;

export const evidenceLedgerSchema = z.strictObject({
  schemaVersion: version,
  ledgerId: z.string().regex(/^ledger-[a-z0-9.-]+$/),
  generatedAt: z.string().datetime(),
  mappings: z.array(evidenceMappingSchema).min(1).max(1_000),
  requiredTickets: z.array(z.string().regex(/^PIPE-\d+$/)).min(1).max(200),
  requiredCriteriaPerTicket: z.record(
    z.string().regex(/^PIPE-\d+$/),
    z.array(z.string().regex(/^AC\d+$/)).min(1).max(50)
  ),
});
export type EvidenceLedger = z.infer<typeof evidenceLedgerSchema>;

export interface EvidenceAssessment {
  readonly ready: boolean;
  readonly passedMappings: number;
  readonly totalMappings: number;
  readonly missingTickets: readonly string[];
  readonly missingCriteria: readonly string[];
  readonly failedMappings: readonly EvidenceMapping[];
  readonly unsafeMappings: readonly EvidenceMapping[];
  readonly action: string;
}

export function assessEvidenceLedger(raw: unknown): EvidenceAssessment {
  const ledger = evidenceLedgerSchema.parse(raw);
  const ticketSet = new Set(ledger.mappings.map((mapping) => mapping.ticketKey));
  const missingTickets = ledger.requiredTickets.filter(
    (ticket) => !ticketSet.has(ticket)
  );
  const missingCriteria = Object.entries(ledger.requiredCriteriaPerTicket)
    .flatMap(([ticket, criteria]) =>
      criteria
        .filter(
          (criterion) =>
            !ledger.mappings.some(
              (mapping) =>
                mapping.ticketKey === ticket &&
                mapping.criterionId === criterion
            )
        )
        .map((criterion) => `${ticket}:${criterion}`)
    );
  const failedMappings = ledger.mappings.filter(
    (mapping) => mapping.status !== "passed"
  );
  const unsafeMappings = ledger.mappings.filter(
    (mapping) => mapping.containsSensitiveData
  );
  const ready =
    missingTickets.length === 0 &&
    missingCriteria.length === 0 &&
    failedMappings.length === 0 &&
    unsafeMappings.length === 0;
  return {
    ready,
    passedMappings: ledger.mappings.filter(
      (mapping) => mapping.status === "passed"
    ).length,
    totalMappings: ledger.mappings.length,
    missingTickets,
    missingCriteria,
    failedMappings,
    unsafeMappings,
    action: ready
      ? "Attach the ledger and current test result to each completion record."
      : missingTickets.length > 0
        ? `Add evidence for ${missingTickets[0]}.`
        : missingCriteria.length > 0
          ? `Map ${missingCriteria[0]} to executable or named manual evidence.`
          : failedMappings[0]
            ? `Repair ${failedMappings[0].id} and rerun its reproducible command.`
            : "Remove sensitive content from the evidence mapping.",
  };
}
