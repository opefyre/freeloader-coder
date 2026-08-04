import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";

const outputDirectory = resolve("dist/site");
const manifest = JSON.parse(await readFile(resolve(outputDirectory, ".vite/manifest.json"), "utf8"));
const assets = new Map();

for (const item of Object.values(manifest)) {
  if (!item || typeof item !== "object" || typeof item.file !== "string") continue;
  if (item.file.endsWith(".js") || item.file.endsWith(".css")) {
    assets.set(item.file, Boolean(item.isEntry) || Boolean(assets.get(item.file)));
  }
  for (const cssFile of Array.isArray(item.css) ? item.css : []) {
    assets.set(cssFile, Boolean(assets.get(cssFile)));
  }
}

let total = 0;
for (const [file, entry] of assets) {
  const bytes = (await stat(resolve(outputDirectory, file))).size;
  total += bytes;
  const budget = file.endsWith(".css") ? 110_000 : entry ? 260_000 : 210_000;
  console.log(`${entry ? "entry" : "asset"} ${String(bytes).padStart(7)} / ${String(budget).padStart(7)}  ${file}`);
  if (bytes > budget) throw new Error(`Public-site bundle budget failed for ${file}: ${bytes} > ${budget}`);
}
if (total > 480_000) throw new Error(`Public-site total asset budget failed: ${total} > 480000`);
console.log(`Public-site bundle budgets passed (${total} bytes total).`);
