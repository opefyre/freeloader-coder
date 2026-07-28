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
import { useMemo, useState } from "react";

import { Badge } from "./components/ui/badge.js";
import { PipelineMark } from "./components/brand/pipeline-mark.js";
import { Button } from "./components/ui/button.js";
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
  providerTelemetry,
  routeEvidenceSummary,
  successfulProviderCalls,
} from "./runtime-fixture.js";
import { useTheme, type ThemeMode } from "./theme.js";

const navItems = [
  { label: "Overview", icon: Gauge, active: true },
  { label: "Conversation", icon: ChatCircleDots, active: false },
  { label: "Work", icon: ListChecks, count: "8", active: false },
  { label: "Providers", icon: PlugsConnected, active: false },
  { label: "Evidence", icon: ShieldCheck, active: false },
] as const;

const stages = [
  { label: "Readiness", note: "Goal and repository understood", state: "done" },
  { label: "Breakdown", note: "6 scoped tasks created", state: "done" },
  { label: "Implementation", note: "Responsive navigation shell", state: "active" },
  { label: "Validation", note: "Type, lint, build and UI", state: "next" },
  { label: "Review", note: "Two independent reviewers", state: "next" },
] as const;

const providerColor: Record<string, string> = {
  groq: "bg-chart-1",
  cloudflare: "bg-chart-2",
  gemini: "bg-chart-3",
  openrouter: "bg-chart-5",
};

function App() {
  const theme = useTheme();
  const [selectedProvider, setSelectedProvider] = useState(
    providerTelemetry[0]?.providerId ?? ""
  );
  const [costOpen, setCostOpen] = useState(false);
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
          <span className="grid size-10 place-items-center rounded-2xl bg-primary text-primary-foreground shadow-lg shadow-primary/10">
            <PipelineMark className="size-7" title="Pipeline Studio mark" />
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
            <a
              key={item.label}
              href={`#${item.label.toLowerCase()}`}
              aria-current={item.active ? "page" : undefined}
              className={cn(
                "flex h-10 items-center gap-3 rounded-2xl px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                item.active && "bg-sidebar-accent text-sidebar-accent-foreground"
              )}
            >
              <item.icon size={18} weight={item.active ? "fill" : "regular"} />
              <span>{item.label}</span>
              {"count" in item && (
                <Badge className="ml-auto px-2 py-0.5">{item.count}</Badge>
              )}
            </a>
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

        <a
          href="#settings"
          className="mt-3 flex h-10 items-center gap-3 rounded-2xl px-3 text-sm text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
        >
          <Gear size={18} />
          Settings
        </a>
      </aside>

      <main id="workspace" className="min-w-0">
        <header className="sticky top-0 z-30 flex h-18 items-center justify-between bg-background/88 px-4 backdrop-blur-xl sm:px-7 lg:px-9">
          <div className="flex items-center gap-3 lg:hidden">
            <span className="grid size-9 place-items-center rounded-2xl bg-primary text-primary-foreground">
              <PipelineMark className="size-6" title="Pipeline Studio mark" />
            </span>
            <strong className="text-sm">Pipeline Studio</strong>
          </div>
          <button
            type="button"
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
                Freeloader Coder
                <span>·</span>
                <span>Demo data</span>
              </div>
              <h1 className="mt-2 text-2xl font-semibold tracking-[-0.03em] sm:text-3xl">
                Good morning, Opefyre
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Your pipeline is moving. One safe decision is waiting.
              </p>
            </div>
            <div className="flex gap-2">
              <Button variant="secondary">
                <Pause />
                Pause after step
              </Button>
              <Button>
                <ChatCircleDots weight="fill" />
                Ask the pipeline
              </Button>
            </div>
          </div>

          <section className="metric-grid grid gap-3" aria-label="Pipeline summary">
            <Metric
              icon={Lightning}
              label="Active work"
              value="1 task"
              note="Implementation · 68%"
              tone="text-primary"
            />
            <Metric
              icon={ListChecks}
              label="Queue"
              value="8 tasks"
              note="3 ready · 5 dependent"
              tone="text-chart-3"
            />
            <Metric
              icon={CheckCircle}
              label="Verified"
              value="12 tasks"
              note="All checks passed"
              tone="text-emerald-300"
            />
            <Metric
              icon={Warning}
              label="Needs you"
              value="1 decision"
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
                          <span className="text-xs font-medium text-muted-foreground">PIPE-33</span>
                        </div>
                        <CardTitle className="mt-4 text-xl">
                          Build the responsive workspace navigation
                        </CardTitle>
                        <CardDescription>
                          The implementer is aligning routes, keyboard behavior, and compact layouts.
                        </CardDescription>
                      </div>
                      <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-primary/10 text-primary">
                        <Code size={23} weight="duotone" />
                      </span>
                    </CardHeader>
                    <CardContent className="mt-6">
                      <div className="h-2 overflow-hidden rounded-full bg-muted">
                        <div className="h-full w-[68%] rounded-full bg-primary" />
                      </div>
                      <div className="mt-2 flex justify-between text-xs text-muted-foreground">
                        <span>Implementation</span>
                        <span>68%</span>
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
                        <Button size="sm">
                          Open task
                          <ArrowRight />
                        </Button>
                        <Button variant="ghost" size="sm">
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
                  <Card className="bg-[linear-gradient(145deg,var(--card),color-mix(in_oklch,var(--card),var(--primary)_7%))]">
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
                        <Choice label="Pipeline Studio" note="Clear and credible" />
                        <Choice label="Freeloader Coder" note="Matches the repository" />
                      </div>
                      <Button variant="ghost" size="sm" className="mt-3 px-2">
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
      </main>

      <nav
        className="fixed inset-x-3 bottom-3 z-40 grid grid-cols-5 rounded-3xl bg-popover/95 p-1.5 shadow-2xl ring-1 ring-foreground/[.07] backdrop-blur-xl lg:hidden"
        aria-label="Mobile workspace"
      >
        {navItems.map((item) => (
          <a
            key={item.label}
            href={`#${item.label.toLowerCase()}`}
            aria-current={item.active ? "page" : undefined}
            className={cn(
              "flex min-h-13 flex-col items-center justify-center gap-1 rounded-2xl px-1 text-[10px] font-medium text-muted-foreground",
              item.active && "bg-primary/12 text-primary"
            )}
          >
            <item.icon size={18} weight={item.active ? "fill" : "regular"} />
            <span>{item.label}</span>
          </a>
        ))}
      </nav>
    </div>
  );
}

function Metric({
  icon: Icon,
  label,
  value,
  note,
  tone,
}: {
  icon: typeof Cpu;
  label: string;
  value: string;
  note: string;
  tone: string;
}) {
  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <span className="text-xs font-medium text-muted-foreground">{label}</span>
          <strong className="mt-2 block text-xl font-semibold tracking-tight">{value}</strong>
          <span className="mt-1 block text-xs text-muted-foreground">{note}</span>
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

function Choice({ label, note }: { label: string; note: string }) {
  return (
    <button
      type="button"
      className="flex w-full items-center gap-3 rounded-2xl bg-muted/65 p-3 text-left outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/30"
    >
      <span className="size-4 rounded-full bg-background ring-1 ring-foreground/15" />
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
