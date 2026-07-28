import assert from "node:assert/strict";
import test from "node:test";

import {
  createSetupState,
  resumeSetup,
  runPreflight,
  selectLoopbackPort,
  type PreflightSnapshot,
} from "../packages/runtime/src/index.js";

function snapshot(overrides: Partial<PreflightSnapshot> = {}): PreflightSnapshot {
  return {
    schemaVersion: 1,
    platform: "darwin",
    architecture: "arm64",
    nodeMajor: 22,
    npmMajor: 10,
    gitAvailable: true,
    totalMemoryGb: 8,
    freeDiskGb: 25,
    stateDirectoryWritable: true,
    preferredPort: 4310,
    occupiedPorts: [],
    activeController: null,
    containerRuntimes: [],
    localModelRuntimeAvailable: false,
    ...overrides,
  };
}

test("a supported clean machine reaches a ready no-Docker setup", () => {
  const report = runPreflight(snapshot(), {
    now: 1_000,
    profileId: "default",
  });
  assert.equal(report.state, "ready");
  assert.equal(report.selectedSandbox, "native_bounded");
  assert.equal(report.selectedPort, 4310);
  assert.equal(
    report.requirements.find((item) => item.id === "local-model-runtime")?.disposition,
    "optional"
  );
});

test("missing requirements explain exact action and Resume verification", () => {
  const report = runPreflight(
    snapshot({
      nodeMajor: 20,
      gitAvailable: false,
      freeDiskGb: 2,
      stateDirectoryWritable: false,
    }),
    { now: 1_000, profileId: "default" }
  );
  assert.equal(report.state, "unsupported");
  const blockers = report.requirements.filter((item) => item.state !== "ready");
  assert.equal(blockers.every((item) => item.verification.length > 0), true);
  assert.equal(
    blockers
      .filter((item) => item.disposition === "needs_user")
      .every((item) => item.action?.includes("Resume")),
    true
  );
});

test("port selection repairs bounded conflicts without wildcard binding", () => {
  assert.equal(selectLoopbackPort(4310, [4310, 4311]), 4312);
  assert.equal(
    selectLoopbackPort(
      65_485,
      Array.from({ length: 51 }, (_, index) => 65_485 + index)
    ),
    null
  );
});

test("repeated setup preserves configuration and credential-store boundary", () => {
  const firstReport = runPreflight(snapshot(), {
    now: 1_000,
    profileId: "main",
  });
  const first = createSetupState({
    profileId: "main",
    report: firstReport,
    configuration: { theme: "dark", profile: "balanced" },
    now: 1_001,
  });
  const resumed = resumeSetup({
    current: first,
    report: runPreflight(snapshot({ occupiedPorts: [4310] }), {
      now: 2_000,
      profileId: "main",
    }),
    now: 2_001,
  });
  assert.deepEqual(resumed.configuration, first.configuration);
  assert.equal(resumed.credentialStore, "operating_system");
  assert.equal(resumed.selectedPort, 4311);
});

test("setup state rejects secret-shaped configuration", () => {
  const report = runPreflight(snapshot(), {
    now: 1_000,
    profileId: "main",
  });
  assert.throws(
    () =>
      createSetupState({
        profileId: "main",
        report,
        configuration: { api_key: "sk-test-secret" },
        now: 1_001,
      }),
    /secret material/
  );
});
