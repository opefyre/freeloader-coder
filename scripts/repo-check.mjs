import { readdir, readFile } from "node:fs/promises";
import { extname, join } from "node:path";

const mode = process.argv[2];
const roots = ["apps", "packages", "fixtures", "scripts", "tests"];
const textExtensions = new Set([".ts", ".mjs", ".json", ".md", ".css"]);
const forbidden = [
  ["house", "hold"].join(""),
  ["tail", "scale"].join(""),
  ["launch", "agent"].join(""),
  ["oll", "ama"].join(""),
  ["100", ".119"].join("")
];
const failures = [];
const approvedFontTokens = new Set(["packages/ui/src/tokens.css"]);
const approvedColorTokens = new Set(["packages/ui/src/tokens.css"]);
const approvedForcedColorFallbacks = new Set(["packages/ui/src/tokens.css"]);

async function walk(path) {
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const child = join(path, entry.name);
    if (
      entry.isDirectory() &&
      !["node_modules", "dist", ".git", ".vite"].includes(entry.name)
    ) {
      await walk(child);
    }
    else if (textExtensions.has(extname(entry.name))) await inspect(child);
  }
}

async function inspect(path) {
  const content = await readFile(path, "utf8");
  if (!content.endsWith("\n")) failures.push(`${path}: missing final newline`);
  content.split("\n").forEach((line, index) => {
    if (/[ \t]+$/.test(line)) failures.push(`${path}:${index + 1}: trailing whitespace`);
  });
  if (mode === "lint") {
    const lower = content.toLowerCase();
    for (const term of forbidden) {
      if (lower.includes(term)) failures.push(`${path}: forbidden prototype-specific term`);
    }
    if (/sk-[a-z0-9_-]{12,}/i.test(content)) failures.push(`${path}: possible API key`);
    if (
      path.endsWith(".css") &&
      /font-family\s*:/i.test(content) &&
      !approvedFontTokens.has(path) &&
      !/font-family\s*:\s*var\(--ps-font-sans\)/i.test(content)
    ) {
      failures.push(`${path}: feature CSS must use --ps-font-sans`);
    }
    if (
      path.endsWith(".css") &&
      /(?:#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(|oklch\()/i.test(content) &&
      !approvedColorTokens.has(path)
    ) {
      failures.push(`${path}: feature CSS must use semantic color tokens`);
    }
    if (
      path.endsWith(".css") &&
      /\bborder(?:-(?:top|right|bottom|left|block|inline)(?:-(?:width|style|color))?)?\s*:/i.test(
        content
      ) &&
      !approvedForcedColorFallbacks.has(path)
    ) {
      failures.push(`${path}: decorative borders are prohibited`);
    }
    if (
      /from\s+["'](?:react-icons|@heroicons|@phosphor-icons|fortawesome|@fortawesome)\b/.test(
        content
      )
    ) {
      failures.push(`${path}: use the approved Lucide icon family`);
    }
  }
}

if (!["format", "lint"].includes(mode)) throw new Error("Use format or lint.");
for (const root of roots) await walk(root);
if (failures.length) throw new Error(failures.join("\n"));
console.log(`${mode} checks passed.`);
