import { ArrowRight } from "@phosphor-icons/react/ArrowRight";
import { Bell } from "@phosphor-icons/react/Bell";
import { CaretDown } from "@phosphor-icons/react/CaretDown";
import { ChartDonut } from "@phosphor-icons/react/ChartDonut";
import { ChatCircleDots } from "@phosphor-icons/react/ChatCircleDots";
import { Check } from "@phosphor-icons/react/Check";
import { CheckCircle } from "@phosphor-icons/react/CheckCircle";
import { ClockCountdown } from "@phosphor-icons/react/ClockCountdown";
import { Code } from "@phosphor-icons/react/Code";
import { Cpu } from "@phosphor-icons/react/Cpu";
import { Desktop } from "@phosphor-icons/react/Desktop";
import { FolderOpen } from "@phosphor-icons/react/FolderOpen";
import { Gauge } from "@phosphor-icons/react/Gauge";
import { Gear } from "@phosphor-icons/react/Gear";
import { GitBranch } from "@phosphor-icons/react/GitBranch";
import { Lightning } from "@phosphor-icons/react/Lightning";
import { ListChecks } from "@phosphor-icons/react/ListChecks";
import { MagnifyingGlass } from "@phosphor-icons/react/MagnifyingGlass";
import { Moon } from "@phosphor-icons/react/Moon";
import { PaperPlaneTilt } from "@phosphor-icons/react/PaperPlaneTilt";
import { Pause } from "@phosphor-icons/react/Pause";
import { PlugsConnected } from "@phosphor-icons/react/PlugsConnected";
import { ShieldCheck } from "@phosphor-icons/react/ShieldCheck";
import { Sparkle } from "@phosphor-icons/react/Sparkle";
import { Sun } from "@phosphor-icons/react/Sun";
import { Warning } from "@phosphor-icons/react/Warning";
import { X } from "@phosphor-icons/react/X";
import { useEffect, useMemo, useState } from "react";

import { controlCenterMetric } from "../../../fixtures/control-center-metrics.js";
import {
  approvalFacts,
  contentPatternExamples,
} from "../../../packages/ui/src/content.js";
import { Badge } from "./components/ui/badge.js";
import { PipelineMark } from "./components/brand/pipeline-mark.js";
import { Button, buttonVariants } from "./components/ui/button.js";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "./components/ui/card.js";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./components/ui/tabs.js";
import { cn } from "./lib/utils.js";
import {
  costSafetySummary,
  providerQueueSnapshot,
  providerTelemetry,
  routeEvidenceSummary,
  successfulProviderCalls,
  verifiedProviderSnapshot,
} from "./runtime-fixture.js";
import { useTheme, type ThemeMode } from "./theme.js";

const studioViews = [
  "overview",
  "conversation",
  "work",
  "providers",
  "evidence",
  "settings",
] as const;
type StudioView = (typeof studioViews)[number];

const navItems = [
  { id: "overview", label: "Overview", note: "Pipeline health and decisions", icon: Gauge },
  {
    id: "conversation",
    label: "Conversation",
    note: "Ask, clarify, and guide work",
    icon: ChatCircleDots,
  },
  { id: "work", label: "Work", note: "Active, queued, and verified tasks", icon: ListChecks, count: "8" },
  { id: "providers", label: "Providers", note: "Free routes and model health", icon: PlugsConnected },
  { id: "evidence", label: "Evidence", note: "Checks, checkpoints, and sources", icon: ShieldCheck },
] as const;

const viewCopy: Record<
  StudioView,
  { eyebrow: string; title: string; description: string }
> = {
  overview: {
    eyebrow: "Freeloader Coder · Demo data",
    title: "Good morning, Opefyre",
    description: "Your pipeline is moving. One safe decision is waiting.",
  },
  conversation: {
    eyebrow: "Grounded in this project",
    title: "Build through conversation",
    description: "Describe outcomes, clarify intent, and guide the pipeline without losing execution context.",
  },
  work: {
    eyebrow: "1 active · 8 queued",
    title: "Work that explains itself",
    description: "Follow every task from readiness through independent review and verified completion.",
  },
  providers: {
    eyebrow: "Free-provider mesh · Demo evidence",
    title: "Models working as one system",
    description: "Inspect routing, health, usage, fallbacks, and the evidence behind every provider claim.",
  },
  evidence: {
    eyebrow: "87 checks passed",
    title: "Trust, with receipts",
    description: "Review checkpoints, validations, sources, and recoverable proof before accepting a result.",
  },
  settings: {
    eyebrow: "Local-first configuration",
    title: "Connections and safeguards",
    description: "Connect services, control privacy, and keep automatic spend locked at zero.",
  },
};

function initialView(): StudioView {
  const candidate = new URLSearchParams(window.location.search).get("view");
  return studioViews.includes(candidate as StudioView)
    ? (candidate as StudioView)
    : "overview";
}

const stages = [
  { label: "Readiness", note: "Goal and repository understood", state: "done" },
  { label: "Breakdown", note: "6 scoped tasks created", state: "done" },
  { label: "Implementation", note: "Plans, approvals, errors", state: "active" },
  { label: "Validation", note: "Type, lint, build and UI", state: "next" },
  { label: "Review", note: "Two independent reviewers", state: "next" },
] as const;

const providerColor: Record<string, string> = {
  groq: "bg-chart-1",
  cloudflare: "bg-chart-2",
  gemini: "bg-chart-3",
  openrouter: "bg-chart-5",
  cerebras: "bg-chart-4",
  mistral: "bg-chart-2",
  zhipu: "bg-chart-3",
  sambanova: "bg-chart-1",
};

const connectionProfiles = [
  {
    id: "groq",
    name: "Groq",
    state: "Connected",
    dashboardUrl: "https://console.groq.com",
    sourceUrl: "https://console.groq.com/docs/rate-limits",
    workItemUrl: "https://opefyre.atlassian.net/browse/PIPE-49",
    access: "Free account",
  },
  {
    id: "cloudflare",
    name: "Cloudflare Workers AI",
    state: "Connected",
    dashboardUrl: "https://dash.cloudflare.com",
    sourceUrl: "https://developers.cloudflare.com/workers-ai/platform/pricing/",
    workItemUrl: "https://opefyre.atlassian.net/browse/PIPE-49",
    access: "Free allowance",
  },
  {
    id: "gemini",
    name: "Gemini",
    state: "Connected",
    dashboardUrl: "https://aistudio.google.com/apikey",
    sourceUrl: "https://ai.google.dev/gemini-api/docs/rate-limits",
    workItemUrl: "https://opefyre.atlassian.net/browse/PIPE-49",
    access: "Free project only",
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    state: "Connected",
    dashboardUrl: "https://openrouter.ai/settings/keys",
    sourceUrl: "https://openrouter.ai/models?max_price=0",
    workItemUrl: "https://opefyre.atlassian.net/browse/PIPE-49",
    access: "Free models only",
  },
  {
    id: "github",
    name: "GitHub Models",
    state: "Setup needed",
    dashboardUrl: "https://github.com/marketplace/models",
    sourceUrl: "https://docs.github.com/en/github-models",
    workItemUrl: "https://opefyre.atlassian.net/browse/PIPE-49",
    access: "Account limited",
  },
  ...verifiedProviderSnapshot.map((provider) => ({
    id: provider.id,
    name: provider.label,
    state: provider.zeroCostEligible ? "Setup needed" : "Credit only",
    dashboardUrl: provider.dashboardUrl,
    sourceUrl: provider.sourceUrl,
    workItemUrl: `https://opefyre.atlassian.net/browse/${
      {
        cerebras: "PIPE-179",
        mistral: "PIPE-180",
        zhipu: "PIPE-181",
        sambanova: "PIPE-182",
        deepseek: "PIPE-183",
      }[provider.id] ?? "PIPE-178"
    }`,
    access: provider.zeroCostEligible ? "Verified free candidate" : "Not a permanent free tier",
  })),
] as const;

