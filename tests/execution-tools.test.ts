import assert from "node:assert/strict";
import test from "node:test";

import {
  authorizeToolInvocation,
  isolationProfiles,
  recordToolResult,
  toolInvocationSchema
} from "../packages/execution/src/index.js";

function invocation(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    id: "invoke-1",
    tool: "patch",
    projectId: "project-1",
    paths: ["src/App.tsx"],
    commandId: null,
    environmentReferences: [],
    networkHosts: [],
    declaredEffects: ["read_project", "write_project"],
    timeoutMs: 60_000,
    maxOutputBytes: 1_024,
    idempotencyKey: "invoke-1-attempt-1",
    ...overrides
  };
}

const policy = {
  isolation: isolationProfiles[0]!,
  protectedPaths: [".env", "secrets"],
  symlinkPaths: ["src/linked.ts"],
  allowedCommandIds: ["test"],
  allowedNetworkHosts: ["registry.npmjs.org"]
};

test("path traversal, protected paths, and symlinks are denied", () => {
  assert.throws(() => toolInvocationSchema.parse(invocation({ paths: ["../secret"] })), /project-relative/);
  assert.throws(
    () => authorizeToolInvocation({ invocation: invocation({ paths: [".env"] }), ...policy }),
    /protected path/
  );
  assert.throws(
    () => authorizeToolInvocation({ invocation: invocation({ paths: ["src/linked.ts"] }), ...policy }),
    /symlink/
  );
});

test("tools refuse undeclared effects and unknown schemas", () => {
  assert.throws(
    () => authorizeToolInvocation({
      invocation: invocation({ declaredEffects: ["write_git"] }),
      ...policy
    }),
    /does not own/
  );
  assert.throws(
    () => toolInvocationSchema.parse({ ...invocation(), shell: "unrestricted" }),
    /Unrecognized key/
  );
});

test("commands, environment references, and network hosts are policy-bound", () => {
  const command = invocation({
    tool: "command",
    paths: [],
    commandId: "test",
    declaredEffects: ["run_process"]
  });
  assert.equal(authorizeToolInvocation({ invocation: command, ...policy }).commandId, "test");
  assert.throws(
    () => authorizeToolInvocation({
      invocation: { ...command, commandId: "curl-anything" },
      ...policy
    }),
    /not declared/
  );
  assert.throws(
    () => authorizeToolInvocation({
      invocation: invocation({
        tool: "read",
        declaredEffects: ["read_project"],
        networkHosts: ["example.com"]
      }),
      ...policy
    }),
    /allowlist/
  );
});

test("large and sensitive output is redacted and stored as a local artifact reference", () => {
  const receipt = recordToolResult({
    invocation: invocation({ maxOutputBytes: 256 }),
    output: `token=very-secret-value\n${"result ".repeat(100)}/Users/alice/project`,
    exitStatus: "succeeded",
    durationMs: 50,
    observedEffects: ["read_project", "write_project"],
    sensitive: true
  });
  assert.match(receipt.outputSummary, /stored as a local artifact/);
  assert.match(receipt.artifactRef ?? "", /^artifact:/);
  assert.doesNotMatch(receipt.outputExcerpt, /very-secret-value|alice/);
  assert.ok(receipt.redactions >= 2);
});

test("observed effects cannot exceed declared effects", () => {
  assert.throws(
    () => recordToolResult({
      invocation: invocation(),
      output: "done",
      exitStatus: "succeeded",
      durationMs: 10,
      observedEffects: ["write_git"],
      sensitive: false
    }),
    /undeclared effect/
  );
});
