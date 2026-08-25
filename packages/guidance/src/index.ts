import { z } from "zod";

export const helpJourneySchema = z.enum([
  "first_project",
  "first_provider",
  "first_plan",
  "first_preview",
  "first_restore",
  "first_publish",
  "first_recovery"
]);
export type HelpJourney = z.infer<typeof helpJourneySchema>;

export const helpCategorySchema = z.enum([
  "start",
  "providers",
  "work",
  "safety",
  "recovery",
  "publishing",
  "contributing"
]);
export type HelpCategory = z.infer<typeof helpCategorySchema>;

export const helpArticleSchema = z.strictObject({
  schemaVersion: z.literal(1),
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{2,80}$/),
  title: z.string().min(3).max(120),
  summary: z.string().min(10).max(280),
  category: helpCategorySchema,
  journeys: z.array(helpJourneySchema).max(7),
  keywords: z.array(z.string().min(2).max(40)).max(30),
  steps: z.array(z.string().min(3).max(240)).min(1).max(12),
  safeAlternative: z.string().min(3).max(240).nullable(),
  advancedDetail: z.string().min(3).max(800).nullable(),
  offline: z.boolean(),
  owner: z.string().min(2).max(80),
  reviewedAt: z.string().date(),
  reviewAfter: z.string().date(),
  sourcePath: z.string().regex(/^docs\/[a-zA-Z0-9_./-]+\.md$/),
  jiraKey: z.string().regex(/^PIPE-\d+$/)
});
export type HelpArticle = z.infer<typeof helpArticleSchema>;

