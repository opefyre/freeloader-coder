import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Studio gallery has a landmark, skip link, and labeled control groups", async () => {
  const html = await readFile("apps/studio/index.html", "utf8");
  const source = await readFile("apps/studio/src/main.ts", "utf8");
  assert.match(html, /class="skip-link"/);
  assert.match(source, /<main class="shell">/);
  assert.match(source, /role="tablist"/);
  assert.match(source, /aria-label="Information density"/);
  assert.match(source, /aria-label="Preview breakpoint"/);
  assert.match(source, /primitive\.recommendedAction/);
});

test("Studio gallery imports the local font and approved Lucide package", async () => {
  const source = await readFile("apps/studio/src/main.ts", "utf8");
  assert.match(source, /@fontsource-variable\/geist/);
  assert.match(source, /from "lucide"/);
  assert.doesNotMatch(source, /https?:\/\//);
});

test("Studio gallery contains explicit tablet and mobile reflow rules", async () => {
  const css = await readFile("apps/studio/src/styles.css", "utf8");
  assert.match(css, /@media \(max-width: 54rem\)/);
  assert.match(css, /@media \(max-width: 38rem\)/);
  assert.match(css, /\.rail\s*\{[\s\S]*?inset: auto 0 0;/);
  assert.match(css, /\.metrics,\s*\n\s*\.primitive-grid\s*\{\s*\n\s*grid-template-columns: 1fr;/);
});
