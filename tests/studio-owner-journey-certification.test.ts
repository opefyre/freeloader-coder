import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  "apps/studio/src/components/activity/owner-journey-certification-card.tsx",
  "utf8",
);
const app = readFileSync("apps/studio/src/App.tsx", "utf8");
const client = readFileSync(
  "apps/studio/src/owner-journey-certification-client.ts",
  "utf8",
);

test("Action Center owns a minimal honest certification and consented-learning experience", () => {
  assert.match(app, /OwnerJourneyCertificationCard = lazy/);
  assert.match(app, /<OwnerJourneyCertificationCard endpoint=\{endpoint\}/);
  for (const phrase of [
    "Owner-journey check",
    "Local, synthetic, and always $0",
    "Run check",
    "Record a real session",
    "explicitly consented",
    "anonymous",
    "external adoption",
  ])
    assert.equal(
      source.toLocaleLowerCase().includes(phrase.toLocaleLowerCase()),
      true,
      phrase,
    );
  assert.doesNotMatch(
    source,
    /api key|source code body|participant name|email address/i,
  );
  assert.match(source, /Complete session/);
  assert.match(source, /Withdraw consent/);
  assert.doesNotMatch(
    source,
    /saved=\{async \(\) => \{\s*setShowLearning\(false\)/,
  );
  assert.match(source, /saved=\{async \(message\) =>/);
});

test("certification UI and client preserve accessibility, responsive layout, privacy, and loopback boundaries", () => {
  for (const token of [
    'role="status"',
    'role="alert"',
    'aria-label="Certification stages"',
    "focus-visible:ring",
    "sm:grid-cols",
    "lg:grid-cols",
  ])
    assert.match(source, new RegExp(token));
  assert.match(client, /credentials: "omit"/);
  assert.match(client, /cache: "no-store"/);
  assert.match(client, /MAX_BYTES/);
  assert.match(client, /127\.0\.0\.1/);
  assert.match(client, /Idempotency-Key/);
});