const rawArticles: readonly HelpArticle[] = [
  article({
    id: "add-your-first-project",
    title: "Add your first project",
    summary: "Register a local repository or clone from GitHub without moving or overwriting existing work.",
    category: "start",
    journeys: ["first_project"],
    keywords: ["repository", "clone", "github", "local", "start"],
    steps: [
      "Open Projects and choose Local folder or Clone from GitHub.",
      "Review the read-only repository inspection and any unsupported-layout warning.",
      "Confirm the proposed project record; no source changes occur during registration.",
      "Continue to the grounded starter plan only after the project facts look correct."
    ],
    safeAlternative: "If the layout is unsupported, keep the repository unchanged and use the compatibility details to choose a supported root.",
    sourcePath: "docs/guides/first-project.md",
    jiraKey: "PIPE-100"
  }),
  article({
    id: "connect-a-free-provider",
    title: "Connect a free provider",
    summary: "Add an API key through secure entry and admit only account-verified free capacity.",
    category: "providers",
    journeys: ["first_provider"],
    keywords: ["api key", "free", "quota", "provider", "vault"],
    steps: [
      "Open Settings, then Connections, and select the provider.",
      "Use the provider dashboard link to create the minimum required credential.",
      "Paste it only into secure entry; Codkesh stores it in the operating-system vault.",
      "Wait for account, model, quota, and capability checks before the route becomes Ready."
    ],
    safeAlternative: "If free status cannot be proven, leave the route inactive and use another verified provider.",
    sourcePath: "docs/guides/provider-connections.md",
    jiraKey: "PIPE-102"
  }),
  article({
    id: "understand-and-approve-a-plan",
    title: "Understand and approve a plan",
    summary: "Inspect scope, assumptions, files, effects, and validation before implementation begins.",
    category: "work",
    journeys: ["first_plan"],
    keywords: ["plan", "approval", "scope", "assumption", "task"],
    steps: [
      "Read the outcome and bounded task graph.",
      "Resolve only assumptions marked as blocking.",
      "Inspect affected files, permissions, cost, evidence, and undo behavior.",
      "Approve the frozen plan or edit it before any implementation effect."
    ],
    safeAlternative: "If the intended outcome is unclear, ask the pipeline to revise the plan without starting implementation.",
    sourcePath: "docs/guides/plans-and-approvals.md",
    jiraKey: "PIPE-100"
  }),
  article({
    id: "review-a-verified-preview",
    title: "Review a verified preview",
    summary: "Separate visual output, deterministic checks, and model review before accepting a change.",
    category: "work",
    journeys: ["first_preview"],
    keywords: ["preview", "validation", "review", "screenshot", "diff"],
    steps: [
      "Open the checkpoint preview from Work or Evidence.",
      "Compare the visual result and diff with the requested outcome.",
      "Check deterministic validation and independent reviewer evidence.",
      "Keep the result only when the observable postconditions pass."
    ],
    safeAlternative: "Restore the previous checkpoint if the preview is wrong or evidence is incomplete.",
    sourcePath: "docs/guides/previews-and-evidence.md",
    jiraKey: "PIPE-100"
  }),
  article({
    id: "restore-a-checkpoint",
    title: "Restore a checkpoint safely",
    summary: "Preview restore impact, preserve unrelated work, and return to a verified state.",
    category: "recovery",
    journeys: ["first_restore", "first_recovery"],
    keywords: ["restore", "checkpoint", "rollback", "conflict", "recovery"],
    steps: [
      "Choose a verified checkpoint and preview the affected files.",
      "Review conflicts and preserve both versions when intent is uncertain.",
      "Approve the bounded restore effect.",
      "Run validation again and confirm the restored state."
    ],
    safeAlternative: "Create a new checkpoint and ask for help if unrelated changes overlap the restore target.",
    sourcePath: "docs/guides/recovery.md",
    jiraKey: "PIPE-100"
  }),
  article({
    id: "publish-verified-work",
    title: "Publish verified work",
    summary: "Push or create a pull request only after target, branch, evidence, and external effects are confirmed.",
    category: "publishing",
    journeys: ["first_publish"],
    keywords: ["push", "pull request", "github", "publish", "branch"],
    steps: [
      "Confirm the repository, branch, commit, and remote destination.",
      "Review the exact external write and attached evidence.",
      "Approve the one-time publish effect.",
      "Observe the remote commit or pull request before marking publication complete."
    ],
    safeAlternative: "Keep the verified commit local when remote access or target identity is uncertain.",
    sourcePath: "docs/guides/publishing.md",
    jiraKey: "PIPE-102"
  }),
  article({
    id: "recover-stuck-or-interrupted-work",
    title: "Recover stuck or interrupted work",
    summary: "Distinguish slow work, scheduled capacity waits, stopped services, and tasks that need your decision.",
    category: "recovery",
    journeys: ["first_recovery"],
    keywords: ["stuck", "interrupted", "retry", "quota", "service", "offline"],
    steps: [
      "Open Evidence and inspect the current lease, last event, and provider activity.",
      "Treat active model or validation work within its healthy window as running.",
      "Use Resume only when the recommended repair confirms there is no live lease.",
      "Choose an alternative when the task is quarantined or explicitly needs your decision."
    ],
    safeAlternative: "Export a redacted support bundle if automatic recovery cannot prove a safe next action.",
    sourcePath: "docs/guides/recovery.md",
    jiraKey: "PIPE-100"
  }),
  article({
    id: "update-pipeline-studio",
    title: "Update Codkesh safely",
    summary: "Verify compatibility, preserve projects and data, preview migrations, and retain a proven rollback before applying a source update.",
    category: "safety",
    journeys: [],
    keywords: ["update", "release", "migration", "compatibility", "rollback"],
    steps: [
      "Open Releases and confirm the target manifest, signature, compatibility evidence, and known limitations.",
      "Wait for active work to reach a checkpoint, then create the project checkpoint and database backup.",
      "Review migrations, changed files, required disk, and the exact rollback version.",
      "Apply and verify the update; restore the last compatible version if verification is interrupted or fails."
    ],
    safeAlternative: "Remain on the current supported version when compatibility, signature, preservation, or rollback evidence is incomplete.",
    sourcePath: "docs/guides/updating.md",
    jiraKey: "PIPE-98"
  }),
  article({
    id: "inspect-trust-and-data-use",
    title: "Inspect trust and data use",
    summary: "Trace project governance, release safeguards, data destinations, consent, and responsible-AI rules back to versioned source.",
    category: "safety",
    journeys: [],
    keywords: ["trust", "governance", "privacy", "telemetry", "training", "supply chain"],
    steps: [
      "Open Trust and choose Governance, Supply chain, or Data & AI.",
      "Follow a material decision to its versioned repository record and linked release.",
      "Inspect the release firewall and use the mismatch simulation to confirm required evidence fails closed.",
      "Review every declared data flow before changing a consent choice; paid usage remains separate and locked off."
    ],
    safeAlternative: "Keep optional data flows disabled and inspect the repository policy when a destination or retention rule is unclear.",
    sourcePath: "docs/governance/privacy-data-ai.md",
    jiraKey: "PIPE-108"
  }),
  article({
    id: "inspect-accessibility-evidence",
    title: "Inspect accessibility evidence",
    summary: "Confirm keyboard, focus, semantics, contrast, motion, zoom, reflow, and chart alternatives before a release proceeds.",
    category: "safety",
    journeys: [],
    keywords: ["accessibility", "wcag", "keyboard", "focus", "contrast", "zoom", "chart"],
    steps: [
      "Open Accessibility and review all eight required WCAG 2.2 AA dimensions.",
      "Confirm automated results and named manual evidence are current for critical workflows.",
      "Use the chart-alternative failure fixture to confirm one critical issue blocks release.",
      "Open Foundation evidence to trace each acceptance claim to a test, negative fixture, owner, and source artifact."
    ],
    safeAlternative: "Keep the candidate blocked when any required check is failed, missing, not run, stale, or lacks meaningful evidence.",
    sourcePath: "docs/quality/accessibility-release-gate.md",
    jiraKey: "PIPE-35"
  }),
  article({
    id: "share-a-safe-support-report",
    title: "Share a safe support report",
    summary: "Create a reproducible report without credentials, source code, personal paths, or private account data.",
    category: "safety",
    journeys: [],
    keywords: ["support", "bug", "diagnostics", "redaction", "security"],
    steps: [
      "Choose the report type and describe observable behavior.",
      "Preview locally redacted diagnostics and selected environment facts.",
      "Remove source snippets, secrets, personal paths, and account identifiers.",
      "Use the private disclosure channel for security vulnerabilities."
    ],
    safeAlternative: "Share only the correlation ID and reproduction class when diagnostic content is not safe to disclose.",
    sourcePath: "docs/support/reporting.md",
    jiraKey: "PIPE-103"
  }),
  article({
    id: "make-a-contribution",
    title: "Make a contribution",
    summary: "Implement a ticket with its architecture, acceptance evidence, compatibility, and documentation context.",
    category: "contributing",
    journeys: [],
    keywords: ["contributor", "architecture", "tests", "ticket", "pull request"],
    steps: [
      "Start from a self-contained Jira ticket and its cited architecture contract.",
      "Run setup and focused tests before editing.",
      "Update schemas, fixtures, compatibility, and documentation with the implementation.",
      "Run the complete local verification suite and attach observable evidence."
    ],
    safeAlternative: "Open a draft change with the exact unresolved decision instead of inventing product behavior.",
    sourcePath: "docs/contributing/README.md",
    jiraKey: "PIPE-104"
  })
] as const;

