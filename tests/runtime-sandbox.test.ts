import assert from "node:assert/strict";
import test from "node:test";

import { selectSandboxMode } from "../packages/runtime/src/index.js";

test("lightweight projects work without Docker under truthful reduced isolation", () => {
  const selection = selectSandboxMode({
    platform: "darwin",
    availableContainers: [],
    projectNeedsStrongIsolation: false,
    policyRequiresStrongIsolation: false,
  });
  assert.equal(selection.mode, "native_bounded");
  assert.equal(selection.strength, "reduced");
  assert.match(selection.label, /Native bounded/);
  assert.equal(selection.restrictions.includes("no_protected_paths"), true);
  assert.equal(selection.restrictions.includes("no_unapproved_network"), true);
  assert.equal(selection.restrictions.includes("no_secret_injection"), true);
});

test("available containers receive strong but still restricted isolation", () => {
  const selection = selectSandboxMode({
    platform: "linux",
    availableContainers: ["podman"],
    projectNeedsStrongIsolation: true,
    policyRequiresStrongIsolation: false,
  });
  assert.equal(selection.mode, "strong_container");
  assert.equal(selection.strength, "strong");
  assert.match(selection.label, /Podman/);
  assert.equal(selection.restrictions.includes("no_host_secrets"), true);
});

test("strong requirements block instead of silently falling back", () => {
  const selection = selectSandboxMode({
    platform: "win32",
    availableContainers: [],
    projectNeedsStrongIsolation: true,
    policyRequiresStrongIsolation: false,
  });
  assert.equal(selection.mode, "blocked");
  assert.equal(selection.strength, "unavailable");
  assert.match(selection.action ?? "", /Install Docker Desktop or Podman/);
  assert.doesNotMatch(selection.summary, /container isolation is available/i);
});

