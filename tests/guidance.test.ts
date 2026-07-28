import assert from "node:assert/strict";
import test from "node:test";

import {
  buildSupportDraft,
  contextualHelp,
  documentationHealth,
  helpArticleSchema,
  helpArticles,
  searchHelp,
  supportAlternative,
  supportReportInputSchema,
} from "../packages/guidance/src/index.js";

test("the offline catalogue covers every first-use journey with current guidance", () => {
  const journeys = new Set(helpArticles.flatMap((article) => article.journeys));
  assert.deepEqual(
    [...journeys].sort(),
    [
      "first_plan",
      "first_preview",
      "first_project",
      "first_provider",
      "first_publish",
      "first_recovery",
      "first_restore",
    ]
  );
  assert.ok(helpArticles.every((article) => article.offline));
  assert.ok(helpArticles.every((article) => article.reviewAfter >= "2026-07-28"));
});

test("search ranks exact title matches and supports category and journey context", () => {
  assert.equal(searchHelp({ query: "publish verified work" })[0]?.article.id, "publish-verified-work");
  assert.ok(
    searchHelp({ query: "", category: "providers" }).every(
      (result) => result.article.category === "providers"
    )
  );
  assert.equal(
    contextualHelp({ kind: "journey", journey: "first_restore" })[0]?.id,
    "restore-a-checkpoint"
  );
  assert.ok(
    contextualHelp({ kind: "error", code: "quota" }).some(
      (article) => article.id === "recover-stuck-or-interrupted-work"
    )
  );
});

test("help articles and support inputs reject undeclared sensitive fields", () => {
  const article = { ...helpArticles[0], credential: "must-not-exist" };
  assert.equal(helpArticleSchema.safeParse(article).success, false);
  assert.equal(
    supportReportInputSchema.safeParse({
      schemaVersion: 1,
      kind: "bug",
      summary: "A sufficiently long summary",
      observed: "A sufficiently clear observed behavior",
      expected: "Safe result",
      reproduction: ["Open the task"],
      diagnostics: [],
      consentToShare: true,
      apiKey: "must-not-exist",
    }).success,
    false
  );
});

test("support drafts redact secrets, account identifiers, and personal paths locally", () => {
  const draft = buildSupportDraft({
    schemaVersion: 1,
    kind: "bug",
    summary: "Pipeline stopped before completion",
    observed:
      "api_key=secret-value email=builder@example.com path=/Users/alex/project",
    expected: "The task should recover safely.",
    reproduction: ["Open the affected task."],
    diagnostics: ["token=super-secret correlation_id=abc"],
    consentToShare: true,
  });
  assert.equal(draft.destination, "public_issue");
  assert.equal(draft.safeToShare, true);
  assert.ok(draft.redactions >= 4);
  assert.doesNotMatch(draft.body, /secret-value|builder@example\.com|\/Users\/alex|super-secret/);
  assert.match(draft.body, /\[redacted\]|\/Users\/\[user\]/);
});

test("support blocks source disclosure and routes vulnerabilities privately", () => {
  const blocked = buildSupportDraft({
    schemaVersion: 1,
    kind: "bug",
    summary: "A source file appears in diagnostics",
    observed: "The task failed during validation.",
    expected: "Validation should finish.",
    reproduction: ["Open the task and inspect Evidence."],
    diagnostics: ["apps/studio/src/App.tsx contains export function App"],
    consentToShare: true,
  });
  assert.equal(blocked.safeToShare, false);
  assert.match(blocked.blockedReasons.join(" "), /source code/i);

  const security = buildSupportDraft({
    schemaVersion: 1,
    kind: "security",
    summary: "Private disclosure is required",
    observed: "An authorization decision appears incorrect.",
    expected: "The effect should be denied.",
    reproduction: ["Use a minimal non-sensitive reproduction."],
    diagnostics: [],
    consentToShare: true,
  });
  assert.equal(security.destination, "private_security");
});

test("support always explains a usable alternative", () => {
  assert.match(
    supportAlternative({ supportedVersion: false, requestType: "product" }),
    /latest supported version/i
  );
  assert.match(
    supportAlternative({ supportedVersion: true, requestType: "security" }),
    /private security/i
  );
  assert.match(
    supportAlternative({ supportedVersion: true, requestType: "billing" }),
    /billing owner/i
  );
});

test("documentation health distinguishes current, stale, and missing sources", () => {
  const allPaths = new Set(helpArticles.map((article) => article.sourcePath));
  assert.ok(
    documentationHealth({ existingPaths: allPaths, now: "2026-08-01" }).every(
      (item) => item.state === "current"
    )
  );

  const withoutFirst = new Set([...allPaths].slice(1));
  assert.equal(
    documentationHealth({ existingPaths: withoutFirst, now: "2026-11-01" }).find(
      (item) => item.articleId === helpArticles[0]?.id
    )?.state,
    "missing"
  );
  assert.ok(
    documentationHealth({ existingPaths: allPaths, now: "2026-11-01" }).some(
      (item) => item.state === "stale"
    )
  );
});
