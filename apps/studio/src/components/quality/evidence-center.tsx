import { ArrowSquareOut } from "@phosphor-icons/react/ArrowSquareOut";
import { CheckCircle } from "@phosphor-icons/react/CheckCircle";
import { DownloadSimple } from "@phosphor-icons/react/DownloadSimple";
import { FileCode } from "@phosphor-icons/react/FileCode";
import { GitDiff } from "@phosphor-icons/react/GitDiff";
import { Pulse } from "@phosphor-icons/react/Pulse";
import { ShieldCheck } from "@phosphor-icons/react/ShieldCheck";
import { Warning } from "@phosphor-icons/react/Warning";
import { Wrench } from "@phosphor-icons/react/Wrench";
import { useState } from "react";

import {
  evidenceItems,
  qualityChecks,
  qualityDigest,
  reviewers,
} from "../../quality-fixture.js";
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
import { ReleaseEvidenceRegistry } from "./release-evidence-registry.js";

type Filter = "All" | (typeof evidenceItems)[number]["kind"];
type ReviewMode = "passing" | "dissent";
type HealingMode = "idle" | "repairing" | "recovered" | "quarantined";
type EvidenceView = "task" | "release";

const filters: readonly Filter[] = ["All", "Diffs", "Checks", "Builds", "Commits", "Visuals", "Limits"];

export function EvidenceCenter() {
  const [view, setView] = useState<EvidenceView>("task");
  return (
    <div className="space-y-4">
      <div className="grid gap-2 rounded-3xl bg-muted/55 p-2 sm:grid-cols-2" role="tablist" aria-label="Evidence center views">
        <EvidenceViewButton active={view === "task"} label="Task evidence" note="Diffs, checks, review, healing" onClick={() => setView("task")} />
        <EvidenceViewButton active={view === "release"} label="Release registry" note="30 checks across 10 capabilities" onClick={() => setView("release")} />
      </div>
      {view === "task" ? <TaskEvidenceCenter /> : <ReleaseEvidenceRegistry />}
    </div>
  );
}

