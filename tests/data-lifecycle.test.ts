import assert from "node:assert/strict";
import test from "node:test";
import { cleanupEligible, storageBreakdown, validateDataGraph, type DataRecord } from "../packages/data-lifecycle/src/schema.js";
import { runMigration } from "../packages/data-lifecycle/src/migrations.js";
import { deletionDryRun, planRestore, previewExport } from "../packages/data-lifecycle/src/portability.js";

const record = (patch: Partial<DataRecord> & Pick<DataRecord, "id" | "kind">): DataRecord => {
  const { id, kind, ...rest } = patch;
  return {
    ownerId: "profile", projectId: "project", checksum: "a".repeat(64),
    references: [], retention: "project", sizeBytes: 100,
    contentAddress: null, credential: false, ...rest, id, kind,
  };
};
const records = [
  record({ id: "project", kind: "project", retention: "keep" }),
  record({ id: "task", kind: "task", references: ["project"] }),
  record({ id: "artifact", kind: "artifact", references: ["task"], sizeBytes: 2_000_000, contentAddress: "sha256:artifact" }),
];

test("ownership, foreign keys, credentials, content addressing, and storage breakdown are enforced", () => {
  validateDataGraph(records);
  assert.equal(storageBreakdown(records)[0]?.kind, "artifact");
  assert.throws(() => validateDataGraph([record({ id: "secret", kind: "setting", credential: true })]));
  assert.throws(() => validateDataGraph([record({ id: "large", kind: "artifact", sizeBytes: 2_000_000 })]));
});

test("cleanup preserves active, retained, checkpointed, audited, and referenced data", () => {
  assert.deepEqual(cleanupEligible({ records, candidateIds: ["project", "task", "artifact"], activeTaskIds: new Set(["task"]), checkpointReferences: new Set(["artifact"]) }), []);
  assert.deepEqual(cleanupEligible({ records, candidateIds: ["artifact"], activeTaskIds: new Set(), checkpointReferences: new Set() }), ["artifact"]);
});

test("migration is idempotent, verified, and rolls back to recovery mode on failure", () => {
  const migration = { id: "v1-v2", from: 1, to: 2, prerequisite: () => true, apply: (state: Readonly<Record<string, unknown>>) => ({ ...state, migrated: true }), verify: (state: Readonly<Record<string, unknown>>) => state.migrated === true };
  assert.equal(runMigration({ currentVersion: 1, targetVersion: 2, state: { safe: true }, migrations: [migration] }).status, "migrated");
  assert.equal(runMigration({ currentVersion: 2, targetVersion: 2, state: { safe: true }, migrations: [migration] }).status, "current");
  assert.equal(runMigration({ currentVersion: 1, targetVersion: 3, state: { safe: true }, migrations: [migration] }).status, "read_only_recovery");
});

test("backup preview excludes credentials and restore never silently overwrites", () => {
  const bundle = previewExport({ projectId: "project", records, destination: "/backup", encrypted: true, includeKinds: ["task", "artifact"] });
  assert.equal(bundle.credentialsIncluded, false);
  assert.deepEqual(planRestore({ bundle, existing: records, conflict: "keep_existing" }).replace, []);
  assert.equal(planRestore({ bundle, existing: records, conflict: "import_copy" }).create.every((item) => item.id.endsWith(".imported")), true);
});

test("deletion dry run preserves shared data and lists external revocations", () => {
  const result = deletionDryRun({ records, targetIds: ["project", "task"], activeTaskIds: new Set(["task"]), externalGrants: ["Revoke GitHub grant"] });
  assert.deepEqual(result.blocked.map((item) => item.id), ["task"]);
  assert.deepEqual(result.sharedPreserved, ["task"]);
  assert.equal(result.externalRevocations[0], "Revoke GitHub grant");
});
