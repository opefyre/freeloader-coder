import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import { LocalProjectRegistry } from "../apps/core/src/local-project-registry.js";
import { PROJECT_ARTIFACT_KINDS, ProjectArtifactStore } from "../apps/core/src/project-artifact-store.js";
import { ProjectExecutionCoordinator } from "../apps/core/src/project-execution-coordinator.js";
import { ProjectExecutionService } from "../apps/core/src/project-execution-service.js";
import { ProjectLifecycleService } from "../apps/core/src/project-lifecycle-service.js";
import { completeDeliveryPlan } from "./delivery-plan-fixture.js";

const planDigest = "d".repeat(64);
const evidenceDigest = "e".repeat(64);
const taskId = "plan_0000000000000004";

for (const kind of ["new_product", "existing_product"] as const) {
  test(`${kind.replaceAll("_", " ")} golden journey is complete, durable, idempotent, and safely isolated`, async () => {
    const disposableRoot = await mkdtemp(join(process.cwd(), `.codkesh-${kind}-golden-`));
    const stateRoot = join(disposableRoot, "state");
    const workspace = join(disposableRoot, kind === "new_product" ? "new-product" : "existing-product");
    const evidence: Array<{ stage: string; reference: string }> = [];
    let preservedBefore: string | null = null;

    try {
      const registry = new LocalProjectRegistry(stateRoot);
      if (kind === "existing_product") {
        await seedExistingProject(workspace);
        preservedBefore = await digestFile(join(workspace, "src", "existing.ts"));
      }

      const project = kind === "new_product"
        ? await registry.create({
            schemaVersion: 1,
            displayName: "Golden product",
            idea: "Create a complete owner-approved product from one plain-language idea.",
            workspacePath: workspace,
          }, "golden:new-product:create")
        : await registry.register({ schemaVersion: 1, path: workspace, displayName: "Existing golden product" });
      evidence.push({ stage: "workspace", reference: project.id });

      const replayedProject = kind === "new_product"
        ? await registry.create({
            schemaVersion: 1,
            displayName: "Golden product",
            idea: "Create a complete owner-approved product from one plain-language idea.",
            workspacePath: workspace,
          }, "golden:new-product:create")
        : await registry.register({ schemaVersion: 1, path: workspace, displayName: "Existing golden product" });
      assert.equal(replayedProject.id, project.id);
      assert.equal((await registry.list()).projects.length, 1);

      const bound = await registry.setResources(project.id, {
        schemaVersion: 1,
        expectedRevision: 0,
        resources: [{
          kind: "jira_project",
          connectionId: "jira-golden-scope",
          resourceId: "PIPE-GOLDEN",
          label: "PIPE Golden Test Scope",
          url: "https://example.atlassian.net/jira/software/projects/PIPE-GOLDEN",
          role: "primary",
        }],
      });
      const jiraResource = bound.resources?.[0];
      assert.equal(jiraResource?.kind, "jira_project");
      assert.ok(jiraResource);
      evidence.push({ stage: "resources", reference: jiraResource.id });

      const artifacts = await new ProjectArtifactStore().list(workspace);
      assert.deepEqual(artifacts.map((artifact) => artifact.metadata.kind), [...PROJECT_ARTIFACT_KINDS]);
      assert.equal(artifacts.every((artifact) => artifact.metadata.bodyDigest.length === 64), true);
      evidence.push(...artifacts.map((artifact) => ({ stage: `artifact:${artifact.metadata.kind}`, reference: artifact.metadata.bodyDigest })));

      const lifecycle = new ProjectLifecycleService(stateRoot);
      let now = 100;
      const begun = await lifecycle.begin({ projectId: project.id, mission: "Deliver the approved major product outcome.", now: now++ });
      assert.equal((await lifecycle.begin({ projectId: project.id, mission: "Ignored replay", now: now++ })).revision, begun.revision);
      evidence.push({ stage: begun.stage, reference: String(begun.revision) });

      const context = await lifecycle.publishQuestions({ projectId: project.id, now: now++, artifact: lifecycleArtifact("context", "a"), questions: [] });
      evidence.push({ stage: context.stage, reference: String(context.revision) });
      const eligible = await lifecycle.assess(project.id, {
        schemaVersion: 1,
        expectedRevision: context.revision,
        requestId: kind === "new_product" ? "request_aaaaaaaaaaaaaaaaaaaa" : "request_bbbbbbbbbbbbbbbbbbbb",
        projectKind: kind,
        affectedDomains: ["product", "frontend", "backend", "infrastructure"],
        deliveryStages: ["research", "product", "design", "frontend", "backend", "infrastructure", "qa", "launch"],
        estimatedDeveloperHours: 120,
        requiresArchitectureDecision: true,
        evidence: [kind === "new_product" ? "A complete new product was requested." : "A major extension to an observed repository was requested."],
        confidence: 0.99,
      }, `golden:${kind}:eligibility`);
      assert.equal(eligible.decision.eligible, true);
      evidence.push({ stage: "eligibility", reference: eligible.decision.requestId });

      const solution = lifecycleArtifact("solution", "b");
      const awaitingApproval = await lifecycle.publishSolution(project.id, solution);
      const approved = await lifecycle.decideSolution(project.id, {
        schemaVersion: 1,
        expectedRevision: awaitingApproval.revision,
        artifactDigest: solution.digest,
        decision: "approved",
        feedback: null,
      }, `golden:${kind}:approval`);
      assert.equal((await lifecycle.decideSolution(project.id, {
        schemaVersion: 1,
        expectedRevision: awaitingApproval.revision,
        artifactDigest: solution.digest,
        decision: "approved",
        feedback: null,
      }, `golden:${kind}:approval`)).revision, approved.revision);
      evidence.push({ stage: approved.stage, reference: solution.digest });

      const backlog = lifecycleArtifact("backlog", "c");
      await lifecycle.publishBacklog(project.id, backlog);
      const delivery = await lifecycle.activateDelivery(project.id, backlog.digest, "PIPE-GOLDEN-1");
      evidence.push({ stage: delivery.stage, reference: delivery.jiraEpicId! });

      const reviewedPlan = deliveryPlan(project.id);
      const execution = executionService(stateRoot, project.id, reviewedPlan, lifecycle, () => now);
      const initialized = await execution.initialize(project.id);
      const replayedExecution = await execution.initialize(project.id);
      assert.equal(replayedExecution.tasks.length, initialized.tasks.length);
      assert.deepEqual(replayedExecution.tasks.map((task) => task.id), initialized.tasks.map((task) => task.id));
      evidence.push({ stage: "execution_initialized", reference: planDigest });
      const coordinator = new ProjectExecutionCoordinator(
        stateRoot,
        execution,
        goldenWorker(execution, project.id),
        () => now++,
        25,
        async (id) => { await lifecycle.completeDelivery(id); },
      );
      await coordinator.schedule(project.id);
      await waitFor(async () => (await coordinator.get(project.id))?.state === "completed");
      await coordinator.shutdown();
      evidence.push({ stage: "qa_and_completion", reference: evidenceDigest });

      assert.equal((await new ProjectLifecycleService(stateRoot).get(project.id))?.stage, "complete");
      assert.equal((await executionService(stateRoot, project.id, reviewedPlan, lifecycle).get(project.id))?.state, "completed");
      assert.equal(new Set(evidence.map((item) => item.stage)).size >= PROJECT_ARTIFACT_KINDS.length + 8, true);
      assert.equal(evidence.every((item) => item.reference.length > 0), true);

      if (kind === "existing_product") {
        assert.equal(await digestFile(join(workspace, "src", "existing.ts")), preservedBefore);
        assert.equal(await readFile(join(workspace, "package.json"), "utf8"), EXISTING_MANIFEST);
      }
    } finally {
      await rm(disposableRoot, { recursive: true, force: true });
      await assert.rejects(stat(disposableRoot), { code: "ENOENT" });
    }
  });
}

