import { ArrowClockwise } from "@phosphor-icons/react/ArrowClockwise";
import { CheckCircle } from "@phosphor-icons/react/CheckCircle";
import { ClockCountdown } from "@phosphor-icons/react/ClockCountdown";
import { Hand } from "@phosphor-icons/react/Hand";
import { Pause } from "@phosphor-icons/react/Pause";
import { Play } from "@phosphor-icons/react/Play";
import { Robot } from "@phosphor-icons/react/Robot";
import { ShieldCheck } from "@phosphor-icons/react/ShieldCheck";
import { Warning } from "@phosphor-icons/react/Warning";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { AutonomyMode, AutonomyRecommendation, AutonomySnapshot } from "../../../../../packages/runtime/src/autonomy.js";
import { advanceSafeStep, changeProjectAutonomyMode, changeProjectAutonomyPause, fetchAutonomySnapshot } from "../../autonomy-client.js";
import { cn } from "../../lib/utils.js";
import { Badge } from "../ui/badge.js";
import { Button } from "../ui/button.js";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card.js";

type Filter = "all" | "safe_action" | "approval" | "waiting" | "attention" | "terminal";

export function AutonomousWorkCenter({ endpoint }: { endpoint: string }) {
  const [snapshot, setSnapshot] = useState<AutonomySnapshot | null>(null);
  const snapshotRef = useRef<AutonomySnapshot | null>(null);
  const [connection, setConnection] = useState<"loading" | "live" | "stale" | "offline">("loading");
  const [filter, setFilter] = useState<Filter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pending, setPending] = useState<null | { type: "advance"; request: AutonomyRecommendation } | { type: "mode"; projectId: string; mode: AutonomyMode } | { type: "pause"; projectId: string; paused: boolean }>(null);
  const [working, setWorking] = useState(false);
  const [notice, setNotice] = useState("Connecting to the local coordinator…");

  const accept = useCallback((next: AutonomySnapshot) => {
    snapshotRef.current = next;
    setSnapshot(next);
    setConnection(Date.now() <= next.observedAt + next.validForMs ? "live" : "stale");
    setSelectedId((current) => current && next.recommendations.some((item) => item.requestId === current) ? current : next.recommendations[0]?.requestId ?? null);
    setNotice(next.health === "waiting" && next.nextWakeAt ? `Scheduled wake ${formatTime(next.nextWakeAt)}.` : `Coordinator is ${next.health}.`);
  }, []);
  const refresh = useCallback(async () => {
    try { accept(await fetchAutonomySnapshot({ endpoint })); }
    catch { setConnection(snapshotRef.current ? "stale" : "offline"); setNotice(snapshotRef.current ? "Latest observation is stale; no action was inferred." : "Local coordinator is offline."); }
  }, [accept, endpoint]);

  useEffect(() => {
    const controller = new AbortController();
    void fetchAutonomySnapshot({ endpoint, signal: controller.signal }).then(accept).catch(() => { if (!controller.signal.aborted) setConnection("offline"); });
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") void refresh(); }, 10_000);
    return () => { controller.abort(); window.clearInterval(timer); };
  }, [accept, endpoint, refresh]);

  const visible = useMemo(() => snapshot?.recommendations.filter((item) => filter === "all" || item.classification === filter) ?? [], [filter, snapshot]);
  const selected = snapshot?.recommendations.find((item) => item.requestId === selectedId) ?? visible[0] ?? null;
  const counts = useMemo(() => Object.fromEntries(["safe_action", "approval", "waiting", "attention", "terminal"].map((kind) => [kind, snapshot?.recommendations.filter((item) => item.classification === kind).length ?? 0])), [snapshot]);

  async function confirm() {
    if (!pending || working) return;
    setWorking(true);
    try {
      const key = `autonomy:${pending.type}:${Date.now()}:${crypto.randomUUID()}`;
      const result = pending.type === "advance"
        ? await advanceSafeStep({ endpoint, requestId: pending.request.requestId, expectedUpdatedAt: pending.request.expectedUpdatedAt, idempotencyKey: key })
        : pending.type === "mode"
          ? await changeProjectAutonomyMode({ endpoint, projectId: pending.projectId, mode: pending.mode, confirmBroaderAutomation: true, idempotencyKey: key })
          : await changeProjectAutonomyPause({ endpoint, projectId: pending.projectId, paused: pending.paused, idempotencyKey: key });
      accept(result.snapshot);
      setNotice(result.receipt?.detail ?? readable(result.outcome));
      setPending(null);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Coordinator action failed safely.");
      await refresh();
    } finally { setWorking(false); }
  }

  if (!snapshot && connection === "loading") return <State title="Connecting to autonomous work…" detail="Reading canonical requests, boundaries, schedules, and safe-step policy." />;
  if (!snapshot) return <State title="Coordinator is offline" detail="Start Pipeline Studio locally. No sample queue or inferred action is shown." action={<Button onClick={() => void refresh()}><ArrowClockwise />Retry</Button>} />;

  return (
    <section aria-labelledby="autonomous-work-title" className="space-y-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex flex-wrap gap-2">
            <Badge tone={connection === "live" ? "positive" : "caution"}>{connection === "live" ? <ShieldCheck weight="fill" /> : <Warning weight="fill" />}{connection === "live" ? "Live coordinator" : "Preserved stale view"}</Badge>
            <Badge>{readable(snapshot.health)}</Badge><Badge>$0 automatic spend</Badge>
          </div>
          <h2 id="autonomous-work-title" className="mt-4 text-2xl font-semibold tracking-tight">Autonomous work</h2>
          <p className="mt-1 text-sm text-muted-foreground">One safe next step per request. Human authority remains at every consequential boundary.</p>
        </div>
        <Button variant="secondary" onClick={() => void refresh()}><ArrowClockwise />Refresh</Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Metric label="Safe now" value={counts.safe_action ?? 0} icon={<Robot />} />
        <Metric label="Needs approval" value={counts.approval ?? 0} icon={<Hand />} caution />
        <Metric label="Scheduled" value={counts.waiting ?? 0} icon={<ClockCountdown />} />
        <Metric label="Attention" value={counts.attention ?? 0} icon={<Warning />} caution />
        <Metric label="Terminal" value={counts.terminal ?? 0} icon={<CheckCircle />} />
      </div>

      <div className="flex gap-2 overflow-x-auto pb-1" role="group" aria-label="Filter autonomous work">
        {(["all", "safe_action", "approval", "waiting", "attention", "terminal"] as const).map((item) => <button key={item} type="button" aria-pressed={filter === item} onClick={() => setFilter(item)} className={cn("shrink-0 rounded-full bg-muted px-4 py-2 text-xs font-semibold outline-none focus-visible:ring-3 focus-visible:ring-ring/30", filter === item && "bg-primary text-primary-foreground")}>{readable(item)}{item !== "all" ? ` · ${counts[item] ?? 0}` : ""}</button>)}
      </div>

      <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <Card className="min-w-0">
          <CardHeader><CardTitle>Canonical queue</CardTitle><CardDescription>Stable local request identity, revision-bound recommendations, and no demo rows.</CardDescription></CardHeader>
          <CardContent className="mt-4">
            {visible.length === 0 ? <Empty title={snapshot.recommendations.length ? "No work matches this filter" : "No work yet"} detail={snapshot.recommendations.length ? "Choose another state to inspect the remaining canonical queue." : "Create a request from Conversation. The coordinator will stay healthily idle."} /> : <div className="grid gap-2">{visible.map((item) => <button key={item.requestId} type="button" aria-pressed={selected?.requestId === item.requestId} onClick={() => setSelectedId(item.requestId)} className={cn("grid gap-2 rounded-2xl bg-muted/45 p-3 text-left outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/30 sm:grid-cols-[7rem_minmax(0,1fr)_7rem] sm:items-center", selected?.requestId === item.requestId && "bg-primary/[.10]")}><Badge tone={item.classification === "approval" || item.classification === "attention" ? "caution" : item.classification === "terminal" ? "positive" : "neutral"} className="w-fit">{readable(item.classification)}</Badge><span className="min-w-0"><strong className="block truncate text-xs">{item.title}</strong><span className="mt-1 block truncate text-[10px] text-muted-foreground">{item.reason}</span></span><span className="text-[10px] text-muted-foreground sm:text-right">{item.retryAt ? formatTime(item.retryAt) : item.requestId.slice(-8)}</span></button>)}</div>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><Badge tone={selected?.automaticAllowed ? "positive" : selected?.classification === "approval" ? "caution" : "neutral"} className="w-fit">{selected?.automaticAllowed ? "Automatic safe step" : selected ? readable(selected.classification) : "Healthy idle"}</Badge><CardTitle className="mt-4">{selected?.title ?? "Nothing selected"}</CardTitle><CardDescription>{selected?.reason ?? "Create a request to see its next safe action."}</CardDescription></CardHeader>
          <CardContent className="mt-4">
            {selected && <><div className="rounded-3xl bg-muted/50 p-4"><Fact label="Effect" value={readable(selected.effect)} /><Fact label="Authority boundary" value={readable(selected.boundary)} /><Fact label="Maximum cost" value="$0.00" /><Fact label="Expected revision" value={String(selected.expectedUpdatedAt)} /></div><div className="mt-4 space-y-2">{selected.evidence.map((item) => <div key={item} className="flex gap-2 text-xs text-muted-foreground"><CheckCircle className="mt-0.5 shrink-0 text-primary" />{item}</div>)}</div>{selected.action && <Button className="mt-5 w-full" onClick={() => setPending({ type: "advance", request: selected })}><Play />Preview safe step</Button>}</>}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle>Project autonomy</CardTitle><CardDescription>Broader modes require confirmation. Requests may become more conservative, never broader than their project.</CardDescription></CardHeader>
        <CardContent className="mt-4 grid gap-3 lg:grid-cols-2">
          {snapshot.preferences.length === 0 ? <Empty title="No project preferences" detail="Register a project and create its first request to configure autonomy." /> : snapshot.preferences.map((preference) => <div key={preference.projectId} className="rounded-3xl bg-muted/45 p-4"><div className="flex items-center justify-between gap-3"><div><strong className="text-sm">{preference.projectId.slice(-8)}</strong><p className="mt-1 text-xs text-muted-foreground">{preference.paused ? "Automatic steps paused" : `${readable(preference.mode)} mode`}</p></div><Button size="sm" variant="secondary" onClick={() => setPending({ type: "pause", projectId: preference.projectId, paused: !preference.paused })}>{preference.paused ? <Play /> : <Pause />}{preference.paused ? "Resume" : "Pause"}</Button></div><div className="mt-4 flex gap-2">{(["guided", "balanced", "autonomous"] as const).map((mode) => <button key={mode} type="button" aria-pressed={preference.mode === mode} onClick={() => setPending({ type: "mode", projectId: preference.projectId, mode })} className={cn("flex-1 rounded-full bg-background/70 px-2 py-2 text-[10px] font-semibold outline-none focus-visible:ring-3 focus-visible:ring-ring/30", preference.mode === mode && "bg-primary text-primary-foreground")}>{readable(mode)}</button>)}</div></div>)}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Coordinator schedule</CardTitle>
            <CardDescription>Observed wake time and single-owner leases from durable local state.</CardDescription>
          </CardHeader>
          <CardContent className="mt-4 space-y-3">
            <div className="rounded-3xl bg-muted/45 p-4">
              <Fact label="Next scheduled wake" value={snapshot.nextWakeAt ? formatDateTime(snapshot.nextWakeAt) : "No scheduled retry"} />
              <Fact label="Active coordinator leases" value={String(snapshot.leases.length)} />
            </div>
            {snapshot.leases.length === 0 ? <Empty title="No active coordinator lease" detail="Healthy idle and approval-bound work do not require a lease." /> : snapshot.leases.map((lease) => (
              <div key={lease.requestId} className="rounded-3xl bg-muted/45 p-4">
                <strong className="text-xs">{lease.requestId.slice(-8)}</strong>
                <p className="mt-1 text-[11px] text-muted-foreground">Expires {formatDateTime(lease.expiresAt)} · single local coordinator</p>
              </div>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Recent receipts</CardTitle>
            <CardDescription>Revision-bound proof of completed, deferred, blocked, or failed safe steps.</CardDescription>
          </CardHeader>
          <CardContent className="mt-4">
            {snapshot.receipts.length === 0 ? <Empty title="No coordinator receipts yet" detail="Receipts appear after a confirmed or automatic safe step." /> : (
              <div className="space-y-2">
                {snapshot.receipts.slice(-6).reverse().map((receipt) => (
                  <div key={receipt.id} className="grid gap-2 rounded-3xl bg-muted/45 p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                    <div className="min-w-0">
                      <strong className="block truncate text-xs">{readable(receipt.action)}</strong>
                      <p className="mt-1 truncate text-[11px] text-muted-foreground">{receipt.detail}</p>
                    </div>
                    <Badge tone={receipt.outcome === "completed" ? "positive" : receipt.outcome === "deferred" ? "neutral" : "caution"}>{readable(receipt.outcome)}</Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <p className="text-xs text-muted-foreground" aria-live="polite">{notice}</p>
      {pending && <div className="fixed inset-0 z-[80] grid place-items-end bg-background/55 p-3 backdrop-blur-sm sm:place-items-center" role="presentation"><section role="dialog" aria-modal="true" aria-labelledby="autonomy-confirm-title" className="w-full max-w-md rounded-4xl bg-popover p-6 shadow-2xl"><Badge tone="caution">Confirmation</Badge><h2 id="autonomy-confirm-title" className="mt-4 text-xl font-semibold">{pending.type === "advance" ? pending.request.title : pending.type === "mode" ? `Use ${readable(pending.mode)} mode` : pending.paused ? "Pause automatic steps" : "Resume automatic steps"}</h2><p className="mt-2 text-sm leading-6 text-muted-foreground">{pending.type === "advance" ? `${pending.request.reason} Effect: ${readable(pending.request.effect)}. Maximum cost: $0.` : pending.type === "mode" ? "This changes which already-safe steps the coordinator may perform. Approval, privacy, cost, repository, and validation boundaries remain enforced." : "Active work is not cancelled. Canonical state and evidence remain preserved."}</p><div className="mt-6 flex gap-2"><Button onClick={() => void confirm()} disabled={working}>{working ? "Applying…" : "Confirm"}</Button><Button variant="ghost" onClick={() => setPending(null)} disabled={working}>Cancel</Button></div></section></div>}
    </section>
  );
}

function Metric({ label, value, icon, caution = false }: { label: string; value: number; icon: React.ReactNode; caution?: boolean }) { return <Card className="p-5"><div className="flex justify-between gap-3"><div><span className="text-xs text-muted-foreground">{label}</span><strong className="mt-2 block text-2xl">{value}</strong></div><span className={caution && value > 0 ? "text-amber-500" : "text-primary"}>{icon}</span></div></Card>; }
function Fact({ label, value }: { label: string; value: string }) { return <div className="mb-3 last:mb-0"><span className="block text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span><strong className="mt-1 block text-xs">{value}</strong></div>; }
function Empty({ title, detail }: { title: string; detail: string }) { return <div className="rounded-3xl bg-muted/45 p-5"><strong className="text-sm">{title}</strong><p className="mt-2 text-xs leading-5 text-muted-foreground">{detail}</p></div>; }
function State({ title, detail, action }: { title: string; detail: string; action?: React.ReactNode }) { return <section aria-live="polite" className="grid min-h-[24rem] place-items-center"><div className="max-w-md rounded-4xl bg-card p-8 text-center"><Robot className="mx-auto text-primary" size={36} /><h2 className="mt-5 text-xl font-semibold">{title}</h2><p className="mt-2 text-sm leading-6 text-muted-foreground">{detail}</p>{action && <div className="mt-5 flex justify-center">{action}</div>}</div></section>; }
function readable(value: string): string { return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase()); }
function formatTime(value: number): string { return new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); }
function formatDateTime(value: number): string { return new Date(value).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }); }
