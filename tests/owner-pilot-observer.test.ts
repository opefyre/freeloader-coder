import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { OwnerPilotObserver } from "../apps/core/src/owner-pilot-observer.js";
import { ProjectArtifactStore } from "../apps/core/src/project-artifact-store.js";

const projectId = `project_${"a".repeat(16)}`;

test("pilot observer derives milestones only from governed artifacts and passed preview evidence", async () => {
  const root = await mkdtemp(join(tmpdir(), "codkesh-pilot-observer-"));
  const artifacts = new ProjectArtifactStore();
  await artifacts.initialize(root);
  const context = await artifacts.read(root, "context");
  await artifacts.write(root, { kind: "context", body: context.body, producer: "test:context", expectedDigest: context.metadata.bodyDigest });
  const design = await artifacts.read(root, "design");
  await artifacts.write(root, { kind: "design", body: design.body, producer: "owner:test", expectedDigest: design.metadata.bodyDigest, approvedDigest: design.metadata.bodyDigest });
  const observedAt = Date.now();
  const observer = new OwnerPilotObserver(
    { canonicalRoot: async () => root } as never,
    { list: async () => [{ projectId, stage: "delivery", updatedAt: observedAt }] as never },
    { get: async () => ({ tasks: [{ liveJourneyEvidence: { passed: true, reference: "preview://local", revisionDigest: "a".repeat(40), observedAt } }] }) as never },
    artifacts,
    () => observedAt,
  );
  const observation = await observer.observe(projectId);
  assert.match(observation.contextDigest ?? "", /^[a-f0-9]{64}$/);
  assert.match(observation.approvedDesignDigest ?? "", /^[a-f0-9]{64}$/);
  assert.match(observation.previewEvidenceDigest ?? "", /^[a-f0-9]{64}$/);
  assert.equal(observation.observedAt, observedAt);
});

test("pilot observer never promotes template artifacts or failed previews", async () => {
  const root = await mkdtemp(join(tmpdir(), "codkesh-pilot-observer-"));
  const artifacts = new ProjectArtifactStore();
  await artifacts.initialize(root);
  const observer = new OwnerPilotObserver(
    { canonicalRoot: async () => root } as never,
    { list: async () => [] },
    { get: async () => null },
    artifacts,
    () => 100,
  );
  const observation = await observer.observe(projectId);
  assert.equal(observation.contextDigest, null);
  assert.equal(observation.approvedDesignDigest, null);
  assert.equal(observation.previewEvidenceDigest, null);
  assert.equal(observation.activityAt, 0);
});
