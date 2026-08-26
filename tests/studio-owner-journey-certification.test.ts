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
    "Pilot readiness",
    "Anonymous aggregates only",
    "At least 3 completed sessions",
    "Refresh evidence",
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
  assert.match(source, /getOwnerJourneyTrust/);
  assert.match(source, /tickOwnerJourneyTrust/);
  assert.doesNotMatch(source, /participantAlias.*trust\.learning|trust\.learning.*note/);
});

test("real pilot UI uses canonical reconciliation, one status, and local receipts instead of manual milestone claims", () => {
  assert.match(source, /reconcileOwnerPilot/);
  assert.match(source, /Verified progress/);
  assert.match(source, /Session receipt/);
  assert.doesNotMatch(source, /Mark context ready|Mark solution approved|Record first preview/);
  assert.match(client, /\/reconcile/);
  assert.match(client, /\/summary/);
  assert.match(client, /\/receipt/);
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
  assert.match(client, /\/api\/v1\/owner-journey-trust/);
  assert.match(source, /Download privacy-safe certification evidence/);
  assert.match(source, /getOwnerCertificationEvidence/);
  assert.match(source, /ownerCertificationEvidenceFilename/);
  assert.match(source, /URL\.createObjectURL/);
  assert.match(client, /\/api\/v1\/owner-certification-evidence/);
  assert.match(client, /codkesh-owner-evidence-/);
});

test("pilot improvements use one exact owner decision before Jira mutation", () => {
  for (const phrase of [
    "Jira improvement preview",
    "Review Jira handoff",
    "Save edits",
    "Approve and create",
    "Decline",
    "Retry remaining",
    "evidence receipt",
  ]) assert.match(source, new RegExp(phrase, "i"));
  assert.match(source, /expectedPreviewDigest: draft\.previewDigest/);
  assert.match(source, /expectedRevision: draft\.revision/);
  assert.match(source, /aria-label="Jira receipts"/);
  assert.match(source, /role="alert"/);
  for (const path of [
    "/api/v1/owner-pilot/improvements",
    "/edit",
    "/approve",
    "/decline",
  ]) assert.equal(client.includes(path), true, path);
});
