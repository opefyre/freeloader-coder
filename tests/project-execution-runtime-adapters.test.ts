import assert from "node:assert/strict";
import test from "node:test";

import { ProjectExecutionRuntimeAdapters } from "../apps/core/src/project-execution-runtime-adapters.js";
import type { ExecutionCandidate, ExecutionTask } from "../packages/orchestration/src/project-execution.js";
import { completeDeliveryPlan } from "./delivery-plan-fixture.js";

const projectId = "project_abcdef0123456789";
const digest = "d".repeat(64);
const taskId = "plan_0000000000000004";
const implementer = candidate("groq", "provider:implementation");
const reviewer = candidate("gemini", "provider:review");
const secondReviewer = candidate("cloudflare", "provider:second-review");

test("runtime adapter joins exact provider output, bounded workspace, validation, reviews, integration, and Jira observation", async () => {
  const calls: string[] = [];
  let sawToolchainContext = false;
  const workspace = { projectId, taskId, root: "/isolated", branch: "studio/task", baseline: "a".repeat(40), authorityDigest: digest };
  const model = {
    candidates: async (_permit: unknown, role: string) => role === "implementer" ? [implementer] : [reviewer, secondReviewer],
    run: async (input: any) => {
      calls.push(`model:${input.role}:${input.taskId}`);
      if (input.role === "implementer") {
        const instruction = JSON.parse(input.instruction);
        assert.equal(input.sources.some((source: { name: string }) => source.name === `delivery-plan://${taskId}`), true);
        assert.deepEqual(input.responseSchema.properties.operations.items.properties.path.enum, ["src/workflow.ts"]);
        assert.deepEqual(input.responseSchema.properties.operations.items.properties.citations.items.enum, ["src/workflow.ts", `delivery-plan://${taskId}`]);
        assert.equal(input.responseSchema.properties.summary.maxLength, 500);
        assert.match(instruction.toolchainCompatibilityRule, /when it runs node --test, import test from node:test and import assert from node:assert\/strict/);
        assert.match(instruction.toolchainCompatibilityRule, /node:test has no named strict assertion export/);
        assert.match(instruction.toolchainCompatibilityRule, /react-dom\/client does not export createElement/);
        assert.match(instruction.toolchainCompatibilityRule, /querySelector may return null/);
        assert.match(instruction.toolchainCompatibilityRule, /Never import a test framework that the configured command does not launch/);
        assert.match(instruction.toolchainCompatibilityRule, /NodeNext and Node16 require the emitted \.js suffix/);
        assert.match(instruction.toolchainCompatibilityRule, /when browser globals are not declared, use globalThis\.document/);
        assert.match(instruction.toolchainCompatibilityRule, /A \.ts file cannot contain JSX syntax/);
        assert.match(instruction.authorityRule, /Never import a project-local module unless that module is present in the supplied sources/);
        assert.match(instruction.authorityRule, /declare and export it inside an allowed implementation file/);
        return { providerId: "groq", modelId: "coder", artifactDigest: "a".repeat(64), response: { summary: "Update feature", operations: [{ type: "replace", path: "src/workflow.ts", content: "export const value = 2;\n", citations: ["src/workflow.ts"], rationale: "Meet the approved behavior." }] } };
      }
      const instruction = JSON.parse(input.instruction);
      assert.deepEqual(instruction.currentValidationEvidence.map((item: { tier: string; passed: boolean }) => ({ tier: item.tier, passed: item.passed })), [{ tier: "fast", passed: true }, { tier: "full", passed: true }]);
      assert.equal(instruction.validationHistory.length, 3);
      assert.match(input.system, /Historical validation failures.*superseded/);
      const role = input.taskId.endsWith("security") ? "security" : "functional";
      return { providerId: input.assignment.providerId, modelId: "reviewer", artifactDigest: "b".repeat(64), response: { reviewerId: `${role}-reviewer`, verdict: "pass", findings: [{ id: `${role}-1`, severity: "info", evidenceRef: digest, confidence: 0.99, acceptanceCriterion: "Approved behavior is present.", recommendedRepair: role === "functional" ? "" : "No repair is required." }] } };
    },
  };
  const workspaces = {
    prepare: async () => { calls.push("prepare"); return workspace; },
    sources: async (_workspace: unknown, sourceTask: ExecutionTask) => {
      if (sourceTask.allowedFiles.includes("package.json")) sawToolchainContext = true;
      return [{ path: "src/workflow.ts", content: "export const value = 1;\n", digest: "c".repeat(64) }];
    },
    apply: async (_workspace: unknown, _task: unknown, operations: any[]) => { calls.push("apply"); assert.equal(operations[0].expectedBeforeDigest, "c".repeat(64)); return { changedFiles: ["src/workflow.ts"], evidenceDigest: "e".repeat(64) }; },
    validate: async () => [{ profile: "unit", passed: true, exitCode: 0, output: "ok", evidenceDigest: digest }],
    validateCommit: async () => [{ profile: "unit", passed: true, exitCode: 0, output: "clean", evidenceDigest: digest }],
    commit: async () => ({ commitDigest: "f".repeat(40), evidenceDigest: digest }),
    integrate: async () => ({ integrationDigest: digest }),
    revertIntegration: async () => { throw new Error("must not revert passing integration"); },
  };
  const permit = { schemaVersion: 1 as const, projectId, contextDigest: "a".repeat(64), dataClass: "source_code" as const, providerIds: ["groq", "gemini"], approvedAt: 1, expiresAt: 999_999 };
  const adapters = new ProjectExecutionRuntimeAdapters(
    { canonicalRoot: async () => "/canonical" }, { readDraft: async () => ({ draft: { ...completeDeliveryPlan(), revision: 1, reviews: [{ schemaVersion: 1, reviewerId: "delivery-reviewer", discipline: "delivery", verdict: "pass", findings: [] }, { schemaVersion: 1, reviewerId: "technical-reviewer", discipline: "technical", verdict: "pass", findings: [] }] } as any }) },
    { readVerified: async () => ({ digest: permit.contextDigest }) }, { authorize: async () => permit }, model, workspaces as any,
    { synchronize: async () => { calls.push("jira"); } }
  );
  const task = executionTask();
  assert.equal((await adapters.candidates(projectId, task))[0]?.providerId, "groq");
  assert.equal((await adapters.healingPolicy(projectId, task)).maxAttempts, 5);
  assert.equal((await adapters.healingPolicy(projectId, { ...task, attempt: 7 })).maxAttempts, 5);
  assert.equal((await adapters.healingPolicy(projectId, { ...task, attempt: 9 })).maxAttempts, 5);
  const implementation = await adapters.implement(projectId, task, 0);
  assert.deepEqual(implementation.changedFiles, ["src/workflow.ts"]);
  assert.equal((await adapters.validate(projectId, task, "fast")).passed, true);
  const reviews = await adapters.review(projectId, { ...task, validations: [{ tier: "fast", commandLabel: "unit", passed: false, exitCode: 1, evidenceDigest: "e".repeat(64), observedAt: 1 }, { tier: "fast", commandLabel: "unit", passed: true, exitCode: 0, evidenceDigest: digest, observedAt: 2 }, { tier: "full", commandLabel: "unit", passed: true, exitCode: 0, evidenceDigest: digest, observedAt: 3 }] });
  assert.deepEqual(reviews.map((item) => item.role), ["functional", "security"]);
  assert.deepEqual(reviews.map((item) => item.providerId), ["gemini", "cloudflare"]);
  assert.equal(reviews[0]?.findings[0]?.recommendedRepair, "No repair required.");
  assert.equal((await adapters.integrate(projectId, task)).validation.passed, true);
  await adapters.observe(projectId);
  assert.equal(sawToolchainContext, true);
  assert.deepEqual(calls, ["prepare", `model:implementer:${taskId}`, "apply", `model:reviewer:${taskId}-functional`, `model:reviewer:${taskId}-security`, "jira"]);
});

