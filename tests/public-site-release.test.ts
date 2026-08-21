import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const app = await readFile("apps/site/src/App.tsx", "utf8");
const css = await readFile("apps/site/src/globals.css", "utf8");
const html = await readFile("apps/site/index.html", "utf8");
const config = await readFile("apps/site/vite.config.ts", "utf8");
const robots = await readFile("apps/site/public/robots.txt", "utf8");
const sitemap = await readFile("apps/site/public/sitemap.xml", "utf8");
const manifest = JSON.parse(await readFile("apps/site/public/site.webmanifest", "utf8"));

test("public site exposes the complete source-first adoption journey", () => {
  for (const anchor of ["#demo", "#capabilities", "#trust", "#compare", "#faq"]) assert.ok(app.includes(anchor));
  for (const phrase of ["Full test suite passing", "$0 automatic spend", "Evidence before Done", "Privacy-conscious analytics", "Public preview live · field evidence pending", "real adoption evidence still comes next"]) assert.ok(app.includes(phrase));
  for (const phrase of ["Illustrative run · no live effect", "Bounded demo", "Preview evidence · local checks · $0.00"]) assert.ok(app.includes(phrase));
  assert.ok(app.includes("git clone https://github.com/opefyre/freeloader-coder.git"));
  assert.ok(app.includes("aria-label=\"Primary\""));
  assert.ok(app.includes("role=\"tablist\""));
  assert.ok(app.includes("aria-live=\"polite\""));
});

test("public site rejects deceptive visual and tracking shortcuts", () => {
  assert.doesNotMatch(css, /gradient/i);
  assert.doesNotMatch(app, /google-analytics|segment|mixpanel|posthog|amplitude/i);
  assert.doesNotMatch(html, /google-analytics|segment|mixpanel|posthog|amplitude/i);
  assert.doesNotMatch(app, /download now|production[- ]ready|unlimited free/i);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(css, /forced-colors/);
  assert.match(css, /@media \(max-width: 42rem\)/);
});

test("public site builds independently on a dedicated route and output", () => {
  assert.match(config, /port: 4311/);
  assert.match(config, /dist\/site/);
  assert.match(html, /<meta name="robots" content="index, follow"/);
  assert.match(html, /og:title/);
  assert.match(html, /pipeline-studio-mark\.svg/);
});

test("public discovery metadata uses one canonical, crawlable origin", () => {
  for (const marker of ["rel=\"canonical\"", "google-site-verification", "og:url", "og:image", "twitter:card", "rel=\"manifest\""]) assert.ok(html.includes(marker));
  assert.ok(html.includes('type="application/ld+json"'));
  assert.match(robots, /Allow: \/\s/);
  assert.match(robots, /Sitemap: https:\/\/pipeline-studio\.pages\.dev\/sitemap\.xml/);
  assert.match(sitemap, /<loc>https:\/\/pipeline-studio\.pages\.dev\/<\/loc>/);
  assert.equal(manifest.start_url, "/");
  assert.equal(manifest.name, "Codkesh");
});
