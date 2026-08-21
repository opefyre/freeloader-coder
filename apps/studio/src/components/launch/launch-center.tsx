import { ArrowRight } from "@phosphor-icons/react/ArrowRight";
import { ArrowSquareOut } from "@phosphor-icons/react/ArrowSquareOut";
import { CheckCircle } from "@phosphor-icons/react/CheckCircle";
import { ClockCountdown } from "@phosphor-icons/react/ClockCountdown";
import { GitBranch } from "@phosphor-icons/react/GitBranch";
import { Heart } from "@phosphor-icons/react/Heart";
import { Pulse } from "@phosphor-icons/react/Pulse";
import { RocketLaunch } from "@phosphor-icons/react/RocketLaunch";
import { ShieldCheck } from "@phosphor-icons/react/ShieldCheck";
import { Sparkle } from "@phosphor-icons/react/Sparkle";
import { Warning } from "@phosphor-icons/react/Warning";
import { useState } from "react";

import { Badge } from "../ui/badge.js";
import { Button } from "../ui/button.js";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../ui/card.js";
import { cn } from "../../lib/utils.js";

type DemoState = "provider" | "review" | "interruption";
type LaunchSection = "story" | "compare" | "operate" | "learn";

const demoStates = {
  provider: {
    label: "Free quota exhausted",
    signal: "Scheduled, not spinning",
    detail:
      "The task keeps its checkpoint and sleeps until eligible free capacity returns.",
    action: "Next safe attempt · 09:00 UTC",
    tone: "caution" as const,
    icon: ClockCountdown,
  },
  review: {
    label: "Reviewers disagree",
    signal: "Needs your decision",
    detail:
      "Both findings remain visible. The pipeline cannot call the work complete or merge it.",
    action: "Compare findings",
    tone: "critical" as const,
    icon: Warning,
  },
  interruption: {
    label: "Worker disconnected",
    signal: "Checkpoint preserved",
    detail:
      "The lease expires safely, observable state is reconciled, and another worker may resume.",
    action: "Resume from checkpoint",
    tone: "positive" as const,
    icon: CheckCircle,
  },
} as const;

const competitors = [
  {
    name: "OpenCode",
    strength: "Fast terminal, desktop, IDE workflow with broad model choice",
    boundary: "Provider access and agent operation are the center of the product",
    source: "https://opencode.ai/docs/",
  },
  {
    name: "OpenHands",
    strength: "Composable coding-agent SDK, CLI, local GUI, and cloud options",
    boundary: "A general software-agent platform with local and hosted paths",
    source: "https://docs.openhands.dev/overview/introduction",
  },
  {
    name: "Aider",
    strength: "Focused AI pair programming inside a local Git repository",
    boundary: "Terminal pair-programming rather than a durable operations plane",
    source: "https://aider.chat/docs/",
  },
] as const;

const gates = [
  { label: "Product evidence", state: "Passed", tone: "positive" as const, ticket: "PIPE-173" },
  { label: "Free-spend contract", state: "Passed", tone: "positive" as const, ticket: "PIPE-113" },
  { label: "License decision", state: "Review", tone: "caution" as const, ticket: "PIPE-105" },
  { label: "Public deployment", state: "Not run", tone: "neutral" as const, ticket: "PIPE-110" },
] as const;

const metrics = [
  { label: "Clone → validated preview", value: "12m", target: "< 15m", width: "80%" },
  { label: "Recovered without lost work", value: "94%", target: "> 90%", width: "94%" },
  { label: "Paid calls without approval", value: "0", target: "0", width: "2%" },
  { label: "Support cases with safe repro", value: "81%", target: "> 75%", width: "81%" },
] as const;

