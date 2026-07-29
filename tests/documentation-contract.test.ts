import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";

import { helpArticles } from "../packages/guidance/src/index.js";

const root = process.cwd();

test("every in-product article has an existing source guide", async () => {
  await Promise.all(
    helpArticles.map((article) => access(resolve(root, article.sourcePath)))
  );
});

test("relative Markdown links in the sprint documentation resolve", async () => {
  const documents = [
    "README.md",
    "CONTRIBUTING.md",
    "SECURITY.md",
    "docs/guides/README.md",
    "docs/guides/first-project.md",
    "docs/guides/provider-connections.md",
    "docs/guides/plans-and-approvals.md",
    "docs/guides/previews-and-evidence.md",
    "docs/guides/recovery.md",
    "docs/guides/publishing.md",
    "docs/guides/updating.md",
    "docs/support/reporting.md",
    "docs/contributing/README.md",
    "docs/architecture/release-lifecycle.md",
    "docs/governance/README.md",
    "docs/governance/project-governance.md",
    "docs/governance/supply-chain.md",
    "docs/governance/privacy-data-ai.md",
    "docs/governance/disclosures.md",
    "CODE_OF_CONDUCT.md",
    "docs/quality/accessibility-release-gate.md",
    "docs/evidence/PIPE-41-GITHUB-ENTRY.md",
    "docs/evidence/PIPE-35-117-124-ACCESSIBILITY-FOUNDATION.md",
  ];
  for (const document of documents) {
    const absolute = resolve(root, document);
    const content = await readFile(absolute, "utf8");
    const links = [...content.matchAll(/\[[^\]]+\]\((?!https?:|#)([^)]+)\)/g)];
    for (const match of links) {
      const target = match[1];
      assert.ok(target, `Expected a target in ${document}.`);
      await access(resolve(dirname(absolute), target));
    }
  }
});

test("public issue templates warn against unsafe disclosure", async () => {
  const templates = ["bug.yml", "provider.yml", "installation.yml"];
  for (const template of templates) {
    const content = await readFile(
      resolve(root, ".github/ISSUE_TEMPLATE", template),
      "utf8"
    );
    assert.match(content, /credential|API key|secrets/i);
    assert.match(content, /source|environment files/i);
  }
  const config = await readFile(
    resolve(root, ".github/ISSUE_TEMPLATE/config.yml"),
    "utf8"
  );
  assert.match(config, /security\/advisories\/new/);
  assert.match(config, /Never include credentials/i);
});

test("the contributor guide covers every coupled engineering contract", async () => {
  const content = await readFile(
    resolve(root, "docs/contributing/README.md"),
    "utf8"
  );
  for (const concept of [
    "Schema changes",
    "State-machine changes",
    "Provider adapters",
    "Tool or permission changes",
    "UI changes",
    "npm run verify",
    "Jira completion comment",
  ]) {
    assert.match(content, new RegExp(concept, "i"));
  }
});
