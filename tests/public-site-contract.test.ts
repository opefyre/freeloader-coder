import assert from "node:assert/strict";
import test from "node:test";

import { demoStages, publicClaims, repositoryUrl } from "../apps/site/src/claims.js";

test("public claims are unique, sourced, and explicit about bounded outcomes", () => {
  assert.equal(new Set(publicClaims.map((claim) => claim.id)).size, publicClaims.length);
  assert.ok(publicClaims.every((claim) => claim.source.startsWith(repositoryUrl) || claim.source === "https://pipeline-studio.pages.dev/"));
  assert.ok(publicClaims.every((claim) => claim.detail.length >= 40));
  assert.equal(publicClaims.find((claim) => claim.id === "paid")?.status, "unavailable");
  assert.equal(publicClaims.find((claim) => claim.id === "launch")?.status, "verified");
  assert.match(publicClaims.find((claim) => claim.id === "launch")?.detail ?? "", /adoption.*not yet claimed/i);
  assert.match(publicClaims.find((claim) => claim.id === "providers")?.detail ?? "", /vary/i);
  assert.match(publicClaims.find((claim) => claim.id === "free-first")?.detail ?? "", /silently/i);
});

test("interactive walkthrough is complete, ordered, and stops before external effects", () => {
  assert.deepEqual(demoStages.map((stage) => stage.id), ["request", "plan", "work", "validate", "review", "apply"]);
  assert.equal(new Set(demoStages.map((stage) => stage.evidence)).size, demoStages.length);
  assert.ok(demoStages.every((stage) => stage.detail.length >= 70));
  assert.match(demoStages.at(-1)?.detail ?? "", /ends before any external write/i);
});