test("runtime adapter grounds a first source file in the reviewed delivery task", async () => {
  const workspace = { projectId, taskId, root: "/isolated", branch: "studio/task", baseline: "a".repeat(40), authorityDigest: digest };
  let applied = false;
  const model = {
    candidates: async () => [implementer],
    run: async (input: any) => {
      assert.deepEqual(input.sources.map((source: { name: string }) => source.name), [`delivery-plan://${taskId}`]);
      return { providerId: "groq", modelId: "coder", artifactDigest: "a".repeat(64), response: { summary: "Create first feature", operations: [{ type: "replace", path: "src/workflow.ts", content: "export const value = 1;\n", citations: [`delivery-plan://${taskId}`], rationale: "Implement the reviewed task." }] } };
    },
  };
  const permit = { schemaVersion: 1 as const, projectId, contextDigest: "a".repeat(64), dataClass: "source_code" as const, providerIds: ["groq"], approvedAt: 1, expiresAt: 999_999 };
  const workspaces = {
    prepare: async () => workspace,
    sources: async () => [],
    apply: async (_workspace: unknown, _task: unknown, operations: any[]) => { applied = true; assert.equal(operations[0].type, "create"); assert.equal(operations[0].expectedBeforeDigest, null); return { changedFiles: ["src/workflow.ts"], evidenceDigest: "e".repeat(64) }; },
  };
  const adapters = new ProjectExecutionRuntimeAdapters(
    { canonicalRoot: async () => "/canonical" },
    { readDraft: async () => ({ draft: { ...completeDeliveryPlan(), revision: 1, reviews: [] } as any }) },
    { readVerified: async () => ({ digest: permit.contextDigest }) },
    { authorize: async () => permit }, model, workspaces as any,
    { synchronize: async () => undefined }
  );
  const result = await adapters.implement(projectId, executionTask(), 0);
  assert.equal(applied, true);
  assert.deepEqual(result.changedFiles, ["src/workflow.ts"]);
});

