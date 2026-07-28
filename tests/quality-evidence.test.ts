import assert from "node:assert/strict";
import test from "node:test";

import { buildEvidenceBundle, type EvidenceItem } from "../packages/validation/src/evidence-bundle.js";

const base: readonly EvidenceItem[] = [
  { id: "diff", kind: "diff", label: "Changed files", state: "passed", artifactRef: "artifacts/task.diff", sourceDigest: "a".repeat(64), required: true },
  { id: "checks", kind: "validation", label: "Validation report", state: "passed", artifactRef: "artifacts/report.json", sourceDigest: "b".repeat(64), required: true },
];

test("changed code always requires diff and validation artifacts", () => {
  assert.throws(() => buildEvidenceBundle({ taskId: "task", changedPaths: ["x.ts"], items: base.slice(0, 1) }));
  assert.equal(buildEvidenceBundle({ taskId: "task", changedPaths: ["x.ts"], items: base }).ready, true);
});

test("visual failure blocks UI work but is a warning for non-UI work", () => {
  const visual: EvidenceItem = { id: "visual", kind: "visual", label: "Browser capture", state: "unavailable", artifactRef: null, sourceDigest: "c".repeat(64), required: false };
  assert.equal(buildEvidenceBundle({ taskId: "ui", changedPaths: ["App.tsx"], items: [...base, visual] }).ready, false);
  assert.equal(buildEvidenceBundle({ taskId: "api", changedPaths: ["api.ts"], items: [...base, visual] }).ready, true);
});

test("evidence bundle is stable and preserves warnings, skips, and waivers", () => {
  const items: EvidenceItem[] = [...base,
    { id: "warning", kind: "log", label: "Warnings", state: "warning", artifactRef: "logs/warn", sourceDigest: "d".repeat(64), required: false },
    { id: "skip", kind: "visual", label: "Not a UI task", state: "skipped", artifactRef: null, sourceDigest: "e".repeat(64), required: false },
    { id: "waiver", kind: "limitation", label: "Approved limitation", state: "waived", artifactRef: "waivers/1", sourceDigest: "f".repeat(64), required: false },
  ];
  const bundle = buildEvidenceBundle({ taskId: "api", changedPaths: ["api.ts"], items });
  assert.deepEqual(bundle.items.map((item) => item.state).sort(), ["passed", "passed", "skipped", "waived", "warning"]);
});
