import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const path =
  "apps/studio/src/components/providers/provider-connection-wizard.tsx";

test("provider wizard exposes secure live admission, recovery, and revocation states", async () => {
  const source = await readFile(path, "utf8");
  assert.match(source, /Connect, prove, and route/);
  assert.match(source, /operating-system vault/);
  assert.match(source, /Running admission checks/);
  assert.match(source, /Re-check/);
  assert.match(source, /Revoke key/);
  assert.match(source, /mutateProviderConnection/);
  assert.doesNotMatch(source, /demoFingerprint|recordProviderValidation/);
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
  assert.match(source, /aria-label="Live provider connections"/);
  assert.match(source, /aria-pressed=/);
  assert.match(source, /xl:grid-cols/);
  assert.match(source, /focus-visible:ring/);
});