test("runtime adapter rejects JSX in a .ts proposal before workspace mutation", async () => {
  const workspace = { projectId, taskId, root: "/isolated", branch: "studio/task", baseline: "a".repeat(40), authorityDigest: digest };
  let applied = false;
  const permit = { schemaVersion: 1 as const, projectId, contextDigest: "a".repeat(64), dataClass: "source_code" as const, providerIds: ["groq"], approvedAt: 1, expiresAt: 999_999 };
  const adapters = new ProjectExecutionRuntimeAdapters(
    { canonicalRoot: async () => "/canonical" },
    { readDraft: async () => ({ draft: completeDeliveryPlan() as any }) },
    { readVerified: async () => ({ digest: permit.contextDigest }) },
    { authorize: async () => permit },
    { candidates: async () => [implementer], run: async () => ({ providerId: "groq", modelId: "coder", artifactDigest: digest, response: { summary: "Invalid JSX proposal", operations: [{ type: "replace", path: "src/workflow.ts", content: "export const view = <main />;\n", citations: ["src/workflow.ts"], rationale: "Render the owner view." }] } }) },
    { prepare: async () => workspace, sources: async () => [{ path: "src/workflow.ts", content: "export const value = 1;\n", digest: "c".repeat(64) }], apply: async () => { applied = true; throw new Error("must not apply"); } } as any,
    { synchronize: async () => undefined },
  );
  await assert.rejects(() => adapters.implement(projectId, executionTask(), 0), /failed strict response contract.*invalid TypeScript syntax/);
  assert.equal(applied, false);
});

