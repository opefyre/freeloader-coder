import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";

import { LocalProjectRegistry } from "../apps/core/src/local-project-registry.js";

const exec = promisify(execFile);

test("live artifact journey returns truthful status and supports safe in-app reading", async () => {
  const sandbox = join(process.cwd(), `.test-artifact-ui-${crypto.randomUUID()}`);
  const project = join(sandbox, "project");
  const state = join(sandbox, "state");
  const opened: string[] = [];
  try {
    await mkdir(sandbox, { recursive: true });
    await exec("git", ["init", "--initial-branch=main", project]);
    await writeFile(join(project, "README.md"), "# Test project\n", "utf8");
    const registry = new LocalProjectRegistry(state, undefined, async (path) => { opened.push(path); });
    const registered = await registry.register({ schemaVersion: 1, path: project });
    const artifacts = await registry.artifacts(registered.id);
    assert.equal(artifacts.length, 11);
    assert.ok(artifacts.every(({ fileName, bodyDigest }) => /^[A-Z][A-Z-]+\.md$/.test(fileName) && /^[a-f0-9]{64}$/.test(bodyDigest)));
    const document = await registry.artifact(registered.id, "context");
    assert.equal(document.fileName, "CONTEXT.md");
    assert.match(document.body, /Project context/);
    const result = await registry.openArtifact(registered.id, "context");
    assert.deepEqual(result, { schemaVersion: 1, outcome: "opened", kind: "context", fileName: "CONTEXT.md" });
    assert.deepEqual(opened, [join(project, "CONTEXT.md")]);
    assert.doesNotMatch(JSON.stringify({ artifacts, result }), new RegExp(project.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(await readFile(join(project, "CONTEXT.md"), "utf8"), /Project context/);
  } finally { await rm(sandbox, { recursive: true, force: true }); }
});

test("artifact workspace is concise, keyboard reachable, responsive, and distinguishes owner states", async () => {
  const source = await readFile(join(process.cwd(), "apps/studio/src/components/projects/project-artifact-workspace.tsx"), "utf8");
  const renderer = await readFile(join(process.cwd(), "apps/studio/src/components/projects/markdown-document.tsx"), "utf8");
  assert.match(source, /<button[^>]+type="button"/);
  assert.match(source, /focus-visible:ring/);
  assert.match(source, /sm:grid-cols-2 xl:grid-cols-3/);
  assert.match(source, /Approval pending/);
  assert.match(source, /Conflict/);
  assert.match(source, /Missing/);
  assert.match(source, /Stale/);
  assert.match(source, /Existing project files were not changed/);
  assert.match(source, /<ProjectResearchControl endpoint={props\.endpoint} projectId={props\.projectId}/);
  assert.match(source, /getProjectArtifact/);
  assert.match(source, /role="dialog"/);
  assert.match(source, /MarkdownDocument/);
  assert.match(renderer, /ReactMarkdown/);
  assert.match(renderer, /remarkGfm/);
  assert.match(renderer, /skipHtml/);
  assert.match(renderer, /table:/);
  assert.match(renderer, /blockquote:/);
  assert.doesNotMatch(source, /absolute path|digest:|producer:/i);
});

test("project status and Action Center provide direct navigation to project files", async () => {
  const activity = await readFile(join(process.cwd(), "apps/studio/src/components/activity/project-activity-dashboard.tsx"), "utf8");
  const app = await readFile(join(process.cwd(), "apps/studio/src/App.tsx"), "utf8");
  assert.match(activity, /Open project files/);
  assert.match(activity, /href={`\/projects\/\$\{record\.projectId\}`}/);
  assert.match(app, /<ProjectArtifactWorkspace endpoint={endpoint} projectId={selectedProjectId}/);
  assert.match(app, /projectIdFromLocation\(window\.location\)/);
  assert.match(app, /setSelectedProjectId\(projectId\)/);
});

test("Action Center exposes immutable solution revisions and keeps historical decisions read only", async () => {
  const source = await readFile(join(process.cwd(), "apps/studio/src/components/decisions/decision-inbox.tsx"), "utf8");
  assert.match(source, /getProjectSolutionHistory/);
  assert.match(source, /aria-label="Solution revision"/);
  assert.match(source, /Historical revision · read only/);
  assert.match(source, /viewedSolution\.digest !== solution\.digest/);
});
