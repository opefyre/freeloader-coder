import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const path =
  "apps/studio/src/components/providers/provider-connection-wizard.tsx";

test("provider wizard exposes secure connection, trust, repair, and revocation states", async () => {
  const source = await readFile(path, "utf8");
  assert.match(source, /Connect a provider without editing files/);
  assert.match(source, /Operating-system vault/);
  assert.match(source, /Preview a repair path/);
  assert.match(source, /Revoke local access/);
});

test("provider wizard uses approved components and icon family", async () => {
  const source = await readFile(path, "utf8");
  assert.match(source, /@phosphor-icons\/react/);
  assert.doesNotMatch(source, /react-icons|lucide|heroicons/);
  assert.match(source, /<Card/);
  assert.match(source, /<Button/);
  assert.match(source, /<Badge/);
});

test("provider wizard has keyboard semantics and responsive layout", async () => {
  const source = await readFile(path, "utf8");
  assert.match(source, /aria-label="Guided provider connection"/);
  assert.match(source, /aria-pressed=/);
  assert.match(source, /xl:grid-cols/);
  assert.match(source, /focus-visible:ring/);
});