test("a rejected implementation cycle rotates to another eligible free provider", async () => {
  const permit = { schemaVersion: 1 as const, projectId, contextDigest: "a".repeat(64), dataClass: "source_code" as const, providerIds: ["groq", "gemini"], approvedAt: 1, expiresAt: 999_999 };
  const adapters = new ProjectExecutionRuntimeAdapters(
    { canonicalRoot: async () => "/canonical" },
    { readDraft: async () => ({ draft: completeDeliveryPlan() as any }) },
    { readVerified: async () => ({ digest: permit.contextDigest }) },
    { authorize: async () => permit },
    { candidates: async () => [implementer, reviewer], run: async () => { throw new Error("not used"); } },
    {} as any,
    { synchronize: async () => undefined },
  );
  const rejectedAttempt = {
    approvalId: "approval_11111111111111111111",
    priorRevision: 1,
    implementerProviderId: "groq",
    implementationEvidence: [digest],
    validations: [],
    reviews: [],
    rationale: "The generated source did not parse.",
    decidedAt: 1,
  };
  const candidates = await adapters.candidates(projectId, { ...executionTask(), reviewAttempts: [rejectedAttempt] });
  assert.deepEqual(candidates.map((candidate) => candidate.providerId), ["gemini"]);
});

test("scaffold implementation requires project-wide test discovery", async () => {
  let instruction = "";
  const workspace = { projectId, taskId, root: "/isolated", branch: "studio/task", baseline: "a".repeat(40), authorityDigest: digest };
  const permit = { schemaVersion: 1 as const, projectId, contextDigest: "a".repeat(64), dataClass: "source_code" as const, providerIds: ["groq"], approvedAt: 1, expiresAt: 999_999 };
  const scaffoldTask = { ...executionTask(), allowedFiles: ["package.json", "tests/scaffold.test.ts"] };
  const adapters = new ProjectExecutionRuntimeAdapters(
    { canonicalRoot: async () => "/canonical" },
    { readDraft: async () => ({ draft: { ...completeDeliveryPlan(), revision: 1, reviews: [], items: [{ ...completeDeliveryPlan().items[0]!, id: taskId, allowedFiles: scaffoldTask.allowedFiles }] } as any }) },
    { readVerified: async () => ({ digest: permit.contextDigest }) },
    { authorize: async () => permit },
    { candidates: async () => [implementer], run: async (input: any) => { instruction = input.instruction; return { providerId: "groq", modelId: "coder", artifactDigest: digest, response: { summary: "Create complete scaffold", operations: [{ type: "create", path: "package.json", content: "{}\n", citations: [`delivery-plan://${taskId}`], rationale: "Create manifest." }, { type: "create", path: "tests/scaffold.test.ts", content: "export {};\n", citations: [`delivery-plan://${taskId}`], rationale: "Create test." }] } }; } },
    { prepare: async () => workspace, sources: async () => [], apply: async () => ({ changedFiles: scaffoldTask.allowedFiles, evidenceDigest: digest }) } as any,
    { synchronize: async () => undefined },
  );
  await adapters.implement(projectId, scaffoldTask, 0);
  assert.match(instruction, /complete current and future test suite/);
  assert.match(instruction, /must never name only tests\/scaffold\.test\.ts/);
  assert.match(instruction, /Every package imported by lint, compiler, test, or build configuration must be declared/);
  assert.match(instruction, /configuration APIs must match the declared package versions/);
  assert.match(instruction, /\.pipeline\/, \.codkesh\/, and governed root Markdown documents/);
});