const EXISTING_MANIFEST = '{"name":"existing-golden","scripts":{"test":"node --test"}}\n';

async function seedExistingProject(workspace: string) {
  await mkdir(join(workspace, ".git"), { recursive: true });
  await mkdir(join(workspace, "src"), { recursive: true });
  await writeFile(join(workspace, ".git", "HEAD"), "ref: refs/heads/main\n", "utf8");
  await writeFile(join(workspace, "README.md"), "# Existing product\n\nOwner-authored application.\n", "utf8");
  await writeFile(join(workspace, "package.json"), EXISTING_MANIFEST, "utf8");
  await writeFile(join(workspace, "src", "existing.ts"), 'export const ownerCode = "preserve-me";\n', "utf8");
}

function lifecycleArtifact(kind: "context" | "solution" | "backlog", character: string) {
  return {
    kind,
    projectRelativePath: kind === "context" ? ".pipeline/CONTEXT.md" as const : kind === "solution" ? ".pipeline/SOLUTION.md" as const : ".pipeline/BACKLOG.md" as const,
    digest: character.repeat(64), revision: 1, createdAt: 100, citations: ["local://evidence"],
    reviewerIds: kind === "context" ? ["context-reviewer"] : ["product-reviewer", "technical-reviewer"], qaPassed: true as const,
  };
}

