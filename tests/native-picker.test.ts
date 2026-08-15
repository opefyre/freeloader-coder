import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { NativePicker } from "../apps/core/src/native-picker.js";

test("native picker returns canonical opaque handles and resolves them only for the matching purpose", async () => {
  const root = join(tmpdir(), `codkesh-picker-${process.pid}-${Date.now()}`);
  const folder = join(root, "example-project");
  const file = join(root, "brief.md");
  await mkdir(folder, { recursive: true });
  await writeFile(file, "brief", "utf8");
  let now = 1_000;
  try {
    const picker = new NativePicker(async (kind) => kind === "folder" ? [folder] : [file], () => now);
    const folderResponse = await picker.folder();
    const handle = folderResponse.selections[0]?.path ?? "";
    assert.match(handle, /^selection_[a-f0-9]{32}$/);
    assert.equal(JSON.stringify(folderResponse).includes(root), false);
    assert.equal(picker.resolveFolder(handle), await realpath(folder));
    assert.throws(() => picker.resolveFiles([handle]), /expired or is no longer available/);

    const files = await picker.files();
    assert.deepEqual(picker.resolveFiles(files.selections.map((item) => item.path)), [await realpath(file)]);
    now += 10 * 60_000;
    assert.throws(() => picker.resolveFolder(handle), /expired or is no longer available/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("native picker rejects symbolic links and selections of the wrong kind before issuing handles", async () => {
  const root = join(tmpdir(), `codkesh-picker-guard-${process.pid}-${Date.now()}`);
  const folder = join(root, "project");
  const file = join(root, "brief.md");
  const link = join(root, "brief-link.md");
  await mkdir(folder, { recursive: true });
  await writeFile(file, "brief", "utf8");
  await symlink(file, link);
  try {
    await assert.rejects(() => new NativePicker(async () => [link]).files(), /symbolic link/);
    await assert.rejects(() => new NativePicker(async () => [file]).folder(), /not a folder/);
    await assert.rejects(() => new NativePicker(async () => [folder]).files(), /not a regular file/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("native picker cancellation returns no handles", async () => {
  const evidence: any[] = [];
  const picker = new NativePicker(async () => [], Date.now, async (item) => { evidence.push(item); });
  assert.deepEqual(await picker.folder(), { schemaVersion: 1, outcome: "cancelled", selections: [] });
  assert.equal(evidence[0]?.outcome, "cancelled");
  assert.equal(evidence[0]?.selectionCount, 0);
});
