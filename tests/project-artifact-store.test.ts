import assert from "node:assert/strict";
import { mkdir, readFile, readdir, rm, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import { PROJECT_ARTIFACT_CONTRACTS, PROJECT_ARTIFACT_KINDS, ProjectArtifactError, ProjectArtifactStore } from "../apps/core/src/project-artifact-store.js";

test("publishes complete versioned ownership and dependency contracts", () => {
  assert.deepEqual(Object.keys(PROJECT_ARTIFACT_CONTRACTS), PROJECT_ARTIFACT_KINDS);
  for (const kind of PROJECT_ARTIFACT_KINDS) {
    const contract = PROJECT_ARTIFACT_CONTRACTS[kind];
    assert.equal(contract.kind, kind);
    assert.match(contract.fileName, /^[A-Z][A-Z-]+\.md$/);
    assert.ok(contract.owners.length > 0);
    assert.ok(contract.readers.includes("orchestrator"));
    assert.ok(contract.refreshTriggers.length > 0);
    assert.ok(contract.dependencies.every((dependency) => PROJECT_ARTIFACT_KINDS.includes(dependency)));
  }
});

test("initializes the complete governed artifact workspace without claiming unverified work", async () => {
  const root = join(process.cwd(), `.test-artifacts-${crypto.randomUUID()}`);
  await mkdir(root, { recursive: true });
  try {
    const artifacts = await new ProjectArtifactStore().initialize(root);
    assert.equal(artifacts.length, PROJECT_ARTIFACT_KINDS.length);
    assert.deepEqual(artifacts.map((artifact) => artifact.fileName), [
      "CONTEXT.md", "MEMORY.md", "RESEARCH.md", "PRODUCT.md", "DESIGN.md", "DELIVERY-PLAN.md",
      "OPS-RULES.md", "INFRA.md", "SECURITY.md", "DECISIONS.md", "STATUS.md",
    ]);
    assert.ok(artifacts.every((artifact) => artifact.metadata.revision === 1));
    assert.equal(artifacts.find((artifact) => artifact.metadata.kind === "status")?.metadata.approvalState, "not_required");
    assert.equal(artifacts.find((artifact) => artifact.metadata.kind === "design")?.metadata.approvalState, "pending");
    assert.ok(artifacts.every((artifact) => artifact.metadata.confidence === "unknown"));
    assert.match((await readFile(join(root, "STATUS.md"), "utf8")), /Project execution has not started/);
    assert.doesNotMatch((await readFile(join(root, "DESIGN.md"), "utf8")), /production-ready|complete solution/i);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("watcher reports verified and conflicting owner edits without polling", async () => {
  const root = join(process.cwd(), `.test-artifacts-${crypto.randomUUID()}`);
  await mkdir(root, { recursive: true });
  try {
    const store = new ProjectArtifactStore();
    await store.initialize(root);
    const changes: Array<{ fileName: string; state: string }> = [];
    const watcher = await store.watch(root, (change) => changes.push(change));
    const statusPath = join(root, "STATUS.md");
    await writeFile(statusPath, await readFile(statusPath, "utf8"), "utf8");
    await waitFor(() => changes.some((change) => change.fileName === "STATUS.md" && change.state === "verified"));
    await writeFile(statusPath, (await readFile(statusPath, "utf8")).replace("Complete project intake", "Manual unrecorded edit"), "utf8");
    await waitFor(() => changes.some((change) => change.fileName === "STATUS.md" && change.state === "conflict"));
    watcher.close();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("strict metadata rejects unknown fields while reading older v1 metadata safely", async () => {
  const root = join(process.cwd(), `.test-artifacts-${crypto.randomUUID()}`);
  await mkdir(root, { recursive: true });
  try {
    const store = new ProjectArtifactStore();
    await store.initialize(root);
    const path = join(root, "STATUS.md");
    const current = await readFile(path, "utf8");
    const legacy = current.replace(/,"confidence":"unknown","approvalState":"not_required"/, "");
    await writeFile(path, legacy, "utf8");
    assert.equal((await store.read(root, "status")).metadata.confidence, "unknown");
    await writeFile(path, current.replace('"schemaVersion":1', '"schemaVersion":1,"destructiveOverride":true'), "utf8");
    await assert.rejects(() => store.read(root, "status"), /unknown field/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("migrates an owner artifact without overwriting it and archives the original", async () => {
  const root = join(process.cwd(), `.test-artifacts-${crypto.randomUUID()}`);
  await mkdir(root, { recursive: true });
  await writeFile(join(root, "CONTEXT.md"), "# Owner context\n\nKeep this decision.\n", "utf8");
  try {
    const store = new ProjectArtifactStore();
    await store.initialize(root);
    const context = await store.read(root, "context");
    assert.equal(context.body, "# Owner context\n\nKeep this decision.");
    assert.equal(context.metadata.revision, 1);
    const archived = await readFile(join(root, ".codkesh", "artifacts", "CONTEXT.md", `000000-legacy-${context.metadata.bodyDigest}.md`), "utf8");
    assert.match(archived, /Keep this decision/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("uses expected digests to prevent silent concurrent overwrites and preserves history", async () => {
  const root = join(process.cwd(), `.test-artifacts-${crypto.randomUUID()}`);
  await mkdir(root, { recursive: true });
  try {
    const store = new ProjectArtifactStore();
    await store.initialize(root);
    const initial = await store.read(root, "memory");
    const first = await store.write(root, { kind: "memory", body: "# Project memory\n\n## Accepted knowledge\n\n- Local-first.\n\n## Owner preferences\n\n- None.\n\n## Lessons\n\n- None.\n\n## Unresolved knowledge\n\n- None.", producer: "codkesh:test", expectedDigest: initial.metadata.bodyDigest });
    assert.equal(first.metadata.revision, 2);
    assert.equal(first.metadata.supersedesDigest, initial.metadata.bodyDigest);
    await assert.rejects(
      () => store.write(root, { kind: "memory", body: "# Stale overwrite", producer: "codkesh:test", expectedDigest: initial.metadata.bodyDigest }),
      (error: unknown) => error instanceof ProjectArtifactError && error.code === "artifact-conflict",
    );
    const history = await readFile(join(root, ".codkesh", "artifacts", "MEMORY.md", `000001-${initial.metadata.bodyDigest}.md`), "utf8");
    assert.match(history, /No durable knowledge has been accepted/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("detects manual changes and rejects credential-like content", async () => {
  const root = join(process.cwd(), `.test-artifacts-${crypto.randomUUID()}`);
  await mkdir(root, { recursive: true });
  try {
    const store = new ProjectArtifactStore();
    await store.initialize(root);
    const security = await store.read(root, "security");
    await assert.rejects(
      () => store.write(root, { kind: "security", body: "# Security\n\napi_key=secret-value-123456789", producer: "codkesh:test", expectedDigest: security.metadata.bodyDigest }),
      (error: unknown) => error instanceof ProjectArtifactError && error.code === "sensitive-content",
    );
    const file = join(root, "STATUS.md");
    await writeFile(file, (await readFile(file, "utf8")).replace("Complete project intake", "Changed outside Codkesh"), "utf8");
    await assert.rejects(
      () => store.read(root, "status"),
      (error: unknown) => error instanceof ProjectArtifactError && error.code === "artifact-conflict",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("blocks a representative secret and personal-path corpus without echoing sensitive values", async () => {
  const root = join(process.cwd(), `.test-artifacts-${crypto.randomUUID()}`);
  await mkdir(root, { recursive: true });
  const corpus = [
    "api_key=secret-value-123456789",
    "ghp_abcdefghijklmnopqrstuvwxyz123456",
    "AKIAABCDEFGHIJKLMNOP",
    "Bearer abcdefghijklmnopqrstuvwxyz.123456",
    "eyJabcdefghijk.abcdefghijklmnop.abcdefghijklmnop",
    "-----BEGIN PRIVATE KEY-----",
    "password: dangerous-password-value",
    "/Users/private-owner/Projects/confidential",
    "/home/private-owner/confidential",
    "C:\\Users\\private-owner\\confidential",
  ];
  try {
    const store = new ProjectArtifactStore();
    await store.initialize(root);
    for (const secret of corpus) {
      const current = await store.read(root, "security");
      await assert.rejects(
        () => store.write(root, {
          kind: "security",
          body: `${current.body}\n\n${secret}`,
          producer: "codkesh:redaction-test",
          expectedDigest: current.metadata.bodyDigest,
        }),
        (error: unknown) => error instanceof ProjectArtifactError &&
          error.code === "sensitive-content" &&
          !error.message.includes(secret) &&
          !error.message.includes("private-owner"),
      );
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("normalizes citations, records provenance, and keeps browser inspection free of private paths", async () => {
  const root = join(process.cwd(), `.test-artifacts-${crypto.randomUUID()}`);
  await mkdir(root, { recursive: true });
  await writeFile(join(root, "source.txt"), "verified source\n", "utf8");
  try {
    const store = new ProjectArtifactStore();
    await store.initialize(root);
    const research = await store.read(root, "research");
    const written = await store.write(root, {
      kind: "research",
      body: research.body.replace("_Research has not started._", "- Validate cited evidence."),
      producer: "codkesh:research",
      expectedDigest: research.metadata.bodyDigest,
      confidence: "mixed",
      citations: [
        "source.txt", "source.txt", "https://example.com/evidence", "PIPE-604",
        "missing.txt", "/Users/private-owner/secret.txt", "../outside.txt", ".env", "http://localhost/private",
      ],
    });
    assert.equal(written.metadata.citations.length, 8);
    assert.deepEqual(
      written.metadata.citations.map(({ kind, state }) => `${kind}:${state}`),
      ["local:verified", "url:unverified", "jira:unverified", "local:invalid", "local:invalid", "local:invalid", "local:invalid", "url:invalid"],
    );
    assert.match(written.metadata.citations[0]?.digest ?? "", /^[a-f0-9]{64}$/);
    const serialized = JSON.stringify(await store.inspect(root));
    assert.doesNotMatch(serialized, new RegExp(root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.doesNotMatch(serialized, /private-owner|source\.txt|example\.com/);
    const summary = (await store.inspect(root)).find(({ kind }) => kind === "research");
    assert.deepEqual(summary?.citations, { verified: 1, unverified: 2, invalid: 5 });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("approved meaning cannot change silently and explicit revision withdrawal remains auditable", async () => {
  const root = join(process.cwd(), `.test-artifacts-${crypto.randomUUID()}`);
  await mkdir(root, { recursive: true });
  try {
    const store = new ProjectArtifactStore();
    await store.initialize(root);
    const initial = await store.read(root, "design");
    const approved = await store.write(root, {
      kind: "design", body: initial.body, producer: "owner:approval", expectedDigest: initial.metadata.bodyDigest,
      approvedDigest: initial.metadata.bodyDigest,
    });
    const changedBody = approved.body.replace("_Not yet designed._", "- A reviewed experience change.");
    await assert.rejects(
      () => store.write(root, { kind: "design", body: changedBody, producer: "codkesh:revision", expectedDigest: approved.metadata.bodyDigest }),
      (error: unknown) => error instanceof ProjectArtifactError && error.code === "artifact-unsafe",
    );
    const revised = await store.write(root, {
      kind: "design", body: changedBody, producer: "codkesh:revision", expectedDigest: approved.metadata.bodyDigest,
      approvedDigest: null,
    });
    assert.equal(revised.metadata.approvalState, "pending");
    assert.equal(revised.metadata.approvedDigest, null);
    assert.equal(revised.metadata.supersedesDigest, approved.metadata.bodyDigest);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("reconciles manual changes explicitly and preserves both recorded and manual evidence", async () => {
  const root = join(process.cwd(), `.test-artifacts-${crypto.randomUUID()}`);
  await mkdir(root, { recursive: true });
  try {
    const store = new ProjectArtifactStore();
    await store.initialize(root);
    const before = await store.read(root, "status");
    const path = join(root, "STATUS.md");
    await writeFile(path, (await readFile(path, "utf8")).replace("Complete project intake", "Owner changed the next action"), "utf8");
    const accepted = await store.reconcile(root, "status", "accept_manual", "owner:manual-reconciliation");
    assert.equal(accepted.metadata.revision, before.metadata.revision + 1);
    assert.equal(accepted.metadata.approvedDigest, null);
    assert.match(accepted.body, /Owner changed the next action/);
    const names = await readdir(join(root, ".codkesh", "artifacts", "STATUS.md"));
    assert.ok(names.some((name) => name.startsWith("manual-")));

    await writeFile(path, (await readFile(path, "utf8")).replace("Owner changed the next action", "Unreviewed edit"), "utf8");
    const restored = await store.reconcile(root, "status", "restore_recorded", "owner:restore");
    assert.equal(restored.metadata.bodyDigest, accepted.metadata.bodyDigest);
    assert.match(restored.body, /Owner changed the next action/);
    assert.doesNotMatch(restored.body, /Unreviewed edit/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("interrupted primary write leaves the last valid revision readable after restart", async () => {
  const root = join(process.cwd(), `.test-artifacts-${crypto.randomUUID()}`);
  await mkdir(root, { recursive: true });
  try {
    const healthy = new ProjectArtifactStore();
    await healthy.initialize(root);
    const before = await healthy.read(root, "memory");
    const interrupted = new ProjectArtifactStore({ faultAt: "before_primary_rename" });
    await assert.rejects(() => interrupted.write(root, {
      kind: "memory", body: "# Project memory\n\n## Accepted knowledge\n\n- Interrupted candidate.\n\n## Owner preferences\n\n- None.\n\n## Lessons\n\n- None.\n\n## Unresolved knowledge\n\n- None.",
      producer: "codkesh:crash-test", expectedDigest: before.metadata.bodyDigest,
    }), /Injected artifact write interruption/);
    const afterRestart = new ProjectArtifactStore();
    await afterRestart.initialize(root);
    const recovered = await afterRestart.read(root, "memory");
    assert.equal(recovered.metadata.bodyDigest, before.metadata.bodyDigest);
    assert.doesNotMatch(recovered.body, /Interrupted candidate/);
    assert.equal((await readdir(root)).some((name) => name.includes(".tmp-")), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("cross-process lock fails closed and stale lock recovery is bounded", async () => {
  const root = join(process.cwd(), `.test-artifacts-${crypto.randomUUID()}`);
  await mkdir(join(root, ".codkesh", "locks", "artifacts.lock"), { recursive: true });
  try {
    const blocked = new ProjectArtifactStore({ lockTimeoutMs: 40, staleLockMs: 60_000 });
    await assert.rejects(
      () => blocked.initialize(root),
      (error: unknown) => error instanceof ProjectArtifactError && error.code === "artifact-lock-timeout",
    );
    const old = new Date(Date.now() - 10_000);
    await utimes(join(root, ".codkesh", "locks", "artifacts.lock"), old, old);
    const recovered = new ProjectArtifactStore({ lockTimeoutMs: 100, staleLockMs: 100 });
    assert.equal((await recovered.initialize(root)).length, PROJECT_ARTIFACT_KINDS.length);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects unknown and unauthorized cross-artifact references", async () => {
  const root = join(process.cwd(), `.test-artifacts-${crypto.randomUUID()}`);
  await mkdir(root, { recursive: true });
  try {
    const store = new ProjectArtifactStore();
    await store.initialize(root);
    const research = await store.read(root, "research");
    await assert.rejects(() => store.write(root, {
      kind: "research", body: "# Research\n\nSee local://UNKNOWN.md", producer: "codkesh:test", expectedDigest: research.metadata.bodyDigest,
    }), /Unknown governed artifact reference/);
    await assert.rejects(() => store.write(root, {
      kind: "research", body: "# Research\n\nSee local://INFRA.md", producer: "codkesh:test", expectedDigest: research.metadata.bodyDigest,
    }), /cannot depend/);
    await assert.rejects(() => store.write(root, {
      kind: "research", body: "# Research\n\n## Arbitrary replacement\n\nNo governed sections.", producer: "codkesh:test", expectedDigest: research.metadata.bodyDigest,
    }), /stable-section profile/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

async function waitFor(predicate: () => boolean) {
  const deadline = Date.now() + 2_000;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("Timed out waiting for artifact watcher evidence.");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}
