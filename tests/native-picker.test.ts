import assert from "node:assert/strict";
import test from "node:test";

import { NativePicker } from "../apps/core/src/native-picker.js";

test("native picker returns opaque handles and resolves them only for the matching purpose", async () => {
  let now = 1_000;
  const picker = new NativePicker(async (kind) => kind === "folder" ? ["/private/tmp/example-project"] : ["/private/tmp/brief.md"], () => now);
  const folder = await picker.folder();
  const handle = folder.selections[0]?.path ?? "";
  assert.match(handle, /^selection_[a-f0-9]{32}$/);
  assert.equal(JSON.stringify(folder).includes("/private/tmp"), false);
  assert.equal(picker.resolveFolder(handle), "/private/tmp/example-project");
  assert.throws(() => picker.resolveFiles([handle]), /expired or is no longer available/);

  const files = await picker.files();
  assert.deepEqual(picker.resolveFiles(files.selections.map((item) => item.path)), ["/private/tmp/brief.md"]);
  now += 10 * 60_000;
  assert.throws(() => picker.resolveFolder(handle), /expired or is no longer available/);
});

test("native picker cancellation returns no handles", async () => {
  const picker = new NativePicker(async () => []);
  assert.deepEqual(await picker.folder(), { schemaVersion: 1, outcome: "cancelled", selections: [] });
});
