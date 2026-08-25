import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  CertificationServiceError,
  OwnerJourneyCertificationService,
} from "../apps/core/src/owner-journey-certification-service.js";
import type { OwnerJourneyCertificationReceipt } from "../packages/runtime/src/owner-journey-certification.js";

const digest = "a".repeat(64);
function receipt(id = digest): OwnerJourneyCertificationReceipt {
  return {
    schemaVersion: 1,
    certificationId: id,
    mode: "synthetic_zero_cost",
    outcome: "passed",
    startedAt: "2026-08-25T10:00:00.000Z",
    completedAt: "2026-08-25T10:00:01.000Z",
    durationMs: 1_000,
    suites: (["owner_mvp", "new_product", "existing_product"] as const).map(
      (suite) => ({ id: suite, outcome: "passed", evidenceDigest: digest }),
    ),
    stages: (
      [
        "plain_language_intake",
        "workspace_and_resources",
        "governed_artifacts",
        "context_and_eligibility",
        "solution_approval",
        "jira_backlog",
        "isolated_implementation",
        "deterministic_validation",
        "independent_review",
        "integration",
        "durable_completion",
      ] as const
    ).map((name) => ({ name, outcome: "passed", evidenceDigest: digest })),
    paidCalls: 0,
    externalEffects: 0,
    privacy: {
      prompts: false,
      sourceCode: false,
      attachments: false,
      credentials: false,
      absolutePaths: false,
      personalIdentifiers: false,
      privateJiraContent: false,
    },
    limitations: ["Synthetic evidence only."],
    nextAction: "Run one consented external-owner journey.",
  };
}

test("certification registry persists, replays idempotently, survives restart, and preserves passing evidence", async () => {
  const root = await mkdtemp(join(tmpdir(), "codkesh-certification-"));
  let calls = 0;
  const service = new OwnerJourneyCertificationService(root, async () => {
    calls += 1;
    return receipt();
  });
  assert.equal((await service.snapshot()).state, "not_run");
  assert.equal((await service.preview()).maximumCostUsd, 0);
  const first = await service.run("certification.service.0001");
  assert.equal(first.snapshot.state, "passed");
  assert.equal(calls, 1);
  const replay = await service.run("certification.service.0001");
  assert.equal(replay.outcome, "replayed");
  assert.equal(calls, 1);
  const restarted = new OwnerJourneyCertificationService(root, async () =>
    receipt("b".repeat(64)),
  );
  assert.equal(
    (await restarted.snapshot()).lastPassedReceipt?.certificationId,
    digest,
  );
  await assert.rejects(
    new OwnerJourneyCertificationService(root, async () => {
      throw new Error("failed");
    }).run("certification.service.0002"),
    (error: unknown) =>
      error instanceof CertificationServiceError && error.code === "failed",
  );
  const failed = await restarted.snapshot();
  assert.equal(failed.lastPassedReceipt?.certificationId, digest);
});

test("certification registry coalesces concurrent work and fails closed on corrupt or private evidence", async () => {
  const root = await mkdtemp(join(tmpdir(), "codkesh-certification-"));
  let release!: () => void;
  let calls = 0;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const service = new OwnerJourneyCertificationService(root, async () => {
    calls += 1;
    await gate;
    return receipt();
  });
  const one = service.run("certification.concurrent.0001");
  const two = service.run("certification.concurrent.0002");
  release();
  assert.equal((await one).snapshot.state, "passed");
  assert.equal((await two).snapshot.state, "passed");
  assert.equal(calls, 1);
  await writeFile(
    join(root, "owner-journey-certification.json"),
    "{}\n",
    "utf8",
  );
  await assert.rejects(
    () => new OwnerJourneyCertificationService(root).snapshot(),
    /corrupt/i,
  );
  const privateRoot = await mkdtemp(join(tmpdir(), "codkesh-certification-"));
  await assert.rejects(() =>
    new OwnerJourneyCertificationService(privateRoot, async () => ({
      ...receipt(),
      limitations: ["/Users/private/project"],
    })).run("certification.private.0001"),
  );
});
