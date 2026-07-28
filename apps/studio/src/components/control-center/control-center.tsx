import { ArrowSquareOut } from "@phosphor-icons/react/ArrowSquareOut";
import { Check } from "@phosphor-icons/react/Check";
import { DownloadSimple } from "@phosphor-icons/react/DownloadSimple";
import { Gauge } from "@phosphor-icons/react/Gauge";
import { Pause } from "@phosphor-icons/react/Pause";
import { Play } from "@phosphor-icons/react/Play";
import { ShieldCheck } from "@phosphor-icons/react/ShieldCheck";
import { Warning } from "@phosphor-icons/react/Warning";
import { useState } from "react";

import { controlCenterMetric } from "../../../../../fixtures/control-center-metrics.js";
import { controlTasks, doctorChecks, providerShare, throughputPoints } from "../../control-center-fixture.js";
import { cn } from "../../lib/utils.js";
import { Badge } from "../ui/badge.js";
import { Button } from "../ui/button.js";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card.js";

export function ControlCenter({ navigate }: { navigate: (view: "work" | "evidence" | "providers") => void }) {
  const [range, setRange] = useState<"24h" | "7d">("24h");
  const [selectedTask, setSelectedTask] = useState<string>(controlTasks[0]!.id);
  const [paused, setPaused] = useState(false);
  const [previewAction, setPreviewAction] = useState<"pause" | "resume" | null>(null);
  const [audit, setAudit] = useState("No operator action in this session.");
  const [bundleOpen, setBundleOpen] = useState(false);
  const task = controlTasks.find((item) => item.id === selectedTask)!;
  const scale = range === "24h" ? 1 : 5;
  const metric = controlCenterMetric("quota_remaining");

  return (
    <section aria-labelledby="control-center-title" className="space-y-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="positive"><ShieldCheck weight="fill" /> Source backed</Badge>
            <Badge>Observed 08:58 UTC</Badge>
            <a href="https://opefyre.atlassian.net/browse/PIPE-68" target="_blank" rel="noreferrer" className="text-xs font-semibold text-primary hover:underline">PIPE-68–71</a>
          </div>
          <h2 id="control-center-title" className="mt-4 text-2xl font-semibold tracking-tight">The whole system, with receipts</h2>
          <p className="mt-1 text-sm text-muted-foreground">Current health, historical performance, and configured capacity stay separate.</p>
        </div>
        <div className="flex rounded-full bg-muted/60 p-1" role="group" aria-label="Time range">
          {(["24h", "7d"] as const).map((item) => (
            <button key={item} type="button" aria-pressed={range === item} onClick={() => setRange(item)} className={cn("rounded-full px-4 py-2 text-xs font-semibold", range === item && "bg-background shadow-sm")}>{item.toUpperCase()}</button>
          ))}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Signal label="Throughput" value={`${12 * scale} tasks`} note={`task.completed · ${range}`} tone="positive" />
        <Signal label="Queue" value="8 tasks" note="3 ready · 5 dependency blocked" />
        <Signal label="Recovery" value={`${2 * scale} restored`} note="3 healed · 0 quarantined" tone="positive" />
        <Signal label="Known quota" value={metric.value === null ? "Unavailable" : `${metric.value}%`} note="Missing source · never shown as zero" tone="caution" />
      </div>

      <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(20rem,.65fr)]">
        <Card className="min-w-0">
          <CardHeader className="flex flex-row items-start justify-between gap-3">
            <div><CardTitle>Pipeline velocity</CardTitle><CardDescription>Verified completions · click a task below for exact sources.</CardDescription></div>
            <Badge tone="positive">+18%</Badge>
          </CardHeader>
          <CardContent className="mt-6">
            <div className="flex h-44 items-end gap-2" role="img" aria-label={`Throughput over ${range}; rising from 2 to ${16 * scale} tasks`}>
              {throughputPoints.map((point, index) => (
                <button key={index} type="button" title={`${point * scale} verified tasks`} onClick={() => setSelectedTask(controlTasks[index % controlTasks.length]!.id)} className="group flex h-full flex-1 items-end rounded-full outline-none focus-visible:ring-3 focus-visible:ring-ring/30">
                  <span className="w-full rounded-full bg-primary/20 transition-colors group-hover:bg-primary/50" style={{ height: `${Math.max(12, (point / 16) * 100)}%` }} />
                </button>
              ))}
            </div>
            <div className="mt-5 grid gap-2 sm:grid-cols-4">
              {controlTasks.map((item) => (
                <button key={item.id} type="button" aria-pressed={selectedTask === item.id} onClick={() => setSelectedTask(item.id)} className={cn("rounded-3xl bg-muted/45 p-3 text-left outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/30", selectedTask === item.id && "bg-primary/[.10]")}>
                  <span className="text-[10px] font-semibold text-primary">{item.id}</span>
                  <strong className="mt-2 block text-xs">{item.title}</strong>
                  <span className="mt-1 block text-[10px] text-muted-foreground">{item.stage} · {item.progress}%</span>
                </button>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><Badge tone={task.outcome === "working" ? "active" : "neutral"} className="w-fit">{task.stage}</Badge><CardTitle className="mt-4">{task.id}</CardTitle><CardDescription>{task.title}</CardDescription></CardHeader>
          <CardContent className="mt-5">
            <div className="rounded-3xl bg-muted/50 p-4">
              <Fact label="Active lease" value={paused ? "None · paused safely" : "worker-spare-01 · 08:59"} />
              <Fact label="Preserved" value="Branch · artifacts · evidence" />
              <Fact label="Dependencies" value="2 downstream tasks" />
              <Fact label="Automatic cost" value="$0.00" />
            </div>
            <div className="mt-4 grid gap-2">
              <a href={task.source} target="_blank" rel="noreferrer" className="inline-flex h-9 items-center justify-center gap-2 rounded-full bg-secondary px-4 text-sm font-medium hover:bg-secondary/75"><ArrowSquareOut /> Open exact Jira task</a>
              <Button variant="ghost" onClick={() => navigate("evidence")}><ShieldCheck /> Evidence and artifacts</Button>
              <Button variant="ghost" onClick={() => navigate("work")}><Gauge /> Execution details</Button>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid min-w-0 gap-4 xl:grid-cols-3">
        <Card className="min-w-0 xl:col-span-2">
          <CardHeader className="flex flex-row items-start justify-between gap-3"><div><CardTitle>Provider execution share</CardTitle><CardDescription>External and local calls · selected {range} range.</CardDescription></div><Button size="sm" variant="ghost" onClick={() => navigate("providers")}>Provider details</Button></CardHeader>
          <CardContent className="mt-5 grid gap-5 md:grid-cols-[11rem_minmax(0,1fr)]">
            <div className="grid aspect-square place-items-center rounded-full" style={{ background: "conic-gradient(var(--chart-1) 0 38%, var(--chart-2) 38% 63%, var(--chart-3) 63% 82%, var(--chart-4) 82% 94%, var(--chart-5) 94%)" }}>
              <div className="grid size-28 place-items-center rounded-full bg-card text-center"><div><strong className="block text-3xl">32</strong><span className="text-[10px] text-muted-foreground">observed calls</span></div></div>
            </div>
            <div className="space-y-2">
              {providerShare.map((provider) => (
                <a key={provider.id} href={provider.dashboard} target="_blank" rel="noreferrer" className="grid grid-cols-[5.5rem_1fr_3rem] items-center gap-3 rounded-2xl px-3 py-2 hover:bg-muted">
                  <span className="truncate text-xs font-semibold capitalize">{provider.id}</span>
                  <span className="h-2 overflow-hidden rounded-full bg-muted"><span className="block h-full rounded-full bg-primary" style={{ width: `${provider.share}%` }} /></span>
                  <span className="text-right text-xs">{provider.calls}</span>
                </a>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Safe operator action</CardTitle><CardDescription>Impact is previewed before the canonical state changes.</CardDescription></CardHeader>
          <CardContent className="mt-5">
            <Button className="w-full" onClick={() => setPreviewAction(paused ? "resume" : "pause")}>{paused ? <Play /> : <Pause />}{paused ? "Preview resume" : "Preview pause"}</Button>
            {previewAction && (
              <div className="mt-3 rounded-3xl bg-primary/[.08] p-4" aria-live="polite">
                <strong className="text-sm capitalize">{previewAction} after current step</strong>
                <p className="mt-2 text-xs leading-5 text-muted-foreground">Lease: {paused ? "none" : "worker-spare-01"}. Branch, artifacts, and evidence remain intact. Two dependencies wait. Cost: $0.</p>
                <div className="mt-3 flex gap-2"><Button size="sm" onClick={() => { setPaused(previewAction === "pause"); setAudit(`Opefyre · ${previewAction} · checkpoint preserved`); setPreviewAction(null); }}><Check /> Confirm</Button><Button size="sm" variant="ghost" onClick={() => setPreviewAction(null)}>Cancel</Button></div>
              </div>
            )}
            <p className="mt-4 text-xs text-muted-foreground">{audit}</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between"><div><CardTitle>Local doctor and support bundle</CardTitle><CardDescription>Inspect exactly what is healthy, repairable, and included before export.</CardDescription></div><Button variant="secondary" onClick={() => setBundleOpen((value) => !value)}><DownloadSimple /> {bundleOpen ? "Hide bundle preview" : "Preview support bundle"}</Button></CardHeader>
        <CardContent className="mt-5 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          {doctorChecks.map((check) => <div key={check.id} className="rounded-3xl bg-muted/50 p-4"><Badge tone={check.state === "Healthy" ? "positive" : "caution"}>{check.state}</Badge><strong className="mt-3 block text-sm">{check.label}</strong><span className="mt-1 block text-xs text-muted-foreground">{check.note}</span></div>)}
          {bundleOpen && <div className="sm:col-span-2 xl:col-span-4 rounded-3xl bg-primary/[.08] p-4" aria-live="polite"><strong className="text-sm">Bundle preview · diag-20260728</strong><p className="mt-2 text-xs leading-5 text-muted-foreground">Included: doctor results, selected redacted logs, OS/runtime versions, reproduction context. Excluded: source code, prompts, credentials, user paths, and unselected logs.</p><Badge tone="positive" className="mt-3">Automated redaction passed</Badge></div>}
        </CardContent>
      </Card>
    </section>
  );
}

function Signal({ label, value, note, tone = "neutral" }: { label: string; value: string; note: string; tone?: "neutral" | "positive" | "caution" }) {
  return <Card className="p-5"><div className="flex items-start justify-between"><div><span className="text-xs text-muted-foreground">{label}</span><strong className="mt-2 block text-xl">{value}</strong><span className="mt-1 block text-[10px] text-muted-foreground">{note}</span></div>{tone === "caution" ? <Warning className="text-amber-500" /> : <Gauge className={tone === "positive" ? "text-emerald-500" : "text-primary"} />}</div></Card>;
}
function Fact({ label, value }: { label: string; value: string }) { return <div className="mb-3 last:mb-0"><span className="block text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span><strong className="mt-1 block text-xs">{value}</strong></div>; }