test("healing normalizes a grounded create proposal into a stale-safe replacement", async () => {
  const workspace = { projectId, taskId, root: "/isolated", branch: "studio/task", baseline: "a".repeat(40), authorityDigest: digest };
  let observedType = "";
  const permit = { schemaVersion: 1 as const, projectId, contextDigest: "a".repeat(64), dataClass: "source_code" as const, providerIds: ["groq"], approvedAt: 1, expiresAt: 999_999 };
  const adapters = new ProjectExecutionRuntimeAdapters(
    { canonicalRoot: async () => "/canonical" },
    { readDraft: async () => ({ draft: { ...completeDeliveryPlan(), revision: 1, reviews: [] } as any }) },
    { readVerified: async () => ({ digest: permit.contextDigest }) },
    { authorize: async () => permit },
    { candidates: async () => [implementer], run: async () => ({ providerId: "groq", modelId: "coder", artifactDigest: "a".repeat(64), response: { summary: "Repair observed file", operations: [{ type: "create", path: "src/workflow.ts", content: "export const value = 2;\n", citations: [`delivery-plan://${taskId}`, "src/workflow.ts"], rationale: "Repair the observed implementation." }] } }) },
    { prepare: async () => workspace, sources: async () => [{ path: "src/workflow.ts", content: "export const value = 1;\n", digest }], apply: async (_workspace: unknown, _task: unknown, operations: any[]) => { observedType = operations[0].type; assert.equal(operations[0].expectedBeforeDigest, digest); return { changedFiles: ["src/workflow.ts"], evidenceDigest: digest }; } } as any,
    { synchronize: async () => undefined }
  );
  await adapters.implement(projectId, executionTask(), 1);
  assert.equal(observedType, "replace");
});

test("validation-only recovery preserves the verified workspace instead of erasing prior implementation", async () => {
  const workspace = { projectId, taskId, root: "/isolated", branch: "studio/task", baseline: "a".repeat(40), authorityDigest: digest };
  let resets = 0;
  const permit = { schemaVersion: 1 as const, projectId, contextDigest: "a".repeat(64), dataClass: "source_code" as const, providerIds: ["groq"], approvedAt: 1, expiresAt: 999_999 };
  const adapters = new ProjectExecutionRuntimeAdapters(
    { canonicalRoot: async () => "/canonical" },
    { readDraft: async () => ({ draft: { ...completeDeliveryPlan(), revision: 1, reviews: [] } as any }) },
    { readVerified: async () => ({ digest: permit.contextDigest }) },
    { authorize: async () => permit },
    { candidates: async () => [implementer], run: async () => ({ providerId: "groq", modelId: "coder", artifactDigest: "a".repeat(64), response: { summary: "Preserve and refine implementation", operations: [{ type: "replace", path: "src/workflow.ts", content: "export const value = 2;\n", citations: ["src/workflow.ts"], rationale: "Apply the bounded validation correction." }] } }) },
    {
      prepare: async () => workspace,
      resetAuthorizedFiles: async () => { resets += 1; },
      sources: async () => [{ path: "src/workflow.ts", content: "export const value = 1;\n", digest }],
      apply: async () => ({ changedFiles: ["src/workflow.ts"], evidenceDigest: digest }),
    } as any,
    { synchronize: async () => undefined },
  );
  const validationOnlyRecovery = {
    ...executionTask(),
    implementationEvidence: [],
    reviewAttempts: [{ approvalId: "approval_11111111111111111111", priorRevision: 9, implementerProviderId: "gemini", implementationEvidence: [digest], validations: [{ tier: "fast" as const, commandLabel: "unit", passed: false, exitCode: 1, evidenceDigest: digest, observedAt: 1 }], reviews: [], rationale: "Retry the deterministic validation correction.", decidedAt: 2 }],
  };
  await adapters.implement(projectId, validationOnlyRecovery, 1);
  assert.equal(resets, 0);
});

