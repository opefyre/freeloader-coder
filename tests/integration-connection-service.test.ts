import assert from "node:assert/strict";
import test from "node:test";

import { IntegrationConnectionService } from "../apps/core/src/integration-connection-service.js";

test("GitHub discovery returns authenticated account and bounded repository metadata", async () => {
  const calls: string[] = [];
  const service = new IntegrationConnectionService(async (file, args) => {
    calls.push(`${file} ${args.join(" ")}`);
    if (args[0] === "api") return { stdout: "opefyre\n" };
    return { stdout: JSON.stringify([{ id: "R_1", nameWithOwner: "opefyre/app", url: "https://github.com/opefyre/app", isPrivate: true, defaultBranchRef: { name: "main" } }]) };
  });
  const result = await service.probeGitHub();
  assert.equal(result.connections[0]?.state, "ready");
  assert.equal(result.connections[0]?.accountLabel, "opefyre");
  assert.equal(result.connections[0]?.resources[0]?.label, "opefyre/app");
  assert.deepEqual(calls, ["gh api user --jq .login", "gh repo list --limit 100 --json id,nameWithOwner,url,isPrivate,defaultBranchRef"]);
  assert.equal(JSON.stringify(result).includes("token"), false);
});

test("GitHub discovery fails closed without credentials or executable", async () => {
  const missing = new IntegrationConnectionService(async () => { throw new Error("spawn gh ENOENT"); });
  assert.equal((await missing.probeGitHub()).connections[0]?.state, "unavailable");
  const signedOut = new IntegrationConnectionService(async () => { throw new Error("authentication required"); });
  assert.equal((await signedOut.probeGitHub()).connections[0]?.state, "not_connected");
});
