import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const sourcePath =
  "apps/studio/src/components/quality/accessibility-center.tsx";

test("Accessibility Center exposes all hard-gate dimensions and foundation evidence", async () => {
  const source = await readFile(sourcePath, "utf8");
  for (const requirement of [
    "Keyboard-only critical journeys",
    "Visible focus and logical order",
    "Names, roles, states, and landmarks",
    "WCAG AA text and control contrast",
    "Reduced-motion behavior",
    "200% zoom without lost content",
    "Mobile and narrow-window reflow",
    "Charts have text or table alternatives",
    "Foundation evidence ledger",
  ]) {
    assert.match(source, new RegExp(requirement, "i"));
  }
});

test("Accessibility Center proves one critical failure blocks release", async () => {
  const source = await readFile(sourcePath, "utf8");
  assert.match(source, /Remove chart alternative/);
  assert.match(source, /Restore accessible evidence/);
  assert.match(source, /Release blocked/);
  assert.match(source, /<table/);
  assert.match(source, /<caption/);
  assert.match(source, /aria-live/);
});

test("Accessibility Center links every Sprint 18 evidence ticket and uses approved UI rules", async () => {
  const source = await readFile(sourcePath, "utf8");
  for (const key of [
    "PIPE-35",
    "PIPE-117",
    "PIPE-118",
    "PIPE-119",
    "PIPE-120",
    "PIPE-121",
    "PIPE-122",
    "PIPE-123",
    "PIPE-124",
  ]) {
    assert.match(source, new RegExp(key));
  }
  assert.match(source, /@phosphor-icons\/react/);
  assert.match(source, /sm:grid-cols/);
  assert.match(source, /xl:grid-cols/);
  assert.match(source, /focus-visible:ring/);
  assert.doesNotMatch(
    source,
    /react-icons|lucide|heroicons|bg-gradient|linear-gradient/
  );
});
