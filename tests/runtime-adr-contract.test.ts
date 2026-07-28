import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("runtime ADR records prototype evidence, support matrix, and replacement triggers", async () => {
  const source = await readFile(
    "docs/architecture/ADR-002-clone-runtime-lifecycle.md",
    "utf8"
  );
  assert.match(source, /## Prototype evidence/);
  assert.match(source, /## Replacement triggers/);
  assert.match(source, /macOS 14\+/);
  assert.match(source, /Windows 11 \+ WSL2/);
  assert.match(source, /Docker and Podman are optional/);
});

test("README exposes the complete clone, setup, start, and repair journey", async () => {
  const source = await readFile("README.md", "utf8");
  assert.match(source, /git clone https:\/\/github.com\/opefyre\/freeloader-coder\.git/);
  assert.match(source, /npm run setup/);
  assert.match(source, /npm start/);
  assert.match(source, /npm run repair/);
  assert.match(
    source,
    /Docker, a local model runtime, cloud accounts, and provider keys are optional/
  );
});
