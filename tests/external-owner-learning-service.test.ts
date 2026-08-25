import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { ExternalOwnerLearningService } from "../apps/core/src/external-owner-learning-service.js";

test("consented owner learning is local, anonymous, durable, immutable after completion, and withdrawable", async () => {
  const root = await mkdtemp(join(tmpdir(), "codkesh-learning-"));
  const service = new ExternalOwnerLearningService(root);
  const startedAt = 1_800_000_000_000;
  const draft = await service.create(
    {
      participantAlias: "participant-a1b2c3",
      scenario: "new_product",
      consent: true,
      startedAt,
    },
    "learning.service.create.0001",
    startedAt,
  );
  assert.equal(draft.status, "draft");
  assert.equal(draft.synthetic, false);
  assert.equal(
    (
      await service.create(
        {
          participantAlias: "participant-a1b2c3",
          scenario: "new_product",
          consent: true,
          startedAt,
        },
        "learning.service.create.0001",
        startedAt,
      )
    ).id,
    draft.id,
  );
  const completed = await service.complete(draft.id, {
    expectedRevision: 1,
    completedAt: startedAt + 600_000,
    timeToPreviewSeconds: 420,
    trustRating: 4,
    frictions: ["clarity"],
    note: "Needed a clearer approval explanation.",
  });
  assert.equal(completed.status, "completed");
  await assert.rejects(
    () =>
      service.complete(draft.id, {
        expectedRevision: 2,
        completedAt: startedAt + 700_000,
        timeToPreviewSeconds: 500,
        trustRating: 5,
        frictions: [],
        note: "",
      }),
    /draft/,
  );
  const restarted = new ExternalOwnerLearningService(root);
  assert.equal(
    (await restarted.list()).sessions[0]?.evidenceDigest,
    completed.evidenceDigest,
  );
  const withdrawn = await restarted.withdraw(draft.id, 2);
  assert.equal(withdrawn.status, "withdrawn");
  assert.equal(withdrawn.note, "");
  assert.equal((await restarted.list()).automaticSpendLimitUsd, 0);
});

test("learning capture rejects missing consent, private notes, stale updates, future starts, and corrupt state", async () => {
  const root = await mkdtemp(join(tmpdir(), "codkesh-learning-"));
  const service = new ExternalOwnerLearningService(root);
  const now = 1_800_000_000_000;
  await assert.rejects(() =>
    service.create(
      {
        participantAlias: "participant-a1b2c3",
        scenario: "new_product",
        consent: false,
        startedAt: now,
      },
      "learning.service.create.0002",
      now,
    ),
  );
  await assert.rejects(
    () =>
      service.create(
        {
          participantAlias: "participant-a1b2c3",
          scenario: "new_product",
          consent: true,
          startedAt: now + 70_000,
        },
        "learning.service.create.0003",
        now,
      ),
    /future/,
  );
  const draft = await service.create(
    {
      participantAlias: "participant-a1b2c3",
      scenario: "major_feature",
      consent: true,
      startedAt: now,
    },
    "learning.service.create.0004",
    now,
  );
  await assert.rejects(
    () =>
      service.complete(draft.id, {
        expectedRevision: 2,
        completedAt: now + 100,
        timeToPreviewSeconds: 10,
        trustRating: 3,
        frictions: [],
        note: "",
      }),
    /changed/,
  );
  await assert.rejects(
    () =>
      service.complete(draft.id, {
        expectedRevision: 1,
        completedAt: now + 100,
        timeToPreviewSeconds: 10,
        trustRating: 3,
        frictions: [],
        note: "token=secret-value",
      }),
    /private/,
  );
  await writeFile(join(root, "external-owner-learning.json"), "{}\n", "utf8");
  await assert.rejects(
    () => new ExternalOwnerLearningService(root).list(),
    /corrupt/,
  );
});
