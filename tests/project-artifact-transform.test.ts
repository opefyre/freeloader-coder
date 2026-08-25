import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { ProjectArtifactStore } from "../apps/core/src/project-artifact-store.js";
import { ProjectArtifactTransformService } from "../apps/core/src/project-artifact-transform.js";

test("governed transform previews without mutation, applies with history, and is idempotent", async () => {
  const root = await mkdtemp(join(tmpdir(), "codkesh-artifact-transform-"));
  try {
    const store = new ProjectArtifactStore();
    await store.initialize(root);
    const current = await store.read(root, "product");
    const branded = current.body.replace("# Product", "# Pipeline Studio Product");
    const seeded = await store.write(root, { kind: "product", body: branded, producer: "codkesh:test", expectedDigest: current.metadata.bodyDigest });
    const service = new ProjectArtifactTransformService(store);
    const preview = await service.transform({ root, kinds: ["product"], replacements: [{ from: "Pipeline Studio", to: "Codkesh" }] });
    assert.equal(preview.mode, "dry_run");
    assert.equal(preview.changed.length, 1);
    assert.equal((await store.read(root, "product")).metadata.bodyDigest, seeded.metadata.bodyDigest);

    const applied = await service.transform({ root, mode: "apply", kinds: ["product"], replacements: [{ from: "Pipeline Studio", to: "Codkesh" }] });
    assert.equal(applied.changed[0]?.approvalState, "pending");
    const updated = await store.read(root, "product");
    assert.match(updated.body, /Codkesh Product/);
    assert.doesNotMatch(updated.body, /Pipeline Studio/);
    assert.equal(updated.metadata.supersedesDigest, seeded.metadata.bodyDigest);
    assert.equal((await store.history(root, "product")).some((artifact) => artifact.metadata.bodyDigest === seeded.metadata.bodyDigest), true);

    const replay = await service.transform({ root, mode: "apply", kinds: ["product"], replacements: [{ from: "Pipeline Studio", to: "Codkesh" }] });
    assert.equal(replay.changed.length, 0);
    assert.deepEqual(replay.unchanged, ["product"]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("governed transform fails closed for invalid replacements, secrets, and stale content", async () => {
  const root = await mkdtemp(join(tmpdir(), "codkesh-artifact-transform-fail-"));
  try {
    const store = new ProjectArtifactStore();
    await store.initialize(root);
    const service = new ProjectArtifactTransformService(store);
    await assert.rejects(service.transform({ root, replacements: [] }), /between one and twenty/);
    await assert.rejects(service.transform({ root, replacements: [{ from: "same", to: "same" }] }), /must change/);
    const context = await store.read(root, "context");
    await store.write(root, { kind: "context", body: context.body.replace("_No verified facts have been recorded._", "Pipeline Studio"), producer: "codkesh:test", expectedDigest: context.metadata.bodyDigest });
    await assert.rejects(service.transform({ root, kinds: ["context"], replacements: [{ from: "Pipeline Studio", to: "api_key=secret-value-123456789" }] }), /credential|sensitive/i);

    const primary = join(root, "CONTEXT.md");
    const before = await readFile(primary, "utf8");
    await writeFile(primary, before.replace("Pipeline Studio", "Owner edit"), "utf8");
    await assert.rejects(service.transform({ root, mode: "apply", kinds: ["context"], replacements: [{ from: "Pipeline Studio", to: "Codkesh" }] }), /digest|changed|match/i);
  } finally { await rm(root, { recursive: true, force: true }); }
});
