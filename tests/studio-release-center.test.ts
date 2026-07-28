import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const sourcePath = "apps/studio/src/components/releases/release-center.tsx";

test("Release Center covers artifacts, updates, compatibility, rollout, incidents, and notes", async () => {
  const source = await readFile(sourcePath, "utf8");
  for (const requirement of [
    "Release chain of custody",
    "Rollout control",
    "Guided update",
    "Preservation ledger",
    "Compatibility truth",
    "Incident rehearsal",
    "Release notes",
    "no tag, release, update, rollout, issue, or deployment is created",
  ]) {
    assert.match(source, new RegExp(requirement, "i"));
  }
});

test("Release Center exposes sources and interactive recovery controls", async () => {
  const source = await readFile(sourcePath, "utf8");
  for (const key of ["PIPE-97", "PIPE-98", "PIPE-99", "PIPE-101"]) {
    assert.match(source, new RegExp(key));
  }
  assert.match(source, /github\.com\/opefyre\/freeloader-coder/);
  assert.match(source, /Simulate interruption/);
  assert.match(source, /Restore \{update\.rollbackVersion\}/);
  assert.match(source, /aria-pressed/);
  assert.match(source, /Search compatibility/);
});

test("Release Center uses the approved visual system without gradients", async () => {
  const source = await readFile(sourcePath, "utf8");
  assert.match(source, /@phosphor-icons\/react/);
  assert.match(source, /sm:grid-cols/);
  assert.match(source, /xl:grid-cols/);
  assert.match(source, /focus-visible:ring/);
  assert.doesNotMatch(source, /react-icons|lucide|heroicons|bg-gradient|linear-gradient/);
});