test("independent review rotates to another eligible free provider when one rejects the request", async () => {
  const rejected = candidate("kilo", "provider:rejected-reviewer");
  const compatible = candidate("mistral", "provider:compatible-reviewer");
  const secondCompatible = candidate("gemini", "provider:second-compatible-reviewer");
  const attempted: string[] = [];
  const reviewSystems: string[] = [];
  const permit = { schemaVersion: 1 as const, projectId, contextDigest: "a".repeat(64), dataClass: "source_code" as const, providerIds: ["groq", "kilo", "mistral", "gemini"], approvedAt: 1, expiresAt: 999_999 };
  const adapters = new ProjectExecutionRuntimeAdapters(
    { canonicalRoot: async () => "/canonical" },
    { readDraft: async () => ({ draft: { ...completeDeliveryPlan(), revision: 1, reviews: [] } as any }) },
    { readVerified: async () => ({ digest: permit.contextDigest }) },
    { authorize: async () => permit },
    {
      candidates: async (_permit: unknown, role: string) => role === "implementer" ? [implementer] : [rejected, compatible, secondCompatible],
      run: async (input: any) => {
        if (input.role === "implementer") return { providerId: "groq", modelId: "coder", artifactDigest: "a".repeat(64), response: { summary: "Prepare review fixture", operations: [{ type: "replace", path: "src/workflow.ts", content: "export const value = 2;\n", citations: ["src/workflow.ts"], rationale: "Prepare the reviewed change." }] } };
        attempted.push(input.assignment.providerId);
        reviewSystems.push(input.system);
        if (input.assignment.providerId === "kilo") return { providerId: "kilo", modelId: "reviewer", artifactDigest: "b".repeat(64), response: { reviewerId: "contradictory-reviewer", verdict: "pass", findings: [{ id: "blocking", severity: "major", evidenceRef: digest, confidence: 0.9, acceptanceCriterion: "Approved behavior is present.", recommendedRepair: "Change the approved behavior." }] } };
        const role = input.taskId.endsWith("security") ? "security" : "functional";
        return { providerId: input.assignment.providerId, modelId: "reviewer", artifactDigest: "b".repeat(64), response: { reviewerId: `${role}-reviewer`, verdict: "pass", findings: [] } };
      },
    },
    { prepare: async () => ({ projectId, taskId, root: "/isolated", branch: "studio/task", baseline: "a".repeat(40), authorityDigest: digest }), sources: async () => [{ path: "src/workflow.ts", content: "export const value = 2;", digest }], apply: async () => ({ changedFiles: ["src/workflow.ts"], evidenceDigest: digest }) } as any,
    { synchronize: async () => undefined }
  );
  const task = executionTask();
  await adapters.implement(projectId, task, 0);
  const reviews = await adapters.review(projectId, { ...task, validations: [{ tier: "fast", commandLabel: "unit", passed: true, exitCode: 0, evidenceDigest: digest, observedAt: 1 }] });
  assert.deepEqual(reviews.map((review) => review.providerId), ["mistral", "gemini"]);
  assert.deepEqual(attempted, ["kilo", "mistral", "gemini"]);
  assert.ok(reviewSystems.every((system) => system.includes("must not fail code for an alleged parse, format, lint, typecheck, build, or test error")));
  assert.ok(reviewSystems.every((system) => system.includes("tsconfig.json is TypeScript JSONC")));
});

function candidate(providerId: string, deviceId: string): ExecutionCandidate { return { providerId, modelId: providerId === "groq" ? "coder" : "reviewer", deviceId, capabilities: ["chat", "structured_output"], privacyClasses: ["source_code"], quotaAvailable: true, billingEnabled: false, activeRequests: 0, safeConcurrency: 1, availableMemoryMb: 1, requiredMemoryMb: 0, deviceLoad: 0, preference: 10 }; }
function executionTask(): ExecutionTask { return { id: taskId, jiraIssueKey: "PIPE-4", title: "Implement workflow contract", dependsOn: [], allowedFiles: ["src/workflow.ts"], validationProfiles: ["unit"], uiChanged: false, requiredCapabilities: ["chat", "structured_output"], privacyClass: "source_code", status: "running", revision: 1, attempt: 0, assignment: { providerId: "groq", modelId: "coder", deviceId: "provider:implementation", selectedAt: 1, reasons: ["All gates passed."] }, lease: { leaseId: "execlease_11111111111111111111", ownerId: "worker", acquiredAt: 1, heartbeatAt: 1, expiresAt: 999_999 }, implementationEvidence: [], validations: [], reviews: [], commitDigest: null, integrationDigest: null, failureClass: null, safeMessage: "Running.", updatedAt: 1 }; }
