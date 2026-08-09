import assert from "node:assert/strict";
import test from "node:test";

import { terminateSensitiveInput } from "../apps/core/src/sensitive-command-runner.js";

test("macOS Keychain interactive commands preserve their terminated protected stdin", () => {
  const command = { executable: "/usr/bin/security", args: ["-i"], stdin: "fixture-command\n", outputContainsSecret: false } as const;
  assert.equal(terminateSensitiveInput(command), "fixture-command\n");
});

test("other native vault backends preserve exact protected stdin", () => {
  const command = { executable: "secret-tool", args: ["store"], stdin: "fixture-secret", outputContainsSecret: false } as const;
  assert.equal(terminateSensitiveInput(command), "fixture-secret");
});
