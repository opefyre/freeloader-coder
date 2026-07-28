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
import { ExecutionSafetyPanel } from "./components/execution/execution-safety-panel.js";
import { IntegrationWorkbench } from "./components/integrations/integration-workbench.js";
import { OrchestrationWorkbench } from "./components/orchestration/orchestration-workbench.js";
import { EvidenceCenter } from "./components/quality/evidence-center.js";
import { ControlCenter } from "./components/control-center/control-center.js";
import { ResilienceCenter } from "./components/resilience/resilience-center.js";
import { ConversationWorkbench } from "./components/conversation/conversation-workbench.js";
import { ProviderConnectionWizard } from "./components/providers/provider-connection-wizard.js";
import { ExpandedProviderMesh } from "./components/providers/expanded-provider-mesh.js";
import { RuntimeSetupPanel } from "./components/runtime/runtime-setup-panel.js";
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
import {
  applyPermissionAction,
  recommendedPermissionProfiles,
  visiblePermissionTarget,
  type PermissionAction,
  type PermissionProfile,
} from "./permission-fixture.js";
import {
  detectedProject,
  nextOnboardingStage,
  onboardingProgress,
  onboardingStages,
  previewEvidence,
  starterPlan,
  type OnboardingStage,
} from "./onboarding-fixture.js";
import {
  canonicalStudioUrl,
  viewFromLocation,
  type StudioView,
} from "./routing.js";

