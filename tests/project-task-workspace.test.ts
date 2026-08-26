import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";

import {
  ProjectTaskWorkspaceError,
  ProjectTaskWorkspaceService,
} from "../apps/core/src/project-task-workspace.js";
import type { ExecutionTask } from "../packages/orchestration/src/project-execution.js";

const run = promisify(execFile);

test("isolated workspace enforces authority, validates, commits, and fast-forward integrates", async () => {
  const root = await mkdtemp(join(tmpdir(), "project-task-workspace-"));
  const repository = join(root, "repo");
  try {
    await mkdir(join(repository, "src"), { recursive: true });
    await mkdir(join(repository, "tests"), { recursive: true });
    await writeFile(
      join(repository, "src", "feature.js"),
      "export const value = 1;\n",
    );
    await writeFile(
      join(repository, "package.json"),
      JSON.stringify({
        type: "module",
        scripts: {
          typecheck: "node --check src/feature.js",
          test: "node --test tests/feature.test.js",
        },
      }),
    );
    await git(repository, ["init", "-b", "main"]);
    await git(repository, ["add", "."]);
    await git(repository, [
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.com",
      "commit",
      "-m",
      "initial",
    ]);
    const service = new ProjectTaskWorkspaceService(join(root, "state"));
    const workspace = await service.prepare(
      "project_abcdef0123456789",
      repository,
      task(),
    );
    const sources = await service.sources(workspace, task());
    const before = sources.find((source) => source.path === "src/feature.js")!;
    const applied = await service.apply(workspace, task(), [
      {
        type: "replace",
        path: "src/feature.js",
        expectedBeforeDigest: before.digest,
        content: "export const value = 2;\n",
      },
      {
        type: "create",
        path: "tests/feature.test.js",
        expectedBeforeDigest: null,
        content:
          "import assert from 'node:assert/strict'; import test from 'node:test'; import { value } from '../src/feature.js'; test('feature value', () => assert.equal(value, 2));\n",
      },
    ]);
    assert.deepEqual(applied.changedFiles, [
      "src/feature.js",
      "tests/feature.test.js",
    ]);
    assert.equal(
      (await service.validate(workspace.root, task())).every(
        (item) => item.passed,
      ),
      true,
    );
    const committed = await service.commit(workspace, task());
    assert.match(committed.commitDigest, /^[a-f0-9]{40,64}$/);
    const integrated = await service.integrate(
      repository,
      workspace,
      committed.commitDigest,
    );
    assert.match(integrated.integrationDigest, /^[a-f0-9]{64}$/);
    assert.equal(
      await readFile(join(repository, "src", "feature.js"), "utf8"),
      "export const value = 2;\n",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("reopened delivered work may revalidate unchanged authorized files without fabricating a commit", async () => {
  const root = await mkdtemp(join(tmpdir(), "project-workspace-revalidation-"));
  const repository = join(root, "repo");
  try {
    await mkdir(join(repository, "src"), { recursive: true });
    await mkdir(join(repository, "tests"), { recursive: true });
    await writeFile(
      join(repository, "src", "feature.js"),
      "export const value = 1;\n",
    );
    await writeFile(
      join(repository, "tests", "feature.test.js"),
      "import test from 'node:test'; test('existing delivery', () => {});\n",
    );
    await writeFile(
      join(repository, "package.json"),
      JSON.stringify({
        type: "module",
        scripts: {
          typecheck: "node --check src/feature.js",
          test: "node --test tests/feature.test.js",
        },
      }),
    );
    await git(repository, ["init", "-b", "main"]);
    await git(repository, ["add", "."]);
    await git(repository, [
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.com",
      "commit",
      "-m",
      "existing delivery",
    ]);
    const service = new ProjectTaskWorkspaceService(join(root, "state"));
    const reopened = {
      ...task(),
      reviewAttempts: [
        {
          approvalId: "approval_11111111111111111111",
          priorRevision: 1,
          implementerProviderId: "gemini",
          implementationEvidence: ["a".repeat(64)],
          validations: [],
          reviews: [],
          rationale: "Revalidate previously integrated delivery proof.",
          decidedAt: 2,
        },
      ],
    };
    const workspace = await service.prepare(
      "project_abcdef0123456789",
      repository,
      reopened,
    );
    const committed = await service.commit(workspace, reopened);
    assert.equal(committed.commitDigest, workspace.baseline);
    const integrated = await service.integrate(
      repository,
      workspace,
      committed.commitDigest,
    );
    assert.match(integrated.integrationDigest, /^[a-f0-9]{64}$/);
    assert.equal(
      (await run("git", ["log", "--oneline"], { cwd: repository })).stdout
        .trim()
        .split("\n").length,
      1,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("restarted workspace accepts only descendant commits inside exact task authority", async () => {
  const root = await mkdtemp(join(tmpdir(), "project-workspace-descendant-"));
  const repository = join(root, "repo");
  try {
    await mkdir(join(repository, "src"), { recursive: true });
    await mkdir(join(repository, "tests"), { recursive: true });
    await writeFile(
      join(repository, "src", "feature.js"),
      "export const value = 1;\n",
    );
    await writeFile(
      join(repository, "package.json"),
      JSON.stringify({
        type: "module",
        scripts: {
          typecheck: "node --check src/feature.js",
          test: "node --test tests/feature.test.js",
        },
      }),
    );
    await git(repository, ["init", "-b", "main"]);
    await git(repository, ["add", "."]);
    await git(repository, [
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.com",
      "commit",
      "-m",
      "initial",
    ]);
    const state = join(root, "state");
    const service = new ProjectTaskWorkspaceService(state);
    const workspace = await service.prepare(
      "project_abcdef0123456789",
      repository,
      task(),
    );
    const source = (await service.sources(workspace, task())).find(
      (item) => item.path === "src/feature.js",
    )!;
    await service.apply(workspace, task(), [
      {
        type: "replace",
        path: "src/feature.js",
        expectedBeforeDigest: source.digest,
        content: "export const value = 2;\n",
      },
      {
        type: "create",
        path: "tests/feature.test.js",
        expectedBeforeDigest: null,
        content: "import test from 'node:test'; test('feature', () => {});\n",
      },
    ]);
    await service.commit(workspace, task());
    const restarted = new ProjectTaskWorkspaceService(state);
    const recovered = await restarted.prepare(
      "project_abcdef0123456789",
      repository,
      task(),
    );
    assert.equal(recovered.root, workspace.root);
    await writeFile(
      join(workspace.root, "package.json"),
      JSON.stringify({ scripts: {} }),
    );
    await git(workspace.root, ["add", "package.json"]);
    await git(workspace.root, [
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.com",
      "commit",
      "-m",
      "unauthorized",
    ]);
    await assert.rejects(
      () => restarted.prepare("project_abcdef0123456789", repository, task()),
      /outside exact file authority/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("bounded repair discards rejected authorized changes and restarts from the canonical baseline", async () => {
  const root = await mkdtemp(join(tmpdir(), "project-workspace-repair-reset-"));
  const repository = join(root, "repo");
  try {
    await mkdir(join(repository, "src"), { recursive: true });
    await mkdir(join(repository, "tests"), { recursive: true });
    await writeFile(
      join(repository, "src", "feature.js"),
      "export const value = 1;\n",
    );
    await writeFile(
      join(repository, "package.json"),
      JSON.stringify({
        type: "module",
        scripts: {
          typecheck: "node --check src/feature.js",
          test: "node --test tests/feature.test.js",
        },
      }),
    );
    await git(repository, ["init", "-b", "main"]);
    await git(repository, ["add", "."]);
    await git(repository, [
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.com",
      "commit",
      "-m",
      "initial",
    ]);
    const service = new ProjectTaskWorkspaceService(join(root, "state"));
    const workspace = await service.prepare(
      "project_abcdef0123456789",
      repository,
      task(),
    );
    const source = (await service.sources(workspace, task())).find(
      (item) => item.path === "src/feature.js",
    )!;
    await service.apply(workspace, task(), [
      {
        type: "replace",
        path: "src/feature.js",
        expectedBeforeDigest: source.digest,
        content: "export const value = 99;\n",
      },
      {
        type: "create",
        path: "tests/feature.test.js",
        expectedBeforeDigest: null,
        content: "rejected\n",
      },
    ]);
    await service.resetAuthorizedFiles(workspace, task());
    assert.equal(
      await readFile(join(workspace.root, "src", "feature.js"), "utf8"),
      "export const value = 1;\n",
    );
    await assert.rejects(
      () => readFile(join(workspace.root, "tests", "feature.test.js"), "utf8"),
      /ENOENT/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("validation rejects unconditional-success scripts", async () => {
  const root = await mkdtemp(join(tmpdir(), "project-task-noop-"));
  try {
    await writeFile(
      join(root, "package.json"),
      JSON.stringify({
        scripts: {
          typecheck: "echo 'No typecheck needed'",
          test: 'node -e "process.exit(0)"',
        },
      }),
    );
    const service = new ProjectTaskWorkspaceService(join(root, "state"));
    await assert.rejects(
      () => service.validate(root, task()),
      (error: unknown) =>
        error instanceof ProjectTaskWorkspaceError &&
        error.code === "validation_unavailable" &&
        /no-op/.test(error.message),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("validation removes untracked generated output before retrying project-wide checks", async () => {
  const root = await mkdtemp(join(tmpdir(), "validator-generated-output-"));
  try {
    await mkdir(join(root, "dist"), { recursive: true });
    await writeFile(join(root, "dist", "stale.js"), "stale generated output\n");
    await writeFile(
      join(root, "package.json"),
      JSON.stringify({
        scripts: {
          lint: "node -e \"const fs=require('node:fs'); if(fs.existsSync('dist')) process.exit(7)\"",
        },
      }),
    );
    await git(root, ["init", "-b", "main"]);
    await git(root, ["add", "package.json"]);
    await git(root, [
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.com",
      "commit",
      "-m",
      "initial",
    ]);
    const service = new ProjectTaskWorkspaceService(join(root, "state"));
    const lintTask = { ...task(), validationProfiles: ["lint" as const] };
    const result = await service.validate(root, lintTask);
    assert.equal(result[0]?.passed, true);
    await assert.rejects(
      () => readFile(join(root, "dist", "stale.js"), "utf8"),
      /ENOENT/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("unit validation requires and executes every task-owned test beyond the project test script", async () => {
  const root = await mkdtemp(
    join(tmpdir(), "project-workspace-focused-tests-"),
  );
  try {
    await mkdir(join(root, "tests"), { recursive: true });
    await writeFile(
      join(root, "package.json"),
      JSON.stringify({
        scripts: { test: "node --test tests/scaffold.test.js" },
      }),
    );
    await writeFile(
      join(root, "tests", "scaffold.test.js"),
      "import test from 'node:test'; test('scaffold', () => {});\n",
    );
    const service = new ProjectTaskWorkspaceService(join(root, "state"));
    const focusedTask = {
      ...task(),
      allowedFiles: ["tests/behavior.test.js"],
      validationProfiles: ["unit" as const],
    };
    const missing = await service.validate(root, focusedTask);
    assert.equal(missing[0]?.passed, false);
    assert.match(missing[0]?.output ?? "", /Task-owned unit tests are missing/);
    await writeFile(
      join(root, "tests", "behavior.test.js"),
      "import test from 'node:test'; test('behavior', () => { throw new Error('focused test executed'); });\n",
    );
    const executed = await service.validate(root, focusedTask);
    assert.equal(executed[0]?.passed, false);
    assert.match(executed[0]?.output ?? "", /focused test executed/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("new-product scaffold rejects a test command that can never discover downstream tests", async () => {
  const root = await mkdtemp(
    join(tmpdir(), "project-workspace-scaffold-suite-"),
  );
  try {
    await mkdir(join(root, "tests"), { recursive: true });
    await writeFile(
      join(root, "tests", "scaffold.test.js"),
      "import test from 'node:test'; test('scaffold', () => {});\n",
    );
    const service = new ProjectTaskWorkspaceService(join(root, "state"));
    const scaffold = {
      ...task(),
      allowedFiles: ["package.json", "tests/scaffold.test.js"],
      validationProfiles: ["unit" as const],
    };
    await writeFile(
      join(root, "package.json"),
      JSON.stringify({
        scripts: { test: "node --test tests/scaffold.test.js" },
      }),
    );
    await assert.rejects(
      () => service.validate(root, scaffold),
      /complete test suite/,
    );
    await writeFile(
      join(root, "package.json"),
      JSON.stringify({ scripts: { test: "node --test tests/*.test.js" } }),
    );
    assert.equal((await service.validate(root, scaffold))[0]?.passed, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("deterministic formatting skips extensionless control files outside the declared Prettier corpus", async () => {
  const root = await mkdtemp(
    join(tmpdir(), "project-workspace-format-authority-"),
  );
  try {
    await mkdir(join(root, "tests"), { recursive: true });
    await writeFile(
      join(root, "package.json"),
      JSON.stringify({
        scripts: { "format:check": 'prettier --check "**/*.{ts,js,json,md}"' },
        devDependencies: { prettier: "3.2.4" },
      }),
    );
    await writeFile(join(root, ".gitignore"), "node_modules/\n");
    await writeFile(
      join(root, "tests", "feature.test.ts"),
      "const value={answer:42}\n",
    );
    await run(
      "npm",
      ["install", "--ignore-scripts", "--no-audit", "--no-fund"],
      { cwd: root },
    );
    await git(root, ["init", "-b", "main"]);
    await git(root, ["add", "."]);
    await git(root, [
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.com",
      "commit",
      "-m",
      "initial",
    ]);
    const service = new ProjectTaskWorkspaceService(join(root, "state"));
    const formatTask = {
      ...task(),
      allowedFiles: [".gitignore", "tests/feature.test.ts"],
      validationProfiles: ["format" as const],
    };
    const workspace = await service.prepare(
      "project_abcdef0123456789",
      root,
      formatTask,
    );
    await service.prepareDependencies(workspace, formatTask);
    const result = await service.formatAuthorizedFiles(workspace, formatTask);
    assert.deepEqual(result?.changedFiles, ["tests/feature.test.ts"]);
    assert.equal(
      await readFile(join(workspace.root, ".gitignore"), "utf8"),
      "node_modules/\n",
    );
    assert.equal(
      (await service.validate(workspace.root, formatTask))[0]?.passed,
      true,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("isolated workspace rejects unauthorized paths and stale replacement evidence", async () => {
  const root = await mkdtemp(join(tmpdir(), "project-task-denial-"));
  const repository = join(root, "repo");
  try {
    await mkdir(join(repository, "src"), { recursive: true });
    await writeFile(join(repository, "src", "feature.js"), "safe\n");
    await writeFile(
      join(repository, "package.json"),
      JSON.stringify({
        scripts: {
          typecheck: 'node -e "process.exit(0)"',
          test: 'node -e "process.exit(0)"',
        },
      }),
    );
    await git(repository, ["init", "-b", "main"]);
    await git(repository, ["add", "."]);
    await git(repository, [
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.com",
      "commit",
      "-m",
      "initial",
    ]);
    const service = new ProjectTaskWorkspaceService(join(root, "state"));
    const workspace = await service.prepare(
      "project_abcdef0123456789",
      repository,
      task(),
    );
    await assert.rejects(
      () =>
        service.apply(workspace, task(), [
          {
            type: "replace",
            path: "package.json",
            expectedBeforeDigest: "a".repeat(64),
            content: "{}",
          },
        ]),
      (error: unknown) =>
        error instanceof ProjectTaskWorkspaceError &&
        error.code === "operation_denied",
    );
    await assert.rejects(
      () =>
        service.apply(workspace, task(), [
          {
            type: "replace",
            path: "src/feature.js",
            expectedBeforeDigest: "a".repeat(64),
            content: "changed\n",
          },
        ]),
      (error: unknown) =>
        error instanceof ProjectTaskWorkspaceError &&
        error.code === "stale_source",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("commitless Codkesh-owned project creates one verified baseline before isolation", async () => {
  const root = await mkdtemp(join(tmpdir(), "project-bootstrap-product-"));
  const repository = join(root, "repo");
  try {
    await mkdir(join(repository, ".pipeline"), { recursive: true });
    await writeFile(
      join(repository, "CONTEXT.md"),
      "# Context\n\nApproved context.\n",
    );
    await writeFile(
      join(repository, ".pipeline", "SOLUTION.md"),
      "# Solution\n\nApproved solution.\n",
    );
    await git(repository, ["init", "-b", "main"]);
    const service = new ProjectTaskWorkspaceService(join(root, "state"));
    const workspace = await service.prepare(
      "project_abcdef0123456789",
      repository,
      task(),
    );
    const baseline = (
      await run("git", ["rev-parse", "--verify", "HEAD"], { cwd: repository })
    ).stdout.trim();
    assert.equal(workspace.baseline, baseline);
    assert.equal(
      (await run("git", ["status", "--porcelain"], { cwd: repository })).stdout,
      "",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("commitless project refuses to checkpoint files outside Codkesh ownership", async () => {
  const root = await mkdtemp(join(tmpdir(), "project-task-unowned-"));
  const repository = join(root, "repo");
  try {
    await mkdir(repository, { recursive: true });
    await writeFile(
      join(repository, "customer-source.ts"),
      "export const customer = true;\n",
    );
    await git(repository, ["init", "-b", "main"]);
    const service = new ProjectTaskWorkspaceService(join(root, "state"));
    await assert.rejects(
      () => service.prepare("project_abcdef0123456789", repository, task()),
      (error: unknown) =>
        error instanceof ProjectTaskWorkspaceError &&
        error.code === "canonical_dirty",
    );
    await assert.rejects(() =>
      run("git", ["rev-parse", "--verify", "HEAD"], { cwd: repository }),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("existing project checkpoints only verified Codkesh planning artifacts before isolation", async () => {
  const root = await mkdtemp(join(tmpdir(), "project-planning-checkpoint-"));
  const repository = join(root, "repo");
  try {
    await mkdir(join(repository, ".codkesh", "artifacts", "CONTEXT.md"), {
      recursive: true,
    });
    await git(repository, ["init", "-b", "main"]);
    await writeFile(join(repository, ".gitignore"), "node_modules/\n");
    await git(repository, ["add", ".gitignore"]);
    await git(repository, [
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.com",
      "commit",
      "-m",
      "initial",
    ]);
    const content = "# Context\n\nApproved context.\n";
    await writeFile(join(repository, "CONTEXT.md"), content);
    await writeFile(
      join(
        repository,
        ".codkesh",
        "artifacts",
        "CONTEXT.md",
        "000001-evidence.md",
      ),
      content,
    );
    const service = new ProjectTaskWorkspaceService(join(root, "state"));
    const workspace = await service.prepare(
      "project_abcdef0123456789",
      repository,
      task(),
    );
    assert.equal(
      (await run("git", ["status", "--porcelain"], { cwd: repository })).stdout,
      "",
    );
    assert.match(
      (await run("git", ["log", "-1", "--pretty=%s"], { cwd: repository }))
        .stdout,
      /checkpoint approved Codkesh plan/,
    );
    assert.equal(
      workspace.baseline,
      (
        await run("git", ["rev-parse", "HEAD"], { cwd: repository })
      ).stdout.trim(),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("existing project refuses unrelated or tampered planning changes", async () => {
  const root = await mkdtemp(join(tmpdir(), "project-planning-denial-"));
  const repository = join(root, "repo");
  try {
    await mkdir(join(repository, ".codkesh", "artifacts", "CONTEXT.md"), {
      recursive: true,
    });
    await git(repository, ["init", "-b", "main"]);
    await writeFile(join(repository, ".gitignore"), "node_modules/\n");
    await git(repository, ["add", ".gitignore"]);
    await git(repository, [
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.com",
      "commit",
      "-m",
      "initial",
    ]);
    await writeFile(join(repository, "CONTEXT.md"), "tampered\n");
    await writeFile(
      join(
        repository,
        ".codkesh",
        "artifacts",
        "CONTEXT.md",
        "000001-evidence.md",
      ),
      "approved\n",
    );
    const service = new ProjectTaskWorkspaceService(join(root, "state"));
    await assert.rejects(
      () => service.prepare("project_abcdef0123456789", repository, task()),
      (error: unknown) =>
        error instanceof ProjectTaskWorkspaceError &&
        error.code === "canonical_dirty" &&
        /immutable/.test(error.message),
    );
    await rm(join(repository, "CONTEXT.md"));
    await rm(join(repository, ".codkesh"), { recursive: true, force: true });
    await writeFile(
      join(repository, "customer-source.ts"),
      "export const customer = true;\n",
    );
    await assert.rejects(
      () => service.prepare("project_abcdef0123456789", repository, task()),
      (error: unknown) =>
        error instanceof ProjectTaskWorkspaceError &&
        error.code === "canonical_dirty",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("scaffold dependency preparation creates an authorized lockfile and installs without lifecycle scripts", async () => {
  const root = await mkdtemp(join(tmpdir(), "project-scaffold-dependencies-"));
  const repository = join(root, "repo");
  try {
    await mkdir(repository, { recursive: true });
    await writeFile(join(repository, "CONTEXT.md"), "# Initial baseline\n");
    await git(repository, ["init", "-b", "main"]);
    await git(repository, ["add", "CONTEXT.md"]);
    await git(repository, [
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.com",
      "commit",
      "-m",
      "initial",
    ]);
    const scaffoldTask = {
      ...task(),
      allowedFiles: ["package.json", "package-lock.json"],
    };
    const service = new ProjectTaskWorkspaceService(join(root, "state"));
    const workspace = await service.prepare(
      "project_abcdef0123456789",
      repository,
      scaffoldTask,
    );
    await service.apply(workspace, scaffoldTask, [
      {
        type: "create",
        path: "package.json",
        expectedBeforeDigest: null,
        content: JSON.stringify({ private: true, devDependencies: {} }),
      },
    ]);
    const prepared = await service.prepareDependencies(workspace, scaffoldTask);
    assert.ok(prepared?.changedFiles.includes("package-lock.json"));
    assert.equal(
      prepared?.changedFiles.some((path) => path.startsWith("node_modules/")),
      false,
    );
    assert.match(
      await readFile(join(workspace.root, "package-lock.json"), "utf8"),
      /lockfileVersion/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

function task(): ExecutionTask {
  return {
    id: "plan_1111111111111111",
    jiraIssueKey: "PIPE-1",
    title: "Implement bounded feature",
    dependsOn: [],
    allowedFiles: ["src/feature.js", "tests/feature.test.js"],
    validationProfiles: ["typecheck", "unit"],
    uiChanged: false,
    requiredCapabilities: ["chat", "structured_output"],
    privacyClass: "source_code",
    status: "queued",
    revision: 0,
    attempt: 0,
    assignment: null,
    lease: null,
    implementationEvidence: [],
    validations: [],
    reviews: [],
    commitDigest: null,
    integrationDigest: null,
    failureClass: null,
    safeMessage: "Queued.",
    updatedAt: 1,
  };
}
async function git(cwd: string, args: readonly string[]) {
  await run("git", [...args], { cwd });
}