export const helpArticles = Object.freeze(rawArticles.map((value) => helpArticleSchema.parse(value)));

export interface HelpSearchResult {
  readonly article: HelpArticle;
  readonly score: number;
  readonly matchedTerms: readonly string[];
}

export function searchHelp(input: {
  readonly query: string;
  readonly category?: HelpCategory | undefined;
  readonly journey?: HelpJourney | undefined;
  readonly offlineOnly?: boolean | undefined;
  readonly now?: string | undefined;
}): readonly HelpSearchResult[] {
  const terms = normalizeTerms(input.query);
  const now = input.now ?? new Date().toISOString().slice(0, 10);
  return helpArticles
    .filter((article) => input.category === undefined || article.category === input.category)
    .filter((article) => input.journey === undefined || article.journeys.includes(input.journey))
    .filter((article) => !input.offlineOnly || article.offline)
    .map((article) => {
      const title = article.title.toLowerCase();
      const haystack = [
        article.title,
        article.summary,
        article.category,
        ...article.keywords,
        ...article.steps
      ].join(" ").toLowerCase();
      const matchedTerms = terms.filter((term) => haystack.includes(term));
      const score = matchedTerms.reduce(
        (total, term) => total + (title.includes(term) ? 8 : article.keywords.includes(term) ? 4 : 1),
        0
      ) + (article.reviewAfter < now ? -20 : 0);
      return { article, score, matchedTerms };
    })
    .filter((result) => terms.length === 0 || result.matchedTerms.length > 0)
    .sort((left, right) => right.score - left.score || left.article.title.localeCompare(right.article.title));
}

export type HelpContext =
  | { readonly kind: "approval"; readonly topic: "plan" | "publish" | "restore" }
  | { readonly kind: "error"; readonly code: "quota" | "offline" | "permission" | "interrupted" | "unsupported" }
  | { readonly kind: "journey"; readonly journey: HelpJourney };

export function contextualHelp(context: HelpContext): readonly HelpArticle[] {
  if (context.kind === "journey") {
    return helpArticles.filter((article) => article.journeys.includes(context.journey));
  }
  const query = context.kind === "approval"
    ? { plan: "approve plan", publish: "publish", restore: "restore" }[context.topic]
    : {
        quota: "quota provider",
        offline: "offline interrupted",
        permission: "permission approval",
        interrupted: "interrupted recovery",
        unsupported: "unsupported support"
      }[context.code];
  return searchHelp({ query }).map((result) => result.article).slice(0, 3);
}

export const supportReportKindSchema = z.enum([
  "bug",
  "provider",
  "installation",
  "feature",
  "security",
  "documentation"
]);
export type SupportReportKind = z.infer<typeof supportReportKindSchema>;

export const supportReportInputSchema = z.strictObject({
  schemaVersion: z.literal(1),
  kind: supportReportKindSchema,
  summary: z.string().min(8).max(180),
  observed: z.string().min(8).max(2_000),
  expected: z.string().min(3).max(1_000),
  reproduction: z.array(z.string().min(3).max(400)).min(1).max(12),
  diagnostics: z.array(z.string().max(1_000)).max(20),
  consentToShare: z.boolean()
});
export type SupportReportInput = z.infer<typeof supportReportInputSchema>;

