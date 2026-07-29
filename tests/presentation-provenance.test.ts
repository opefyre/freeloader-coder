import assert from "node:assert/strict";
import test from "node:test";

import {
  assessPresentationProvenance,
  type PresentationProvenance,
} from "../packages/ui/src/provenance.js";

const now = new Date("2026-07-29T10:00:00.000Z");

function provenance(
  overrides: Partial<PresentationProvenance> = {}
): PresentationProvenance {
  return {
    mode: "synthetic_fixture",
    generatedAt: "2026-07-29T09:00:00.000Z",
    sourceClasses: ["synthetic task"],
    externallyVerifiedAt: null,
    ...overrides,
  };
}

test("synthetic fixtures can never claim live status", () => {
  assert.deepEqual(assessPresentationProvenance(provenance(), now), {
    label: "Demo workspace",
    canClaimLive: false,
    freshness: "not_applicable",
  });
});

test("external verification must be present and current", () => {
  assert.equal(
    assessPresentationProvenance(
      provenance({
        mode: "external_verification",
        externallyVerifiedAt: "2026-07-29T09:50:00.000Z",
      }),
      now
    ).canClaimLive,
    true
  );
  assert.deepEqual(
    assessPresentationProvenance(
      provenance({
        mode: "external_verification",
        externallyVerifiedAt: "2026-07-29T09:30:00.000Z",
      }),
      now
    ),
    {
      label: "Demo workspace",
      canClaimLive: false,
      freshness: "stale",
    }
  );
});

test("missing sources fail closed even for an external mode", () => {
  assert.deepEqual(
    assessPresentationProvenance(
      provenance({
        mode: "external_verification",
        sourceClasses: [],
        externallyVerifiedAt: "2026-07-29T09:59:00.000Z",
      }),
      now
    ),
    {
      label: "Demo workspace",
      canClaimLive: false,
      freshness: "stale",
    }
  );
});
