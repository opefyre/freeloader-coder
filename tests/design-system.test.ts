import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  assertPrimitiveContract,
  componentGallery,
  densityModes,
  operationalStates,
  primitiveKinds,
  supportedBreakpoints,
  validateComponentGallery,
  visualSystem
} from "../packages/ui/src/index.js";

test("design system locks the reference-compatible shadcn visual language", () => {
  assert.equal(visualSystem.typography.family, "Space Grotesk");
  assert.equal(visualSystem.iconography.library, "phosphor");
  assert.equal(visualSystem.surfaces.decorativeBorders, false);
  assert.equal(visualSystem.surfaces.treatment, "shadcn-layered");
});

test("component gallery covers every state, breakpoint, density, and primitive", () => {
  validateComponentGallery();
  assert.equal(
    componentGallery.length,
    operationalStates.length * supportedBreakpoints.length * densityModes.length
  );
  for (const scenario of componentGallery) {
    assert.deepEqual(
      new Set(scenario.primitives.map((primitive) => primitive.kind)),
      new Set(primitiveKinds)
    );
  }
});

test("meaningful icons require names and blocking states preserve user trust", () => {
  assert.throws(
    () =>
      assertPrimitiveContract({
        id: "bad-icon",
        kind: "status",
        state: "working",
        tone: "active",
        title: "Working",
        summary: "Work is active.",
        icon: { decorative: false, accessibleName: "" },
        actions: []
      }),
    /accessible name/
  );

  assert.throws(
    () =>
      assertPrimitiveContract({
        id: "bad-error",
        kind: "recovery",
        state: "failed",
        tone: "critical",
        title: "Stopped",
        summary: "The run stopped.",
        icon: { decorative: false, accessibleName: "Run stopped" },
        actions: []
      }),
    /preserved work/
  );
});

test("CSS exposes reduced-motion and forced-color fallbacks", async () => {
  const css = await readFile("apps/studio/src/globals.css", "utf8");
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
  assert.match(css, /forced-colors:\s*active/);
  assert.match(css, /"Space Grotesk Variable"/);
  assert.match(css, /@import "shadcn\/tailwind\.css"/);
});
