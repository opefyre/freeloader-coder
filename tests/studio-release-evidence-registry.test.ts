import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const sourcePath = "apps/studio/src/components/quality/release-evidence-registry.tsx";

test("release evidence registry exposes all Sprint 19 capabilities", async () => {
  const source = await readFile(sourcePath, "utf8");
  for (const key of [
    "PIPE-125", "PIPE-126", "PIPE-128", "PIPE-130", "PIPE-132",
    "PIPE-140", "PIPE-141", "PIPE-142", "PIPE-170", "PIPE-171",
  ]) assert.match(source, new RegExp(key));
  for (const label of [
    "Repository scan", "First outcome", "Approval policy", "Provider adapter",
    "Provider routing", "Tool execution", "Execution isolation", "Safe apply",
    "Release package", "Safe update",
  ]) assert.match(source, new RegExp(label));
});

test("registry exposes failure, recovery, sources, and accessible state", async () => {
  const source = await readFile(sourcePath, "utf8");
  assert.match(source, /Break routing proof/);
  assert.match(source, /Restore passing registry/);
  assert.match(source, /aria-live/);
  assert.match(source, /Open work item/);
  assert.match(source, /Open evidence record/);
  assert.match(source, /focus-visible:ring/);
  assert.doesNotMatch(source, /react-icons|lucide|heroicons|bg-gradient|linear-gradient/);
});
