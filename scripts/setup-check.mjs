import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";

const required = [
  "apps/studio/package.json",
  "apps/desktop/package.json",
  "apps/core/package.json",
  "apps/worker/package.json",
  "packages/orchestration/package.json",
  "packages/schemas/package.json",
  "packages/storage/package.json",
  "packages/policy/package.json",
  "packages/providers/package.json",
  "packages/connectors/package.json",
  "packages/tools/package.json",
  "packages/validation/package.json",
  "packages/evals/package.json",
  "packages/execution/package.json",
  "packages/runtime/package.json",
  "packages/security/package.json",
  "packages/vault/package.json",
  "packages/ui/package.json",
  "fixtures/demo-project.json"
];

for (const path of required) {
  await stat(resolve(path));
}

const packageJson = JSON.parse(await readFile("package.json", "utf8"));
const major = Number(process.versions.node.split(".")[0]);
if (major < 22) throw new Error("Pipeline Studio requires Node.js 22 or newer.");
if (packageJson.private !== true) throw new Error("Workspace root must stay private.");

console.log(`Setup OK: Node ${process.versions.node}, ${required.length} required entries.`);
