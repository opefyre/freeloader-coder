import assert from "node:assert/strict";
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { NativePickerEvidenceStore } from "../apps/core/src/native-picker-evidence-store.js";

test("native picker evidence is bounded, private, restart-safe, and contains no paths", async () => {
  const root = await mkdtemp(join(tmpdir(), "codkesh-picker-evidence-"));
  const store = new NativePickerEvidenceStore(root);
  for (let index = 0; index < 105; index += 1) await store.record({ schemaVersion: 1, kind: index % 2 ? "files" : "folder", outcome: "selected", selectionCount: 1, platform: "darwin", observedAt: index });
  const restarted = new NativePickerEvidenceStore(root);
  const evidence = await restarted.list();
  assert.equal(evidence.length, 100);
  assert.equal(evidence[0]?.observedAt, 5);
  const path = join(root, "native-picker-evidence.json");
  const raw = await readFile(path, "utf8");
  assert.doesNotMatch(raw, /Users|selection_|label|path/i);
  assert.equal((await stat(path)).mode & 0o777, 0o600);
  await writeFile(path, "not-json", "utf8");
  await assert.rejects(() => restarted.list(), /corrupt/i);
});
