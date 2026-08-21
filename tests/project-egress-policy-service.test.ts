import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { ProjectEgressDeniedError, ProjectEgressPolicyService } from "../apps/core/src/project-egress-policy-service.js";

const projectId = "project_abcdef0123456789";
const digest = "a".repeat(64);

test("project egress consent is explicit, digest-bound, expiring, private, and revocable", async () => {
  const root = await mkdtemp(join(tmpdir(), "project-egress-"));
  let now = 1_800_000_000_000;
  try {
    const service = new ProjectEgressPolicyService(root, () => now);
    await assert.rejects(() => service.authorize(projectId, digest), ProjectEgressDeniedError);
    const permit = await service.grant(projectId, { schemaVersion: 1, contextDigest: digest, dataClass: "source_code", providerIds: ["groq", "groq", "mistral"], expiresAt: now + 86_400_000, acknowledgment: "I authorize this exact project context for the selected free providers." });
    assert.deepEqual(permit.providerIds, ["groq", "mistral"]);
    assert.equal((await service.authorize(projectId, digest)).contextDigest, digest);
    await assert.rejects(() => service.authorize(projectId, "b".repeat(64)), /context changed/);
    const state = await readFile(join(root, "project-egress-policies.json"), "utf8");
    assert.doesNotMatch(state, /credential|secret|token/i);
    now += 86_400_001;
    await assert.rejects(() => service.authorize(projectId, digest), /expired/);
    await service.revoke(projectId);
    assert.equal(await service.get(projectId), null);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("consent rejects silent acknowledgments and unbounded duration", async () => {
  const root = await mkdtemp(join(tmpdir(), "project-egress-invalid-"));
  const now = 1_800_000_000_000;
  try {
    const service = new ProjectEgressPolicyService(root, () => now);
    await assert.rejects(() => service.grant(projectId, { schemaVersion: 1, contextDigest: digest, dataClass: "source_code", providerIds: ["groq"], expiresAt: now + 1_000, acknowledgment: true }));
    await assert.rejects(() => service.grant(projectId, { schemaVersion: 1, contextDigest: digest, dataClass: "source_code", providerIds: ["groq"], expiresAt: now + 32 * 86_400_000, acknowledgment: "I authorize this exact project context for the selected free providers." }), /within 31 days/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("standing owner authorization refreshes a digest-bound permit from the current free-provider pool", async () => {
  const root = await mkdtemp(join(tmpdir(), "project-egress-defaults-"));
  let now = 1_800_000_000_000;
  let providers: readonly string[] = ["mistral", "groq", "groq"];
  try {
    const service = new ProjectEgressPolicyService(root, () => now, async () => providers);
    const first = await service.authorize(projectId, digest);
    assert.deepEqual(first.providerIds, ["groq", "mistral"]);
    assert.equal(first.dataClass, "source_code");
    assert.equal(first.expiresAt, now + 31 * 86_400_000);

    providers = ["gemini"];
    assert.deepEqual((await service.authorize(projectId, digest)).providerIds, ["groq", "mistral"]);
    const changed = await service.authorize(projectId, "b".repeat(64));
    assert.deepEqual(changed.providerIds, ["gemini"]);
    assert.equal(changed.contextDigest, "b".repeat(64));

    now += 31 * 86_400_000 + 1;
    providers = [];
    await assert.rejects(() => service.authorize(projectId, "b".repeat(64)), /No eligible free provider/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
