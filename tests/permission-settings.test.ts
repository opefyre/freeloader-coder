import assert from "node:assert/strict";
import test from "node:test";

import {
  applyPermissionAction,
  recommendedPermissionProfiles,
  visiblePermissionTarget
} from "../apps/studio/src/permission-fixture.js";

test("permission catalogue covers every required access surface", () => {
  assert.deepEqual(
    new Set(recommendedPermissionProfiles.map((profile) => profile.kind)),
    new Set([
      "Project folder",
      "Provider",
      "Connector",
      "Tool",
      "External effect",
      "Paid action"
    ])
  );
  assert.equal(
    recommendedPermissionProfiles.every(
      (profile) => profile.recentUse.length > 0 && profile.technicalScopes.length > 0
    ),
    true
  );
});

test("revoke blocks new work and explains active-work reconciliation", () => {
  const project = recommendedPermissionProfiles.find(
    (profile) => profile.id === "project-folder"
  )!;
  const result = applyPermissionAction(project, "revoke");
  assert.equal(result.profile.state, "Revoked");
  assert.equal(result.profile.activeWork, 0);
  assert.match(result.notice, /New work is blocked/);
  assert.match(result.notice, /pause after its current safe step/);
});

test("expire later and reset recommended are deterministic", () => {
  const connector = recommendedPermissionProfiles.find(
    (profile) => profile.id === "jira"
  )!;
  const expiring = applyPermissionAction(connector, "expire");
  assert.equal(expiring.profile.state, "Expires soon");
  assert.equal(expiring.profile.expiresAt, "In 24 hours");
  const reset = applyPermissionAction(expiring.profile, "reset");
  assert.deepEqual(reset.profile, connector);
});

test("shared-computer projection masks targets without changing canonical state", () => {
  const connector = recommendedPermissionProfiles.find(
    (profile) => profile.id === "jira"
  )!;
  assert.equal(visiblePermissionTarget(connector, false), connector.target);
  assert.equal(visiblePermissionTarget(connector, true), connector.maskedTarget);
  assert.equal(connector.target, "PIPE project · Opefyre Jira");
});

test("paid actions remain denied through every permission action", () => {
  const paid = recommendedPermissionProfiles.find(
    (profile) => profile.id === "paid-actions"
  )!;
  for (const action of ["revoke", "expire", "reset"] as const) {
    assert.equal(applyPermissionAction(paid, action).profile.state, "Denied");
  }
});
