import { resolve } from "node:path";
import { ProjectArtifactTransformService } from "../dist/apps/core/src/project-artifact-transform.js";

const apply = process.argv.includes("--apply");
const rootArgument = process.argv.find((argument) => argument.startsWith("--root="));
const root = resolve(rootArgument?.slice("--root=".length) || process.cwd());
const receipt = await new ProjectArtifactTransformService().transform({
  root,
  mode: apply ? "apply" : "dry_run",
  replacements: [{ from: "Pipeline Studio", to: "Codkesh" }],
  producer: "codkesh:identity-refresh",
});
process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
