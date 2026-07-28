import assert from "node:assert/strict";
import test from "node:test";

import {
  registerProject,
  type RepositoryInspection,
  type RepositoryIntakeAdapter
} from "../packages/onboarding/src/index.js";

function inspection(
  overrides: Partial<RepositoryInspection> = {}
): RepositoryInspection {
  return {
    schemaVersion: 1,
    repositoryId: "github:opefyre/example",
    canonicalPath: "/safe/projects/example",
    displayName: "Example",
    exists: true,
    directory: true,
    destinationState: "empty",
    authentication: "ready",
    sizeBytes: 1024,
    fileCount: 12,
    submodules: [],
    lfs: false,
    unsupportedReasons: [],
    detectedCommands: ["npm test", "npm run build"],
    risks: [],
    missingDependencies: [],
    git: {
      present: true,
      branch: "main",
      head: "a".repeat(40),
      detached: false,
      dirtyPaths: [],
      untrackedPaths: [],
      ignoredSensitivePaths: [".env"],
      largeFiles: [],
      nestedRepositories: [],
      remotes: [{ name: "origin", host: "github.com" }]
    },
    ...overrides
  };
}

class IntakeAdapter implements RepositoryIntakeAdapter {
  destination: "unused" | "empty" | "occupied" = "empty";
  local = inspection();
  remote = inspection();
  cloned = inspection();
  cloneCalls = 0;

  async inspectLocal(): Promise<RepositoryInspection> {
    return this.local;
  }

  async inspectRemote(): Promise<RepositoryInspection> {
    return this.remote;
  }

  async inspectDestination(): Promise<"unused" | "empty" | "occupied"> {
    return this.destination;
  }

  async clone(): Promise<RepositoryInspection> {
    this.cloneCalls += 1;
    return this.cloned;
  }
}

test("local registration and GitHub clone produce the same canonical project record", async () => {
  const adapter = new IntakeAdapter();
  const local = await registerProject({
    request: { schemaVersion: 1, kind: "local", path: "/safe/projects/example" },
    adapter
  });
  const clone = await registerProject({
    request: {
      schemaVersion: 1,
      kind: "github_clone",
      url: "https://github.com/opefyre/example.git",
      destination: "/safe/projects/example"
    },
    adapter
  });
  assert.equal(local.status, "ready");
  assert.equal(clone.status, "ready");
  assert.deepEqual(local.record, clone.record);
  assert.equal(adapter.cloneCalls, 1);
});

test("occupied clone destinations are never overwritten", async () => {
  const adapter = new IntakeAdapter();
  adapter.destination = "occupied";
  const result = await registerProject({
    request: {
      schemaVersion: 1,
      kind: "github_clone",
      url: "https://github.com/opefyre/example",
      destination: "/safe/projects/existing"
    },
    adapter
  });
  assert.equal(result.status, "needs_user");
  assert.equal(result.record, null);
  assert.equal(result.code, "destination_conflict");
  assert.equal(adapter.cloneCalls, 0);
  assert.match(result.message, /Nothing was changed/);
  assert.ok(result.options.includes("Register the existing folder instead"));
});

test("private repository failures give exact permission and Resume options", async () => {
  const adapter = new IntakeAdapter();
  adapter.remote = inspection({ authentication: "required" });
  const result = await registerProject({
    request: {
      schemaVersion: 1,
      kind: "github_clone",
      url: "https://github.com/opefyre/private-project",
      destination: "/safe/projects/private-project"
    },
    adapter
  });
  assert.equal(result.status, "needs_user");
  assert.equal(result.code, "authentication_required");
  assert.match(result.resumeToken, /^resume_[a-f0-9]{20}$/);
  assert.ok(result.options.some((option) => /Resume verification/.test(option)));
  assert.equal(adapter.cloneCalls, 0);
});

test("unsupported layouts preserve a deterministic Resume path", async () => {
  const adapter = new IntakeAdapter();
  adapter.local = inspection({ unsupportedReasons: ["Repository contains a nested workspace root."] });
  const result = await registerProject({
    request: { schemaVersion: 1, kind: "local", path: "/safe/projects/example" },
    adapter
  });
  assert.equal(result.status, "unsupported");
  assert.equal(result.code, "unsupported_layout");
  assert.ok(result.options.some((option) => /Resume/.test(option)));
});

test("non-canonical GitHub URLs and invented fields are rejected", async () => {
  const adapter = new IntakeAdapter();
  await assert.rejects(
    registerProject({
      request: {
        schemaVersion: 1,
        kind: "github_clone",
        url: "https://example.com/opefyre/example",
        destination: "/safe/projects/example"
      },
      adapter
    }),
    /canonical HTTPS GitHub/
  );
  await assert.rejects(
    registerProject({
      request: {
        schemaVersion: 1,
        kind: "local",
        path: "/safe/projects/example",
        overwrite: true
      },
      adapter
    }),
    /Unrecognized key/
  );
});
