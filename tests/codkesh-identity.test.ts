import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const ownerFacingFiles = [
  "README.md",
  "CODE_OF_CONDUCT.md",
  "CONTRIBUTING.md",
  "THIRD_PARTY_NOTICES.md",
  "apps/oauth-broker/src/index.ts",
  "apps/core/src/control-plane.ts",
  "apps/core/src/control-plane-main.ts",
  "apps/core/src/local-commit.ts",
  "apps/core/src/local-integration.ts",
  "apps/core/src/local-proposal.ts",
  "apps/core/src/pipeline-mcp.ts",
  "apps/core/src/project-lifecycle-service.ts",
  "apps/core/src/project-task-workspace.ts",
  "apps/studio/src/components/integrations/tool-device-fabric.tsx",
  "apps/studio/src/components/orchestration/orchestration-workbench.tsx",
  "packages/execution/src/resources.ts",
  "packages/guidance/src/index.ts",
  "packages/providers/src/wizard.ts",
  "packages/releases/src/index.ts",
  "packages/runtime/src/preflight.ts",
  "packages/ui/src/content.ts",
  "scripts/setup-check.mjs",
  "scripts/setup.mjs",
  "scripts/start-agent-canvas.mjs",
  "scripts/start.mjs",
  "engine/scripts/dev-with-automation.mjs",
  "engine/package.json",
] as const;

test("owner-facing product surfaces use one Codkesh identity and canonical source", async () => {
  for (const path of ownerFacingFiles) {
    const source = await readFile(path, "utf8");
    assert.doesNotMatch(source, /Pipeline Studio/, `${path} exposes the legacy product name`);
    assert.doesNotMatch(
      source,
      /github\.com\/opefyre\/pipeline-studio/,
      `${path} links to the retired repository`,
    );
  }

  const readme = await readFile("README.md", "utf8");
  assert.match(readme, /^# Codkesh$/m);
  assert.match(readme, /github\.com\/opefyre\/freeloader-coder\.git codkesh/);
});

test("compatibility identifiers remain stable while new Git attribution uses Codkesh", async () => {
  const [packageManifest, controlPlane, theme, vaultContracts, brokerClient, commitSource] =
    await Promise.all([
      readFile("package.json", "utf8"),
      readFile("apps/core/src/control-plane-main.ts", "utf8"),
      readFile("apps/studio/src/theme.ts", "utf8"),
      readFile("packages/vault/src/contracts.ts", "utf8"),
      readFile("apps/studio/src/integration-connection-client.ts", "utf8"),
      readFile("apps/core/src/local-commit.ts", "utf8"),
    ]);

  assert.match(packageManifest, /"name": "pipeline-studio"/);
  assert.match(controlPlane, /\.pipeline-studio/);
  assert.match(theme, /pipeline-studio-theme/);
  assert.match(vaultContracts, /pipeline-studio-local-core/);
  assert.match(brokerClient, /pipeline-studio-oauth\.opefyre\.workers\.dev/);
  assert.match(commitSource, /Codkesh <codkesh@local\.invalid>/);
});

test("legacy commit receipts remain readable during the identity migration", async () => {
  const requestContracts = await readFile(
    "packages/runtime/src/local-requests.ts",
    "utf8",
  );

  assert.match(requestContracts, /Codkesh <codkesh@local\.invalid>/);
  assert.match(
    requestContracts,
    /Pipeline Studio <pipeline-studio@local\.invalid>/,
  );
});
