import { ArrowClockwise } from "@phosphor-icons/react/ArrowClockwise";
import { ArrowSquareOut } from "@phosphor-icons/react/ArrowSquareOut";
import { CheckCircle } from "@phosphor-icons/react/CheckCircle";
import { ClockCountdown } from "@phosphor-icons/react/ClockCountdown";
import { DownloadSimple } from "@phosphor-icons/react/DownloadSimple";
import { FunnelSimple } from "@phosphor-icons/react/FunnelSimple";
import { MagnifyingGlass } from "@phosphor-icons/react/MagnifyingGlass";
import { Pulse } from "@phosphor-icons/react/Pulse";
import { ShieldCheck } from "@phosphor-icons/react/ShieldCheck";
import { Warning } from "@phosphor-icons/react/Warning";
import { X } from "@phosphor-icons/react/X";
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";

import type { ActivityEvent, ActivityKind, ActivityQuery, ActivityRange, ActivitySeverity, ActivitySnapshot } from "../../../../../packages/runtime/src/activity.js";
import { createActivityExport, fetchActivity } from "../../activity-client.js";
import { cn } from "../../lib/utils.js";
import { Badge } from "../ui/badge.js";
import { Button } from "../ui/button.js";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card.js";

type Connection = "loading" | "live" | "stale" | "offline";
const ranges: readonly ActivityRange[] = ["1h", "24h", "7d", "all"];
const kinds: readonly ActivityKind[] = ["request", "project", "provider", "autonomy", "system"];
const severities: readonly ActivitySeverity[] = ["progress", "attention", "failure", "success", "neutral"];

