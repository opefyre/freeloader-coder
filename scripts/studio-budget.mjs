import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";

import {
  assessBundleBudgets,
  studioBundleBudgets,
} from "../dist/packages/releases/src/bundle-budget.js";

const outputDirectory = resolve("dist/studio");
const manifestPath = resolve(outputDirectory, ".vite/manifest.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const assetsByFile = new Map();

for (const item of Object.values(manifest)) {
  if (!item || typeof item !== "object" || typeof item.file !== "string") continue;
  if (!item.file.endsWith(".js")) continue;
  const current = assetsByFile.get(item.file);
  assetsByFile.set(item.file, {
    file: item.file,
    isEntry: Boolean(item.isEntry) || Boolean(current?.isEntry),
  });
}

const assets = [];
for (const asset of assetsByFile.values()) {
  const measurement = await stat(resolve(outputDirectory, asset.file));
  const kind = asset.isEntry
    ? "entry"
    : /(?:react|rolldown)-runtime/.test(asset.file)
      ? "shared"
      : "feature";
  assets.push({ file: asset.file, bytes: measurement.size, kind });
}

const result = assessBundleBudgets(assets);
for (const asset of result.assets) {
  console.log(
    `${asset.kind.padEnd(7)} ${String(asset.bytes).padStart(7)} / ${String(studioBundleBudgets[asset.kind]).padStart(7)}  ${asset.file}`
  );
}
if (!result.passed) {
  throw new Error(`Studio bundle budget failed:\n${result.failures.join("\n")}`);
}
console.log("Studio bundle budgets passed.");
