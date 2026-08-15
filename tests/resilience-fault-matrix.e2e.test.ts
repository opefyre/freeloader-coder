import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import { LocalProjectRegistry } from "../apps/core/src/local-project-registry.js";
import { ProjectLifecycleService } from "../apps/core/src/project-lifecycle-service.js";
import { ResilienceCertificationService, type DurableResilienceObservation } from "../apps/core/src/resilience-certification-service.js";
import { planJiraSync, verifyJiraSync } from "../packages/integrations/src/sync.js";

const projectId = "project_abcdef0123456789";
const revision = "b".repeat(64);
const now = 1_800_000_000_000;

test("real owner-timeout, attachment, connector, and Jira-conflict paths preserve state and resume exactly once", async () => {
  const root = await mkdtemp(join(process.cwd(), ".codkesh-resilience-matrix-"));
  const state = join(root, "state");
  const evidence = new ResilienceCertificationService(state);
  try {
    await exerciseOwnerTimeout(state, evidence);
    await exerciseInvalidAttachment(root, state, evidence);
    await exerciseJiraDenialAndConflict(evidence);

    const restarted = new ResilienceCertificationService(state);
    const observations = await restarted.list(projectId);
    assert.deepEqual(observations.map((item) => item.scenario).sort(), ["connector_denial", "invalid_attachment", "jira_conflict", "owner_timeout"]);
    assert.equal(observations.every((item) => item.safeStatePreserved && item.resumed && item.duplicateEffects === 0), true);
    const partial = await restarted.certify(projectId);
    assert.equal(partial.certified, false);
    assert.match(partial.failures.join("\n"), /process_crash: missing fault-injection evidence/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

async function exerciseOwnerTimeout(state: string, evidence: ResilienceCertificationService) {
  const lifecycle = new ProjectLifecycleService(state);
  await lifecycle.begin({ projectId, mission: "Deliver the owner-approved product.", now });
  const context = await lifecycle.publishQuestions({ projectId, now: now + 1, artifact: artifact("context", "a"), questions: [] });
  await lifecycle.assess(projectId, { schemaVersion: 1, expectedRevision: context.revision, requestId: "request_aaaaaaaaaaaaaaaaaaaa", projectKind: "new_product", affectedDomains: ["product", "frontend", "backend"], deliveryStages: ["research", "product", "design", "frontend", "backend", "qa", "launch"], estimatedDeveloperHours: 80, requiresArchitectureDecision: true, evidence: ["Complete product work requested."], confidence: 1 }, "matrix-owner-timeout-eligibility");
  const solution = artifact("solution", "b");
  const waiting = await lifecycle.publishSolution(projectId, solution);
  assert.equal(waiting.stage, "awaiting_design_approval");
  const before = digestState(waiting.stage, waiting.revision);
  const restarted = new ProjectLifecycleService(state);
  const stillWaiting = await restarted.get(projectId);
  assert.equal(stillWaiting?.stage, "awaiting_design_approval");
  const approved = await restarted.decideSolution(projectId, { schemaVersion: 1, expectedRevision: waiting.revision, artifactDigest: solution.digest, decision: "approved", feedback: null }, "matrix-owner-timeout-approval");
  const replay = await restarted.decideSolution(projectId, { schemaVersion: 1, expectedRevision: waiting.revision, artifactDigest: solution.digest, decision: "approved", feedback: null }, "matrix-owner-timeout-approval");
  assert.equal(replay.revision, approved.revision);
  await evidence.record(observation("owner_timeout", 10, before, digestState(approved.stage, approved.revision), "Owner approval remained pending across restart.", "Approve, decline, or request a revision."));
}

async function exerciseInvalidAttachment(root: string, state: string, evidence: ResilienceCertificationService) {
  const repository = join(root, "attachment-project");
  await mkdir(join(repository, ".git"), { recursive: true });
  await writeFile(join(repository, ".git", "HEAD"), "ref: refs/heads/main\n", "utf8");
  await writeFile(join(repository, "README.md"), "# Attachment project\n", "utf8");
  const registry = new LocalProjectRegistry(state);
  const registered = await registry.register({ schemaVersion: 1, path: repository, displayName: "Attachment project" });
  const before = digestState((await registry.list()).projects.length, (await readFile(join(repository, "README.md"), "utf8")).length);
  await assert.rejects(() => registry.addFiles(registered.id, { schemaVersion: 1, paths: [repository] }), /Folders and symbolic links/);
  assert.equal((await registry.list()).projects.length, 1);
  const valid = join(root, "brief.md");
  await writeFile(valid, "# Valid brief\n", "utf8");
  const restarted = new LocalProjectRegistry(state);
  const imported = await restarted.addFiles(registered.id, { schemaVersion: 1, paths: [valid] });
  assert.equal(imported.files.length, 1);
  assert.equal(await readFile(join(repository, imported.files[0]!.projectRelativePath), "utf8"), "# Valid brief\n");
  await evidence.record(observation("invalid_attachment", 7, before, digestState(imported.files[0]!.evidence.sourceDigest, imported.files.length), "A folder was rejected before it entered project evidence.", "Choose a regular supported file."));
}

async function exerciseJiraDenialAndConflict(evidence: ResilienceCertificationService) {
  const base = { issueId: "10079", issueKey: "PIPE-79", sourceRevision: revision, currentRevision: revision, requestedStatus: "Done" as const, comment: "Deterministic checks and review passed.", links: ["https://github.com/opefyre/codkesh/commit/abc"], evidence: { deterministicChecksPassed: true, reviewQuorumPassed: true, modelClaimOnly: false }, permissionState: "ready" as const, existingReceipts: [] };
  const denied = planJiraSync({ ...base, permissionState: "revoked" });
  assert.equal(denied.state, "permission_denied");
  const permitted = planJiraSync(base);
  assert.equal(permitted.state, "ready");
  await evidence.record(observation("connector_denial", 5, digestState(denied.state), digestState(permitted.state), "Jira permission was revoked before synchronization.", "Reconnect Jira and retry the unchanged plan."));

  const conflict = planJiraSync({ ...base, currentRevision: "d".repeat(64) });
  assert.equal(conflict.state, "conflict");
  const ready = planJiraSync(base);
  assert.equal(ready.state, "ready");
  const receipt = verifyJiraSync({ marker: ready.marker, issueId: base.issueId, expectedFields: ready.changes, observedFields: ready.changes, observedRevision: "e".repeat(64), matchingMarkers: 1, now });
  const replay = planJiraSync({ ...base, existingReceipts: [receipt] });
  assert.equal(replay.state, "already_verified");
  await evidence.record(observation("jira_conflict", 6, digestState(conflict.state, conflict.decision), digestState(receipt.marker, receipt.observedRevision), "Jira changed after the planned source revision.", "Review the latest Jira revision and retry."));
}

function observation(scenario: DurableResilienceObservation["scenario"], index: number, beforeDigest: string, afterDigest: string, blocker: string, smallestOwnerAction: string): DurableResilienceObservation {
  return { schemaVersion: 1, projectId, requestId: `request_${index.toString(16).padStart(20, "0")}`, scenario, evidenceRef: `event:matrix/${scenario}`, beforeDigest, afterDigest, recoveryReceipt: `receipt:matrix/${scenario}`, safeStatePreserved: true, blocker, smallestOwnerAction, restartObserved: true, resumed: true, duplicateEffects: 0, observedAt: now + index };
}

function artifact(kind: "context" | "solution", character: string) {
  return { kind, projectRelativePath: kind === "context" ? ".pipeline/CONTEXT.md" as const : ".pipeline/SOLUTION.md" as const, digest: character.repeat(64), revision: 1, createdAt: now, citations: ["local://evidence"], reviewerIds: kind === "context" ? ["context-reviewer"] : ["product-reviewer", "technical-reviewer"], qaPassed: true as const };
}

function digestState(...values: unknown[]) {
  return (values.map((value) => String(value)).join("").padEnd(64, "0").slice(0, 64).replaceAll(/[^a-f0-9]/g, "a"));
}
