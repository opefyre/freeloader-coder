import assert from "node:assert/strict";
import test from "node:test";

import {
  assessEvidenceLedger,
  evidenceLedgerSchema,
  type EvidenceLedger,
} from "../packages/evals/src/index.js";

const tickets = [
  "PIPE-117",
  "PIPE-118",
  "PIPE-119",
  "PIPE-120",
  "PIPE-121",
  "PIPE-122",
  "PIPE-123",
  "PIPE-124",
] as const;

const ledger: EvidenceLedger = {
  schemaVersion: 1,
  ledgerId: "ledger-foundation-s18",
  generatedAt: "2026-07-29T08:00:00.000Z",
  mappings: tickets.flatMap((ticket) =>
    ["AC1", "AC2", "AC3"].map((criterionId) => ({
      schemaVersion: 1 as const,
      id: `${ticket.toLowerCase()}-${criterionId.toLowerCase()}`,
      ticketKey: ticket,
      parentKey: "PIPE-29",
      criterionId,
      claim: `${ticket} ${criterionId} maps to reproducible evidence.`,
      method: "automated" as const,
      artifact: "tests/foundation-evidence.test.ts",
      owner: "Quality engineering",
      status: "passed" as const,
      negativeFixture: `fixture://${ticket.toLowerCase()}/${criterionId.toLowerCase()}-broken`,
      containsSensitiveData: false as const,
      reproducibleCommand: "npm run verify",
    }))
  ),
  requiredTickets: [...tickets],
  requiredCriteriaPerTicket: Object.fromEntries(
    tickets.map((ticket) => [ticket, ["AC1", "AC2", "AC3"]])
  ),
};

test("the complete foundation evidence ledger is ready", () => {
  const result = assessEvidenceLedger(ledger);
  assert.equal(result.ready, true);
  assert.equal(result.passedMappings, 24);
  assert.deepEqual(result.missingTickets, []);
  assert.deepEqual(result.missingCriteria, []);
});

test("a missing ticket remains visible and blocks evidence readiness", () => {
  const broken = {
    ...ledger,
    mappings: ledger.mappings.filter(
      (mapping) => mapping.ticketKey !== "PIPE-124"
    ),
  };
  const result = assessEvidenceLedger(broken);
  assert.equal(result.ready, false);
  assert.deepEqual(result.missingTickets, ["PIPE-124"]);
  assert.match(result.action, /PIPE-124/);
});

test("an unmapped acceptance criterion blocks evidence readiness", () => {
  const broken = {
    ...ledger,
    mappings: ledger.mappings.filter(
      (mapping) =>
        !(
          mapping.ticketKey === "PIPE-120" &&
          mapping.criterionId === "AC3"
        )
    ),
  };
  const result = assessEvidenceLedger(broken);
  assert.equal(result.ready, false);
  assert.deepEqual(result.missingCriteria, ["PIPE-120:AC3"]);
});

test("a failed negative fixture cannot be reported as ready", () => {
  const broken = structuredClone(ledger);
  broken.mappings[0]!.status = "failed";
  const result = assessEvidenceLedger(broken);
  assert.equal(result.ready, false);
  assert.equal(result.failedMappings.length, 1);
  assert.match(result.action, /repair/i);
});

test("evidence schemas reject sensitive fixtures and unknown fields", () => {
  const broken = structuredClone(ledger) as unknown as Record<string, unknown>;
  const mappings = broken.mappings as Array<Record<string, unknown>>;
  mappings[0]!.containsSensitiveData = true;
  broken.silentWaiver = true;
  assert.throws(() => evidenceLedgerSchema.parse(broken));
});
