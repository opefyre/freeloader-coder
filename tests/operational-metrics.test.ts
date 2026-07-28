import assert from "node:assert/strict";
import test from "node:test";

import { controlCenterMetrics } from "../fixtures/control-center-metrics.js";
import {
  operationalMetricKindSchema,
  operationalMetricSchema,
} from "../packages/schemas/src/index.js";

test("control center fixture covers every required operational metric", () => {
  assert.deepEqual(
    new Set(controlCenterMetrics.map((metric) => metric.kind)),
    new Set(operationalMetricKindSchema.options)
  );
  assert.equal(controlCenterMetrics.every((metric) => metric.schemaVersion === 1), true);
});

test("every displayed metric carries source, scope, freshness, and estimation evidence", () => {
  for (const metric of controlCenterMetrics) {
    assert.equal(metric.provenance.eventTypes.length > 0, true);
    assert.equal(Date.parse(metric.scope.to) > Date.parse(metric.scope.from), true);
    assert.equal(typeof metric.provenance.estimated, "boolean");
  }
});

test("missing metrics remain null and strict schemas reject invented fields", () => {
  const missing = controlCenterMetrics.find((metric) => metric.provenance.freshness === "missing");
  assert.equal(missing?.value, null);
  assert.equal(
    operationalMetricSchema.safeParse({
      ...missing,
      value: 0,
    }).success,
    false
  );
  assert.equal(
    operationalMetricSchema.safeParse({
      ...controlCenterMetrics[0],
      hiddenGuess: 1,
    }).success,
    false
  );
});
