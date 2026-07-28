import { ArrowRight } from "@phosphor-icons/react/ArrowRight";
import { BookOpenText } from "@phosphor-icons/react/BookOpenText";
import { Check } from "@phosphor-icons/react/Check";
import { CheckCircle } from "@phosphor-icons/react/CheckCircle";
import { Code } from "@phosphor-icons/react/Code";
import { Copy } from "@phosphor-icons/react/Copy";
import { GithubLogo } from "@phosphor-icons/react/GithubLogo";
import { Lifebuoy } from "@phosphor-icons/react/Lifebuoy";
import { LinkSimple } from "@phosphor-icons/react/LinkSimple";
import { LockKey } from "@phosphor-icons/react/LockKey";
import { MagnifyingGlass } from "@phosphor-icons/react/MagnifyingGlass";
import { ShieldCheck } from "@phosphor-icons/react/ShieldCheck";
import { Sparkle } from "@phosphor-icons/react/Sparkle";
import { Warning } from "@phosphor-icons/react/Warning";
import { useMemo, useState } from "react";

import {
  buildSupportDraft,
  contextualHelp,
  helpArticles,
  searchHelp,
  type HelpArticle,
  type HelpCategory,
  type HelpJourney,
  type SupportReportKind,
} from "../../../../../packages/guidance/src/index.js";
import { cn } from "../../lib/utils.js";
import { Badge } from "../ui/badge.js";
import { Button } from "../ui/button.js";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../ui/card.js";

const categories: readonly { id: "all" | HelpCategory; label: string }[] = [
  { id: "all", label: "All" },
  { id: "start", label: "Start" },
  { id: "providers", label: "Providers" },
  { id: "work", label: "Work" },
  { id: "safety", label: "Safety" },
  { id: "recovery", label: "Recovery" },
  { id: "publishing", label: "Publish" },
  { id: "contributing", label: "Contribute" },
];

const journeys: readonly {
  id: HelpJourney;
  label: string;
  note: string;
  state: "complete" | "current" | "next";
}[] = [
  { id: "first_project", label: "Project", note: "Add safely", state: "complete" },
  { id: "first_provider", label: "Provider", note: "Verify free", state: "complete" },
  { id: "first_plan", label: "Plan", note: "Understand", state: "current" },
  { id: "first_preview", label: "Preview", note: "See proof", state: "next" },
  { id: "first_restore", label: "Restore", note: "Undo safely", state: "next" },
  { id: "first_publish", label: "Publish", note: "Approve write", state: "next" },
  { id: "first_recovery", label: "Recover", note: "Unblock work", state: "next" },
];

const recoveryCases = [
  { id: "quota", label: "Free quota waiting", description: "No provider can accept work yet." },
  { id: "offline", label: "A machine is offline", description: "The executor or controller cannot be reached." },
  { id: "permission", label: "Permission denied", description: "A requested effect was not authorized." },
  { id: "interrupted", label: "Work was interrupted", description: "The last attempt ended before evidence was complete." },
  { id: "unsupported", label: "Unsupported request", description: "The pipeline cannot safely perform this operation." },
] as const;

const reportKinds: readonly { id: SupportReportKind; label: string }[] = [
  { id: "bug", label: "Bug" },
  { id: "provider", label: "Provider" },
  { id: "installation", label: "Installation" },
  { id: "feature", label: "Feature" },
  { id: "security", label: "Security" },
  { id: "documentation", label: "Docs" },
];

