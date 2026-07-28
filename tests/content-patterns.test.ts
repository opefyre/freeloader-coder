import assert from "node:assert/strict";
import test from "node:test";

import {
  approvalContentSchema,
  errorContentSchema,
  planContentSchema,
  standardContentPatternSchema
} from "../packages/schemas/src/index.js";
import {
  approvalFacts,
  contentPatternExamples,
  inspectStandardCopy,
  primaryAction,
  standardVisibleCopy
} from "../packages/ui/src/index.js";

test("approval content always explains change, location, cost, and undo", () => {
  const approval = approvalContentSchema.parse(contentPatternExamples.approval);
  const facts = new Map(approvalFacts(approval).map((fact) => [fact.label, fact.value]));
  assert.ok(facts.get("What changes")?.includes("activity timeline"));
  assert.ok(facts.get("Where")?.includes("Pipeline Studio repository"));
  assert.match(facts.get("Cost") ?? "", /No paid provider/);
  assert.match(facts.get("How to undo") ?? "", /restore the saved checkpoint/);
  assert.equal(primaryAction(approval), "Approve local changes");
});

test("paid approvals are invalid without an explicit maximum charge", () => {
  assert.throws(
    () =>
      approvalContentSchema.parse({
        ...contentPatternExamples.approval,
        cost: {
          mode: "paid",
          explanation: "This route can charge the connected provider.",
          maximum: null
        }
      }),
    /maximum charge/
  );
});

test("errors preserve work, recommend one action, and hide diagnostics from Standard copy", () => {
  const error = errorContentSchema.parse(contentPatternExamples.error);
  const visible = standardVisibleCopy(error);
  assert.match(visible, /local changes.*preserved/i);
  assert.match(visible, /Retry with the next free provider/);
  assert.doesNotMatch(visible, /PROVIDER_CAPACITY|Capacity response/);
  assert.equal(primaryAction(error), "Retry with the next free provider");
  assert.deepEqual(inspectStandardCopy(error), []);
});

test("Standard content rejects blame, false certainty, and uncontextualized diagnostics", () => {
  const blamed = {
    ...contentPatternExamples.error,
    whatHappened: "You configured the provider incorrectly.",
    preservedWork: "Your work is definitely safe.",
    recommendedAction: "Open ERR_PROVIDER_TIMEOUT at Worker.run(/Users/name/app.ts:7:2)."
  };
  const findings = inspectStandardCopy(errorContentSchema.parse(blamed));
  assert.deepEqual(
    new Set(findings.map((finding) => finding.rule)),
    new Set(["blame", "false_certainty", "diagnostic_leak"])
  );
});

test("plan and before-after patterns expose one obvious next action", () => {
  const plan = planContentSchema.parse(contentPatternExamples.plan);
  const change = standardContentPatternSchema.parse(contentPatternExamples.change);
  assert.equal(primaryAction(plan), "Review plan");
  assert.equal(primaryAction(change), "Review evidence");
  assert.match(standardVisibleCopy(change), /static anchors/);
  assert.match(standardVisibleCopy(change), /dedicated, URL-persisted surface/);
});

test("strict content schemas reject invented fields and empty action language", () => {
  assert.throws(
    () =>
      standardContentPatternSchema.parse({
        ...contentPatternExamples.approval,
        hiddenCharge: true
      }),
    /Unrecognized key/
  );
  assert.throws(
    () =>
      errorContentSchema.parse({
        ...contentPatternExamples.error,
        recommendedAction: ""
      }),
    /too small|expected string/i
  );
});
