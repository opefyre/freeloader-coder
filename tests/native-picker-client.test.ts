import assert from "node:assert/strict";
import test from "node:test";

import { openNativePicker } from "../apps/studio/src/native-picker-client.js";

test("native picker client stays on loopback and validates selections", async () => {
  let observed = "";
  const result = await openNativePicker({
    endpoint: "http://127.0.0.1:4312",
    kind: "folder",
    fetcher: async (url) => {
      observed = String(url);
      return Response.json({ schemaVersion: 1, outcome: "selected", selections: [{ path: "/Users/example/project", label: "project" }] });
    },
  });
  assert.equal(observed, "http://127.0.0.1:4312/api/v1/system/pick-folder");
  assert.equal(result.selections[0]?.label, "project");
  await assert.rejects(() => openNativePicker({ endpoint: "https://example.com", kind: "files", fetcher: fetch }));
});