export function HelpCenter() {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<"all" | HelpCategory>("all");
  const [selectedArticleId, setSelectedArticleId] = useState(helpArticles[0]?.id ?? "");
  const [selectedJourney, setSelectedJourney] = useState<HelpJourney>("first_plan");
  const [recoveryCase, setRecoveryCase] =
    useState<(typeof recoveryCases)[number]["id"]>("quota");
  const [reportKind, setReportKind] = useState<SupportReportKind>("bug");
  const [consent, setConsent] = useState(false);
  const [copied, setCopied] = useState(false);

  const results = useMemo(
    () =>
      searchHelp({
        query,
        category: category === "all" ? undefined : category,
        offlineOnly: true,
      }),
    [category, query]
  );
  const selected =
    helpArticles.find((article) => article.id === selectedArticleId) ??
    results[0]?.article ??
    helpArticles[0];
  const recoveryHelp = contextualHelp({ kind: "error", code: recoveryCase });
  const draft = buildSupportDraft({
    schemaVersion: 1,
    kind: reportKind,
    summary: "Pipeline stopped before the task completed",
    observed:
      "The run changed to waiting after the provider request. User path: /Users/demo/project.",
    expected: "The run should resume safely or explain the required decision.",
    reproduction: [
      "Open the affected task in Work.",
      "Inspect the latest event and choose recovery guidance.",
    ],
    diagnostics: [
      "correlation_id=run_demo_01",
      "provider=free-route; api_key=never-share-this",
    ],
    consentToShare: consent,
  });

  function openArticle(article: HelpArticle) {
    setSelectedArticleId(article.id);
    window.setTimeout(() => {
      document.getElementById("help-article")?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    }, 0);
  }

  async function copyDraft() {
    if (!draft.safeToShare) return;
    await navigator.clipboard.writeText(`${draft.title}\n\n${draft.body}`);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1_800);
  }

  return (
    <section aria-labelledby="help-center-title" className="space-y-4">
      <Card className="relative isolate overflow-hidden bg-foreground text-background">
        <div
          aria-hidden="true"
          className="absolute -right-16 -top-24 size-72 rounded-full bg-primary/20 blur-3xl"
        />
        <CardContent className="relative grid gap-8 py-7 sm:py-9 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
          <div>
            <Badge className="bg-background/10 text-background">
              <Sparkle weight="fill" />
              Offline guidance · version 1
            </Badge>
            <h2
              id="help-center-title"
              className="mt-5 max-w-2xl text-3xl font-semibold tracking-[-0.045em] sm:text-4xl"
            >
              Find the safe next move.
            </h2>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-background/65">
              Search the product’s actual workflows, diagnose a blocked run, or
              prepare a locally redacted support report.
            </p>
            <label className="mt-7 flex max-w-2xl items-center gap-3 rounded-2xl bg-background/10 px-4 py-3.5 shadow-inner focus-within:bg-background/15">
              <MagnifyingGlass className="shrink-0 text-primary" size={20} />
              <span className="sr-only">Search help</span>
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search plans, providers, recovery, publishing…"
                className="min-w-0 flex-1 bg-transparent text-sm text-background outline-none placeholder:text-background/45"
              />
              <kbd className="hidden rounded-lg bg-background/10 px-2 py-1 text-[10px] text-background/55 sm:inline">
                Offline
              </kbd>
            </label>
          </div>
          <div className="grid grid-cols-3 gap-2 lg:w-72">
            <HeroMetric value="9" label="Guides" />
            <HeroMetric value="7" label="Journeys" />
            <HeroMetric value="0" label="Data sent" />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle>Learning path</CardTitle>
            <CardDescription>
              A progressive route from first project to safe recovery.
            </CardDescription>
          </div>
          <Badge tone="positive">
            <CheckCircle weight="fill" />
            2 of 7 complete
          </Badge>
        </CardHeader>
        <CardContent className="mt-5">
          <div className="grid gap-2 sm:grid-cols-4 xl:grid-cols-7">
            {journeys.map((journey, index) => (
              <button
                key={journey.id}
                type="button"
                aria-pressed={selectedJourney === journey.id}
                onClick={() => {
                  setSelectedJourney(journey.id);
                  const article = contextualHelp({
                    kind: "journey",
                    journey: journey.id,
                  })[0];
                  if (article) openArticle(article);
                }}
                className={cn(
                  "group rounded-3xl bg-muted/45 p-3.5 text-left outline-none transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/30",
                  selectedJourney === journey.id && "bg-primary/[.11]"
                )}
              >
                <span
                  className={cn(
                    "grid size-7 place-items-center rounded-full bg-background text-xs font-semibold text-muted-foreground",
                    journey.state === "complete" &&
                      "bg-emerald-500 text-white",
                    journey.state === "current" &&
                      "bg-primary text-primary-foreground"
                  )}
                >
                  {journey.state === "complete" ? (
                    <Check weight="bold" />
                  ) : (
                    index + 1
                  )}
                </span>
                <strong className="mt-3 block text-sm">{journey.label}</strong>
                <span className="mt-1 block text-xs text-muted-foreground">
                  {journey.note}
                </span>
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(21rem,.75fr)_minmax(0,1.25fr)]">
        <Card className="min-w-0">
          <CardHeader>
            <CardTitle>Guides</CardTitle>
            <CardDescription>
              {results.length} trusted {results.length === 1 ? "answer" : "answers"} available locally.
            </CardDescription>
          </CardHeader>
          <CardContent className="mt-5">
            <div className="flex gap-2 overflow-x-auto pb-2" aria-label="Help categories">
              {categories.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  aria-pressed={category === item.id}
                  onClick={() => setCategory(item.id)}
                  className={cn(
                    "shrink-0 rounded-full bg-muted px-3 py-1.5 text-xs font-semibold text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/30",
                    category === item.id &&
                      "bg-primary text-primary-foreground"
                  )}
                >
                  {item.label}
                </button>
              ))}
            </div>
            <div className="mt-4 space-y-2">
              {results.map(({ article }) => (
                <button
                  key={article.id}
                  type="button"
                  aria-pressed={selected?.id === article.id}
                  onClick={() => openArticle(article)}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-3xl bg-muted/40 p-4 text-left outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/30",
                    selected?.id === article.id && "bg-primary/[.09]"
                  )}
                >
                  <span
                    className={cn(
                      "grid size-9 shrink-0 place-items-center rounded-2xl bg-background text-muted-foreground",
                      selected?.id === article.id && "text-primary"
                    )}
                  >
                    <BookOpenText size={18} weight="duotone" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <strong className="block truncate text-sm">
                      {article.title}
                    </strong>
                    <span className="mt-1 block truncate text-xs capitalize text-muted-foreground">
                      {article.category} · {article.offline ? "offline" : "online"}
                    </span>
                  </span>
                  <ArrowRight className="shrink-0 text-muted-foreground" />
                </button>
              ))}
              {results.length === 0 && (
                <div className="rounded-3xl bg-muted/45 p-6 text-center">
                  <MagnifyingGlass className="mx-auto text-muted-foreground" size={24} />
                  <strong className="mt-3 block text-sm">No exact answer</strong>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Try a shorter phrase or clear the category filter.
                  </p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {selected && (
          <Card id="help-article" className="min-w-0 scroll-mt-24">
            <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <div className="flex flex-wrap gap-2">
                  <Badge tone="active" className="capitalize">
                    {selected.category}
                  </Badge>
                  <Badge tone="positive">
                    <ShieldCheck weight="fill" />
                    Current
                  </Badge>
                </div>
                <CardTitle className="mt-4 text-2xl">
                  {selected.title}
                </CardTitle>
                <CardDescription className="max-w-2xl leading-6">
                  {selected.summary}
                </CardDescription>
              </div>
              <a
                href={`https://opefyre.atlassian.net/browse/${selected.jiraKey}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex shrink-0 items-center gap-2 rounded-full bg-secondary px-3 py-2 text-xs font-semibold hover:bg-secondary/75"
              >
                {selected.jiraKey}
                <LinkSimple />
              </a>
            </CardHeader>
            <CardContent className="mt-7">
              <ol className="space-y-3">
                {selected.steps.map((step, index) => (
                  <li
                    key={step}
                    className="grid grid-cols-[2rem_minmax(0,1fr)] gap-3 rounded-3xl bg-muted/40 p-4"
                  >
                    <span className="grid size-8 place-items-center rounded-full bg-primary/12 text-xs font-bold text-primary">
                      {index + 1}
                    </span>
                    <p className="pt-1 text-sm leading-6">{step}</p>
                  </li>
                ))}
              </ol>
              {selected.safeAlternative && (
                <div className="mt-4 flex gap-3 rounded-3xl bg-amber-400/[.08] p-4">
                  <Warning className="mt-0.5 shrink-0 text-amber-400" size={19} />
                  <div>
                    <strong className="text-sm">Safe alternative</strong>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">
                      {selected.safeAlternative}
                    </p>
                  </div>
                </div>
              )}
              <details className="mt-4 rounded-3xl bg-muted/40 p-4">
                <summary className="cursor-pointer text-sm font-semibold">
                  Technical detail
                </summary>
                <p className="mt-3 text-xs leading-5 text-muted-foreground">
                  {selected.advancedDetail}
                </p>
              </details>
              <div className="mt-5 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                <span>Owned by {selected.owner}</span>
                <span aria-hidden="true">·</span>
                <span>Reviewed {selected.reviewedAt}</span>
                <a
                  href={`https://github.com/opefyre/freeloader-coder/blob/main/${selected.sourcePath}`}
                  target="_blank"
                  rel="noreferrer"
                  className="ml-auto inline-flex items-center gap-1.5 font-semibold text-foreground hover:text-primary"
                >
                  <GithubLogo weight="fill" />
                  Source guide
                </a>
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-3">
              <div>
                <CardTitle>Recovery navigator</CardTitle>
                <CardDescription>
                  Name the symptom; keep the diagnosis grounded.
                </CardDescription>
              </div>
              <span className="grid size-11 place-items-center rounded-2xl bg-primary/10 text-primary">
                <Lifebuoy size={22} weight="duotone" />
              </span>
            </div>
          </CardHeader>
          <CardContent className="mt-5">
            <div className="grid gap-2 sm:grid-cols-2">
              {recoveryCases.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  aria-pressed={recoveryCase === item.id}
                  onClick={() => setRecoveryCase(item.id)}
                  className={cn(
                    "rounded-3xl bg-muted/45 p-4 text-left outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/30",
                    recoveryCase === item.id && "bg-primary/[.1]"
                  )}
                >
                  <strong className="text-sm">{item.label}</strong>
                  <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                    {item.description}
                  </span>
                </button>
              ))}
            </div>
            <div className="mt-4 rounded-3xl bg-emerald-400/[.07] p-5">
              <Badge tone="positive">Recommended next step</Badge>
              <strong className="mt-3 block text-base">
                {recoveryHelp[0]?.title ?? "Inspect local evidence"}
              </strong>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                {recoveryHelp[0]?.summary ??
                  "Review the latest verified event before taking action."}
              </p>
              {recoveryHelp[0] && (
                <Button
                  variant="secondary"
                  size="sm"
                  className="mt-4"
                  onClick={() => openArticle(recoveryHelp[0] as HelpArticle)}
                >
                  Open guidance
                  <ArrowRight />
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-3">
              <div>
                <CardTitle>Safe support preview</CardTitle>
                <CardDescription>
                  Interactive demo · nothing is sent.
                </CardDescription>
              </div>
              <Badge tone={draft.safeToShare ? "positive" : "caution"}>
                {draft.safeToShare ? "Ready to copy" : "Consent required"}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="mt-5">
            <div className="flex flex-wrap gap-2" aria-label="Support report type">
              {reportKinds.map((kind) => (
                <button
                  key={kind.id}
                  type="button"
                  aria-pressed={reportKind === kind.id}
                  onClick={() => setReportKind(kind.id)}
                  className={cn(
                    "rounded-full bg-muted px-3 py-1.5 text-xs font-semibold text-muted-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/30",
                    reportKind === kind.id &&
                      "bg-primary text-primary-foreground"
                  )}
                >
                  {kind.label}
                </button>
              ))}
            </div>
            <div className="mt-4 rounded-3xl bg-muted/45 p-4">
              <div className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-2 text-xs font-semibold">
                  {draft.destination === "private_security" ? (
                    <LockKey className="text-amber-400" weight="fill" />
                  ) : (
                    <GithubLogo className="text-primary" weight="fill" />
                  )}
                  {draft.destination === "private_security"
                    ? "Private security advisory"
                    : "Public GitHub issue"}
                </span>
                <Badge tone="positive">{draft.redactions} redactions</Badge>
              </div>
              <strong className="mt-4 block text-sm">{draft.title}</strong>
              <pre className="mt-3 max-h-40 overflow-auto whitespace-pre-wrap font-sans text-[11px] leading-5 text-muted-foreground">
                {draft.body}
              </pre>
            </div>
            <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-3xl bg-muted/45 p-4">
              <input
                type="checkbox"
                checked={consent}
                onChange={(event) => setConsent(event.target.checked)}
                className="mt-0.5 size-4 accent-primary"
              />
              <span>
                <strong className="block text-sm">
                  I reviewed the redacted preview
                </strong>
                <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                  Credentials, source code, personal paths, and account data must
                  not be shared.
                </span>
              </span>
            </label>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button disabled={!draft.safeToShare} onClick={copyDraft}>
                {copied ? <Check weight="bold" /> : <Copy />}
                {copied ? "Copied safely" : "Copy redacted report"}
              </Button>
              <a
                href="https://github.com/opefyre/freeloader-coder/security/advisories/new"
                target="_blank"
                rel="noreferrer"
                className={cn(
                  "inline-flex h-9 items-center gap-2 rounded-full bg-secondary px-4 text-sm font-medium hover:bg-secondary/75",
                  reportKind !== "security" && "hidden"
                )}
              >
                Private disclosure
                <LinkSimple />
              </a>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="grid gap-5 py-6 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
          <div className="flex gap-4">
            <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-primary/10 text-primary">
              <Code size={23} weight="duotone" />
            </span>
            <div>
              <strong className="text-base">Build with the system, not around it</strong>
              <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">
                Architecture, schemas, provider adapters, permissions, design
                rules, tests, fixtures, migrations, and release evidence are
                documented for contributors.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <a
              href="https://github.com/opefyre/freeloader-coder/blob/main/CONTRIBUTING.md"
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-9 items-center gap-2 rounded-full bg-secondary px-4 text-sm font-medium hover:bg-secondary/75"
            >
              <GithubLogo weight="fill" />
              Contributor guide
            </a>
            <a
              href="https://opefyre.atlassian.net/browse/PIPE-104"
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-9 items-center gap-2 rounded-full bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/85"
            >
              Acceptance contract
              <LinkSimple />
            </a>
          </div>
        </CardContent>
      </Card>
    </section>
  );
}

function HeroMetric({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-3xl bg-background/10 p-4 text-center">
      <strong className="block text-2xl font-semibold text-primary">{value}</strong>
      <span className="mt-1 block text-[10px] font-semibold uppercase tracking-[0.14em] text-background/50">
        {label}
      </span>
    </div>
  );
}
