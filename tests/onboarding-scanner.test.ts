import assert from "node:assert/strict";
import test from "node:test";

import {
  modelGroundingProjection,
  scanProject,
  summarizeGrounding
} from "../packages/onboarding/src/index.js";

const files = [
  {
    path: "package.json",
    content: JSON.stringify({
      scripts: { test: "node --test", build: "vite build" },
      dependencies: { react: "19.0.0", vite: "8.0.0" },
      devDependencies: { typescript: "5.9.0" },
      packageManager: "npm@11"
    }),
    bytes: 220
  },
  {
    path: "package-lock.json",
    content: "{}",
    bytes: 2
  },
  {
    path: "src/App.tsx",
    content: "export function App(){ return <main /> }",
    bytes: 43
  },
  {
    path: "src/theme.css",
    content: ":root { --brand-gold: #f7b32b; }",
    bytes: 34
  },
  {
    path: "vite.config.ts",
    content: "export default { server: { port: 4310 } }",
    bytes: 47
  },
  {
    path: "tests/app.test.ts",
    content: "token=should-never-leak\nexport const ok = true",
    bytes: 47
  },
  {
    path: ".env",
    content: "GROQ_API_KEY=super-secret-value",
    bytes: 36
  }
] as const;

function scan(overrides: Partial<Parameters<typeof scanProject>[0]> = {}) {
  return scanProject({
    projectId: "project-example",
    files,
    maxFiles: 100,
    maxFileBytes: 100_000,
    maxTotalBytes: 1_000_000,
    ...overrides
  });
}

test("project scan detects stack, commands, ports, design tokens, tests, and protected paths", () => {
  const profile = scan();
  assert.deepEqual(profile.languages, ["CSS", "TypeScript"]);
  assert.deepEqual(profile.frameworks, ["React", "Vite"]);
  assert.deepEqual(profile.packageManagers, ["npm"]);
  assert.deepEqual(profile.commands.map((command) => command.name), ["build", "test"]);
  assert.deepEqual(profile.ports, [4310]);
  assert.deepEqual(profile.designTokens, ["--brand-gold"]);
  assert.deepEqual(profile.tests, ["tests/app.test.ts"]);
  assert.ok(profile.protectedPaths.includes(".env"));
  assert.equal(profile.readiness, "ready");
});

test("grounding is deterministic and invalidates when a relevant file changes", () => {
  const first = scan();
  const second = scan();
  assert.deepEqual(first, second);
  const changedFiles = files.map((file) =>
    file.path === "src/App.tsx"
      ? { ...file, content: "export function App(){ return <section /> }", bytes: 46 }
      : file
  );
  const changed = scan({ files: changedFiles });
  assert.notEqual(changed.sourceDigest, first.sourceDigest);
  assert.notEqual(changed.groundingDigest, first.groundingDigest);
});

test("secret values never enter the grounding projection", () => {
  const profile = scan();
  const projection = modelGroundingProjection(profile);
  const serialized = JSON.stringify(projection);
  assert.doesNotMatch(serialized, /super-secret-value|should-never-leak/);
  assert.doesNotMatch(serialized, /GROQ_API_KEY/);
  assert.ok(projection.citations.some((citation) => citation.path === ".env"));
  assert.ok(projection.statements.some((statement) => /excluded from grounding/.test(statement.text)));
});

test("summary distinguishes facts, inferences, assumptions, and user decisions", () => {
  const summary = summarizeGrounding(scan());
  assert.ok(summary.facts.length > 0);
  assert.ok(summary.inferences.some((statement) => /port 4310/.test(statement)));
  assert.ok(summary.userDecisions.some((statement) => /decides whether/.test(statement)));
  assert.deepEqual(summary.assumptions, []);
});

test("bounded scanning rejects duplicate paths, oversized files, and excess totals", () => {
  assert.throws(() => scan({ files: [...files, files[0]] }), /unique/);
  assert.throws(() => scan({ maxFileBytes: 10 }), /oversized/);
  assert.throws(() => scan({ maxTotalBytes: 100 }), /total byte limit/);
  assert.throws(() => scan({ maxFiles: 2 }), /file limit/);
});
