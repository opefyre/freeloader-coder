import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const sourcePath =
  "apps/studio/src/components/governance/trust-center.tsx";

test("Trust Center covers governance, supply chain, privacy, and responsible AI", async () => {
  const source = await readFile(sourcePath, "utf8");
  for (const requirement of [
    "Decision trail",
    "Continuity map",
    "Release firewall",
    "Data journey",
    "Training-eligible free AI",
    "Paid usage",
    "Locked off",
    "No legal claim",
  ]) {
    assert.match(source, new RegExp(requirement, "i"));
  }
});

test("Trust Center exposes interactive failure and consent controls with sources", async () => {
  const source = await readFile(sourcePath, "utf8");
  for (const key of ["PIPE-106", "PIPE-107", "PIPE-108", "PIPE-172"]) {
    assert.match(source, new RegExp(key));
  }
  assert.match(source, /Simulate provenance mismatch/);
  assert.match(source, /Restore verified fixture/);
  assert.match(source, /role="switch"/);
  assert.match(source, /role="tablist"/);
  assert.match(source, /github\.com\/opefyre\/freeloader-coder/);
});

test("Trust Center uses the approved responsive visual system without gradients", async () => {
  const source = await readFile(sourcePath, "utf8");
  assert.match(source, /@phosphor-icons\/react/);
  assert.match(source, /sm:grid-cols/);
  assert.match(source, /xl:grid-cols/);
  assert.match(source, /focus-visible:ring/);
  assert.doesNotMatch(
    source,
    /react-icons|lucide|heroicons|bg-gradient|linear-gradient/
  );
});
