import assert from "node:assert/strict";
import test from "node:test";

import {
  buildReleaseNotes,
  compatibilityEntrySchema,
  evaluateCompatibility,
  evaluatePromotion,
  incidentAction,
  inspectUpdate,
  releaseManifestSchema,
  transitionUpdate,
  verifyReleaseManifest,
  type ReleaseManifest,
  type UpdatePlan,
} from "../packages/releases/src/index.js";

const artifactDigest = `sha256:${"a".repeat(64)}`;
const manifest: ReleaseManifest = {
  schemaVersion: 1,
  releaseId: "release-1.2.3",
  version: "1.2.3",
  commit: "abcdef1",
  channel: "stable",
  createdAt: "2026-07-28T20:00:00.000Z",
  sourceDateEpoch: 1_775_000_000,
  artifacts: ["source", "lockfile", "schema", "sbom", "provenance", "checksums"].map(
    (kind, index) => ({
      name: `${kind}-${index}`,
      kind: kind as "source" | "lockfile" | "schema" | "sbom" | "provenance" | "checksums",
      digest: artifactDigest,
      sizeBytes: 100 + index,
    })
  ),
  requiredChecks: ["test", "build", "rollback"],
  passedChecks: ["test", "build", "rollback"],
  signer: "Local release owner",
  signatureVerified: true,
  previousCompatibleVersion: "1.2.2",
};

const update: UpdatePlan = {
  schemaVersion: 1,
  updateId: "update-1.2.3",
  fromVersion: "1.2.2",
  toVersion: "1.2.3",
  stage: "available",
  projectCheckpointId: null,
  databaseBackupId: null,
  activeWorkCount: 0,
  compatibilityState: "supported",
  migrations: ["Schema v2 to v3"],
  changedFiles: ["package-lock.json"],
  requiredDiskBytes: 1_000,
  availableDiskBytes: 10_000,
  signatureVerified: true,
  rollbackVersion: "1.2.2",
  lastVerifiedStage: "available",
  interruptionObserved: false,
};

test("a complete signed manifest is reproducible and releasable", () => {
  const first = verifyReleaseManifest(manifest);
  const second = verifyReleaseManifest(manifest);
  assert.equal(first.releasable, true);
  assert.equal(first.manifestDigest, second.manifestDigest);
  assert.deepEqual(first.missingKinds, []);
  assert.deepEqual(first.missingChecks, []);
});

test("missing artifacts, checks, duplicate names, and unverified signatures block release", () => {
  const unsafe = {
    ...manifest,
    artifacts: manifest.artifacts.map((artifact) => ({
      ...artifact,
      name: "duplicate",
      kind: "source" as const,
    })),
    passedChecks: ["test"],
    signatureVerified: false,
  };
  const result = verifyReleaseManifest(unsafe);
  assert.equal(result.releasable, false);
  assert.ok(result.missingKinds.length >= 5);
  assert.deepEqual(result.missingChecks, ["build", "rollback"]);
  assert.match(result.failures.join(" "), /signature|unique|required/i);
});

test("release manifests reject unknown fields and malformed provenance boundaries", () => {
  assert.equal(
    releaseManifestSchema.safeParse({ ...manifest, apiKey: "not-allowed" }).success,
    false
  );
  assert.equal(
    releaseManifestSchema.safeParse({
      ...manifest,
      artifacts: [{ ...manifest.artifacts[0], digest: "not-a-digest" }],
    }).success,
    false
  );
});

test("compatibility makes supported, experimental, blocked, and stale behavior explicit", () => {
  const entry = {
    schemaVersion: 1,
    id: "node-22",
    dimension: "runtime",
    name: "Node.js",
    constraint: "22.x",
    state: "supported",
    reason: "Clean-environment verification passed.",
    alternative: "Install the supported runtime.",
    verifiedAt: "2026-07-28T20:00:00.000Z",
    reviewAfter: "2026-08-28T20:00:00.000Z",
    sourceUrl: "https://nodejs.org/",
    owner: "Release Engineering",
  } as const;
  assert.equal(evaluateCompatibility(entry, "2026-07-29T00:00:00.000Z").canProceed, true);
  assert.equal(
    evaluateCompatibility({ ...entry, state: "experimental" }, "2026-07-29T00:00:00.000Z")
      .requiresApproval,
    true
  );
  assert.equal(
    evaluateCompatibility({ ...entry, state: "blocked" }, "2026-07-29T00:00:00.000Z")
      .canProceed,
    false
  );
  assert.equal(evaluateCompatibility(entry, "2026-09-01T00:00:00.000Z").state, "stale");
  assert.equal(
    compatibilityEntrySchema.safeParse({ ...entry, credential: "not-allowed" }).success,
    false
  );
});