const navItems = [
  { id: "overview", label: "Overview", note: "Pipeline health and decisions", icon: Gauge },
  { id: "projects", label: "Projects", note: "Add, understand, and start safely", icon: FolderOpen },
  {
    id: "conversation",
    label: "Conversation",
    note: "Ask, clarify, and guide work",
    icon: ChatCircleDots,
  },
  { id: "work", label: "Work", note: "Active, queued, and verified tasks", icon: ListChecks, count: "8" },
  { id: "providers", label: "Providers", note: "Free routes and model health", icon: PlugsConnected },
  { id: "integrations", label: "Connect", note: "GitHub and Jira workspaces", icon: GitBranch },
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
  projects: {
    eyebrow: "Guided project setup",
    title: "Start with confidence",
    description: "Add a repository, understand it automatically, and reach a validated first preview.",
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
  integrations: {
    eyebrow: "GitHub + Jira · Connected Beta",
    title: "Bring work in. Send proof back.",
    description: "Connect exact resources, ground selected work, and approve every external write before it happens.",
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
  return viewFromLocation(window.location);
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
    const url = canonicalStudioUrl(new URL(window.location.href), view);
    url.hash = "";
    window.history[replace ? "replaceState" : "pushState"]({}, "", url);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  useEffect(() => {
    const canonicalUrl = canonicalStudioUrl(
      new URL(window.location.href),
      initialView()
    );
    if (canonicalUrl.href !== window.location.href) {
      window.history.replaceState({}, "", canonicalUrl);
    }
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
          onClick={() => navigate("projects")}
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
          <ControlCenter navigate={navigate} />
          <div className="hidden" aria-hidden="true">
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
          </div>
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
        className="fixed inset-x-3 bottom-3 z-40 grid grid-cols-7 rounded-3xl bg-popover/95 p-1.5 shadow-2xl ring-1 ring-foreground/[.07] backdrop-blur-xl lg:hidden"
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
            <span>{item.id === "conversation" ? "Chat" : item.label}</span>
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
  if (view === "projects") {
    return <OnboardingWorkspace />;
  }

  if (view === "conversation") {
    return <ConversationWorkbench navigate={navigate} />;
  }

  if (view === "work") {
    return (
      <div className="min-w-0 space-y-4">
        <ExecutionSafetyPanel />
        <OrchestrationWorkbench />
      </div>
    );
  }

  if (view === "integrations") {
    return <IntegrationWorkbench />;
  }

  if (view === "providers") {
    const selected = providerTelemetry.find(
      (provider) => provider.providerId === selectedProvider
    );
    return (
      <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <ExpandedProviderMesh />
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
    return <EvidenceCenter />;
  }

  return (
    <SettingsWorkspace
      selectedConnection={selectedConnection}
      setSelectedConnection={setSelectedConnection}
    />
  );
}

function OnboardingWorkspace() {
  const [onboardingStage, setOnboardingStage] = useState<OnboardingStage>("select");
  const [entryMethod, setEntryMethod] = useState<"local" | "github">("local");
  const [githubUrl, setGithubUrl] = useState("https://github.com/opefyre/freeloader-coder");
  const [notice, setNotice] = useState(
    "Nothing has been read or changed. Choose how to add the project."
  );
  const [decision, setDecision] = useState<"keep" | "restore" | null>(null);
  const progress = onboardingProgress(onboardingStage);
  const currentIndex = onboardingStages.findIndex((stage) => stage.id === onboardingStage);

  const advance = () => {
    const next = nextOnboardingStage(onboardingStage);
    setOnboardingStage(next);
    setNotice({
      analyze: "Repository access confirmed. Analysis is deterministic and excludes likely secrets.",
      plan: "Project understanding is ready. Review the recommended first task before anything changes.",
      preview: "The demo preview is validated and attached to a restorable checkpoint.",
      decision: "Validation is complete. Choose whether to keep or restore the checkpoint.",
      select: "Choose how to add the project."
    }[next]);
  };

  return (
    <div className="space-y-4">
      <RuntimeSetupPanel />
      <Card className="relative overflow-hidden">
        <CardHeader className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <Badge tone="active">First project</Badge>
              <span className="text-xs font-medium text-muted-foreground">{progress}% complete</span>
            </div>
            <CardTitle className="mt-4 text-xl">From repository to verified preview</CardTitle>
            <CardDescription>
              Five guided steps. Existing work stays untouched, and every change can be restored.
            </CardDescription>
          </div>
          <div className="min-w-44">
            <div className="h-2 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary transition-[width]"
                style={{ width: `${progress}%` }}
              />
            </div>
            <p className="mt-2 text-right text-xs text-muted-foreground">
              About {Math.max(1, starterPlan.expectedMinutes - currentIndex * 2)} minutes remaining
            </p>
          </div>
        </CardHeader>
        <CardContent className="mt-6">
          <ol className="grid gap-2 sm:grid-cols-5" aria-label="Project onboarding progress">
            {onboardingStages.map((stage, index) => (
              <li
                key={stage.id}
                aria-current={stage.id === onboardingStage ? "step" : undefined}
                className={cn(
                  "rounded-2xl p-3",
                  index < currentIndex
                    ? "bg-emerald-400/[.07]"
                    : stage.id === onboardingStage
                      ? "bg-primary/10"
                      : "bg-muted/45"
                )}
              >
                <div className="flex items-center gap-2">
                  <span
                    className={cn(
                      "grid size-5 place-items-center rounded-full text-[10px] font-bold",
                      index < currentIndex
                        ? "bg-emerald-400/20 text-emerald-700 dark:text-emerald-300"
                        : stage.id === onboardingStage
                          ? "bg-primary/20 text-primary"
                          : "bg-background text-muted-foreground"
                    )}
                  >
                    {index < currentIndex ? <Check weight="bold" /> : index + 1}
                  </span>
                  <strong className="text-xs">{stage.label}</strong>
                </div>
                <p className="mt-2 text-[11px] leading-4 text-muted-foreground">{stage.note}</p>
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.45fr)_minmax(20rem,.7fr)]">
        <Card>
          {onboardingStage === "select" && (
            <>
              <CardHeader>
                <CardTitle>Add the project you want to build</CardTitle>
                <CardDescription>
                  Local folders and GitHub clones become the same safe project record.
                </CardDescription>
              </CardHeader>
              <CardContent className="mt-6">
                <div className="grid gap-3 sm:grid-cols-2" role="group" aria-label="Repository source">
                  <button
                    type="button"
                    aria-pressed={entryMethod === "local"}
                    onClick={() => {
                      setEntryMethod("local");
                      setNotice("Local folders are inspected read-only before registration.");
                    }}
                    className={cn(
                      "rounded-3xl bg-muted/50 p-5 text-left outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/30",
                      entryMethod === "local" && "bg-primary/[.09]"
                    )}
                  >
                    <FolderOpen size={24} className="text-primary" weight="duotone" />
                    <strong className="mt-5 block">Local folder</strong>
                    <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                      Register an existing repository without moving or overwriting files.
                    </span>
                  </button>
                  <button
                    type="button"
                    aria-pressed={entryMethod === "github"}
                    onClick={() => {
                      setEntryMethod("github");
                      setNotice("Private repositories may ask you to connect GitHub, then Resume verification.");
                    }}
                    className={cn(
                      "rounded-3xl bg-muted/50 p-5 text-left outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/30",
                      entryMethod === "github" && "bg-primary/[.09]"
                    )}
                  >
                    <GitBranch size={24} className="text-primary" weight="duotone" />
                    <strong className="mt-5 block">Clone from GitHub</strong>
                    <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                      Validate access and destination safety before cloning.
                    </span>
                  </button>
                </div>
                {entryMethod === "local" ? (
                  <div className="mt-5 rounded-3xl bg-muted/45 p-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <strong className="text-sm">No folder selected</strong>
                        <p className="mt-1 text-xs text-muted-foreground">
                          The selected path stays local and is masked during screen sharing.
                        </p>
                      </div>
                      <Button
                        onClick={() => setNotice(
                          "Demo repository selected. No file has been opened or changed."
                        )}
                      >
                        <FolderOpen weight="fill" />
                        Choose local folder
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="mt-5">
                    <label htmlFor="github-repository-url" className="text-xs font-semibold">
                      GitHub repository URL
                    </label>
                    <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                      <input
                        id="github-repository-url"
                        type="url"
                        value={githubUrl}
                        onChange={(event) => setGithubUrl(event.target.value)}
                        className="h-11 min-w-0 flex-1 rounded-2xl bg-muted px-4 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/30"
                      />
                      <Button
                        variant="secondary"
                        onClick={() => setNotice(
                          "Access can be verified. The destination will be checked before cloning."
                        )}
                      >
                        Verify access
                      </Button>
                    </div>
                    <button
                      type="button"
                      className="mt-3 text-xs font-semibold text-primary hover:underline"
                      onClick={() => setNotice("Access verification resumed from the preserved checkpoint.")}
                    >
                      Resume verification
                    </button>
                  </div>
                )}
                <div className="mt-6 flex justify-end">
                  <Button onClick={advance}>
                    Analyze safely
                    <ArrowRight />
                  </Button>
                </div>
              </CardContent>
            </>
          )}

          {onboardingStage === "analyze" && (
            <>
              <CardHeader className="flex flex-row items-start justify-between gap-4">
                <div>
                  <Badge tone="positive">{detectedProject.state}</Badge>
                  <CardTitle className="mt-4 text-xl">{detectedProject.name}</CardTitle>
                  <CardDescription>{detectedProject.summary}</CardDescription>
                </div>
                <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-emerald-400/10 text-emerald-700 dark:text-emerald-300">
                  <CheckCircle size={24} weight="duotone" />
                </span>
              </CardHeader>
              <CardContent className="mt-6 space-y-5">
                <div className="grid gap-3 sm:grid-cols-3">
                  <OnboardingFact label="Languages" value={detectedProject.languages.join(", ")} />
                  <OnboardingFact label="Frameworks" value={detectedProject.frameworks.join(", ")} />
                  <OnboardingFact label="Validation" value={detectedProject.commands.join(" · ")} />
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  <GroundingGroup label="Verified facts" items={detectedProject.facts} />
                  <GroundingGroup label="Inferences" items={detectedProject.inferences} />
                  <GroundingGroup label="Assumptions" items={detectedProject.assumptions} />
                  <GroundingGroup label="Your decisions" items={detectedProject.userDecisions} />
                </div>
                <details className="rounded-2xl bg-muted/45 p-4">
                  <summary className="cursor-pointer text-xs font-semibold">
                    Advanced · citations and protected paths
                  </summary>
                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    <OnboardingFact label="Cited sources" value="package.json · App.tsx · globals.css" />
                    <OnboardingFact label="Never grounded" value={detectedProject.protectedPaths.join(" · ")} />
                  </div>
                </details>
                <div className="flex justify-end">
                  <Button onClick={advance}>
                    Review safe starter
                    <ArrowRight />
                  </Button>
                </div>
              </CardContent>
            </>
          )}

          {onboardingStage === "plan" && (
            <>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <Badge tone="active">Recommended</Badge>
                  <Badge>{starterPlan.expectedMinutes} minute estimate</Badge>
                </div>
                <CardTitle className="mt-4 text-xl">{starterPlan.title}</CardTitle>
                <CardDescription>{starterPlan.reason}</CardDescription>
              </CardHeader>
              <CardContent className="mt-6">
                <div className="grid gap-3 md:grid-cols-2">
                  <PlanGroup label="What will happen" items={starterPlan.effects} />
                  <PlanGroup label="What proves it worked" items={starterPlan.evidence} />
                </div>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <OnboardingFact label="Model use" value={starterPlan.providerPosture} />
                  <OnboardingFact label="This computer" value={starterPlan.localResources} />
                </div>
                <div className="mt-4 rounded-3xl bg-emerald-400/[.07] p-5">
                  <div className="flex items-center gap-2 text-sm font-semibold text-emerald-700 dark:text-emerald-300">
                    <ShieldCheck weight="duotone" />
                    Safe undo
                  </div>
                  <p className="mt-2 text-xs leading-5 text-muted-foreground">{starterPlan.undo}</p>
                </div>
                <details className="mt-4 rounded-2xl bg-muted/45 p-4">
                  <summary className="cursor-pointer text-xs font-semibold">
                    Advanced · exact operations and limitations
                  </summary>
                  <div className="mt-4 grid gap-4 md:grid-cols-2">
                    <PlanGroup label="Exact operations" items={starterPlan.advancedOperations} />
                    <PlanGroup label="Limitations" items={starterPlan.limitations} />
                  </div>
                </details>
                <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                  <Button variant="secondary" onClick={() => setOnboardingStage("analyze")}>
                    Review understanding
                  </Button>
                  <Button onClick={advance}>
                    Create validated preview
                    <ArrowRight />
                  </Button>
                </div>
              </CardContent>
            </>
          )}

          {onboardingStage === "preview" && (
            <>
              <CardHeader className="flex flex-row items-start justify-between gap-4">
                <div>
                  <Badge tone="positive">Validated preview</Badge>
                  <CardTitle className="mt-4 text-xl">Your first safe change is ready</CardTitle>
                  <CardDescription>
                    This preview is evidence-backed and still isolated from your existing work.
                  </CardDescription>
                </div>
                <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-primary/10 text-primary">
                  <Sparkle size={23} weight="fill" />
                </span>
              </CardHeader>
              <CardContent className="mt-6">
                <div className="overflow-hidden rounded-3xl bg-muted/55 p-3">
                  <div className="rounded-2xl bg-background p-6 shadow-sm">
                    <span className="text-[10px] font-semibold uppercase tracking-[.16em] text-primary">
                      Local preview
                    </span>
                    <h3 className="mt-3 text-2xl font-semibold tracking-tight">
                      Build freely. Keep control.
                    </h3>
                    <p className="mt-2 max-w-lg text-sm text-muted-foreground">
                      A clearer heading, validated against the repository’s existing design system.
                    </p>
                  </div>
                </div>
                <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  {previewEvidence.map((item) => (
                    <OnboardingFact key={item.label} label={item.label} value={item.value} />
                  ))}
                </div>
                <div className="mt-6 flex justify-end">
                  <Button onClick={advance}>
                    Review Keep or Restore
                    <ArrowRight />
                  </Button>
                </div>
              </CardContent>
            </>
          )}

          {onboardingStage === "decision" && (
            <>
              <CardHeader>
                <Badge tone={decision ? "positive" : "caution"}>
                  {decision ? "Decision recorded" : "One decision left"}
                </Badge>
                <CardTitle className="mt-4 text-xl">
                  {decision === "keep"
                    ? "Checkpoint kept"
                    : decision === "restore"
                      ? "Previous state restored"
                      : "Keep the validated change?"}
                </CardTitle>
                <CardDescription>
                  {decision === null
                    ? "Both options preserve unrelated files and existing local work."
                    : "The guided first-project journey is complete."}
                </CardDescription>
              </CardHeader>
              <CardContent className="mt-6">
                {decision === null ? (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <button
                      type="button"
                      onClick={() => {
                        setDecision("keep");
                        setNotice("The validated checkpoint was kept. No external publish occurred.");
                      }}
                      className="rounded-3xl bg-primary/10 p-5 text-left outline-none hover:bg-primary/15 focus-visible:ring-3 focus-visible:ring-ring/30"
                    >
                      <CheckCircle size={24} className="text-primary" weight="duotone" />
                      <strong className="mt-5 block">Keep checkpoint</strong>
                      <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                        Preserve the validated local change as the new safe starting point.
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setDecision("restore");
                        setNotice("The exact previous state was restored. Unrelated work was preserved.");
                      }}
                      className="rounded-3xl bg-muted/55 p-5 text-left outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/30"
                    >
                      <ShieldCheck size={24} className="text-primary" weight="duotone" />
                      <strong className="mt-5 block">Restore previous state</strong>
                      <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                        Remove only product-owned changes and return to the saved baseline.
                      </span>
                    </button>
                  </div>
                ) : (
                  <div className="rounded-3xl bg-emerald-400/[.07] p-6 text-center">
                    <CheckCircle size={34} className="mx-auto text-emerald-700 dark:text-emerald-300" weight="duotone" />
                    <strong className="mt-4 block">Ready for your next request</strong>
                    <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
                      Pipeline Studio now understands the project, its safeguards, and how to validate future work.
                    </p>
                  </div>
                )}
              </CardContent>
            </>
          )}
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Safety boundary</CardTitle>
              <CardDescription>What remains true throughout setup.</CardDescription>
            </CardHeader>
            <CardContent className="mt-5 space-y-3">
              <SourceRow label="Existing files" value="Never overwritten" state="Protected" />
              <SourceRow label="Likely secrets" value="Excluded" state="Protected" />
              <SourceRow label="Automatic spend" value="$0.00" state="Enforced" />
              <SourceRow label="Restore" value="Product files only" state="Ready" />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Current checkpoint</CardTitle>
              <CardDescription>
                Product work is isolated from pre-existing changes.
              </CardDescription>
            </CardHeader>
            <CardContent className="mt-5">
              <div className="rounded-2xl bg-muted/50 p-4">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs font-semibold">Before Pipeline Studio</span>
                  <Badge tone="positive">Restorable</Badge>
                </div>
                <p className="mt-2 text-xs leading-5 text-muted-foreground">
                  Dirty and untracked user files remain outside the product checkpoint.
                </p>
              </div>
            </CardContent>
          </Card>
          <p
            aria-live="polite"
            className="rounded-3xl bg-primary/[.08] p-4 text-xs leading-5 text-muted-foreground"
          >
            {notice}
          </p>
        </div>
      </div>
    </div>
  );
}

function OnboardingFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-muted/50 p-4">
      <span className="text-[10px] font-semibold uppercase tracking-[.14em] text-muted-foreground">
        {label}
      </span>
      <strong className="mt-2 block text-xs leading-5">{value}</strong>
    </div>
  );
}

function GroundingGroup({ label, items }: { label: string; items: readonly string[] }) {
  return (
    <div className="rounded-3xl bg-muted/45 p-4">
      <strong className="text-xs">{label}</strong>
      <ul className="mt-3 space-y-2 text-xs leading-5 text-muted-foreground">
        {items.map((item) => (
          <li key={item} className="flex gap-2">
            <span className="mt-2 size-1 shrink-0 rounded-full bg-primary" />
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

function PlanGroup({ label, items }: { label: string; items: readonly string[] }) {
  return (
    <div className="rounded-3xl bg-muted/45 p-5">
      <strong className="text-xs">{label}</strong>
      <ol className="mt-4 space-y-3">
        {items.map((item, index) => (
          <li key={item} className="flex gap-3 text-xs leading-5 text-muted-foreground">
            <span className="grid size-5 shrink-0 place-items-center rounded-full bg-background text-[10px] font-bold text-foreground">
              {index + 1}
            </span>
            {item}
          </li>
        ))}
      </ol>
    </div>
  );
}

function SettingsWorkspace({
  selectedConnection,
  setSelectedConnection,
}: {
  selectedConnection: string;
  setSelectedConnection: (provider: string) => void;
}) {
  const [permissions, setPermissions] = useState<readonly PermissionProfile[]>(
    recommendedPermissionProfiles
  );
  const [selectedPermissionId, setSelectedPermissionId] = useState("project-folder");
  const [privacyScreen, setPrivacyScreen] = useState(false);
  const [preset, setPreset] = useState<"Guided" | "Balanced" | "Autonomous">("Balanced");
  const [permissionNotice, setPermissionNotice] = useState(
    "Permissions are scoped to Main project."
  );
  const selectedPermission =
    permissions.find((permission) => permission.id === selectedPermissionId) ??
    permissions[0]!;

  const applyAction = (action: PermissionAction) => {
    const result = applyPermissionAction(selectedPermission, action);
    setPermissions((current) =>
      current.map((permission) =>
        permission.id === result.profile.id ? result.profile : permission
      )
    );
    setPermissionNotice(result.notice);
  };

  return (
    <>
    <ResilienceCenter />
    <Tabs defaultValue="permissions">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <TabsList aria-label="Settings sections">
          <TabsTrigger value="permissions">Permissions</TabsTrigger>
          <TabsTrigger value="connections">Connections</TabsTrigger>
        </TabsList>
        <Button
          variant={privacyScreen ? "default" : "secondary"}
          size="sm"
          aria-pressed={privacyScreen}
          onClick={() => setPrivacyScreen((current) => !current)}
        >
          <ShieldCheck />
          {privacyScreen ? "Privacy screen on" : "Mask for screen sharing"}
        </Button>
      </div>

      <TabsContent value="permissions">
        <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_24rem]">
          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Project permission posture</CardTitle>
                <CardDescription>
                  One canonical policy controls models, plugins, tools, and connected services.
                </CardDescription>
              </CardHeader>
              <CardContent className="mt-6">
                <div className="grid gap-2 sm:grid-cols-3" role="group" aria-label="Approval preset">
                  {(["Guided", "Balanced", "Autonomous"] as const).map((option) => (
                    <button
                      key={option}
                      type="button"
                      aria-pressed={preset === option}
                      onClick={() => {
                        setPreset(option);
                        setPermissionNotice(
                          `${option} is now the project preset. Credential, destructive, permission-expanding, and paid safeguards remain enforced.`
                        );
                      }}
                      className={cn(
                        "rounded-2xl bg-muted/50 p-4 text-left outline-none transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/30",
                        preset === option && "bg-primary/[.09]"
                      )}
                    >
                      <strong className="block text-sm">{option}</strong>
                      <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                        {
                          {
                            Guided: "Ask before every change.",
                            Balanced: "Automate safe local work.",
                            Autonomous: "Automate reversible work within grants.",
                          }[option]
                        }
                      </span>
                    </button>
                  ))}
                </div>
                <p className="mt-4 text-xs leading-5 text-muted-foreground">
                  Models and plugins cannot grant themselves access. Project overrides can tighten
                  policy but cannot auto-approve credentials, destructive changes, or paid use.
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Who can access what</CardTitle>
                <CardDescription>
                  Review project folders, providers, connectors, tools, external effects, and paid permissions.
                </CardDescription>
              </CardHeader>
              <CardContent className="mt-6 grid gap-2 md:grid-cols-2">
                {permissions.map((permission) => (
                  <button
                    key={permission.id}
                    type="button"
                    aria-pressed={selectedPermission.id === permission.id}
                    onClick={() => setSelectedPermissionId(permission.id)}
                    className={cn(
                      "rounded-3xl bg-muted/45 p-5 text-left outline-none transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/30",
                      selectedPermission.id === permission.id && "bg-primary/[.09]"
                    )}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                        {permission.kind}
                      </span>
                      <Badge tone={permissionTone(permission.state)}>{permission.state}</Badge>
                    </div>
                    <strong className="mt-3 block text-sm">{permission.name}</strong>
                    <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                      {permission.summary}
                    </span>
                    <span className="mt-4 block truncate text-xs font-semibold">
                      {visiblePermissionTarget(permission, privacyScreen)}
                    </span>
                  </button>
                ))}
              </CardContent>
            </Card>
          </div>

          <div className="space-y-4">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between gap-3">
                  <CardTitle>{selectedPermission.name}</CardTitle>
                  <Badge tone={permissionTone(selectedPermission.state)}>
                    {selectedPermission.state}
                  </Badge>
                </div>
                <CardDescription>{selectedPermission.summary}</CardDescription>
              </CardHeader>
              <CardContent className="mt-6 space-y-4">
                <PermissionFact
                  label="Project"
                  value={privacyScreen ? "Project · ••••" : selectedPermission.project}
                />
                <PermissionFact
                  label="Target"
                  value={visiblePermissionTarget(selectedPermission, privacyScreen)}
                />
                <PermissionFact label="Allowed effect" value={selectedPermission.access} />
                <PermissionFact
                  label="Expiry"
                  value={selectedPermission.expiresAt ?? "No automatic expiry"}
                />
                <details className="rounded-2xl bg-muted/45 p-4">
                  <summary className="cursor-pointer text-xs font-semibold outline-none focus-visible:ring-3 focus-visible:ring-ring/30">
                    Advanced · technical scopes
                  </summary>
                  <ul className="mt-3 space-y-2 text-xs text-muted-foreground">
                    {selectedPermission.technicalScopes.map((scope) => (
                      <li key={scope}>{scope}</li>
                    ))}
                  </ul>
                </details>
                <div className="grid gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => applyAction("expire")}
                  >
                    Expire in 24 hours
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => applyAction("reset")}
                  >
                    Reset to recommended
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => applyAction("revoke")}
                    disabled={selectedPermission.state === "Revoked"}
                  >
                    Revoke now
                  </Button>
                </div>
                <p
                  className="rounded-2xl bg-primary/[.07] p-3 text-xs leading-5"
                  aria-live="polite"
                >
                  {permissionNotice}
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Recent use</CardTitle>
                <CardDescription>
                  Privacy-safe activity for this permission.
                </CardDescription>
              </CardHeader>
              <CardContent className="mt-5">
                <p className="text-xs leading-5">{selectedPermission.recentUse}</p>
                <p className="mt-2 text-xs text-muted-foreground">
                  {selectedPermission.activeWork > 0
                    ? `${selectedPermission.activeWork} active task will pause after its current safe step if revoked.`
                    : "No active work requires reconciliation."}
                </p>
              </CardContent>
            </Card>
          </div>
        </div>
      </TabsContent>

      <TabsContent value="connections">
        <div className="mb-4">
          <ProviderConnectionWizard />
        </div>
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
      </TabsContent>
    </Tabs>
    </>
  );
}

function PermissionFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-2xl bg-muted/45 p-3">
      <span className="text-xs text-muted-foreground">{label}</span>
      <strong className="max-w-[65%] text-right text-xs">{value}</strong>
    </div>
  );
}

function permissionTone(
  state: PermissionProfile["state"]
): "positive" | "caution" | "neutral" {
  if (state === "Active") return "positive";
  if (state === "Expires soon") return "caution";
  return "neutral";
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
          Every approval uses the same five decision facts.
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
        <details className="rounded-2xl bg-muted/45 p-4">
          <summary className="cursor-pointer text-xs font-semibold outline-none focus-visible:ring-3 focus-visible:ring-ring/30">
            Advanced · sanitized admission evidence
          </summary>
          <dl className="mt-4 grid gap-3 text-xs">
            <div className="flex items-center justify-between gap-4">
              <dt className="text-muted-foreground">Credential</dt>
              <dd>{ready ? "vault:•••• / fingerprint only" : "Not stored"}</dd>
            </div>
            <div className="flex items-center justify-between gap-4">
              <dt className="text-muted-foreground">Live canary</dt>
              <dd>{ready ? "Fresh · chat proven" : "Required before dispatch"}</dd>
            </div>
            <div className="flex items-center justify-between gap-4">
              <dt className="text-muted-foreground">Account limits</dt>
              <dd>{ready ? "Observed · freshness tracked" : "Not observed"}</dd>
            </div>
            <div className="flex items-center justify-between gap-4">
              <dt className="text-muted-foreground">Routing</dt>
              <dd>{creditOnly ? "Excluded from permanent free" : ready ? "Admitted" : "Held safely"}</dd>
            </div>
          </dl>
        </details>
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
