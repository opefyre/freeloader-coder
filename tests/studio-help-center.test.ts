import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const sourcePath = "apps/studio/src/components/help/help-center.tsx";

test("Help Center exposes search, journeys, recovery, reporting, and sources", async () => {
  const source = await readFile(sourcePath, "utf8");
  for (const requirement of [
    "Search help",
    "Learning path",
    "Recovery navigator",
    "Safe support preview",
    "nothing is sent",
    "Source guide",
    "Contributor guide",
    "opefyre.atlassian.net/browse",
    "github.com/opefyre/freeloader-coder",
  ]) {
    assert.match(source, new RegExp(requirement, "i"));
  }
});

test("Help Center uses the approved icon system and avoids gradients", async () => {
  const source = await readFile(sourcePath, "utf8");
  assert.match(source, /@phosphor-icons\/react/);
  assert.doesNotMatch(source, /react-icons|lucide|heroicons|bg-gradient|linear-gradient/);
});

test("Help Center includes responsive and keyboard-accessible interaction contracts", async () => {
  const source = await readFile(sourcePath, "utf8");
  assert.match(source, /sm:grid-cols/);
  assert.match(source, /xl:grid-cols/);
  assert.match(source, /aria-pressed/);
  assert.match(source, /aria-label/);
  assert.match(source, /focus-visible:ring/);
});
