import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("major Studio workspaces use lazy imports and an accessible loading boundary", async () => {
  const app = await readFile("apps/studio/src/App.tsx", "utf8");
  const boundary = await readFile(
    "apps/studio/src/components/shell/route-boundary.tsx",
    "utf8"
  );

  for (const route of [
    "conversation-workbench",
    "integration-workbench",
    "launch-center",
    "release-center",
    "trust-center",
    "accessibility-center",
  ]) {
    assert.match(app, new RegExp(`import\\(\"\\./components/.+/${route}\\.js\"\\)`));
  }
  assert.match(app, /<Suspense fallback=\{<WorkspaceLoading \/>\}>/);
  assert.match(boundary, /role="status"/);
  assert.match(boundary, /aria-live="polite"/);
});

test("route failure containment exposes bounded retry and safe return actions", async () => {
  const source = await readFile(
    "apps/studio/src/components/shell/route-boundary.tsx",
    "utf8"
  );
  for (const phrase of [
    "Workspace contained",
    "This workspace could not render",
    "Retry workspace",
    "Return to overview",
    'this.props.navigate("overview")',
    "does not emit stack traces or source paths",
  ]) {
    assert.equal(source.includes(phrase), true, `Missing recovery contract: ${phrase}`);
  }
});

test("demo provenance is globally inspectable and forbids ambiguous live claims", async () => {
  const [app, disclosure] = await Promise.all([
    readFile("apps/studio/src/App.tsx", "utf8"),
    readFile(
      "apps/studio/src/components/shell/demo-data-disclosure.tsx",
      "utf8"
    ),
  ]);
  assert.doesNotMatch(app, />Pipeline online</);
  for (const phrase of [
    "Runtime truth and demo data",
    "Overview, registered projects, local requests",
    "never turn",
    "Live claim",
    "Local sources only",
    "Simulations",
    "$0 maximum",
    "Approval gated",
    "Preview safe failure",
  ]) {
    assert.equal(disclosure.includes(phrase), true, `Missing provenance contract: ${phrase}`);
  }
});

test("production build separates the React runtime from the Studio entry", async () => {
  const config = await readFile("apps/studio/vite.config.ts", "utf8");
  assert.match(config, /manualChunks\(id\)/);
  assert.match(config, /"react-runtime"/);
});
