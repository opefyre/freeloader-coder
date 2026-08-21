import { ArrowClockwise } from "@phosphor-icons/react/ArrowClockwise";
import { CheckCircle } from "@phosphor-icons/react/CheckCircle";
import { Clock } from "@phosphor-icons/react/Clock";
import { FolderOpen } from "@phosphor-icons/react/FolderOpen";
import { Gauge } from "@phosphor-icons/react/Gauge";
import { PlugsConnected } from "@phosphor-icons/react/PlugsConnected";
import { Warning } from "@phosphor-icons/react/Warning";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { LiveOperationsSnapshot } from "../../../../../packages/runtime/src/live-operations.js";
import { fetchLiveOperations } from "../../live-operations-client.js";
import { cn } from "../../lib/utils.js";
import { Badge } from "../ui/badge.js";
import { Button } from "../ui/button.js";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card.js";

type StudioDestination = "work" | "evidence" | "providers" | "projects";

export function ControlCenter({
  endpoint,
  navigate,
}: {
  endpoint: string;
  navigate: (view: StudioDestination) => void;
}) {
  const [snapshot, setSnapshot] = useState<LiveOperationsSnapshot | null>(null);
  const snapshotRef = useRef<LiveOperationsSnapshot | null>(null);
  const [state, setState] = useState<"loading" | "live" | "stale" | "offline">("loading");
  const [refreshing, setRefreshing] = useState(false);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);

  const refresh = useCallback(async (manual = false) => {
    if (manual) setRefreshing(true);
    try {
      const next = await fetchLiveOperations({ endpoint });
      snapshotRef.current = next;
      setSnapshot(next);
      setState(Date.now() <= next.observedAt + next.validForMs ? "live" : "stale");
      setSelectedEventId((current) =>
        current && next.recentEvents.some((event) => event.id === current)
          ? current
          : next.recentEvents[0]?.id ?? null
      );
    } catch {
      setState(snapshotRef.current ? "stale" : "offline");
    } finally {
      if (manual) setRefreshing(false);
    }
  }, [endpoint]);

  useEffect(() => {
    const controller = new AbortController();
    void fetchLiveOperations({ endpoint, signal: controller.signal }).then((next) => {
      snapshotRef.current = next;
      setSnapshot(next);
      setState(Date.now() <= next.observedAt + next.validForMs ? "live" : "stale");
      setSelectedEventId(next.recentEvents[0]?.id ?? null);
    }).catch(() => {
      if (!controller.signal.aborted) setState(snapshotRef.current ? "stale" : "offline");
    });
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, 15_000);
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [endpoint, refresh]);

  const selectedEvent = snapshot?.recentEvents.find((event) => event.id === selectedEventId) ?? null;
  const maxStageCount = Math.max(1, ...(snapshot?.stages.map((stage) => stage.count) ?? [1]));
  const providerReadyPercent = snapshot?.totals.providers
    ? Math.round((snapshot.totals.readyProviders / snapshot.totals.providers) * 100)
    : 0;
  const completedPercent = snapshot?.totals.requests
    ? Math.round((snapshot.totals.completed / snapshot.totals.requests) * 100)
    : 0;
  const lastObserved = useMemo(
    () => snapshot ? new Date(snapshot.observedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "Never",
    [snapshot]
  );

  if (!snapshot && state === "loading") {
    return <ControlState title="Connecting to local operations…" detail="Reading projects, requests, and free-provider readiness from the loopback control plane." />;
  }
  if (!snapshot) {
    return <ControlState title="Local control plane is offline" detail="Start Codkesh with npm start. No demo values are substituted when live data is unavailable." action={<Button onClick={() => void refresh(true)} disabled={refreshing}><ArrowClockwise className={refreshing ? "animate-spin" : ""} />Retry</Button>} />;
  }

  return (
    <section aria-labelledby="control-center-title" className="space-y-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={state === "live" ? "positive" : "caution"}>
              {state === "live" ? <CheckCircle weight="fill" /> : <Warning weight="fill" />}
              {state === "live" ? "Live local data" : "Preserved stale data"}
            </Badge>
            <Badge><Clock /> Observed {lastObserved}</Badge>
            <Badge>$0 automatic spend</Badge>
          </div>
          <h2 id="control-center-title" className="mt-4 text-2xl font-semibold tracking-tight">Live operations</h2>
          <p className="mt-1 text-sm text-muted-foreground">Canonical local projects, work, and provider readiness—without synthetic substitutes.</p>
        </div>
        <Button variant="secondary" onClick={() => void refresh(true)} disabled={refreshing}>
          <ArrowClockwise className={refreshing ? "animate-spin" : ""} />
          {refreshing ? "Refreshing" : "Refresh"}
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Signal label="Registered projects" value={String(snapshot.totals.projects)} note="local project registry" icon={<FolderOpen />} onClick={() => navigate("projects")} />
        <Signal label="Active work" value={String(snapshot.totals.active)} note={`${snapshot.totals.requests} total requests`} icon={<Gauge />} onClick={() => navigate("work")} />
        <Signal label="Completed" value={`${completedPercent}%`} note={`${snapshot.totals.completed} verified requests`} icon={<CheckCircle />} onClick={() => navigate("evidence")} />
        <Signal label="Ready providers" value={`${snapshot.totals.readyProviders}/${snapshot.totals.providers}`} note={`${providerReadyPercent}% admitted at $0`} icon={<PlugsConnected />} caution={snapshot.totals.readyProviders === 0} onClick={() => navigate("providers")} />
      </div>

      {snapshot.totals.needsAttention > 0 && (
        <div className="flex flex-col gap-3 rounded-3xl bg-amber-500/10 p-4 sm:flex-row sm:items-center sm:justify-between" role="status">
          <div className="flex items-start gap-3">
            <Warning className="mt-0.5 shrink-0 text-amber-500" weight="fill" />
            <div><strong className="text-sm">{snapshot.totals.needsAttention} signal{snapshot.totals.needsAttention === 1 ? "" : "s"} need attention</strong><p className="mt-1 text-xs text-muted-foreground">Interrupted or blocked work, project warnings, and unavailable providers are counted separately from healthy idle state.</p></div>
          </div>
          <Button size="sm" variant="secondary" onClick={() => navigate("work")}>Review work</Button>
        </div>
      )}

      <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(20rem,.65fr)]">
        <Card className="min-w-0">
          <CardHeader>
            <CardTitle>Work distribution</CardTitle>
            <CardDescription>Current request stages from the durable local request store.</CardDescription>
          </CardHeader>
          <CardContent className="mt-6">
            <div className="flex h-48 items-end gap-2" role="img" aria-label={snapshot.stages.map((stage) => `${readable(stage.stage)} ${stage.count}`).join(", ")}>
              {snapshot.stages.map((stage) => (
                <button key={stage.stage} type="button" onClick={() => navigate("work")} className="group flex h-full min-w-0 flex-1 flex-col justify-end gap-2 rounded-2xl outline-none focus-visible:ring-3 focus-visible:ring-ring/30" title={`${readable(stage.stage)}: ${stage.count}`}>
                  <span className="text-center text-xs font-semibold">{stage.count}</span>
                  <span className={cn("mx-auto w-full max-w-14 rounded-2xl bg-primary/20 transition-colors group-hover:bg-primary/45", stage.count === 0 && "bg-muted")} style={{ height: `${Math.max(8, (stage.count / maxStageCount) * 128)}px` }} />
                  <span className="truncate text-center text-[9px] text-muted-foreground">{readable(stage.stage)}</span>
                </button>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <Badge tone={snapshot.health === "attention" ? "caution" : "positive"} className="w-fit">{readable(snapshot.health)}</Badge>
            <CardTitle className="mt-4">{selectedEvent ? readable(selectedEvent.state) : "Healthy idle"}</CardTitle>
            <CardDescription>{selectedEvent?.title ?? "No operational activity has been recorded yet."}</CardDescription>
          </CardHeader>
          <CardContent className="mt-5">
            <div className="rounded-3xl bg-muted/50 p-4">
              <Fact label="Source" value={snapshot.provenance.replaceAll("_", " ")} />
              <Fact label="Observed" value={lastObserved} />
              <Fact label="Kind" value={selectedEvent?.kind ?? "system"} />
              <Fact label="Detail" value={selectedEvent?.detail ?? "Create a request to begin."} />
            </div>
            <Button className="mt-4 w-full" variant="secondary" onClick={() => navigate(eventDestination(selectedEvent?.kind))}>Open related view</Button>
          </CardContent>
        </Card>
      </div>

      <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(22rem,.75fr)]">
        <Card className="min-w-0">
          <CardHeader><CardTitle>Recent operational evidence</CardTitle><CardDescription>Restart-safe request events plus current project and provider observations.</CardDescription></CardHeader>
          <CardContent className="mt-4">
            {snapshot.recentEvents.length === 0 ? (
              <EmptyMessage title="No activity yet" detail="Register a project and create a request. This area will remain empty rather than showing sample work." />
            ) : (
              <div className="grid gap-2">
                {snapshot.recentEvents.slice(0, 10).map((event) => (
                  <button key={event.id} type="button" aria-pressed={event.id === selectedEventId} onClick={() => setSelectedEventId(event.id)} className={cn("grid gap-1 rounded-2xl bg-muted/45 p-3 text-left outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/30 sm:grid-cols-[6rem_minmax(0,1fr)_5rem] sm:items-center", event.id === selectedEventId && "bg-primary/[.10]")}>
                    <Badge className="w-fit">{event.kind}</Badge>
                    <span className="min-w-0"><strong className="block truncate text-xs">{event.title}</strong><span className="mt-1 block truncate text-[10px] text-muted-foreground">{event.detail}</span></span>
                    <span className="text-[10px] text-muted-foreground sm:text-right">{relativeTime(event.observedAt)}</span>
                  </button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Free-provider readiness</CardTitle><CardDescription>Configured connections only. Billing-enabled routes cannot count as ready.</CardDescription></CardHeader>
          <CardContent className="mt-4">
            {snapshot.providers.length === 0 ? (
              <EmptyMessage title="No provider connected" detail="Connect a free account to enable model-backed proposals." action={<Button size="sm" onClick={() => navigate("providers")}>Connect provider</Button>} />
            ) : (
              <div className="grid gap-2">
                {snapshot.providers.map((provider) => (
                  <button key={provider.id} type="button" onClick={() => navigate("providers")} className="flex items-center justify-between gap-3 rounded-2xl bg-muted/45 p-3 text-left outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/30">
                    <span className="min-w-0"><strong className="block truncate text-xs">{provider.label}</strong><span className="mt-1 block truncate text-[10px] text-muted-foreground">{provider.modelId}</span></span>
                    <Badge tone={provider.state === "ready" && provider.admitted && provider.zeroCost ? "positive" : "caution"}>{provider.state === "ready" && provider.admitted && provider.zeroCost ? "Ready · $0" : readable(provider.state)}</Badge>
                  </button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </section>
  );
}

function Signal({ label, value, note, icon, caution = false, onClick }: { label: string; value: string; note: string; icon: React.ReactNode; caution?: boolean; onClick: () => void }) {
  return <button type="button" onClick={onClick} className="rounded-4xl text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/30"><Card className="h-full p-5 transition-colors hover:bg-muted/45"><div className="flex items-start justify-between gap-3"><div><span className="text-xs text-muted-foreground">{label}</span><strong className="mt-2 block text-2xl">{value}</strong><span className="mt-1 block text-[10px] text-muted-foreground">{note}</span></div><span className={caution ? "text-amber-500" : "text-primary"}>{icon}</span></div></Card></button>;
}
function Fact({ label, value }: { label: string; value: string }) { return <div className="mb-3 last:mb-0"><span className="block text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span><strong className="mt-1 block text-xs">{value}</strong></div>; }
function EmptyMessage({ title, detail, action }: { title: string; detail: string; action?: React.ReactNode }) { return <div className="rounded-3xl bg-muted/45 p-5"><strong className="text-sm">{title}</strong><p className="mt-2 text-xs leading-5 text-muted-foreground">{detail}</p>{action && <div className="mt-4">{action}</div>}</div>; }
function ControlState({ title, detail, action }: { title: string; detail: string; action?: React.ReactNode }) { return <section aria-live="polite" className="grid min-h-[26rem] place-items-center"><div className="max-w-md rounded-4xl bg-card p-8 text-center"><Gauge className="mx-auto text-primary" size={34} /><h2 className="mt-5 text-xl font-semibold">{title}</h2><p className="mt-2 text-sm leading-6 text-muted-foreground">{detail}</p>{action && <div className="mt-5 flex justify-center">{action}</div>}</div></section>; }
function readable(value: string): string { return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase()); }
function relativeTime(value: number): string { const seconds = Math.max(0, Math.floor((Date.now() - value) / 1_000)); if (seconds < 60) return `${seconds}s ago`; const minutes = Math.floor(seconds / 60); if (minutes < 60) return `${minutes}m ago`; const hours = Math.floor(minutes / 60); return `${hours}h ago`; }
function eventDestination(kind: LiveOperationsSnapshot["recentEvents"][number]["kind"] | undefined): StudioDestination { return kind === "provider" ? "providers" : kind === "project" ? "projects" : kind === "request" ? "work" : "evidence"; }
