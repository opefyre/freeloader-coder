import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ProjectIntakeStore, ProjectIntakeStoreError } from "../apps/core/src/project-intake-store.js";

test("durable intake preserves mode, opaque resources, revisions, and idempotent submission", async () => {
  const root = await mkdtemp(join(tmpdir(), "codkesh-intake-")); let now = 100;
  try {
    const store = new ProjectIntakeStore(root, () => ++now);
    const draft = await store.create({ schemaVersion: 1, projectMode: "new_product" });
    const selected = await store.saveDraft(draft.id, { schemaVersion: 1, expectedRevision: 1, idea: "Build a family operations product", workspaceReference: "workspace:opaque_12345678", attachmentReferences: ["attachment:brief_12345678"] });
    const resources = await store.selectResources(draft.id, { schemaVersion: 1, expectedRevision: selected.revision, selectedResources: ["jira:project_12345678", "github:repo_12345678"] });
    const submitted = await store.submit(draft.id, { schemaVersion: 1, expectedRevision: resources.revision }, "submit:fixture-1");
    const replay = await new ProjectIntakeStore(root, () => ++now).submit(draft.id, { schemaVersion: 1, expectedRevision: resources.revision }, "submit:fixture-1");
    assert.equal(replay.revision, submitted.revision);
    assert.equal((await new ProjectIntakeStore(root).list())[0]?.projectMode, "new_product");
    const browserSafe = JSON.stringify(replay);
    assert.equal(browserSafe.includes("/Users/"), false);
    assert.equal(browserSafe.includes("file://"), false);
    assert.equal((await readFile(join(root, "project-intakes.json"), "utf8")).includes("workspace:opaque_12345678"), true);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("invalid transitions fail and cancellation permanently stops analysis claims", async () => {
  const root = await mkdtemp(join(tmpdir(), "codkesh-intake-state-"));
  try {
    const store = new ProjectIntakeStore(root);
    const intake = await store.create({ schemaVersion: 1, projectMode: "existing_product" });
    await assert.rejects(() => store.beginAnalysis(intake.id, intake.revision), (error: unknown) => error instanceof ProjectIntakeStoreError && error.code === "invalid_transition");
    const cancelled = await store.cancel(intake.id, intake.revision, "Owner cancelled this project intake.");
    await assert.rejects(() => store.beginAnalysis(cancelled.id, cancelled.revision), (error: unknown) => error instanceof ProjectIntakeStoreError && error.code === "invalid_transition");
    assert.equal(cancelled.projectMode, "existing_product");
  } finally { await rm(root, { recursive: true, force: true }); }
});