export interface SupportDraft {
  readonly destination: "public_issue" | "private_security";
  readonly title: string;
  readonly body: string;
  readonly redactions: number;
  readonly safeToShare: boolean;
  readonly blockedReasons: readonly string[];
}

export function buildSupportDraft(rawInput: unknown): SupportDraft {
  const input = supportReportInputSchema.parse(rawInput);
  const content = [
    input.summary,
    input.observed,
    input.expected,
    ...input.reproduction,
    ...input.diagnostics
  ];
  let redactions = 0;
  const sanitized = content.map((value) => redactSupportContent(value, () => { redactions += 1; }));
  const sourceRisk = input.diagnostics.some((value) =>
    /(?:^|\s)(?:function|class|import|export)\s+[A-Za-z_$]|(?:src|apps|packages)\/.+\.(?:ts|tsx|js|py)/.test(value)
  );
  const blockedReasons = [
    ...(!input.consentToShare ? ["Sharing consent is required."] : []),
    ...(sourceRisk ? ["Diagnostics appear to include source code or source paths."] : [])
  ];
  return {
    destination: input.kind === "security" ? "private_security" : "public_issue",
    title: `[${input.kind}] ${sanitized[0]}`,
    body: [
      "## Observed",
      sanitized[1],
      "",
      "## Expected",
      sanitized[2],
      "",
      "## Reproduction",
      ...input.reproduction.map((_, index) => `${index + 1}. ${sanitized[index + 3]}`),
      "",
      "## Redacted diagnostics",
      ...input.diagnostics.map((_, index) => `- ${sanitized[index + 3 + input.reproduction.length]}`)
    ].join("\n"),
    redactions,
    safeToShare: blockedReasons.length === 0,
    blockedReasons
  };
}

export function supportAlternative(input: {
  readonly supportedVersion: boolean;
  readonly requestType: "product" | "security" | "customization" | "billing";
}): string {
  if (input.requestType === "security") return "Use the private security disclosure channel.";
  if (!input.supportedVersion) return "Reproduce on the latest supported version or attach its compatibility status.";
  if (input.requestType === "customization") return "Ask in community discussions or propose a documented extension.";
  if (input.requestType === "billing") return "Contact the billing owner for that provider; Codkesh cannot inspect provider charges.";
  return "Create a redacted issue with observable behavior and reproduction steps.";
}

export interface DocumentationHealth {
  readonly articleId: string;
  readonly state: "current" | "stale" | "missing";
  readonly detail: string;
}

export function documentationHealth(input: {
  readonly existingPaths: ReadonlySet<string>;
  readonly now: string;
}): readonly DocumentationHealth[] {
  return helpArticles.map((article) => {
    if (!input.existingPaths.has(article.sourcePath)) {
      return { articleId: article.id, state: "missing", detail: `Missing ${article.sourcePath}.` };
    }
    if (article.reviewAfter < input.now) {
      return { articleId: article.id, state: "stale", detail: `Review expired on ${article.reviewAfter}.` };
    }
    return { articleId: article.id, state: "current", detail: `Owned by ${article.owner}; reviewed ${article.reviewedAt}.` };
  });
}

function article(input: Omit<HelpArticle, "schemaVersion" | "offline" | "owner" | "reviewedAt" | "reviewAfter" | "advancedDetail"> & {
  readonly advancedDetail?: string | null;
}): HelpArticle {
  return {
    schemaVersion: 1,
    offline: true,
    owner: "Documentation & Support",
    reviewedAt: "2026-07-28",
    reviewAfter: "2026-10-28",
    advancedDetail: input.advancedDetail ?? "Open Evidence for canonical state, correlation IDs, and local diagnostics.",
    ...input
  };
}

function normalizeTerms(value: string): readonly string[] {
  return [...new Set(value.toLowerCase().normalize("NFKC").split(/[^a-z0-9]+/).filter((term) => term.length > 1))];
}

function redactSupportContent(value: string, onRedaction: () => void): string {
  const patterns = [
    /(token|secret|password|api[_-]?key)\s*[=:]\s*\S+/gi,
    /\b(?:sk|gsk|ghp|github_pat)-[a-zA-Z0-9_-]{8,}\b/g,
    /\/Users\/[^/\s]+/g,
    /C:\\Users\\[^\\\s]+/gi,
    /\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b/g
  ];
  return patterns.reduce((result, pattern) => result.replace(pattern, (match) => {
    onRedaction();
    if (/^\/Users\//.test(match)) return "/Users/[user]";
    if (/^C:\\Users\\/i.test(match)) return "C:\\Users\\[user]";
    return "[redacted]";
  }), value);
}