const summaryMetrics = {
  active: controlCenterMetric("active_leases"),
  queue: controlCenterMetric("queue"),
  verified: controlCenterMetric("validations"),
  needsYou: controlCenterMetric("needs_user"),
} as const;

function App() {
  const theme = useTheme();
  const [activeView, setActiveView] = useState<StudioView>(initialView);
  const [commandOpen, setCommandOpen] = useState(false);
  const [commandQuery, setCommandQuery] = useState("");
  const [selectedProvider, setSelectedProvider] = useState(
    providerTelemetry[0]?.providerId ?? ""
  );
  const [selectedConnection, setSelectedConnection] = useState("cerebras");
  const [costOpen, setCostOpen] = useState(false);
  const [productChoice, setProductChoice] = useState<string>();
  const [message, setMessage] = useState("");
  const [sent, setSent] = useState(false);
  const selected = providerTelemetry.find(
    (provider) => provider.providerId === selectedProvider
  );
  const maxProviderCalls = Math.max(
    1,
    ...providerTelemetry.map((provider) => provider.successfulCalls + provider.failedCalls)
  );
  const successRate = useMemo(() => {
    const total = providerTelemetry.reduce(
      (sum, provider) => sum + provider.successfulCalls + provider.failedCalls,
      0
    );
    return total === 0 ? 0 : Math.round((successfulProviderCalls / total) * 100);
  }, []);
  const activeCopy = viewCopy[activeView];
  const filteredCommands = useMemo(() => {
    const query = commandQuery.trim().toLowerCase();
    const items = [
      ...navItems,
      {
        id: "settings" as const,
        label: "Settings",
        note: "Connections, privacy, and safeguards",
        icon: Gear,
      },
    ];
    return query
      ? items.filter((item) =>
          `${item.label} ${item.note}`.toLowerCase().includes(query)
        )
      : items;
  }, [commandQuery]);

  function navigate(view: StudioView, replace = false) {
    setActiveView(view);
    setCommandOpen(false);
    setCommandQuery("");
    const url = new URL(window.location.href);
    url.hash = "";
    if (view === "overview") {
      url.searchParams.delete("view");
    } else {
      url.searchParams.set("view", view);
    }
    window.history[replace ? "replaceState" : "pushState"]({}, "", url);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  useEffect(() => {
    const onPopState = () => setActiveView(initialView());
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommandOpen(true);
      }
      if (event.key === "Escape") setCommandOpen(false);
    };
    window.addEventListener("popstate", onPopState);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("popstate", onPopState);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[15.5rem_minmax(0,1fr)]">
      <a
        href="#workspace"
        className="fixed left-4 top-4 z-50 -translate-y-20 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground focus:translate-y-0"
      >
        Skip to workspace
      </a>

      <aside className="hidden min-h-screen bg-sidebar px-4 py-5 lg:sticky lg:top-0 lg:flex lg:h-screen lg:flex-col">
        <div className="flex items-center gap-3 px-2">
          <span className="grid size-10 place-items-center text-primary">
            <PipelineMark className="size-8" title="Pipeline Studio mark" />
          </span>
          <div>
            <strong className="block text-sm font-semibold">Pipeline Studio</strong>
            <span className="text-xs text-muted-foreground">Freeloader Coder</span>
          </div>
        </div>

        <Button
          variant="secondary"
          className="mt-6 h-auto w-full justify-between rounded-2xl px-3 py-2.5"
        >
          <span className="flex items-center gap-2.5 text-left">
            <span className="grid size-8 place-items-center rounded-xl bg-background/70 text-xs font-bold">
              FC
            </span>
            <span>
              <span className="block text-xs font-semibold">Main project</span>
              <span className="block text-[11px] font-normal text-muted-foreground">
                1 active run
              </span>
            </span>
          </span>
          <CaretDown />
        </Button>

        <nav className="mt-7 space-y-1" aria-label="Workspace">
          {navItems.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => navigate(item.id)}
              aria-current={activeView === item.id ? "page" : undefined}
              className={cn(
                "flex h-10 w-full items-center gap-3 rounded-2xl px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                activeView === item.id &&
                  "bg-sidebar-accent text-sidebar-accent-foreground"
              )}
            >
              <item.icon
                size={18}
                weight={activeView === item.id ? "fill" : "regular"}
              />
              <span>{item.label}</span>
              {"count" in item && (
                <Badge className="ml-auto px-2 py-0.5">{item.count}</Badge>
              )}
            </button>
          ))}
        </nav>

        <div className="mt-auto rounded-3xl bg-primary/[.08] p-4">
          <div className="flex items-center gap-2 text-xs font-semibold text-primary">
            <Sparkle weight="fill" />
            Free-tier protection
          </div>
          <p className="mt-2 text-xs leading-5 text-muted-foreground">
            Paid routes are disabled. The pipeline stops before any charge.
          </p>
          <button
            type="button"
            className="mt-3 text-xs font-semibold text-foreground hover:text-primary"
            onClick={() => setCostOpen(true)}
          >
            View safeguards
          </button>
        </div>

        <button
          type="button"
          onClick={() => navigate("settings")}
          aria-current={activeView === "settings" ? "page" : undefined}
          className={cn(
            "mt-3 flex h-10 w-full items-center gap-3 rounded-2xl px-3 text-sm text-muted-foreground hover:bg-sidebar-accent hover:text-foreground",
            activeView === "settings" &&
              "bg-sidebar-accent text-sidebar-accent-foreground"
          )}
        >
          <Gear size={18} />
          Settings
        </button>
      </aside>

      <main id="workspace" className="min-w-0">
        <header className="sticky top-0 z-30 flex h-18 items-center justify-between bg-background/88 px-4 backdrop-blur-xl sm:px-7 lg:px-9">
          <div className="flex items-center gap-3 lg:hidden">
            <span className="grid size-9 place-items-center text-primary">
              <PipelineMark className="size-7" title="Pipeline Studio mark" />
            </span>
            <strong className="text-sm">Pipeline Studio</strong>
          </div>
          <button
            type="button"
            onClick={() => setCommandOpen(true)}
            className="hidden h-10 w-full max-w-sm items-center gap-2 rounded-full bg-muted px-4 text-left text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/30 sm:flex"
          >
            <MagnifyingGlass size={17} />
            Find tasks, runs, or evidence
            <kbd className="ml-auto rounded-lg bg-background/70 px-2 py-1 text-[10px]">⌘ K</kbd>
          </button>
          <div className="flex items-center gap-2">
            <Badge tone="positive">
              <span className="size-1.5 rounded-full bg-emerald-300" />
              Pipeline online
            </Badge>
            <Button
              variant="ghost"
              size="icon"
              className="sm:hidden"
              aria-label={`Theme: ${theme.mode}. Change theme`}
              title={`Theme: ${theme.mode}`}
              onClick={theme.cycleMode}
            >
              {theme.mode === "light" ? (
                <Sun weight="fill" />
              ) : theme.mode === "dark" ? (
                <Moon weight="fill" />
              ) : (
                <Desktop weight="fill" />
              )}
            </Button>
            <ThemeControl mode={theme.mode} setMode={theme.setMode} />
            <Button variant="ghost" size="icon" aria-label="Notifications">
              <Bell />
            </Button>
            <button
              type="button"
              className="grid size-9 place-items-center rounded-full bg-secondary text-xs font-bold outline-none focus-visible:ring-3 focus-visible:ring-ring/30"
              aria-label="Open profile menu"
            >
              OF
            </button>
          </div>
        </header>

        <div className="mx-auto max-w-[96rem] px-4 pb-28 sm:px-7 lg:px-9 lg:pb-12">
          <div className="flex flex-col gap-4 pb-6 pt-4 sm:flex-row sm:items-end sm:justify-between sm:pt-7">
            <div>
              <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                <FolderOpen size={15} />
                {activeCopy.eyebrow}
              </div>
              <h1 className="mt-2 text-2xl font-semibold tracking-[-0.03em] sm:text-3xl">
                {activeCopy.title}
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">
                {activeCopy.description}
              </p>
            </div>
            <div className="flex gap-2">
              <Button variant="secondary">
                <Pause />
                Pause after step
              </Button>
              <Button onClick={() => navigate("conversation")}>
                <ChatCircleDots weight="fill" />
                Ask the pipeline
              </Button>
            </div>
          </div>

          {activeView === "overview" ? (
            <>
          <section className="metric-grid grid gap-3" aria-label="Pipeline summary">
            <Metric
              icon={Lightning}
              metric={summaryMetrics.active}
              note="Implementation · 68%"
              tone="text-primary"
            />
            <Metric
              icon={ListChecks}
              metric={summaryMetrics.queue}
              note="3 ready · 5 dependent"
              tone="text-chart-3"
            />
            <Metric
              icon={CheckCircle}
              metric={summaryMetrics.verified}
              note="All checks passed"
              tone="text-emerald-300"
            />
            <Metric
              icon={Warning}
              metric={summaryMetrics.needsYou}
              note="Non-blocking"
              tone="text-amber-300"
            />
          </section>

          <Tabs defaultValue="overview" className="mt-7">
            <TabsList aria-label="Control center views">
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="providers">Providers</TabsTrigger>
              <TabsTrigger value="evidence">Evidence</TabsTrigger>
            </TabsList>

            <TabsContent value="overview">
              <div className="dashboard-grid grid gap-4">
                <div className="space-y-4">
                  <Card>
                    <CardHeader className="flex flex-row items-start justify-between gap-4">
                      <div>
                        <div className="flex items-center gap-2">
                          <Badge tone="active">
                            <span className="size-1.5 animate-pulse rounded-full bg-primary" />
                            Working now
                          </Badge>
                          <span className="text-xs font-medium text-muted-foreground">PIPE-34</span>
                        </div>
                        <CardTitle className="mt-4 text-xl">
                          Build reusable trust language
                        </CardTitle>
                        <CardDescription>
                          The Studio is standardizing how plans, approvals, failures, and evidence are explained.
                        </CardDescription>
                      </div>
                      <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-primary/10 text-primary">
                        <Code size={23} weight="duotone" />
                      </span>
                    </CardHeader>
                    <CardContent className="mt-6">
                      <div className="h-2 overflow-hidden rounded-full bg-muted">
                        <div className="h-full w-[35%] rounded-full bg-primary" />
                      </div>
                      <div className="mt-2 flex justify-between text-xs text-muted-foreground">
                        <span>Implementation</span>
                        <span>35%</span>
                      </div>
                      <div className="mt-7 grid gap-1 sm:grid-cols-5">
                        {stages.map((stage, index) => (
                          <div
                            key={stage.label}
                            className={cn(
                              "relative rounded-2xl p-3",
                              stage.state === "active"
                                ? "bg-primary/10"
                                : stage.state === "done"
                                  ? "bg-emerald-400/[.06]"
                                  : "bg-muted/55"
                            )}
                          >
                            <div className="flex items-center gap-2">
                              <span
                                className={cn(
                                  "grid size-5 place-items-center rounded-full text-[10px]",
                                  stage.state === "done" && "bg-emerald-400/20 text-emerald-300",
                                  stage.state === "active" && "bg-primary/20 text-primary",
                                  stage.state === "next" && "bg-background text-muted-foreground"
                                )}
                              >
                                {stage.state === "done" ? <Check weight="bold" /> : index + 1}
                              </span>
                              <span className="text-xs font-semibold">{stage.label}</span>
                            </div>
                            <p className="mt-2 text-[11px] leading-4 text-muted-foreground">
                              {stage.note}
                            </p>
                          </div>
                        ))}
                      </div>
                      <div className="mt-6 flex flex-wrap items-center gap-3">
                        <Button size="sm" onClick={() => navigate("work")}>
                          Open task
                          <ArrowRight />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => navigate("evidence")}
                        >
                          <GitBranch />
                          View local diff
                        </Button>
                        <span className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground">
                          <ClockCountdown />
                          Updated 2m ago
                        </span>
                      </div>
                    </CardContent>
                  </Card>

                  <Card id="providers">
                    <CardHeader className="flex flex-row items-center justify-between">
                      <div>
                        <CardTitle>Provider execution</CardTitle>
                        <CardDescription>Successful calls across every configured free route.</CardDescription>
                      </div>
                      <Badge tone="positive">{successfulProviderCalls} successful</Badge>
                    </CardHeader>
                    <CardContent className="mt-6">
                      <div className="space-y-3">
                        {providerTelemetry.map((provider) => {
                          const total = provider.successfulCalls + provider.failedCalls;
                          return (
                            <button
                              key={provider.providerId}
                              type="button"
                              data-provider-id={provider.providerId}
                              aria-pressed={selectedProvider === provider.providerId}
                              onClick={() => setSelectedProvider(provider.providerId)}
                              className={cn(
                                "grid w-full grid-cols-[7rem_minmax(0,1fr)_3rem] items-center gap-3 rounded-2xl px-3 py-2.5 text-left outline-none transition-colors hover:bg-muted/70 focus-visible:ring-3 focus-visible:ring-ring/30 sm:grid-cols-[8rem_minmax(0,1fr)_4rem]",
                                selectedProvider === provider.providerId && "bg-muted"
                              )}
                            >
                              <span className="truncate text-sm font-medium capitalize">
                                {provider.providerId}
                              </span>
                              <span className="h-2 overflow-hidden rounded-full bg-background">
                                <span
                                  className={cn(
                                    "block h-full rounded-full",
                                    providerColor[provider.providerId] ?? "bg-primary"
                                  )}
                                  style={{ width: `${Math.max(6, (total / maxProviderCalls) * 100)}%` }}
                                />
                              </span>
                              <span className="text-right text-xs text-muted-foreground">
                                {provider.successfulCalls}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                      {selected && (
                        <div className="mt-5 grid gap-3 rounded-3xl bg-muted/55 p-4 sm:grid-cols-3">
                          <ProviderFact label="Model" value={selected.modelId} />
                          <ProviderFact
                            label="Health"
                            value={selected.health.replace("_", " ")}
                          />
                          <ProviderFact
                            label="Requests today"
                            value={String(selected.requestsToday)}
                          />
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </div>

                <div className="space-y-4">
                  <Card>
                    <CardHeader>
                      <div className="flex items-center justify-between">
                        <Badge tone="caution">Needs you</Badge>
                        <span className="grid size-9 place-items-center rounded-2xl bg-amber-400/10 text-amber-300">
                          <Warning size={18} weight="duotone" />
                        </span>
                      </div>
                      <CardTitle className="mt-5 text-lg">Choose the public product name</CardTitle>
                      <CardDescription>
                        Work can continue safely. This only affects the next public release.
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="mt-5">
                      <div className="space-y-2">
                        <Choice
                          label="Pipeline Studio"
                          note="Clear and credible"
                          selected={productChoice === "Pipeline Studio"}
                          onSelect={setProductChoice}
                        />
                        <Choice
                          label="Freeloader Coder"
                          note="Matches the repository"
                          selected={productChoice === "Freeloader Coder"}
                          onSelect={setProductChoice}
                        />
                      </div>
                      {productChoice && (
                        <p className="mt-3 text-xs text-emerald-600 dark:text-emerald-300">
                          Demo choice recorded locally. No project data was changed.
                        </p>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        className="mt-3 px-2"
                        onClick={() => navigate("evidence")}
                      >
                        Review with context
                        <ArrowRight />
                      </Button>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="flex flex-row items-center justify-between">
                      <div>
                        <CardTitle>Reliability</CardTitle>
                        <CardDescription>Last 24 hours · demo evidence</CardDescription>
                      </div>
                      <ChartDonut className="text-primary" size={22} weight="duotone" />
                    </CardHeader>
                    <CardContent className="mt-5">
                      <div className="flex items-center gap-6">
                        <div
                          className="grid size-28 shrink-0 place-items-center rounded-full"
                          style={{
                            background: `conic-gradient(var(--chart-1) ${successRate}%, var(--muted) 0)`,
                          }}
                        >
                          <div className="grid size-20 place-items-center rounded-full bg-card text-center">
                            <div>
                              <strong className="block text-2xl">{successRate}%</strong>
                              <span className="text-[10px] text-muted-foreground">success</span>
                            </div>
                          </div>
                        </div>
                        <div className="min-w-0 flex-1 space-y-3">
                          <ReliabilityFact label="Retries healed" value="3" />
                          <ReliabilityFact label="QA disagreements" value="0" />
                          <ReliabilityFact label="Quarantined" value="0" />
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="flex flex-row items-center justify-between">
                      <div>
                        <CardTitle>Denial of wallet</CardTitle>
                        <CardDescription>Automatic spend is hard-limited.</CardDescription>
                      </div>
                      <ShieldCheck size={23} className="text-emerald-300" weight="duotone" />
                    </CardHeader>
                    <CardContent className="mt-5">
                      <div className="flex items-end justify-between">
                        <div>
                          <span className="text-xs text-muted-foreground">Maximum automatic spend</span>
                          <strong className="mt-1 block text-3xl tracking-tight">
                            {costSafetySummary.hardCeiling}
                          </strong>
                        </div>
                        <Badge tone="positive">{costSafetySummary.mode}</Badge>
                      </div>
                      <button
                        type="button"
                        data-cost-details
                        aria-expanded={costOpen}
                        onClick={() => setCostOpen((open) => !open)}
                        className="mt-5 flex w-full items-center justify-between rounded-2xl bg-muted px-4 py-3 text-left text-xs font-semibold outline-none hover:bg-muted/80 focus-visible:ring-3 focus-visible:ring-ring/30"
                      >
                        {costOpen ? "Hide safeguards" : "Show safeguards"}
                        <CaretDown className={cn("transition-transform", costOpen && "rotate-180")} />
                      </button>
                      {costOpen && (
                        <ul className="mt-3 space-y-2 text-xs text-muted-foreground">
                          {costSafetySummary.safeguards.map((safeguard) => (
                            <li key={safeguard} className="flex items-center gap-2">
                              <Check className="text-emerald-300" weight="bold" />
                              {safeguard}
                            </li>
                          ))}
                          <li>Paid mode requires a separate connection approval.</li>
                        </ul>
                      )}
                    </CardContent>
                  </Card>
                </div>
              </div>

              <Card className="mt-4" id="conversation">
                <CardContent className="py-5 sm:py-6">
                  <div className="flex gap-3">
                    <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-primary/12 text-primary">
                      <Sparkle size={18} weight="fill" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <strong className="text-sm">Pipeline assistant</strong>
                        <Badge>Grounded in this project</Badge>
                      </div>
                      <p className="mt-1 text-sm text-muted-foreground">
                        Ask for a change, inspect a blocker, or tell the pipeline what to build next.
                      </p>
                      <form
                        className="mt-4 flex items-end gap-2 rounded-3xl bg-muted p-2 pl-4"
                        onSubmit={(event) => {
                          event.preventDefault();
                          if (message.trim()) {
                            setSent(true);
                            setMessage("");
                          }
                        }}
                      >
                        <label className="sr-only" htmlFor="pipeline-message">
                          Message the pipeline
                        </label>
                        <textarea
                          id="pipeline-message"
                          value={message}
                          onChange={(event) => {
                            setMessage(event.target.value);
                            setSent(false);
                          }}
                          rows={1}
                          placeholder="Ask the pipeline…"
                          className="max-h-32 min-h-9 flex-1 resize-none bg-transparent py-2 text-sm outline-none placeholder:text-muted-foreground"
                        />
                        <Button size="icon" type="submit" aria-label="Send message">
                          <PaperPlaneTilt weight="fill" />
                        </Button>
                      </form>
                      {sent && (
                        <p className="mt-2 text-xs text-emerald-300">
                          Demo message received locally. No task was created.
                        </p>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="providers">
              <Card>
                <CardHeader>
                  <CardTitle>Provider mesh · demo evidence</CardTitle>
                  <CardDescription>
                    Routing evidence, health, and usage from configured free-tier providers.
                  </CardDescription>
                </CardHeader>
                <CardContent className="mt-6 grid gap-3 md:grid-cols-2">
                  {providerTelemetry.map((provider) => (
                    <button
                      key={provider.providerId}
                      type="button"
                      data-provider-id={provider.providerId}
                      onClick={() => setSelectedProvider(provider.providerId)}
                      className="rounded-3xl bg-muted/60 p-5 text-left outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/30"
                    >
                      <div className="flex items-center justify-between">
                        <strong className="capitalize">{provider.providerId}</strong>
                        <Badge tone={provider.health === "ready" ? "positive" : "caution"}>
                          {provider.health.replace("_", " ")}
                        </Badge>
                      </div>
                      <p className="mt-2 truncate text-xs text-muted-foreground">{provider.modelId}</p>
                      <div className="mt-5 flex gap-5 text-sm">
                        <span><b>{provider.successfulCalls}</b> successful</span>
                        <span><b>{provider.failedCalls}</b> failed</span>
                      </div>
                    </button>
                  ))}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="evidence">
              <Card>
                <CardHeader>
                  <CardTitle>Trusted evidence</CardTitle>
                  <CardDescription>
                    Claims shown here are explicitly scoped to demo fixture data.
                  </CardDescription>
                </CardHeader>
                <CardContent className="mt-6 grid gap-3 sm:grid-cols-3">
                  <Evidence label="Selected route" value={routeEvidenceSummary.selectedProviderId ?? "None"} />
                  <Evidence label="Paid routes produced" value={String(costSafetySummary.paidRoutesProduced)} />
                  <Evidence label="Eligible providers" value={String(routeEvidenceSummary.eligibleProviderIds.length)} />
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
            </>
          ) : (
            <WorkspaceSurface
              view={activeView}
              selectedProvider={selectedProvider}
              setSelectedProvider={setSelectedProvider}
              selectedConnection={selectedConnection}
              setSelectedConnection={setSelectedConnection}
              message={message}
              setMessage={setMessage}
              sent={sent}
              setSent={setSent}
              navigate={navigate}
            />
          )}
        </div>
      </main>

      <nav
        className="fixed inset-x-3 bottom-3 z-40 grid grid-cols-5 rounded-3xl bg-popover/95 p-1.5 shadow-2xl ring-1 ring-foreground/[.07] backdrop-blur-xl lg:hidden"
        aria-label="Mobile workspace"
      >
        {navItems.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => navigate(item.id)}
            aria-current={activeView === item.id ? "page" : undefined}
            className={cn(
              "flex min-h-13 flex-col items-center justify-center gap-1 rounded-2xl px-1 text-[10px] font-medium text-muted-foreground",
              activeView === item.id && "bg-primary/12 text-primary"
            )}
          >
            <item.icon
              size={18}
              weight={activeView === item.id ? "fill" : "regular"}
            />
            <span>{item.label}</span>
          </button>
        ))}
      </nav>

      {commandOpen && (
        <CommandPalette
          query={commandQuery}
          setQuery={setCommandQuery}
          commands={filteredCommands}
          close={() => setCommandOpen(false)}
          navigate={navigate}
        />
      )}
    </div>
  );
}

function WorkspaceSurface({
  view,
  selectedProvider,
  setSelectedProvider,
  selectedConnection,
  setSelectedConnection,
  message,
  setMessage,
  sent,
  setSent,
  navigate,
}: {
  view: Exclude<StudioView, "overview">;
  selectedProvider: string;
  setSelectedProvider: (provider: string) => void;
  selectedConnection: string;
  setSelectedConnection: (provider: string) => void;
  message: string;
  setMessage: (message: string) => void;
  sent: boolean;
  setSent: (sent: boolean) => void;
  navigate: (view: StudioView) => void;
}) {
  if (view === "conversation") {
    return (
      <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <Card className="min-h-[32rem]">
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle>Pipeline assistant</CardTitle>
              <CardDescription>
                Grounded in the current repository, task graph, and verified evidence.
              </CardDescription>
            </div>
            <Badge tone="positive">Local context ready</Badge>
          </CardHeader>
          <CardContent className="mt-8 flex min-h-[24rem] flex-col">
            <div className="max-w-2xl rounded-3xl bg-muted/65 p-5">
              <div className="flex items-center gap-2">
                <span className="grid size-8 place-items-center rounded-xl bg-primary/12 text-primary">
                  <Sparkle weight="fill" />
                </span>
                <strong className="text-sm">What should we build next?</strong>
              </div>
              <p className="mt-3 text-sm leading-6 text-muted-foreground">
                I can break down a feature, explain a blocker, inspect current work, or
                prepare a safe implementation plan. Nothing executes until intent and
                repository scope are grounded.
              </p>
            </div>
            <div className="mt-5 grid gap-2 sm:grid-cols-3">
              {[
                "Explain the active task",
                "Show what needs me",
                "Plan the next feature",
              ].map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  onClick={() => {
                    setMessage(prompt);
                    setSent(false);
                  }}
                  className="rounded-2xl bg-muted/45 p-4 text-left text-xs font-medium outline-none transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/30"
                >
                  {prompt}
                  <ArrowRight className="mt-5 text-primary" />
                </button>
              ))}
            </div>
            <form
              className="mt-auto flex items-end gap-2 rounded-3xl bg-muted p-2 pl-4"
              onSubmit={(event) => {
                event.preventDefault();
                if (message.trim()) {
                  setSent(true);
                  setMessage("");
                }
              }}
            >
              <label className="sr-only" htmlFor="conversation-message">
                Message the pipeline
              </label>
              <textarea
                id="conversation-message"
                value={message}
                onChange={(event) => {
                  setMessage(event.target.value);
                  setSent(false);
                }}
                rows={2}
                placeholder="Describe what you want to build…"
                className="max-h-36 min-h-12 flex-1 resize-none bg-transparent py-2 text-sm outline-none placeholder:text-muted-foreground"
              />
              <Button size="icon" type="submit" aria-label="Send message">
                <PaperPlaneTilt weight="fill" />
              </Button>
            </form>
            {sent && (
              <p className="mt-2 text-xs text-emerald-600 dark:text-emerald-300">
                Demo message received locally. No task was created.
              </p>
            )}
          </CardContent>
        </Card>
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Grounding</CardTitle>
              <CardDescription>What the assistant can safely use.</CardDescription>
            </CardHeader>
            <CardContent className="mt-5 space-y-3">
              <SourceRow label="Repository" value="Freeloader Coder" state="Ready" />
              <SourceRow label="Task graph" value="9 scoped items" state="Ready" />
              <SourceRow label="Evidence" value="87 checks" state="Fresh" />
            </CardContent>
          </Card>
          <ApprovalPreview />
          <Card>
            <CardHeader>
              <CardTitle>Execution boundary</CardTitle>
              <CardDescription>
                Conversation can propose work; the controller owns execution.
              </CardDescription>
            </CardHeader>
            <CardContent className="mt-5">
              <Button variant="secondary" className="w-full" onClick={() => navigate("work")}>
                <ListChecks />
                Review current work
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  if (view === "work") {
    return (
      <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0 space-y-4">
          <Card className="min-w-0">
            <CardHeader className="flex flex-col items-start justify-between gap-4 sm:flex-row">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <Badge tone="active">Implementation</Badge>
                  <a
                    href="https://opefyre.atlassian.net/browse/PIPE-34"
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs font-semibold text-primary hover:underline"
                  >
                    PIPE-34
                  </a>
                </div>
                <CardTitle className="mt-4 text-xl">
                  Reusable trust-language patterns
                </CardTitle>
                <CardDescription>
                  Defining shared, versioned patterns for plans, approvals, errors,
                  retries, recovery, and evidence.
                </CardDescription>
              </div>
              <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-primary/10 text-primary">
                <Code size={23} weight="duotone" />
              </span>
            </CardHeader>
            <CardContent className="mt-7">
              <div className="flex items-center gap-3">
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                  <div className="h-full w-[35%] rounded-full bg-primary" />
                </div>
                <strong className="text-sm">35%</strong>
              </div>
              <div className="mt-7 grid gap-2 sm:grid-cols-5">
                {stages.map((stage, index) => (
                  <div
                    key={stage.label}
                    className={cn(
                      "rounded-2xl p-3",
                      index < 3 ? "bg-primary/[.08]" : "bg-muted/50"
                    )}
                  >
                    <span className="text-[10px] font-semibold text-muted-foreground">
                      0{index + 1}
                    </span>
                    <strong className="mt-2 block text-xs">{stage.label}</strong>
                    <span className="mt-1 block text-[10px] text-muted-foreground">
                      {index < 2 ? "Verified" : index === 2 ? "Working" : "Waiting"}
                    </span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
          <Card className="min-w-0">
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle>Task graph</CardTitle>
                <CardDescription>Dependency-aware work, in execution order.</CardDescription>
              </div>
              <Badge>3 ready · 5 dependent</Badge>
            </CardHeader>
            <CardContent className="mt-5 space-y-2">
              <TaskRow id="PIPE-34" title="Plain-language trust patterns" state="Working now" tone="active" />
              <TaskRow id="PIPE-35" title="Trustworthy task timeline" state="Ready next" tone="positive" />
              <TaskRow id="PIPE-36" title="Decision inbox and explanations" state="After PIPE-35" tone="neutral" />
              <TaskRow id="PIPE-37" title="Preview and checkpoint experience" state="After PIPE-36" tone="neutral" />
            </CardContent>
          </Card>
        </div>
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Live evidence</CardTitle>
              <CardDescription>Observed during this implementation.</CardDescription>
            </CardHeader>
            <CardContent className="mt-5 space-y-4">
              <EvidencePulse label="Type check" value="Passed" />
              <EvidencePulse label="Unit tests" value="87 / 87" />
              <EvidencePulse label="Browser console" value="Clean" />
              <EvidencePulse label="Last observation" value="Just now" />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Safe controls</CardTitle>
              <CardDescription>Actions preserve the current checkpoint.</CardDescription>
            </CardHeader>
            <CardContent className="mt-5 grid gap-2">
              <Button variant="secondary">
                <Pause />
                Pause after current step
              </Button>
              <Button variant="ghost" onClick={() => navigate("evidence")}>
                <ShieldCheck />
                Inspect evidence
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  if (view === "providers") {
    const selected = providerTelemetry.find(
      (provider) => provider.providerId === selectedProvider
    );
    return (
      <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <Card className="min-w-0 xl:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle>Capacity scheduler</CardTitle>
              <CardDescription>
                Dispatches only when a free provider has safe capacity. Waiting work sleeps until its next eligible window.
              </CardDescription>
            </div>
            <Badge tone="positive">No spin retries</Badge>
          </CardHeader>
          <CardContent className="mt-7 grid gap-5 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_18rem]">
            <div className="rounded-3xl bg-emerald-400/[.07] p-5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                  Dispatching now
                </span>
                <strong className="text-2xl">{providerQueueSnapshot.dispatches.length}</strong>
              </div>
              <div className="mt-5 space-y-3">
                {providerQueueSnapshot.dispatches.map((dispatch) => (
                  <div key={dispatch.taskId} className="flex items-center justify-between gap-4 text-sm">
                    <span className="font-semibold">{dispatch.taskId}</span>
                    <span className="truncate text-xs text-muted-foreground">
                      {dispatch.providerId} · {dispatch.modelId}
                    </span>
                  </div>
                ))}
              </div>
            </div>
            <div className="rounded-3xl bg-amber-400/[.08] p-5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                  Scheduled waits
                </span>
                <strong className="text-2xl">{providerQueueSnapshot.scheduled.length}</strong>
              </div>
              <div className="mt-5 space-y-3">
                {providerQueueSnapshot.scheduled.map((entry) => (
                  <div key={entry.taskId} className="flex items-center justify-between gap-4 text-sm">
                    <span className="font-semibold">{entry.taskId}</span>
                    <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <ClockCountdown />
                      {formatWakeTime(entry.retryAt, providerQueueSnapshot.generatedAt)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
            <div className="rounded-3xl bg-muted/50 p-5">
              <span className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                QA reserve
              </span>
              <div className="mt-5 space-y-4">
                {providerQueueSnapshot.protectedCapacity.map((entry) => (
                  <div key={entry.providerId}>
                    <strong className="text-sm capitalize">{entry.providerId}</strong>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">{entry.label}</p>
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="min-w-0">
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle>Provider mesh</CardTitle>
              <CardDescription>
                Successful calls, failures, and free-capacity routing from demo evidence.
              </CardDescription>
            </div>
            <Badge tone="positive">{successfulProviderCalls} successful</Badge>
          </CardHeader>
          <CardContent className="mt-7 grid gap-3 md:grid-cols-2">
            {providerTelemetry.map((provider) => (
              <button
                key={provider.providerId}
                type="button"
                data-provider-id={provider.providerId}
                aria-pressed={selectedProvider === provider.providerId}
                onClick={() => setSelectedProvider(provider.providerId)}
                className={cn(
                  "rounded-3xl bg-muted/50 p-5 text-left outline-none transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/30",
                  selectedProvider === provider.providerId && "bg-primary/[.09]"
                )}
              >
                <div className="flex items-center justify-between">
                  <strong className="capitalize">{provider.providerId}</strong>
                  <Badge tone={provider.health === "ready" ? "positive" : "caution"}>
                    {provider.health.replace("_", " ")}
                  </Badge>
                </div>
                <p className="mt-2 truncate text-xs text-muted-foreground">
                  {provider.modelId}
                </p>
                <div className="mt-7 flex gap-6 text-sm">
                  <span>
                    <b>{provider.successfulCalls}</b> successful
                  </span>
                  <span>
                    <b>{provider.failedCalls}</b> failed
                  </span>
                </div>
              </button>
            ))}
          </CardContent>
        </Card>
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="capitalize">
                {selected?.providerId ?? "Provider"} route
              </CardTitle>
              <CardDescription>Selected provider evidence.</CardDescription>
            </CardHeader>
            <CardContent className="mt-5 space-y-4">
              <SourceRow label="Model" value={selected?.modelId ?? "Unavailable"} state="Observed" />
              <SourceRow label="Health" value={selected?.health.replace("_", " ") ?? "Unknown"} state="Live" />
              <SourceRow label="Requests today" value={String(selected?.requestsToday ?? 0)} state="Scoped" />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Routing policy</CardTitle>
              <CardDescription>External free routes first; local fallback last.</CardDescription>
            </CardHeader>
            <CardContent className="mt-5">
              <div className="rounded-2xl bg-emerald-400/[.07] p-4 text-sm">
                <strong className="text-emerald-700 dark:text-emerald-300">
                  Paid routes denied
                </strong>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  Unknown-cost models and billing-enabled projects are ineligible.
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
        <VerifiedProviderCatalog />
      </div>
    );
  }

  if (view === "evidence") {
    return (
      <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <Card className="min-w-0">
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle>Verification timeline</CardTitle>
              <CardDescription>
                Every completion claim must trace to an observed postcondition.
              </CardDescription>
            </div>
            <Badge tone="positive">Fresh</Badge>
          </CardHeader>
          <CardContent className="mt-7 space-y-3">
            <Checkpoint
              time="12:25"
              title="Typography runtime verified"
              note="Onest 400/600 loaded in both themes; browser console clean."
              status="Passed"
            />
            <Checkpoint
              time="12:24"
              title="Production build completed"
              note="Bundled application and local font assets generated successfully."
              status="Passed"
            />
            <Checkpoint
              time="12:24"
              title="Automated validation completed"
              note="87 tests, formatting, lint, type checking, and setup checks passed."
              status="Passed"
            />
            <Checkpoint
              time="12:22"
              title="Repository checkpoint created"
              note="Verified source state preserved before the next workspace increment."
              status="Saved"
            />
          </CardContent>
        </Card>
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Current proof</CardTitle>
              <CardDescription>Bounded to this demo repository.</CardDescription>
            </CardHeader>
            <CardContent className="mt-5 grid gap-3">
              <Evidence label="Automated checks" value="87 / 87 passed" />
              <Evidence label="Paid routes produced" value="0" />
              <Evidence label="Provider routes observed" value="4" />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Recovery</CardTitle>
              <CardDescription>The last verified checkpoint is restorable.</CardDescription>
            </CardHeader>
            <CardContent className="mt-5">
              <Button variant="secondary" className="w-full">
                <ShieldCheck />
                Review restore point
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_24rem]">
      <Card>
        <CardHeader>
          <CardTitle>Provider connections</CardTitle>
          <CardDescription>
            Keys stay local and are never placed in prompts, logs, or exports.
          </CardDescription>
        </CardHeader>
        <CardContent className="mt-6 space-y-2">
          {connectionProfiles.map((connection) => (
            <ConnectionRow
              key={connection.id}
              name={connection.name}
              state={connection.state}
              selected={selectedConnection === connection.id}
              onSelect={() => setSelectedConnection(connection.id)}
            />
          ))}
        </CardContent>
      </Card>
      <div className="space-y-4">
        <ConnectionSetup providerId={selectedConnection} />
        <Card>
          <CardHeader>
            <CardTitle>Denial of wallet</CardTitle>
            <CardDescription>
              Free-only is enforced as policy, not presented as a promise.
            </CardDescription>
          </CardHeader>
          <CardContent className="mt-6">
            <div className="rounded-3xl bg-emerald-400/[.07] p-6">
              <span className="text-xs text-muted-foreground">
                Maximum automatic spend
              </span>
              <strong className="mt-2 block text-4xl tracking-tight">$0.00</strong>
              <Badge tone="positive" className="mt-5">
                Enforced
              </Badge>
            </div>
            <ul className="mt-5 space-y-3 text-sm text-muted-foreground">
              {costSafetySummary.safeguards.map((safeguard) => (
                <li key={safeguard} className="flex items-center gap-2">
                  <Check className="text-emerald-600 dark:text-emerald-300" weight="bold" />
                  {safeguard}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function CommandPalette({
  query,
  setQuery,
  commands,
  close,
  navigate,
}: {
  query: string;
  setQuery: (query: string) => void;
  commands: readonly {
    id: StudioView;
    label: string;
    note: string;
    icon: typeof Gear;
  }[];
  close: () => void;
  navigate: (view: StudioView) => void;
}) {
  useEffect(() => {
    document.querySelector<HTMLInputElement>("#command-search")?.focus();
  }, []);
  return (
    <div className="fixed inset-0 z-[70] grid place-items-start bg-background/55 px-4 pt-[12vh] backdrop-blur-md">
      <button
        type="button"
        className="absolute inset-0"
        aria-label="Close command palette"
        onClick={close}
      />
      <section
        role="dialog"
        aria-modal="true"
        aria-label="Find tasks, runs, or evidence"
        className="relative mx-auto w-full max-w-2xl rounded-[2rem] bg-popover p-2 shadow-2xl ring-1 ring-foreground/[.08]"
      >
        <div className="flex items-center gap-3 px-4 py-3">
          <MagnifyingGlass className="text-muted-foreground" />
          <input
            id="command-search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Jump to work, evidence, providers, or settings…"
            className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          <Button variant="ghost" size="icon" aria-label="Close command palette" onClick={close}>
            <X />
          </Button>
        </div>
        <div className="max-h-[26rem] space-y-1 overflow-y-auto p-2">
          {commands.length ? (
            commands.map((command) => (
              <button
                key={command.id}
                type="button"
                onClick={() => navigate(command.id)}
                className="flex w-full items-center gap-3 rounded-2xl p-3 text-left outline-none hover:bg-muted focus-visible:bg-muted focus-visible:ring-3 focus-visible:ring-ring/30"
              >
                <span className="grid size-10 place-items-center rounded-2xl bg-muted text-primary">
                  <command.icon size={19} weight="duotone" />
                </span>
                <span className="min-w-0 flex-1">
                  <strong className="block text-sm">{command.label}</strong>
                  <span className="block truncate text-xs text-muted-foreground">
                    {command.note}
                  </span>
                </span>
                <ArrowRight className="text-muted-foreground" />
              </button>
            ))
          ) : (
            <p className="p-6 text-center text-sm text-muted-foreground">
              No workspace destination matches “{query}”.
            </p>
          )}
        </div>
      </section>
    </div>
  );
}

function ApprovalPreview() {
  const approval = contentPatternExamples.approval;
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <Badge tone="caution">Before I act</Badge>
          <ShieldCheck className="text-primary" weight="duotone" />
        </div>
        <CardTitle className="mt-4">{approval.title}</CardTitle>
        <CardDescription>
          Every approval uses the same four decision facts.
        </CardDescription>
      </CardHeader>
      <CardContent className="mt-5 space-y-3">
        {approvalFacts(approval).map((fact) => (
          <div key={fact.label} className="rounded-2xl bg-muted/50 p-3">
            <span className="block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              {fact.label}
            </span>
            <p className="mt-1 text-xs leading-5">{fact.value}</p>
          </div>
        ))}
        <div className="grid grid-cols-2 gap-2 pt-1">
          <Button variant="secondary" size="sm">
            {approval.alternativeAction}
          </Button>
          <Button size="sm">{approval.recommendedAction}</Button>
        </div>
        <p className="text-[10px] text-muted-foreground">
          Demo only. No local or external effect is connected.
        </p>
      </CardContent>
    </Card>
  );
}

function SourceRow({
  label,
  value,
  state,
}: {
  label: string;
  value: string;
  state: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-2xl bg-muted/55 p-3">
      <span className="min-w-0">
        <span className="block text-[10px] text-muted-foreground">{label}</span>
        <strong className="block truncate text-xs capitalize">{value}</strong>
      </span>
      <Badge tone="positive">{state}</Badge>
    </div>
  );
}

function TaskRow({
  id,
  title,
  state,
  tone,
}: {
  id: string;
  title: string;
  state: string;
  tone: "active" | "positive" | "neutral";
}) {
  return (
    <a
      href={`https://opefyre.atlassian.net/browse/${id}`}
      target="_blank"
      rel="noreferrer"
      className="flex items-center gap-3 rounded-2xl bg-muted/45 p-4 outline-none transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/30"
    >
      <span className="grid size-9 place-items-center rounded-xl bg-background text-primary">
        <ListChecks size={17} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="text-[10px] font-semibold text-muted-foreground">{id}</span>
        <strong className="block truncate text-sm">{title}</strong>
      </span>
      <Badge tone={tone}>{state}</Badge>
    </a>
  );
}

function EvidencePulse({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="flex items-center gap-2 text-xs text-muted-foreground">
        <span className="size-2 rounded-full bg-emerald-400 shadow-[0_0_0.75rem] shadow-emerald-400/50" />
        {label}
      </span>
      <strong className="text-xs">{value}</strong>
    </div>
  );
}

function Checkpoint({
  time,
  title,
  note,
  status,
}: {
  time: string;
  title: string;
  note: string;
  status: string;
}) {
  return (
    <div className="grid gap-3 rounded-3xl bg-muted/45 p-4 sm:grid-cols-[4rem_minmax(0,1fr)_auto] sm:items-center">
      <span className="text-xs font-semibold text-muted-foreground">{time}</span>
      <span>
        <strong className="block text-sm">{title}</strong>
        <span className="mt-1 block text-xs leading-5 text-muted-foreground">{note}</span>
      </span>
      <Badge tone="positive">{status}</Badge>
    </div>
  );
}

function ConnectionSetup({ providerId }: { providerId: string }) {
  const connection =
    connectionProfiles.find((candidate) => candidate.id === providerId) ??
    connectionProfiles[0]!;
  const ready = connection.state === "Connected";
  const creditOnly = connection.state === "Credit only";
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <CardTitle>{connection.name}</CardTitle>
          <Badge tone={ready ? "positive" : creditOnly ? "caution" : "neutral"}>
            {connection.state}
          </Badge>
        </div>
        <CardDescription>{connection.access}</CardDescription>
      </CardHeader>
      <CardContent className="mt-5 space-y-4">
        <div className="space-y-2">
          {[
            ready ? "Credential reference stored" : "Add a key to the local credential vault",
            ready ? "Live route observed" : "Run a bounded live canary",
            ready ? "Capacity tracked" : "Prove free status and account limits",
          ].map((step, index) => (
            <div key={step} className="flex items-start gap-3 rounded-2xl bg-muted/45 p-3">
              <span className="grid size-6 shrink-0 place-items-center rounded-full bg-background text-[10px] font-semibold">
                {index + 1}
              </span>
              <span className="text-xs leading-5 text-muted-foreground">{step}</span>
            </div>
          ))}
        </div>
        <p className="text-xs leading-5 text-muted-foreground">
          {creditOnly
            ? "This provider stays outside permanent free routing. Promotional credit requires a separate balance-safe policy."
            : ready
              ? "Demo evidence marks this connection ready. Production readiness still depends on current, sanitized canary evidence."
              : "Catalog verification is complete. The route remains inactive until its credential, cost, quota, model, and capability evidence pass."}
        </p>
        <div className="grid grid-cols-2 gap-2">
          <a
            className={cn(buttonVariants({ variant: "secondary", size: "sm" }), "w-full")}
            href={connection.dashboardUrl}
            target="_blank"
            rel="noreferrer"
          >
            Dashboard
            <ArrowRight />
          </a>
          <a
            className={cn(buttonVariants({ variant: "secondary", size: "sm" }), "w-full")}
            href={connection.sourceUrl}
            target="_blank"
            rel="noreferrer"
          >
            Free-tier proof
          </a>
        </div>
        <a
          className={cn(buttonVariants({ size: "sm" }), "w-full")}
          href={connection.workItemUrl}
          target="_blank"
          rel="noreferrer"
        >
          Open implementation ticket
          <ArrowRight />
        </a>
      </CardContent>
    </Card>
  );
}

function ConnectionRow({
  name,
  state,
  selected,
  onSelect,
}: {
  name: string;
  state: string;
  selected: boolean;
  onSelect: () => void;
}) {
  const connected = state === "Connected";
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={cn(
        "flex w-full items-center gap-3 rounded-2xl bg-muted/45 p-4 text-left outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/30",
        selected && "bg-primary/[.08] ring-1 ring-primary/15"
      )}
    >
      <span
        className={cn(
          "size-2 rounded-full",
          connected ? "bg-emerald-400" : "bg-amber-400"
        )}
      />
      <strong className="min-w-0 flex-1 truncate text-sm">{name}</strong>
      <Badge tone={connected ? "positive" : "caution"}>{state}</Badge>
      <ArrowRight className="text-muted-foreground" />
    </button>
  );
}

function Metric({
  icon: Icon,
  metric,
  note,
  tone,
}: {
  icon: typeof Cpu;
  metric: ReturnType<typeof controlCenterMetric>;
  note: string;
  tone: string;
}) {
  const value =
    metric.value === null
      ? "Unavailable"
      : `${metric.value} ${
          metric.unit === "tasks" ? (metric.value === 1 ? "task" : "tasks") : metric.unit
        }`;
  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <span className="text-xs font-medium text-muted-foreground">{metric.label}</span>
          <strong className="mt-2 block text-xl font-semibold tracking-tight">{value}</strong>
          <span className="mt-1 block text-xs text-muted-foreground">{note}</span>
          <span
            className="mt-2 block text-[10px] text-muted-foreground/75"
            title={`Source events: ${metric.provenance.eventTypes.join(", ")}`}
          >
            {metric.provenance.freshness} · observed{" "}
            {metric.provenance.observedAt?.slice(11, 16) ?? "never"} UTC
          </span>
        </div>
        <span className={cn("grid size-10 place-items-center rounded-2xl bg-muted", tone)}>
          <Icon size={20} weight="duotone" />
        </span>
      </div>
    </Card>
  );
}

function ProviderFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <span className="block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <strong className="mt-1 block truncate text-xs capitalize">{value}</strong>
    </div>
  );
}

function Choice({
  label,
  note,
  selected,
  onSelect,
}: {
  label: string;
  note: string;
  selected: boolean;
  onSelect: (label: string) => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={() => onSelect(label)}
      className={cn(
        "flex w-full items-center gap-3 rounded-2xl bg-muted/65 p-3 text-left outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/30",
        selected && "bg-primary/10"
      )}
    >
      <span
        className={cn(
          "grid size-4 place-items-center rounded-full bg-background ring-1 ring-foreground/15",
          selected && "bg-primary text-primary-foreground ring-primary"
        )}
      >
        {selected && <Check size={10} weight="bold" />}
      </span>
      <span>
        <strong className="block text-sm">{label}</strong>
        <span className="text-xs text-muted-foreground">{note}</span>
      </span>
    </button>
  );
}

function ReliabilityFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs text-muted-foreground">{label}</span>
      <strong className="text-sm">{value}</strong>
    </div>
  );
}

function Evidence({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-3xl bg-muted/60 p-5">
      <ShieldCheck className="text-primary" size={20} weight="duotone" />
      <span className="mt-4 block text-xs text-muted-foreground">{label}</span>
      <strong className="mt-1 block capitalize">{value}</strong>
    </div>
  );
}

function VerifiedProviderCatalog() {
  return (
    <Card className="min-w-0 xl:col-span-2">
      <CardHeader>
        <CardTitle>Verified connection catalog</CardTitle>
        <CardDescription>
          Officially checked free access. A provider remains inactive until its key and live account limits pass a canary.
        </CardDescription>
      </CardHeader>
      <CardContent className="mt-7 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        {verifiedProviderSnapshot.map((provider) => (
          <div key={provider.id} className="rounded-3xl bg-muted/50 p-5">
            <div className="flex items-center justify-between gap-3">
              <strong>{provider.label}</strong>
              <Badge tone={provider.zeroCostEligible ? "positive" : "caution"}>
                {provider.zeroCostEligible ? "Free eligible" : "Credit only"}
              </Badge>
            </div>
            <p className="mt-2 truncate text-xs text-muted-foreground">{provider.modelId}</p>
            <p className="mt-5 text-xs leading-5 text-muted-foreground">
              {provider.zeroCostEligible
                ? "Connect a key, probe account limits, then admit to routing."
                : "Excluded from automatic free-only routing."}
            </p>
            <div className="mt-5 flex gap-2">
              <a
                href={provider.dashboardUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 rounded-full bg-background px-3 py-2 text-xs font-semibold hover:bg-primary/10"
              >
                Dashboard
                <ArrowRight />
              </a>
              <a
                href={provider.sourceUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center rounded-full bg-background px-3 py-2 text-xs font-semibold hover:bg-primary/10"
              >
                Source
              </a>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function formatWakeTime(retryAt: number, generatedAt: number): string {
  const remainingSeconds = Math.max(0, Math.ceil((retryAt - generatedAt) / 1_000));
  if (remainingSeconds < 60) return `in ${remainingSeconds}s`;
  const minutes = Math.ceil(remainingSeconds / 60);
  return minutes < 60 ? `in ${minutes}m` : `at ${new Date(retryAt).toISOString().slice(11, 16)} UTC`;
}

const themeOptions: readonly {
  mode: ThemeMode;
  label: string;
  icon: typeof Sun;
}[] = [
  { mode: "light", label: "Light theme", icon: Sun },
  { mode: "system", label: "System theme", icon: Desktop },
  { mode: "dark", label: "Dark theme", icon: Moon },
];

function ThemeControl({
  mode,
  setMode,
}: {
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
}) {
  return (
    <div
      className="hidden items-center rounded-full bg-muted p-1 sm:flex"
      role="group"
      aria-label="Color theme"
    >
      {themeOptions.map((option) => (
        <button
          key={option.mode}
          type="button"
          title={option.label}
          aria-label={option.label}
          aria-pressed={mode === option.mode}
          onClick={() => setMode(option.mode)}
          className={cn(
            "grid size-7 place-items-center rounded-full text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/30",
            mode === option.mode && "bg-background text-foreground shadow-sm"
          )}
        >
          <option.icon size={14} weight={mode === option.mode ? "fill" : "regular"} />
        </button>
      ))}
    </div>
  );
}

export { App };
