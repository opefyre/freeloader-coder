import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const component =
  "apps/studio/src/components/conversation/conversation-workbench.tsx";

test("workbench exposes attachments, citations, safety, templates, and assumptions", async () => {
  const source = await readFile(component, "utf8");
  assert.match(source, /Outcome templates/);
  assert.match(source, /Test safety check/);
  assert.match(source, /Blocked locally · not sent/);
  assert.match(source, /Editable assumption/);
  assert.match(source, /Review request/);
});

test("workbench exposes truthful timeline states and safe controls", async () => {
  const source = await readFile(component, "utf8");
  assert.match(source, /One truthful timeline/);
  assert.match(source, /Technical details/);
  assert.match(source, /Inactive · not progressing/);
  assert.match(source, /Stop requested/);
  assert.match(source, /Safely stopped/);
  assert.match(source, /Steer current work/);
});

test("workbench exposes scoped search, memory deletion, export, and truth disclaimer", async () => {
  const source = await readFile(component, "utf8");
  assert.match(source, /Search project conversations/);
  assert.match(source, /Delete remembered assertion/);
  assert.match(source, /Export selected/);
  assert.match(source, /Conversation history is not canonical project truth/);
});

test("workbench uses approved icons, responsive layout, and keyboard semantics", async () => {
  const source = await readFile(component, "utf8");
  assert.match(source, /@phosphor-icons\/react/);
  assert.doesNotMatch(source, /react-icons|lucide|heroicons/);
  assert.match(source, /xl:grid-cols/);
  assert.match(source, /aria-live="polite"/);
  assert.match(source, /focus-visible:ring/);
});

