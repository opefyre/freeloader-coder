import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCheckpointPlan,
  createRestoreManifest,
  executeCheckpointPlan,
  planRestore,
  type CheckpointGitAdapter,
  type GitInspection
} from "../packages/onboarding/src/index.js";

const clean: GitInspection = {
  present: true,
  branch: "main",
  head: "b".repeat(40),
  detached: false,
  dirtyPaths: [],
  untrackedPaths: [],
  ignoredSensitivePaths: [".env"],
  largeFiles: [],
  nestedRepositories: [],
  remotes: [{ name: "origin", host: "github.com" }]
};

test("dirty, untracked, nested, and detached Git state receives guided isolation", () => {
  const plan = buildCheckpointPlan({
    projectId: "Example Project",
    inspection: {
      ...clean,
      branch: null,
      detached: true,
      dirtyPaths: ["src/user-change.ts"],
      untrackedPaths: ["notes.txt"],
      nestedRepositories: ["vendor/component"],
      largeFiles: [{ path: "fixtures/video.mp4", bytes: 50_000_000 }]
    }
  });
  assert.equal(plan.mode, "existing_git");
  assert.deepEqual(plan.userWorkOutsideCheckpoint, ["notes.txt", "src/user-change.ts"]);
  assert.match(plan.exactOperations[0] ?? "", /git worktree add/);
  assert.ok(plan.limitations.some((item) => /detached/i.test(item)));
  assert.ok(plan.limitations.some((item) => /Nested repositories/i.test(item)));
  assert.ok(plan.limitations.some((item) => /Large files/i.test(item)));
});

test("no-Git projects receive an explicit approval-gated baseline plan", () => {
  const plan = buildCheckpointPlan({
    projectId: "new-project",
    inspection: {
      ...clean,
      present: false,
      branch: null,
      head: null,
      remotes: []
    }
  });
  assert.equal(plan.mode, "initialize_git");
  assert.equal(plan.requiresApproval, true);
  assert.equal(plan.baseline, null);
  assert.match(plan.exactOperations.join("\n"), /git init --initial-branch=main/);
  assert.match(plan.limitations.join("\n"), /explicit user approval/);
});

test("restore changes only product-owned files and preserves unrelated work", () => {
  const before = "1".repeat(64);
  const after = "2".repeat(64);
  const manifest = createRestoreManifest({
    checkpointId: "checkpoint-1",
    baseline: "c".repeat(40),
    productOwnedFiles: [
      { path: "src/product.ts", beforeSha256: before, afterSha256: after },
      { path: "src/created.ts", beforeSha256: null, afterSha256: after }
    ],
    unrelatedUserPaths: ["notes.txt", "src/user-change.ts"]
  });
  const restore = planRestore({
    manifest,
    currentDigests: {
      "src/product.ts": after,
      "src/created.ts": after,
      "notes.txt": "3".repeat(64)
    }
  });
  assert.equal(restore.safe, true);
  assert.deepEqual(restore.restorePaths, ["src/product.ts", "src/created.ts"]);
  assert.deepEqual(restore.preservedUserPaths, ["notes.txt", "src/user-change.ts"]);
  assert.ok(restore.operations.some((operation) => /remove product-created/.test(operation)));
  assert.ok(restore.operations.every((operation) => !operation.includes("notes.txt")));
});

test("restore stops on user edits to a product-owned file", () => {
  const manifest = createRestoreManifest({
    checkpointId: "checkpoint-2",
    baseline: "d".repeat(40),
    productOwnedFiles: [{
      path: "src/product.ts",
      beforeSha256: "1".repeat(64),
      afterSha256: "2".repeat(64)
    }],
    unrelatedUserPaths: []
  });
  const restore = planRestore({
    manifest,
    currentDigests: { "src/product.ts": "9".repeat(64) }
  });
  assert.equal(restore.safe, false);
  assert.deepEqual(restore.conflicts, ["src/product.ts"]);
  assert.deepEqual(restore.restorePaths, []);
});

test("Advanced checkpoint plans expose exact operations and limitations", () => {
  const plan = buildCheckpointPlan({ projectId: "project", inspection: clean });
  assert.ok(plan.exactOperations.length >= 4);
  assert.ok(plan.exactOperations.every((operation) => operation.trim().length > 0));
  assert.ok(plan.limitations.some((limitation) => /unrelated user work/i.test(limitation)));
});

test("checkpoint execution requires approval when initializing Git", async () => {
  const plan = buildCheckpointPlan({
    projectId: "new-project",
    inspection: {
      ...clean,
      present: false,
      branch: null,
      head: null,
      remotes: []
    }
  });
  const adapter: CheckpointGitAdapter = {
    async initialize() {
      throw new Error("must not run");
    },
    async createIsolatedCheckpoint() {
      throw new Error("must not run");
    },
    async observe() {
      throw new Error("must not run");
    }
  };
  await assert.rejects(
    executeCheckpointPlan({ plan, adapter, approved: false }),
    /explicit user approval/
  );
});

test("checkpoint execution verifies the exact branch and baseline postcondition", async () => {
  const plan = buildCheckpointPlan({
    projectId: "project",
    inspection: { ...clean, dirtyPaths: ["notes.txt"] }
  });
  const expected = { head: clean.head!, branch: plan.branch };
  const adapter: CheckpointGitAdapter = {
    async initialize() {
      throw new Error("not used");
    },
    async createIsolatedCheckpoint(input) {
      assert.equal(input.baseline, clean.head);
      assert.deepEqual(input.protectedPaths, [".env"]);
      return expected;
    },
    async observe() {
      return expected;
    }
  };
  const result = await executeCheckpointPlan({ plan, adapter, approved: true });
  assert.equal(result.observed, true);
  assert.equal(result.baseline, clean.head);
  assert.deepEqual(result.userWorkPreserved, ["notes.txt"]);

  const broken: CheckpointGitAdapter = {
    ...adapter,
    async observe() {
      return { ...expected, branch: "wrong-branch" };
    }
  };
  await assert.rejects(
    executeCheckpointPlan({ plan, adapter: broken, approved: true }),
    /postcondition was not observed/
  );
});
