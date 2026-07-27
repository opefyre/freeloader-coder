import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, realpath, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  LocalWorkspace,
  prepareWorktree,
  sha256
} from "../packages/tools/src/repository.js";

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "studio-workspace-"));
  await mkdir(join(root, "src"));
  await writeFile(join(root, "src", "item.ts"), "export const item = 1;\n");
  return {
    root,
    workspace: await LocalWorkspace.open({
      root,
      allowedPaths: ["src/item.ts", "src/new.ts", "src/link.ts"],
      maxFileBytes: 1_000
    })
  };
}

test("scoped edit records before/after evidence and writes expected content", async () => {
  const { root, workspace } = await fixture();
  const before = "export const item = 1;\n";
  const evidence = await workspace.applyTextEdits([{
    path: "src/item.ts",
    expectedSha256: sha256(before),
    content: "export const item = 2;\n"
  }]);
  assert.equal(evidence[0]?.beforeSha256, sha256(before));
  assert.equal(await readFile(join(root, "src", "item.ts"), "utf8"), "export const item = 2;\n");
});

test("workspace rejects traversal, undeclared scope, stale input, duplicate edits, and size overflow", async () => {
  const { workspace } = await fixture();
  await assert.rejects(() => workspace.readText("../outside"));
  await assert.rejects(() => workspace.applyTextEdits([{
    path: "src/other.ts",
    expectedSha256: null,
    content: "x"
  }]));
  await assert.rejects(() => workspace.applyTextEdits([{
    path: "src/item.ts",
    expectedSha256: "stale",
    content: "x"
  }]));
  await assert.rejects(() => workspace.applyTextEdits([
    { path: "src/new.ts", expectedSha256: null, content: "a" },
    { path: "src/new.ts", expectedSha256: null, content: "b" }
  ]));
  await assert.rejects(() => workspace.applyTextEdits([{
    path: "src/new.ts",
    expectedSha256: null,
    content: "x".repeat(1_001)
  }]));
});

test("workspace refuses symbolic-link reads and writes", async () => {
  const { root, workspace } = await fixture();
  await symlink(join(root, "src", "item.ts"), join(root, "src", "link.ts"));
  await assert.rejects(() => workspace.readText("src/link.ts"));
  await assert.rejects(() => workspace.applyTextEdits([{
    path: "src/link.ts",
    expectedSha256: null,
    content: "changed"
  }]));
});

test("worktree preparation uses a bounded path and verifies branch/head postconditions", async () => {
  const repositoryRoot = await mkdtemp(join(tmpdir(), "studio-repository-"));
  const worktreeRoot = await mkdtemp(join(tmpdir(), "studio-worktrees-"));
  let requested: { worktreePath: string; branch: string; baseline: string } | null = null;
  const baseline = "a".repeat(40);
  const result = await prepareWorktree({
    repositoryRoot,
    worktreeRoot,
    taskId: "TASK 42",
    runId: "run-1",
    baseline,
    git: {
      addWorktree: async (input) => {
        requested = input;
      },
      inspectWorktree: async () => {
        if (!requested) throw new Error("Missing request.");
        return { branch: requested.branch, head: requested.baseline };
      }
    }
  });
  assert.equal(result.path.startsWith(await realpath(worktreeRoot)), true);
  assert.match(result.branch, /^studio\/task-42-[a-f0-9]{10}$/);
  assert.equal(result.baseline, baseline);
});

test("worktree preparation fails when Git postconditions do not match", async () => {
  const repositoryRoot = await mkdtemp(join(tmpdir(), "studio-repository-"));
  const worktreeRoot = await mkdtemp(join(tmpdir(), "studio-worktrees-"));
  await assert.rejects(() => prepareWorktree({
    repositoryRoot,
    worktreeRoot,
    taskId: "task-1",
    runId: "run-1",
    baseline: "a".repeat(40),
    git: {
      addWorktree: async () => undefined,
      inspectWorktree: async () => ({ branch: "wrong", head: "b".repeat(40) })
    }
  }));
});
