import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { buildGroundingContract } from "../packages/orchestration/src/grounding.js";
import { validateTaskGraph } from "../packages/orchestration/src/readiness.js";
import { runWorkflow } from "../packages/orchestration/src/workflow.js";
import { routeProviders } from "../packages/providers/src/router.js";
import {
  beginEffect,
  claimLease,
  completeEffect,
  emptyCoordinationState,
  releaseLease
} from "../packages/storage/src/coordination.js";
import { LocalWorkspace, sha256 } from "../packages/tools/src/repository.js";
import { runValidation } from "../packages/validation/src/runner.js";

test("one-machine migration journey preserves scope, evidence, effects, and completion truth", async () => {
  const root = await mkdtemp(join(tmpdir(), "studio-e2e-"));
  await mkdir(join(root, "src"));
  const original = "export const value = 1;\n";
  await writeFile(join(root, "src", "value.ts"), original);
  const workspace = await LocalWorkspace.open({
    root,
    allowedPaths: ["src/value.ts"],
    maxFileBytes: 1_000
  });

  const graph = validateTaskGraph({
    units: [{
      id: "unit-1",
      title: "Update local fixture",
      files: ["src/value.ts"],
      dependsOn: []
    }]
  }, { maxUnits: 4, maxFilesPerUnit: 2 });
  const grounding = buildGroundingContract({
    sources: [{ path: "src/value.ts", content: original }],
    rules: ["Change only the declared file", "Require deterministic validation"],
    maxSourceBytes: 1_000
  });
  const route = routeProviders([{
    id: "offline-fake",
    priority: 1,
    privacy: "local",
    location: "local",
    paid: false,
    roles: ["implementer"],
    kinds: ["code"],
    dataClasses: ["source_code"],
    dailyTokenLimit: 10_000,
    usedTokens: 0,
    circuitOpenUntil: 0
  }], {
    role: "implementer",
    kind: "code",
    dataClass: "source_code",
    minimumPrivacy: "local",
    estimatedTokens: 100,
    allowPaid: false,
    now: 100
  });
  assert.equal(route.selected?.id, "offline-fake");

  let coordination = claimLease(emptyCoordinationState(), {
    taskId: "task-1",
    leaseId: "lease-1",
    ownerId: "local-worker",
    expiresAt: 10_000
  }, 100);

  const result = await runWorkflow("task-1", {
    prepare: async () => `scope:${graph.units[0]?.files.join(",")}`,
    plan: async () => `grounding:${grounding.sha256}`,
    implement: async () => {
      const evidence = await workspace.applyTextEdits([{
        path: "src/value.ts",
        expectedSha256: sha256(original),
        content: "export const value = 2;\n"
      }]);
      return `edit:${evidence[0]?.afterSha256}`;
    },
    validate: async (_taskId, tier) => {
      const source = await workspace.readText("src/value.ts");
      const evidence = await runValidation({
        tier,
        sourceDigest: sha256(source),
        validators: [{
          id: "fixture-check",
          tier: "fast",
          run: async () => ({
            exitCode: source.includes("value = 2") ? 0 : 1,
            output: "fixture checked"
          })
        }],
        timeoutMs: 1_000,
        maxOutputBytes: 100
      });
      return { passed: evidence.passed, evidence: `validation:${evidence.inputDigest}` };
    },
    heal: async () => "repair not required",
    review: async (_taskId, kind) => ({ verdict: "pass", evidence: `${kind}:approved` }),
    commit: async () => {
      const begun = beginEffect(coordination, {
        idempotencyKey: "task-1:commit",
        inputDigest: sha256(await workspace.readText("src/value.ts"))
      });
      coordination = completeEffect(begun.state, "task-1:commit", "commit-observed");
      return "commit:observed";
    },
    integrate: async () => {
      const begun = beginEffect(coordination, {
        idempotencyKey: "task-1:integrate",
        inputDigest: "commit-observed"
      });
      coordination = completeEffect(begun.state, "task-1:integrate", "integration-observed");
      return "integration:observed";
    },
    validateIntegration: async () => ({
      passed: (await readFile(join(root, "src", "value.ts"), "utf8")).includes("value = 2"),
      evidence: "integration-validation:observed"
    })
  });

  coordination = releaseLease(coordination, "task-1", "lease-1");
  assert.equal(result.stage, "review_ready");
  assert.equal(coordination.leases.size, 0);
  assert.equal(coordination.effects.get("task-1:commit")?.status, "completed");
  assert.equal(coordination.effects.get("task-1:integrate")?.status, "completed");
  assert.equal(result.evidence.at(-1), "integration-validation:observed");
});
