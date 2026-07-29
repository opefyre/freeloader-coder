import assert from "node:assert/strict";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import {
  LocalRequestError,
  LocalRequestStore,
} from "../apps/core/src/local-request-store.js";

const projectId = "project_0123456789abcdef";

test("request store persists idempotently, serializes mutations, and archives terminal work", async () => {
  const root = join(process.cwd(), `.test-requests-${crypto.randomUUID()}`);
  try {
    const store = new LocalRequestStore(root, async (id) => id === projectId);
    const first = await store.create(
      { schemaVersion: 1, projectId, outcome: "Build the real request queue." },
      "request:0123456789"
    );
    const replay = await store.create(
      { schemaVersion: 1, projectId, outcome: "Build the real request queue." },
      "request:0123456789"
    );
    assert.equal(replay.id, first.id);
    assert.equal((await store.list()).requests.length, 1);
    assert.equal((await new LocalRequestStore(root, async () => true).list()).requests.length, 1);

    const cancelled = await store.cancel(first.id);
    assert.equal(cancelled.state, "cancelled");
    assert.equal((await store.cancel(first.id)).state, "cancelled");
    await store.archive(first.id);
    assert.equal((await store.list()).requests.length, 0);

    const lifecycle = await store.create(
      { schemaVersion: 1, projectId, outcome: "Prove a zero-effect execution handoff." },
      "request:lifecycle1"
    );
    const approved = await store.approve(lifecycle.id);
    assert.equal(approved.state, "approved");
    assert.equal(approved.run?.contract.allowedEffects.length, 0);
    assert.equal(approved.run?.contract.maximumCostUsd, 0);
    assert.equal((await store.approve(lifecycle.id)).run?.contract.digest, approved.run?.contract.digest);
    const claimed = await store.claim(lifecycle.id);
    assert.equal(claimed.state, "claimed");
    assert.equal(claimed.run?.lease?.owner, "local_zero_effect_coordinator");
    assert.equal((await store.claim(lifecycle.id)).run?.lease?.id, claimed.run?.lease?.id);
    const checkpointed = await store.checkpoint(lifecycle.id);
    assert.equal(checkpointed.state, "checkpointed");
    assert.equal((await store.checkpoint(lifecycle.id)).run?.events.length, 3);
    const completed = await store.release(lifecycle.id);
    assert.equal(completed.state, "completed");
    assert.equal((await store.release(lifecycle.id)).run?.events.length, 4);
    assert.equal(completed.run?.lease, null);
    assert.deepEqual(
      completed.run?.events.map((event) => event.sequence),
      [1, 2, 3, 4]
    );
    await store.archive(lifecycle.id);
    assert.equal((await store.list()).requests.length, 0);

    const directoryMode = (await stat(root)).mode & 0o777;
    const fileMode = (await stat(join(root, "local-requests.json"))).mode & 0o777;
    assert.equal(directoryMode, 0o700);
    assert.equal(fileMode, 0o600);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("request store fails closed for unknown projects, secrets, conflicts, and corruption", async () => {
  const root = join(process.cwd(), `.test-requests-${crypto.randomUUID()}`);
  try {
    const store = new LocalRequestStore(root, async () => false);
    await assert.rejects(
      () => store.create(
        { schemaVersion: 1, projectId, outcome: "Build the real request queue." },
        "request:0123456789"
      ),
      (error: unknown) =>
        error instanceof LocalRequestError && error.code === "project_not_found"
    );
    const accepting = new LocalRequestStore(root, async () => true);
    await assert.rejects(
      () => accepting.create(
        { schemaVersion: 1, projectId, outcome: "api_key=secret-value" },
        "request:abcdefghijk"
      ),
      (error: unknown) =>
        error instanceof LocalRequestError && error.code === "sensitive_material"
    );
    await accepting.create(
      { schemaVersion: 1, projectId, outcome: "Build request intake." },
      "request:conflict01"
    );
    await assert.rejects(
      () => accepting.create(
        { schemaVersion: 1, projectId, outcome: "Build something else." },
        "request:conflict01"
      ),
      (error: unknown) =>
        error instanceof LocalRequestError && error.code === "idempotency_conflict"
    );
    await writeFile(join(root, "local-requests.json"), "{broken", "utf8");
    await assert.rejects(
      () => accepting.list(),
      (error: unknown) =>
        error instanceof LocalRequestError && error.code === "store_invalid"
    );
    assert.equal(await readFile(join(root, "local-requests.json"), "utf8"), "{broken");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