function deliveryPlan(projectId: string) {
  const plan = completeDeliveryPlan();
  return {
    ...plan,
    projectId,
    revision: 1,
    reviews: [
      { schemaVersion: 1 as const, reviewerId: "delivery-reviewer", discipline: "delivery" as const, verdict: "pass" as const, findings: [] },
      { schemaVersion: 1 as const, reviewerId: "technical-reviewer", discipline: "technical" as const, verdict: "pass" as const, findings: [] },
    ],
  };
}

function executionService(stateRoot: string, projectId: string, reviewedPlan: ReturnType<typeof deliveryPlan>, lifecycle: ProjectLifecycleService, now: () => number = () => 100) {
  return new ProjectExecutionService(stateRoot, {
    readDraft: async () => ({ draft: reviewedPlan, document: { schemaVersion: 1 as const, projectId, projectRelativePath: ".pipeline/BACKLOG.md" as const, revision: 1, digest: planDigest, markdown: "# Plan", itemCount: 4 } }),
  }, { get: async () => ({ completed: true, planDigest, issues: { [taskId]: { issueKey: "PIPE-GOLDEN-4" } } }) }, now, lifecycle);
}

function goldenWorker(execution: ProjectExecutionService, projectId: string) {
  return { tick: async () => {
    const candidate = { providerId: "groq", modelId: "coder", deviceId: "provider:groq", capabilities: ["chat", "structured_output", "tool_calling"], privacyClasses: ["source_code" as const], quotaAvailable: true, billingEnabled: false, activeRequests: 0, safeConcurrency: 1, availableMemoryMb: 8_000, requiredMemoryMb: 1_000, deviceLoad: 0.1, preference: 10 };
    const claim = await execution.claim(projectId, "golden-worker", [candidate]);
    const lease = claim.task!.lease!;
    await execution.recordImplementation(projectId, taskId, lease.leaseId, "golden-worker", evidenceDigest);
    await execution.recordValidation(projectId, taskId, lease.leaseId, "golden-worker", { tier: "fast", commandLabel: "fast", passed: true, exitCode: 0, evidenceDigest });
    await execution.recordValidation(projectId, taskId, lease.leaseId, "golden-worker", { tier: "full", commandLabel: "full", passed: true, exitCode: 0, evidenceDigest });
    await execution.recordReviews(projectId, taskId, lease.leaseId, "golden-worker", [review("functional", "gemini"), review("security", "cloudflare")]);
    await execution.recordIntegration(projectId, taskId, lease.leaseId, "golden-worker", { commitDigest: "1".repeat(40), integrationDigest: "2".repeat(64), validation: { tier: "integration", commandLabel: "integration", passed: true, exitCode: 0, evidenceDigest } });
    return execution.get(projectId);
  } };
}

function review(role: "functional" | "security", providerId: string) {
  return { reviewerId: `${providerId}-${role}`, providerId, role, verdict: "pass" as const, findings: [{ id: `${role}-pass`, severity: "info" as const, evidenceRef: evidenceDigest, confidence: 0.99, acceptanceCriterion: "Approved behavior is present.", recommendedRepair: "No repair required." }] };
}

async function digestFile(path: string) { return createHash("sha256").update(await readFile(path)).digest("hex"); }
async function waitFor(predicate: () => Promise<boolean>) { for (let index = 0; index < 100; index += 1) { if (await predicate()) return; await new Promise((resolve) => setTimeout(resolve, 10)); } throw new Error("Timed out waiting for golden journey completion."); }