function TaskEvidenceCenter() {
  const [filter, setFilter] = useState<Filter>("All");
  const [selectedId, setSelectedId] = useState("checks");
  const [reviewMode, setReviewMode] = useState<ReviewMode>("passing");
  const [healing, setHealing] = useState<HealingMode>("idle");
  const visible = filter === "All"
    ? evidenceItems
    : evidenceItems.filter((item) => item.kind === filter);
  const selected = evidenceItems.find((item) => item.id === selectedId) ?? evidenceItems[0]!;

  return (
    <section aria-labelledby="evidence-center-title" className="space-y-4">
      <Card className="min-w-0">
        <CardHeader className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="positive">
                <ShieldCheck weight="fill" />
                Reproducible proof
              </Badge>
              <a
                href="https://opefyre.atlassian.net/browse/PIPE-64"
                target="_blank"
                rel="noreferrer"
                className="text-xs font-semibold text-primary hover:underline"
              >
                PIPE-64–67
              </a>
            </div>
            <CardTitle id="evidence-center-title" className="mt-4 text-xl">
              Quality is a release decision, not a model opinion
            </CardTitle>
            <CardDescription>
              Required checks, exact artifacts, independent reviews, and healing history agree before work becomes ready.
            </CardDescription>
          </div>
          <div className="text-right">
            <strong className="text-3xl">287</strong>
            <span className="ml-2 text-xs text-muted-foreground">checks passed</span>
            <p className="mt-1 font-mono text-[10px] text-muted-foreground">{qualityDigest}</p>
          </div>
        </CardHeader>
        <CardContent className="mt-6 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          {qualityChecks.map((check) => (
            <button
              key={check.id}
              type="button"
              onClick={() => setSelectedId(check.id === "unit" ? "checks" : check.id === "build" ? "build" : "diff")}
              className="rounded-3xl bg-muted/50 p-4 text-left outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/30"
            >
              <div className="flex items-start justify-between gap-3">
                <span className={cn(
                  "grid size-8 place-items-center rounded-xl",
                  check.state === "passed"
                    ? "bg-emerald-400/12 text-emerald-600 dark:text-emerald-300"
                    : "bg-amber-400/12 text-amber-600 dark:text-amber-300",
                )}>
                  {check.state === "passed" ? <CheckCircle weight="fill" /> : <Warning weight="fill" />}
                </span>
                <Badge tone={check.state === "passed" ? "positive" : "caution"}>{check.state}</Badge>
              </div>
              <strong className="mt-4 block text-sm">{check.label}</strong>
              <span className="mt-1 block text-xs text-muted-foreground">{check.kind} · {check.duration}</span>
              <code className="mt-3 block truncate text-[10px] text-muted-foreground">{check.command}</code>
            </button>
          ))}
        </CardContent>
      </Card>

      <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(20rem,.8fr)]">
        <Card className="min-w-0">
          <CardHeader>
            <CardTitle>Evidence browser</CardTitle>
            <CardDescription>Diffs and logs are primary; visual evidence is attached when the changed surface needs it.</CardDescription>
          </CardHeader>
          <CardContent className="mt-5">
            <div className="flex gap-1 overflow-x-auto rounded-full bg-muted/55 p-1" role="tablist" aria-label="Evidence types">
              {filters.map((item) => (
                <button
                  key={item}
                  type="button"
                  role="tab"
                  aria-selected={filter === item}
                  onClick={() => setFilter(item)}
                  className={cn(
                    "shrink-0 rounded-full px-3 py-2 text-xs font-medium outline-none focus-visible:ring-3 focus-visible:ring-ring/30",
                    filter === item && "bg-background text-foreground shadow-sm",
                  )}
                >
                  {item}
                </button>
              ))}
            </div>
            <div className="mt-4 grid gap-2">
              {visible.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setSelectedId(item.id)}
                  aria-pressed={selectedId === item.id}
                  className={cn(
                    "flex items-center gap-3 rounded-3xl bg-muted/40 p-3 text-left outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/30",
                    selectedId === item.id && "bg-primary/[.10]",
                  )}
                >
                  <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-background">
                    {item.kind === "Diffs" ? <GitDiff /> : <FileCode />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <strong className="block truncate text-sm">{item.title}</strong>
                    <span className="mt-0.5 block truncate text-xs text-muted-foreground">{item.note}</span>
                  </span>
                  <Badge tone={item.state === "passed" ? "positive" : "caution"}>{item.state}</Badge>
                </button>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card className="min-w-0">
          <CardHeader>
            <Badge tone={selected.state === "passed" ? "positive" : "caution"} className="w-fit">{selected.kind}</Badge>
            <CardTitle className="mt-4">{selected.title}</CardTitle>
            <CardDescription>{selected.note}</CardDescription>
          </CardHeader>
          <CardContent className="mt-6">
            <div className="rounded-3xl bg-muted/50 p-4">
              <span className="text-[10px] uppercase tracking-[.14em] text-muted-foreground">Stable artifact</span>
              <code className="mt-2 block break-all text-xs">{selected.source}</code>
              <p className="mt-3 text-xs leading-5 text-muted-foreground">
                Bound to the source, validation-plan, and evidence-bundle digests. A changed input invalidates this proof.
              </p>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <Button variant="secondary" onClick={() => setSelectedId(selected.id)}>
                <ArrowSquareOut /> Open
              </Button>
              <Button variant="ghost" onClick={() => setSelectedId(selected.id)}>
                <DownloadSimple /> Download
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(20rem,.8fr)]">
        <Card className="min-w-0">
          <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <CardTitle>Independent review quorum</CardTitle>
              <CardDescription>Provider agreement never overrides deterministic failure or evidence-backed dissent.</CardDescription>
            </div>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setReviewMode((value) => value === "passing" ? "dissent" : "passing")}
            >
              <Pulse /> {reviewMode === "passing" ? "Simulate dissent" : "Restore passing review"}
            </Button>
          </CardHeader>
          <CardContent className="mt-5 grid gap-2 md:grid-cols-3">
            {reviewers.map((review, index) => {
              const blocked = reviewMode === "dissent" && index === 1;
              return (
                <article key={review.reviewer} className="rounded-3xl bg-muted/50 p-4">
                  <div className="flex items-center justify-between gap-2">
                    <Badge tone={blocked ? "critical" : "positive"}>{blocked ? "Critical dissent" : review.verdict}</Badge>
                    <span className="text-xs text-muted-foreground">{review.confidence}</span>
                  </div>
                  <strong className="mt-4 block text-sm">{review.role}</strong>
                  <span className="mt-1 block text-xs text-muted-foreground">{review.provider} · independent</span>
                  <p className="mt-4 text-xs leading-5 text-muted-foreground">
                    {blocked ? "Focus treatment is missing at 200% zoom · AC2 · repair required." : review.evidence}
                  </p>
                </article>
              );
            })}
            <p className={cn(
              "md:col-span-3 rounded-2xl px-3 py-2 text-xs",
              reviewMode === "passing"
                ? "bg-emerald-400/[.08] text-emerald-700 dark:text-emerald-300"
                : "bg-destructive/10 text-destructive",
            )} aria-live="polite">
              {reviewMode === "passing"
                ? "Quorum passed. Functional, design, and security evidence agree with deterministic validation."
                : "Readiness blocked. Critical design dissent is evidence-backed and cannot be outvoted."}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Bounded healing</CardTitle>
            <CardDescription>Repairs cannot expand scope or weaken checks, permissions, protected paths, or review.</CardDescription>
          </CardHeader>
          <CardContent className="mt-5">
            <div className={cn(
              "rounded-3xl p-4",
              healing === "quarantined" ? "bg-destructive/10" : "bg-primary/[.08]",
            )}>
              <div className="flex items-center gap-3">
                <span className="grid size-9 place-items-center rounded-xl bg-background text-primary"><Wrench /></span>
                <div>
                  <strong className="block text-sm capitalize">{healing === "idle" ? "Ready to repair" : healing}</strong>
                  <span className="text-xs text-muted-foreground">
                    {healing === "recovered" ? "All affected checks and reviews reran." : healing === "quarantined" ? "Evidence preserved · user decision required." : "Budget 0 / 2 attempts"}
                  </span>
                </div>
              </div>
            </div>
            <div className="mt-4 grid gap-2">
              <Button
                onClick={() => {
                  setHealing("repairing");
                  window.setTimeout(() => setHealing("recovered"), 250);
                }}
              >
                <Wrench /> Run bounded recovery
              </Button>
              <Button variant="ghost" onClick={() => setHealing("quarantined")}>
                <Warning /> Simulate exhausted budget
              </Button>
            </div>
            <p className="mt-4 text-xs leading-5 text-muted-foreground">
              Golden workflow score 98% · release threshold 95% · no regression.
            </p>
          </CardContent>
        </Card>
      </div>
    </section>
  );
}

function EvidenceViewButton({
  active, label, note, onClick,
}: {
  active: boolean;
  label: string;
  note: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        "rounded-[1.25rem] px-4 py-3 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/30",
        active ? "bg-background shadow-sm" : "hover:bg-background/55"
      )}
    >
      <strong className="block text-sm">{label}</strong>
      <span className="mt-1 block text-xs text-muted-foreground">{note}</span>
    </button>
  );
}