export function LaunchCenter() {
  const [section, setSection] = useState<LaunchSection>("story");
  const [demoState, setDemoState] = useState<DemoState>("provider");
  const [notice, setNotice] = useState(
    "This launch surface is local. No analytics, campaign, or deployment was created."
  );
  const demo = demoStates[demoState];
  const DemoIcon = demo.icon;

  return (
    <div className="min-w-0 space-y-4" aria-labelledby="launch-center-title">
      <Card className="overflow-hidden">
        <CardContent className="grid gap-8 p-6 sm:p-8 xl:grid-cols-[minmax(0,1.2fr)_minmax(22rem,.8fr)] xl:p-10">
          <div className="self-center">
            <div className="flex flex-wrap gap-2">
              <Badge tone="positive">Open source</Badge>
              <Badge tone="caution">Free capacity first</Badge>
              <Badge tone="neutral">Local interactive preview</Badge>
            </div>
            <h2
              id="launch-center-title"
              className="mt-6 max-w-3xl text-4xl font-semibold tracking-[-.045em] sm:text-5xl"
            >
              Reliable autonomous development, without a surprise AI bill.
            </h2>
            <p className="mt-5 max-w-2xl text-base leading-7 text-muted-foreground">
              Codkesh turns provider capacity, local workers, task graphs,
              validation, review, recovery, and evidence into one inspectable
              operating system for people who build through prompts and GitHub.
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <Button
                onClick={() => {
                  setSection("story");
                  setNotice("Interactive failure demo selected. No real task was created.");
                }}
              >
                Try the safe demo <ArrowRight />
              </Button>
              <a
                href="https://github.com/opefyre/freeloader-coder"
                target="_blank"
                rel="noreferrer"
                className="inline-flex min-h-10 items-center gap-2 rounded-2xl bg-secondary px-4 text-sm font-semibold hover:bg-secondary/80"
              >
                View source <ArrowSquareOut />
              </a>
            </div>
            <p className="mt-4 text-xs text-muted-foreground" aria-live="polite">
              {notice}
            </p>
          </div>

          <div className="rounded-4xl bg-foreground/[.035] p-5 sm:p-6">
            <div className="flex items-center justify-between">
              <span className="text-[10px] uppercase tracking-[.15em] text-muted-foreground">
                Failure-to-recovery demo
              </span>
              <Badge>Fixture data</Badge>
            </div>
            <div className="mt-5 grid grid-cols-3 gap-2" role="group" aria-label="Demo failure state">
              <DemoButton active={demoState === "provider"} label="Quota" onClick={() => setDemoState("provider")} />
              <DemoButton active={demoState === "review"} label="QA dissent" onClick={() => setDemoState("review")} />
              <DemoButton active={demoState === "interruption"} label="Worker" onClick={() => setDemoState("interruption")} />
            </div>
            <div className="mt-5 rounded-3xl bg-background/80 p-5" aria-live="polite">
              <span className="grid size-11 place-items-center rounded-2xl bg-primary/[.11] text-primary">
                <DemoIcon size={22} weight="duotone" />
              </span>
              <Badge tone={demo.tone} className="mt-5">{demo.signal}</Badge>
              <h3 className="mt-3 text-lg font-semibold">{demo.label}</h3>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">{demo.detail}</p>
              <button
                type="button"
                className="mt-5 text-xs font-semibold text-primary hover:underline"
                onClick={() => setNotice(`${demo.action}. Demo state changed locally only.`)}
              >
                {demo.action} <ArrowRight className="inline" />
              </button>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 gap-2 rounded-3xl bg-muted/60 p-1.5 sm:grid-cols-4" role="tablist" aria-label="Launch center sections">
        {([
          ["story", "Product"],
          ["compare", "Compare"],
          ["operate", "Launch ops"],
          ["learn", "Learn"],
        ] as const).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={section === id}
            onClick={() => setSection(id)}
            className={cn(
              "min-h-10 rounded-2xl px-3 text-xs font-semibold text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/30",
              section === id && "bg-background text-foreground shadow-sm"
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {section === "story" && <ProductStory />}
      {section === "compare" && <Comparison />}
      {section === "operate" && <LaunchOperations setNotice={setNotice} />}
      {section === "learn" && <LearningScorecard />}
    </div>
  );
}

function ProductStory() {
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      {[
        {
          icon: GitBranch,
          title: "One durable task graph",
          copy: "Break down work, preserve dependencies, assign capable models, and keep one canonical state.",
        },
        {
          icon: ShieldCheck,
          title: "Evidence before done",
          copy: "Deterministic checks and independent reviewers—not model confidence—decide whether work is ready.",
        },
        {
          icon: Heart,
          title: "Failure is a workflow",
          copy: "Quota waits, interrupted workers, dissent, checkpoints, and recovery remain visible and actionable.",
        },
      ].map((item) => (
        <Card key={item.title}>
          <CardHeader>
            <span className="grid size-11 place-items-center rounded-2xl bg-primary/[.1] text-primary">
              <item.icon size={22} weight="duotone" />
            </span>
            <CardTitle className="mt-5">{item.title}</CardTitle>
            <CardDescription className="leading-6">{item.copy}</CardDescription>
          </CardHeader>
        </Card>
      ))}
    </div>
  );
}

function Comparison() {
  return (
    <Card>
      <CardHeader>
        <Badge className="w-fit">Honest category map</Badge>
        <CardTitle className="mt-4 text-xl">Different center of gravity</CardTitle>
        <CardDescription>
          These are adjacent products, not inferior versions of Codkesh.
          Claims link to current official product documentation.
        </CardDescription>
      </CardHeader>
      <CardContent className="mt-6 grid gap-3">
        {competitors.map((competitor) => (
          <div key={competitor.name} className="grid gap-4 rounded-3xl bg-muted/55 p-5 lg:grid-cols-[10rem_1fr_1fr_auto] lg:items-center">
            <strong>{competitor.name}</strong>
            <p className="text-xs leading-5 text-muted-foreground">{competitor.strength}</p>
            <p className="text-xs leading-5 text-muted-foreground">{competitor.boundary}</p>
            <a
              href={competitor.source}
              target="_blank"
              rel="noreferrer"
              className="text-xs font-semibold text-primary hover:underline"
            >
              Official source <ArrowSquareOut className="inline" />
            </a>
          </div>
        ))}
        <div className="rounded-3xl bg-primary/[.08] p-5">
          <strong>Codkesh’s claim</strong>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            A free-first, multi-provider operations plane for durable coding work:
            orchestration, evidence, recovery, distributed workers, and operator
            decisions remain integrated. It does not claim better code generation
            than every coding agent or model.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

function LaunchOperations({
  setNotice,
}: {
  setNotice: (notice: string) => void;
}) {
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-3">
            <div>
              <CardTitle>Release gates</CardTitle>
              <CardDescription>One unresolved gate keeps the public launch local.</CardDescription>
            </div>
            <Badge tone="caution">2 remaining</Badge>
          </div>
        </CardHeader>
        <CardContent className="mt-6 grid gap-2">
          {gates.map((gate) => (
            <div key={gate.label} className="flex flex-wrap items-center gap-3 rounded-2xl bg-muted/55 p-4">
              <Badge tone={gate.tone}>{gate.state}</Badge>
              <strong className="text-sm">{gate.label}</strong>
              <a
                className="ml-auto text-xs font-semibold text-primary hover:underline"
                href={`https://opefyre.atlassian.net/browse/${gate.ticket}`}
                target="_blank"
                rel="noreferrer"
              >
                {gate.ticket} <ArrowSquareOut className="inline" />
              </a>
            </div>
          ))}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <span className="grid size-11 place-items-center rounded-2xl bg-primary/[.1] text-primary">
            <RocketLaunch size={22} weight="duotone" />
          </span>
          <CardTitle className="mt-4">Launch controls</CardTitle>
          <CardDescription>
            Drafts only. Nothing publishes from this local fixture.
          </CardDescription>
        </CardHeader>
        <CardContent className="mt-5 grid gap-2">
          <Button variant="secondary" onClick={() => setNotice("Launch preview checked locally. No public URL was created.")}>
            Preview package
          </Button>
          <Button variant="secondary" onClick={() => setNotice("Incident drill recorded locally. No service was contacted.")}>
            Run incident drill
          </Button>
          <Button variant="destructive" onClick={() => setNotice("Public launch remains paused. No deployment existed to stop.")}>
            Keep launch paused
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function LearningScorecard() {
  return (
    <Card>
      <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <CardTitle>Outcome scorecard</CardTitle>
          <CardDescription>
            Synthetic launch baseline · no prompts, source code, secrets, or personal identifiers.
          </CardDescription>
        </div>
        <Badge tone="positive">Privacy safe</Badge>
      </CardHeader>
      <CardContent className="mt-6 grid gap-3 lg:grid-cols-2">
        {metrics.map((metric) => (
          <div key={metric.label} className="rounded-3xl bg-muted/55 p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <span className="text-xs text-muted-foreground">{metric.label}</span>
                <strong className="mt-2 block text-2xl">{metric.value}</strong>
              </div>
              <Badge>{metric.target}</Badge>
            </div>
            <div className="mt-5 h-2 overflow-hidden rounded-full bg-background">
              <div className="h-full rounded-full bg-primary" style={{ width: metric.width }} />
            </div>
          </div>
        ))}
        <div className="rounded-3xl bg-primary/[.08] p-5 lg:col-span-2">
          <div className="flex items-center gap-3">
            <Pulse className="text-primary" size={22} weight="duotone" />
            <strong>Decision: continue the local beta</strong>
          </div>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Evidence supports the reliability promise. Public positioning and
            license approval remain explicit owner decisions before launch.
          </p>
          <a
            href="https://opefyre.atlassian.net/browse/PIPE-112"
            target="_blank"
            rel="noreferrer"
            className="mt-4 inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
          >
            Review learning ticket <ArrowSquareOut />
          </a>
        </div>
      </CardContent>
    </Card>
  );
}

function DemoButton({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "rounded-2xl bg-background/70 px-2 py-3 text-[11px] font-semibold outline-none hover:bg-background focus-visible:ring-3 focus-visible:ring-ring/30",
        active && "bg-primary/[.13] text-primary"
      )}
    >
      {label}
    </button>
  );
}