test("update preflight blocks active work, unverified releases, incompatible environments, and low disk", () => {
  const decision = inspectUpdate({
    ...update,
    activeWorkCount: 1,
    signatureVerified: false,
    compatibilityState: "stale",
    availableDiskBytes: 100,
  });
  assert.equal(decision.allowed, false);
  assert.equal(decision.nextStage, "needs_user");
  assert.equal(decision.blockers.length, 4);
  assert.match(decision.action, /without modifying the project/i);
});

test("update cannot cross the migration boundary without complete preservation evidence", () => {
  const preflight = transitionUpdate(update, "preflight");
  assert.throws(
    () => transitionUpdate(preflight, "migration_preview"),
    /cannot move/
  );
  const checkpointed = transitionUpdate(
    {
      ...preflight,
      projectCheckpointId: "checkpoint-before",
      databaseBackupId: "backup-before",
    },
    "checkpointed"
  );
  assert.equal(transitionUpdate(checkpointed, "migration_preview").stage, "migration_preview");
});

test("interrupted updates become rollback-ready and restore without repeating apply", () => {
  const interrupted = {
    ...update,
    stage: "applying" as const,
    projectCheckpointId: "checkpoint-before",
    databaseBackupId: "backup-before",
    interruptionObserved: true,
  };
  const decision = inspectUpdate(interrupted);
  assert.equal(decision.nextStage, "rollback_ready");
  assert.match(decision.action, /restore/i);
  const ready = transitionUpdate({ ...interrupted, interruptionObserved: false }, "rollback_ready");
  const rollingBack = transitionUpdate(ready, "rolling_back");
  assert.equal(transitionUpdate(rollingBack, "restored").stage, "restored");
});

test("rollout promotion requires observation, healthy failures, rollback proof, and current evidence", () => {
  const healthy = {
    schemaVersion: 1,
    releaseId: "release-1.2.3",
    stage: "canary",
    cohortPercent: 10,
    minimumCanaryHours: 24,
    observedCanaryHours: 30,
    totalUpdates: 100,
    failedUpdates: 1,
    rollbackExercisesPassed: true,
    criticalIncidents: 0,
    evidenceCurrent: true,
  } as const;
  assert.deepEqual(evaluatePromotion(healthy), {
    allowed: true,
    blockers: [],
    nextStage: "beta",
  });
  const blocked = evaluatePromotion({
    ...healthy,
    observedCanaryHours: 3,
    failedUpdates: 4,
    rollbackExercisesPassed: false,
    criticalIncidents: 1,
    evidenceCurrent: false,
  });
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.blockers.length, 5);
});

test("release incidents pause promotion and recommend verified rollback", () => {
  const action = incidentAction({
    schemaVersion: 1,
    incidentId: "incident-update-failure",
    releaseId: "release-1.2.3",
    severity: "critical",
    scope: "update",
    state: "open",
    summary: "Update verification failed for the canary cohort.",
    duplicateEffects: 0,
    dataIntegrityPreserved: true,
    rollbackAvailable: true,
  });
  assert.equal(action.pauseRollout, true);
  assert.equal(action.rollbackRecommended, true);
  assert.equal(action.releaseBlocked, true);
  assert.match(action.action, /restore the last compatible release/i);
});

test("release notes always expose migration, compatibility, limitations, and rollback", () => {
  const notes = buildReleaseNotes({
    version: "1.2.3",
    highlights: ["Safer updates"],
    migrations: ["Schema v2 to v3"],
    compatibilityChanges: ["Node.js 22 required"],
    knownLimitations: ["Automated deployment disabled"],
    rollbackVersion: "1.2.2",
  });
  for (const section of ["Highlights", "Migration", "Compatibility", "Known limitations", "Rollback"]) {
    assert.match(notes, new RegExp(`## ${section}`));
  }
  assert.match(notes, /Restore version 1\.2\.2/);
});