export function ActivityExplorer({ endpoint }: { endpoint: string }) {
  const [snapshot, setSnapshot] = useState<ActivitySnapshot | null>(null);
  const snapshotRef = useRef<ActivitySnapshot | null>(null);
  const [connection, setConnection] = useState<Connection>("loading");
  const [range, setRange] = useState<ActivityRange>("24h");
  const [activeKinds, setActiveKinds] = useState<ActivityKind[]>([]);
  const [activeSeverities, setActiveSeverities] = useState<ActivitySeverity[]>([]);
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [notice, setNotice] = useState("Connecting to canonical local activity…");

  const query = useMemo<Partial<ActivityQuery>>(() => ({ range, kinds: activeKinds, severities: activeSeverities, search: deferredSearch }), [activeKinds, activeSeverities, deferredSearch, range]);
  const accept = useCallback((next: ActivitySnapshot) => {
    snapshotRef.current = next;
    setSnapshot(next);
    setConnection(Date.now() <= next.observedAt + next.validForMs ? "live" : "stale");
    setSelectedId((current) => current && next.events.some((event) => event.id === current) ? current : next.events[0]?.id ?? null);
    setNotice(`${next.events.length} canonical ${next.events.length === 1 ? "event" : "events"} observed.`);
  }, []);
  const refresh = useCallback(async (signal?: AbortSignal) => {
    try { accept(await fetchActivity({ endpoint, query, ...(signal ? { signal } : {}) })); }
    catch (error) {
      if (signal?.aborted) return;
      setConnection(snapshotRef.current ? "stale" : "offline");
      setNotice(snapshotRef.current ? "Showing the last valid observation. No new progress was inferred." : error instanceof Error ? error.message : "Local activity is unavailable.");
    }
  }, [accept, endpoint, query]);

  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal);
    return () => controller.abort();
  }, [refresh]);
  useEffect(() => {
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") void refresh(); }, 15_000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const selected = snapshot?.events.find((event) => event.id === selectedId) ?? snapshot?.events[0] ?? null;
  const grouped = useMemo(() => groupEvents(snapshot?.events ?? []), [snapshot]);
  const filtersActive = activeKinds.length + activeSeverities.length + (search ? 1 : 0);

  function toggleKind(value: ActivityKind) { setActiveKinds((current) => current.includes(value) ? current.filter((item) => item !== value) : [...current, value]); }
  function toggleSeverity(value: ActivitySeverity) { setActiveSeverities((current) => current.includes(value) ? current.filter((item) => item !== value) : [...current, value]); }
  function clearFilters() { setActiveKinds([]); setActiveSeverities([]); setSearch(""); }
  function download() {
    if (!snapshot) return;
    const body = JSON.stringify(createActivityExport(snapshot), null, 2);
    const url = URL.createObjectURL(new Blob([body], { type: "application/json" }));
    const anchor = document.createElement("a");
    anchor.href = url; anchor.download = `pipeline-studio-activity-${new Date().toISOString().slice(0, 10)}.json`; anchor.click();
    URL.revokeObjectURL(url);
    setNotice(`Downloaded ${snapshot.events.length} redacted local events.`);
  }

  if (!snapshot && connection === "loading") return <State title="Connecting to activity…" detail="Reading bounded request, project, provider, autonomy, validation, and recovery evidence." />;
  if (!snapshot) return <State title="Activity is offline" detail="Start Pipeline Studio locally. No sample history or inferred progress is shown." action={<Button onClick={() => void refresh()}><ArrowClockwise />Retry</Button>} />;

  return (
    <section className="space-y-4" aria-labelledby="activity-explorer-title">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex flex-wrap gap-2">
            <Badge tone={connection === "live" ? "positive" : "caution"}>{connection === "live" ? <ShieldCheck weight="fill" /> : <Warning weight="fill" />}{connection === "live" ? "Live local evidence" : "Preserved stale view"}</Badge>
            <Badge>{snapshot.provenance.replaceAll("_", " ")}</Badge><Badge>$0 automatic spend</Badge>
          </div>
          <h2 id="activity-explorer-title" className="mt-4 text-2xl font-semibold tracking-tight">Activity explorer</h2>
          <p className="mt-1 text-sm text-muted-foreground">A bounded operational history. Every row links to canonical local state.</p>
        </div>
        <div className="flex gap-2"><Button variant="secondary" onClick={download}><DownloadSimple />Export</Button><Button variant="secondary" onClick={() => void refresh()}><ArrowClockwise />Refresh</Button></div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <Metric label="Observed" value={snapshot.summary.observed} icon={<Pulse />} />
        <Metric label="In motion" value={snapshot.summary.active} icon={<ClockCountdown />} />
        <Metric label="Decisions" value={snapshot.summary.decisions} icon={<FunnelSimple />} caution />
        <Metric label="Failures" value={snapshot.summary.failures} icon={<Warning />} caution />
        <Metric label="Recoveries" value={snapshot.summary.recoveries} icon={<CheckCircle />} />
        <Metric label="Providers" value={snapshot.summary.providers} icon={<ShieldCheck />} />
      </div>

      <Card>
        <CardContent className="grid gap-4 p-4 lg:grid-cols-[minmax(14rem,1fr)_auto] lg:items-center">
          <label className="relative block">
            <MagnifyingGlass className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <span className="sr-only">Search activity</span>
            <input value={search} onChange={(event) => setSearch(event.target.value)} maxLength={80} placeholder="Search state, detail, or provider" className="h-11 w-full rounded-full bg-muted/60 pl-11 pr-11 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/30" />
            {search && <button type="button" aria-label="Clear activity search" onClick={() => setSearch("")} className="absolute right-3 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded-full hover:bg-background"><X /></button>}
          </label>
          <div className="flex gap-1 overflow-x-auto rounded-full bg-muted/55 p-1" role="group" aria-label="Activity time range">
            {ranges.map((item) => <button key={item} type="button" aria-pressed={range === item} onClick={() => setRange(item)} className={cn("min-w-12 rounded-full px-3 py-2 text-xs font-semibold outline-none focus-visible:ring-3 focus-visible:ring-ring/30", range === item && "bg-primary text-primary-foreground")}>{item === "all" ? "All" : item.toUpperCase()}</button>)}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-3">
          <div><CardTitle>Filters</CardTitle><CardDescription>Counts describe the selected time range before facet filters.</CardDescription></div>
          {filtersActive > 0 && <Button variant="ghost" size="sm" onClick={clearFilters}><X />Clear {filtersActive}</Button>}
        </CardHeader>
        <CardContent className="mt-4 space-y-3">
          <FacetRow label="Source kind">{kinds.map((item) => <Filter key={item} label={readable(item)} count={facetCount(snapshot.facets.kinds, item)} active={activeKinds.includes(item)} onClick={() => toggleKind(item)} />)}</FacetRow>
          <FacetRow label="Severity">{severities.map((item) => <Filter key={item} label={readable(item)} count={facetCount(snapshot.facets.severities, item)} active={activeSeverities.includes(item)} onClick={() => toggleSeverity(item)} />)}</FacetRow>
        </CardContent>
      </Card>

      <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <Card className="min-w-0">
          <CardHeader><CardTitle>Canonical timeline</CardTitle><CardDescription>{snapshot.events.length} matching events · newest first · bounded current-state history</CardDescription></CardHeader>
          <CardContent className="mt-4">
            {snapshot.events.length === 0 ? <Empty filtered={filtersActive > 0} /> : (
              <div className="space-y-6">
                {grouped.map(([date, events]) => <section key={date} aria-labelledby={`activity-date-${date}`}><h3 id={`activity-date-${date}`} className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">{date}</h3><div className="space-y-2">{events.map((event) => <TimelineRow key={event.id} event={event} selected={selected?.id === event.id} onSelect={() => setSelectedId(event.id)} />)}</div></section>)}
              </div>
            )}
          </CardContent>
        </Card>
        <Card className="h-fit xl:sticky xl:top-24">
          <CardHeader>{selected ? <><Badge tone={tone(selected.severity)} className="w-fit">{readable(selected.severity)}</Badge><CardTitle className="mt-4">{selected.title}</CardTitle><CardDescription>{selected.detail}</CardDescription></> : <><Badge className="w-fit">Healthy idle</Badge><CardTitle className="mt-4">Nothing selected</CardTitle><CardDescription>Select a canonical event to inspect its source.</CardDescription></>}</CardHeader>
          <CardContent className="mt-4">
            {selected && <><div className="rounded-3xl bg-muted/50 p-4"><Fact label="Observed" value={formatDateTime(selected.observedAt)} /><Fact label="Source" value={readable(selected.source)} /><Fact label="Canonical state" value={readable(selected.state)} /><Fact label="Record reference" value={selected.sourceRecordId.slice(-16)} /></div><div className="mt-4 rounded-3xl bg-primary/[.07] p-4"><strong className="text-xs">Privacy boundary</strong><p className="mt-1 text-xs leading-5 text-muted-foreground">Credentials, personal paths, prompts, source content, and provider bodies are excluded.</p></div><a href={selected.reference.path} className="mt-4 flex h-10 items-center justify-center gap-2 rounded-full bg-primary px-4 text-xs font-semibold text-primary-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/30">{selected.reference.label}<ArrowSquareOut /></a></>}
          </CardContent>
        </Card>
      </div>
      <div className="flex flex-col gap-1 px-1 text-xs text-muted-foreground sm:flex-row sm:justify-between"><p aria-live="polite">{notice}</p><p>{snapshot.retention.earliestObservedAt ? `Bounded since ${formatDateTime(snapshot.retention.earliestObservedAt)}` : "No retained activity yet"} · maximum {snapshot.retention.maximumEvents}</p></div>
    </section>
  );
}

function TimelineRow({ event, selected, onSelect }: { event: ActivityEvent; selected: boolean; onSelect: () => void }) {
  return <button type="button" aria-pressed={selected} onClick={onSelect} className={cn("grid w-full gap-3 rounded-3xl bg-muted/40 p-4 text-left outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/30 sm:grid-cols-[5rem_7rem_minmax(0,1fr)] sm:items-center", selected && "bg-primary/[.09]")}><time className="text-[11px] text-muted-foreground">{formatTime(event.observedAt)}</time><Badge tone={tone(event.severity)} className="w-fit">{readable(event.kind)}</Badge><span className="min-w-0"><strong className="block truncate text-xs">{event.title}</strong><span className="mt-1 block truncate text-[11px] text-muted-foreground">{event.detail}</span></span></button>;
}
function Metric({ label, value, icon, caution = false }: { label: string; value: number; icon: React.ReactNode; caution?: boolean }) { return <Card className="p-5"><div className="flex justify-between gap-3"><div><span className="text-xs text-muted-foreground">{label}</span><strong className="mt-2 block text-2xl">{value}</strong></div><span className={caution && value > 0 ? "text-amber-500" : "text-primary"}>{icon}</span></div></Card>; }
function FacetRow({ label, children }: { label: string; children: React.ReactNode }) { return <div className="flex flex-col gap-2 sm:flex-row sm:items-center"><span className="w-24 shrink-0 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</span><div className="flex gap-2 overflow-x-auto pb-1">{children}</div></div>; }
function Filter({ label, count, active, onClick }: { label: string; count: number; active: boolean; onClick: () => void }) { return <button type="button" aria-pressed={active} onClick={onClick} className={cn("shrink-0 rounded-full bg-muted px-3 py-2 text-[11px] font-semibold outline-none focus-visible:ring-3 focus-visible:ring-ring/30", active && "bg-primary text-primary-foreground")}>{label} · {count}</button>; }
function Fact({ label, value }: { label: string; value: string }) { return <div className="mb-3 last:mb-0"><span className="block text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span><strong className="mt-1 block text-xs">{value}</strong></div>; }
function Empty({ filtered }: { filtered: boolean }) { return <div className="rounded-3xl bg-muted/45 p-6"><strong className="text-sm">{filtered ? "No activity matches these filters" : "No activity yet"}</strong><p className="mt-2 text-xs leading-5 text-muted-foreground">{filtered ? "Clear a facet or expand the time range. Canonical history remains unchanged." : "Register a project or create work. Healthy idle does not generate synthetic events."}</p></div>; }
function State({ title, detail, action }: { title: string; detail: string; action?: React.ReactNode }) { return <section aria-live="polite" className="grid min-h-[24rem] place-items-center"><div className="max-w-md rounded-4xl bg-card p-8 text-center"><Pulse className="mx-auto text-primary" size={36} /><h2 className="mt-5 text-xl font-semibold">{title}</h2><p className="mt-2 text-sm leading-6 text-muted-foreground">{detail}</p>{action && <div className="mt-5 flex justify-center">{action}</div>}</div></section>; }
function groupEvents(events: readonly ActivityEvent[]): [string, ActivityEvent[]][] { const groups = new Map<string, ActivityEvent[]>(); for (const event of events) { const key = new Date(event.observedAt).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" }); groups.set(key, [...(groups.get(key) ?? []), event]); } return [...groups]; }
function facetCount(facets: readonly { value: string; count: number }[], value: string): number { return facets.find((item) => item.value === value)?.count ?? 0; }
function tone(severity: ActivitySeverity): "positive" | "caution" | "active" | "neutral" { return severity === "success" ? "positive" : severity === "attention" || severity === "failure" ? "caution" : severity === "progress" ? "active" : "neutral"; }
function readable(value: string): string { return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase()); }
function formatTime(value: number): string { return new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); }
function formatDateTime(value: number): string { return new Date(value).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }); }
