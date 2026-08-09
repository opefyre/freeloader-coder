import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import {
  LocalProjectError,
  LocalProjectRegistry,
} from "../apps/core/src/local-project-registry.js";

test("registry persists an idempotent bounded repository observation across restart", async () => {
  const fixture = await createRepositoryFixture();
  try {
    const registry = new LocalProjectRegistry(fixture.state);
    const first = await registry.register({
      schemaVersion: 1,
      path: fixture.repository,
    });
    const replay = await registry.register({
      schemaVersion: 1,
      path: fixture.repository,
    });
    assert.equal(replay.id, first.id);
    assert.equal(first.displayName, "sample-app");
    assert.equal(first.facts.some((fact) => fact.value.includes("TypeScript")), true);
    assert.equal(first.warnings.some((warning) => warning.includes("never executes Git")), true);

    const restarted = new LocalProjectRegistry(fixture.state);
    await restarted.setResources(first.id, {
      schemaVersion: 1,
      resources: [{
        kind: "jira_project",
        connectionId: "jira-main",
        resourceId: "10000",
        label: "PIPE",
        url: "https://example.atlassian.net/jira/software/projects/PIPE",
        role: "primary",
      }],
    });
    const collection = await restarted.list();
    assert.equal(collection.projects.length, 1);
    assert.equal(JSON.stringify(collection).includes(fixture.repository), false);
    assert.equal(JSON.stringify(collection).includes("secret-value"), false);
    assert.equal(collection.projects[0]?.resources?.[0]?.label, "PIPE");
    assert.match(collection.projects[0]?.resources?.[0]?.id ?? "", /^binding_/);
    const planning = await restarted.grounding(first.id);
    assert.equal(
      planning.grounding.sources.some((source) => source.path === "package.json"),
      true
    );
    assert.equal(
      planning.topology.entries.some((entry) => entry.path === "src/index.ts"),
      true
    );
    assert.equal(
      planning.topology.entries.some((entry) => entry.path.includes("node_modules")),
      false
    );
    assert.equal(
      planning.topology.entries.some((entry) => entry.path.includes("secrets")),
      false
    );
    assert.equal(JSON.stringify(planning).includes(fixture.repository), false);
    assert.equal(JSON.stringify(planning).includes("secret-value"), false);

    await restarted.forget(first.id);
    assert.equal((await restarted.list()).projects.length, 0);
    assert.equal((await readFile(join(fixture.repository, "src", "index.ts"), "utf8")), "export {};\n");
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("registry creates a private Git workspace from a plain-language product idea", async () => {
  const fixture = await createRepositoryFixture();
  try {
    const registry = new LocalProjectRegistry(fixture.state);
    const input = {
      schemaVersion: 1 as const,
      displayName: "Garden planner",
      idea: "Help apartment residents plan and track a small balcony garden.",
      workspacePath: join(fixture.root, "garden-planner"),
    };
    const project = await registry.create(input, "create:garden-planner");
    const replay = await registry.create(input, "create:garden-planner");
    assert.equal(replay.id, project.id);
    assert.equal(project.displayName, "Garden planner");
    assert.equal(project.state, "warning");
    assert.equal((await registry.list()).projects.some((item) => item.id === project.id), true);
    const grounding = await registry.grounding(project.id);
    assert.equal(grounding.grounding.sources[0]?.path, "README.md");
    assert.match(grounding.grounding.sources[0]?.excerpt ?? "", /balcony garden/);
    assert.doesNotMatch(JSON.stringify(project), /\.pipeline-studio|\/projects\//);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("registry rejects broad, missing, non-git, duplicate-name, and malformed state", async () => {
  const fixture = await createRepositoryFixture();
  try {
    const registry = new LocalProjectRegistry(fixture.state);
    await assert.rejects(
      () => registry.register({ schemaVersion: 1, path: "/" }),
      (error: unknown) => error instanceof LocalProjectError && error.code === "protected_path"
    );
    await assert.rejects(() =>
      registry.register({ schemaVersion: 1, path: join(fixture.root, "missing") })
    );
    const plain = join(fixture.root, "plain", "folder");
    await mkdir(plain, { recursive: true });
    await assert.rejects(
      () => registry.register({ schemaVersion: 1, path: plain }),
      (error: unknown) => error instanceof LocalProjectError && error.code === "not_repository"
    );
    await registry.register({
      schemaVersion: 1,
      path: fixture.repository,
      displayName: "Shared name",
    });
    const second = join(fixture.root, "second", "repository");
    await mkdir(join(second, ".git"), { recursive: true });
    await writeFile(join(second, ".git", "HEAD"), "ref: refs/heads/main\n");
    await assert.rejects(
      () =>
        registry.register({
          schemaVersion: 1,
          path: second,
          displayName: "shared NAME",
        }),
      (error: unknown) => error instanceof LocalProjectError && error.code === "duplicate_name"
    );

    await writeFile(join(fixture.state, "local-projects.json"), "{broken", "utf8");
    await assert.rejects(
      () => new LocalProjectRegistry(fixture.state).list(),
      (error: unknown) =>
        error instanceof LocalProjectError && error.code === "registry_invalid"
    );
    assert.equal(await readFile(join(fixture.state, "local-projects.json"), "utf8"), "{broken");
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

async function createRepositoryFixture() {
  const root = join(process.cwd(), `.test-project-${crypto.randomUUID()}`);
  const repository = join(root, "projects", "sample-app");
  const state = join(root, "state");
  await mkdir(join(repository, ".git"), { recursive: true });
  await mkdir(join(repository, "src"), { recursive: true });
  await mkdir(join(repository, "node_modules", "ignored"), { recursive: true });
  await mkdir(join(repository, "secrets"), { recursive: true });
  await writeFile(join(repository, ".git", "HEAD"), "ref: refs/heads/main\n");
  await writeFile(
    join(repository, "package.json"),
    JSON.stringify({
      packageManager: "npm@10.0.0",
      scripts: { build: "tsc", test: "node --test" },
    })
  );
  await writeFile(join(repository, "src", "index.ts"), "export {};\n");
  await writeFile(join(repository, "secrets", "token.txt"), "secret-value\n");
  await writeFile(join(repository, ".env"), "TOKEN=secret-value\n");
  await writeFile(join(repository, "node_modules", "ignored", "large.ts"), "ignored\n");
  return { root, repository, state };
}
