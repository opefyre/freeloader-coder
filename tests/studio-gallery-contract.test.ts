import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Studio uses a React landmark, skip link, and labeled shadcn tabs", async () => {
  const html = await readFile("apps/studio/index.html", "utf8");
  const entry = await readFile("apps/studio/src/main.tsx", "utf8");
  const source = await readFile("apps/studio/src/App.tsx", "utf8");
  assert.match(html, /src="\/src\/main\.tsx"/);
  assert.match(entry, /createRoot/);
  assert.match(source, /href="#workspace"/);
  assert.match(source, /<main id="workspace"/);
  assert.match(source, /aria-label="Control center views"/);
  assert.match(source, /TabsTrigger value="overview"/);
});

test("Studio imports shadcn tokens, Onest, and the approved Phosphor package", async () => {
  const source = await readFile("apps/studio/src/App.tsx", "utf8");
  const css = await readFile("apps/studio/src/globals.css", "utf8");
  assert.match(css, /@fontsource-variable\/onest/);
  assert.match(css, /@import "shadcn\/tailwind\.css"/);
  assert.doesNotMatch(`${css}\n${source}`, /(?:linear|radial)-gradient/);
  assert.match(source, /@phosphor-icons\/react/);
  assert.doesNotMatch(source, /lucide/);
  assert.doesNotMatch(css, /url\(["']?https?:\/\//);
  assert.doesNotMatch(source, /target="_blank"(?![\s\S]{0,80}rel="noreferrer")/);
});

test("Studio ships persistent system, light, and dark themes plus an original vector mark", async () => {
  const source = await readFile("apps/studio/src/App.tsx", "utf8");
  const theme = await readFile("apps/studio/src/theme.ts", "utf8");
  const mark = await readFile("apps/studio/public/pipeline-studio-mark.svg", "utf8");
  assert.match(source, /aria-label="Color theme"/);
  assert.match(theme, /"system", "light", "dark"/);
  assert.match(theme, /pipeline-studio-theme/);
  assert.match(theme, /prefers-color-scheme: dark/);
  assert.match(mark, /<svg/);
  assert.match(mark, /protected orchestration core/);
  assert.match(mark, /mask id="orchestration-core"/);
  assert.match(mark, /stroke-linecap="round"/);
  assert.match(mark, /<rect[^>]+rx="16"[^>]+mask="url\(#orchestration-core\)"/);
});

test("Studio contains explicit wide, tablet, and mobile reflow rules", async () => {
  const css = await readFile("apps/studio/src/globals.css", "utf8");
  const source = await readFile("apps/studio/src/App.tsx", "utf8");
  assert.match(css, /@media \(max-width: 76rem\)/);
  assert.match(css, /@media \(max-width: 48rem\)/);
  assert.match(source, /lg:grid-cols-\[15\.5rem_minmax\(0,1fr\)\]/);
  assert.match(source, /sm:grid-cols-5/);
});
