import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, realpath, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  assertPathInsideProject,
  createApprovalReceipt,
  criticalThreatControls,
  evaluateThreatRelease,
  verifyApprovalReceipt,
  verifyUpdateArtifact
} from "../packages/security/src/index.js";

const now = 1_800_000_000_000;

test("every critical threat has prevention, detection, response, verification, and owner", () => {
  assert.equal(criticalThreatControls.length, 8);
  for (const threat of criticalThreatControls) {
    assert.ok(threat.prevention);
    assert.ok(threat.detection);
    assert.ok(threat.response);
    assert.ok(threat.verification);
    assert.ok(threat.owner);
  }
});

test("residual high provider risk blocks release without an explicit owner decision", () => {
  const blocked = evaluateThreatRelease({
    changedSurfaces: ["provider"],
    decisions: [],
    now
  });
  assert.equal(blocked.allowed, false);
  assert.deepEqual(blocked.blockedThreatIds, ["provider-compromise"]);

  const accepted = evaluateThreatRelease({
    changedSurfaces: ["provider"],
    decisions: [{
      threatId: "provider-compromise",
      owner: "Release owner",
      rationale: "Accepted for the synthetic alpha fixture only.",
      acceptedAt: now - 1,
      expiresAt: now + 60_000
    }],
    now
  });
  assert.equal(accepted.allowed, true);
  assert.ok(accepted.reviewRequiredThreatIds.includes("prompt-injection"));
});

test("realpath containment rejects lexical and symlink path escape", async () => {
  const root = await mkdtemp(join(tmpdir(), "pipeline-security-"));
  const project = join(root, "project");
  const outside = join(root, "outside");
  await mkdir(project);
  await mkdir(outside);
  await writeFile(join(project, "safe.txt"), "safe");
  await writeFile(join(outside, "private.txt"), "private");
  await symlink(outside, join(project, "link"));

  assert.equal(
    await assertPathInsideProject(project, "safe.txt"),
    await realpath(join(project, "safe.txt"))
  );
  await assert.rejects(
    () => assertPathInsideProject(project, "../outside/private.txt"),
    /outside the registered project/
  );
  await assert.rejects(
    () => assertPathInsideProject(project, "link/private.txt"),
    /outside the registered project/
  );
});

test("approval receipts reject replay, expiry, and policy mismatch", () => {
  const receipt = createApprovalReceipt({
    effectId: "effect-1",
    nonce: "nonce-1",
    approvedAt: now,
    expiresAt: now + 10_000,
    policyDigest: "policy-a"
  });
  verifyApprovalReceipt({
    receipt,
    effectId: "effect-1",
    policyDigest: "policy-a",
    now: now + 1,
    consumedNonces: new Set()
  });
  assert.throws(() => verifyApprovalReceipt({
    receipt,
    effectId: "effect-1",
    policyDigest: "policy-a",
    now: now + 1,
    consumedNonces: new Set(["nonce-1"])
  }), /already used/);
  assert.throws(() => verifyApprovalReceipt({
    receipt,
    effectId: "effect-1",
    policyDigest: "policy-b",
    now: now + 1,
    consumedNonces: new Set()
  }), /does not match/);
});

test("update artifacts require both signature evidence and exact digest", () => {
  const bytes = Buffer.from("verified release artifact");
  const digest = createHash("sha256").update(bytes).digest("hex");
  verifyUpdateArtifact({ bytes, expectedSha256: digest, signed: true });
  assert.throws(
    () => verifyUpdateArtifact({ bytes, expectedSha256: "0".repeat(64), signed: true }),
    /could not be verified/
  );
  assert.throws(
    () => verifyUpdateArtifact({ bytes, expectedSha256: digest, signed: false }),
    /could not be verified/
  );
});
