import { ArrowClockwise } from "@phosphor-icons/react/ArrowClockwise";
import { ArrowSquareOut } from "@phosphor-icons/react/ArrowSquareOut";
import { CheckCircle } from "@phosphor-icons/react/CheckCircle";
import { ClockCountdown } from "@phosphor-icons/react/ClockCountdown";
import { DownloadSimple } from "@phosphor-icons/react/DownloadSimple";
import { FunnelSimple } from "@phosphor-icons/react/FunnelSimple";
import { HourglassHigh } from "@phosphor-icons/react/HourglassHigh";
import { MagnifyingGlass } from "@phosphor-icons/react/MagnifyingGlass";
import { ShieldCheck } from "@phosphor-icons/react/ShieldCheck";
import { Siren } from "@phosphor-icons/react/Siren";
import { UserFocus } from "@phosphor-icons/react/UserFocus";
import { Warning } from "@phosphor-icons/react/Warning";
import { X } from "@phosphor-icons/react/X";
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";

import type {
  DecisionAge,
  DecisionCategory,
  DecisionItem,
  DecisionOwner,
  DecisionPriority,
  DecisionQuery,
  DecisionRange,
  DecisionSnapshot,
} from "../../../../../packages/runtime/src/decisions.js";
import { createDecisionExport, fetchDecisions } from "../../decision-client.js";
import { decideProjectSolution, getProjectLifecycle, getProjectSolution, getProjectSolutionHistory } from "../../local-project-client.js";
import type { SolutionDocument } from "../../../../../packages/orchestration/src/solution-design.js";
import { cn } from "../../lib/utils.js";
import { Badge } from "../ui/badge.js";
import { Button } from "../ui/button.js";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card.js";

type Connection = "loading" | "live" | "stale" | "offline";
const ranges: readonly DecisionRange[] = ["24h", "7d", "30d", "all"];
const categories: readonly DecisionCategory[] = ["approval", "input", "failure", "recovery", "provider", "project", "policy", "conflict"];
const priorities: readonly DecisionPriority[] = ["critical", "high", "medium", "low"];
const owners: readonly DecisionOwner[] = ["user", "system", "provider", "external_service"];
const ages: readonly DecisionAge[] = ["new", "recent", "aging", "overdue"];

export function DecisionInbox({ endpoint }: { endpoint: string }) {
  const [snapshot, setSnapshot] = useState<DecisionSnapshot | null>(null);
  const snapshotRef = useRef<DecisionSnapshot | null>(null);
  const [connection, setConnection] = useState<Connection>("loading");
  const [range, setRange] = useState<DecisionRange>("7d");
  const [activeCategories, setActiveCategories] = useState<DecisionCategory[]>([]);
  const [activePriorities, setActivePriorities] = useState<DecisionPriority[]>([]);
  const [activeOwners, setActiveOwners] = useState<DecisionOwner[]>([]);
  const [activeAges, setActiveAges] = useState<DecisionAge[]>([]);
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [notice, setNotice] = useState("Connecting to canonical local decisions…");
  const [solution, setSolution] = useState<SolutionDocument | null>(null);
  const [solutionHistory, setSolutionHistory] = useState<readonly SolutionDocument[]>([]);
  const [viewedSolutionDigest, setViewedSolutionDigest] = useState<string | null>(null);
  const [solutionFeedback, setSolutionFeedback] = useState("");
  const [solutionWorking, setSolutionWorking] = useState(false);

  const query = useMemo<Partial<DecisionQuery>>(() => ({
    range,
    categories: activeCategories,
    priorities: activePriorities,
    owners: activeOwners,
    ages: activeAges,
    search: deferredSearch,
  }), [activeAges, activeCategories, activeOwners, activePriorities, deferredSearch, range]);
  const accept = useCallback((next: DecisionSnapshot) => {
    snapshotRef.current = next;
    setSnapshot(next);
    setConnection(Date.now() <= next.observedAt + next.validForMs ? "live" : "stale");
    setSelectedId((current) => current && next.items.some((item) => item.id === current) ? current : next.items[0]?.id ?? null);
    setNotice(next.items.length === 0 ? "No open decision is present in the selected scope." : `${next.items.length} canonical ${next.items.length === 1 ? "decision" : "decisions"} need attention.`);
  }, []);
  const refresh = useCallback(async (signal?: AbortSignal) => {
    try { accept(await fetchDecisions({ endpoint, query, ...(signal ? { signal } : {}) })); }
    catch (error) {
      if (signal?.aborted) return;
      setConnection(snapshotRef.current ? "stale" : "offline");
      setNotice(snapshotRef.current ? "Showing the last valid queue. No resolution or progress was inferred." : error instanceof Error ? error.message : "Local decisions are unavailable.");
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

  const selected = snapshot?.items.find((item) => item.id === selectedId) ?? snapshot?.items[0] ?? null;
  useEffect(() => {
    if (selected?.source !== "project_solution" || !selected.projectId) { setSolution(null); setSolutionHistory([]); setViewedSolutionDigest(null); return; }
    let active = true;
    void Promise.all([getProjectSolution({ endpoint, projectId: selected.projectId }), getProjectSolutionHistory({ endpoint, projectId: selected.projectId })]).then(([document, history]) => { if (active) { setSolution(document); setSolutionHistory(history); setViewedSolutionDigest(document.digest); } }, () => { if (active) { setSolution(null); setSolutionHistory([]); setViewedSolutionDigest(null); setNotice("The solution or its revision history could not be verified."); } });
    return () => { active = false; };
  }, [endpoint, selected?.id, selected?.projectId, selected?.source]);
  const filtersActive = activeCategories.length + activePriorities.length + activeOwners.length + activeAges.length + (search ? 1 : 0);
  const lanes = useMemo(() => priorities.map((priority) => [priority, snapshot?.items.filter((item) => item.priority === priority) ?? []] as const), [snapshot]);
  const viewedSolution = solutionHistory.find((item) => item.digest === viewedSolutionDigest) ?? solution;

  function toggle<T>(value: T, setter: React.Dispatch<React.SetStateAction<T[]>>) {
    setter((current) => current.includes(value) ? current.filter((item) => item !== value) : [...current, value]);
  }
  function clearFilters() {
    setActiveCategories([]); setActivePriorities([]); setActiveOwners([]); setActiveAges([]); setSearch("");
  }
  function download() {
    if (!snapshot) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(createDecisionExport(snapshot), null, 2)], { type: "application/json" }));
    const anchor = document.createElement("a");
    anchor.href = url; anchor.download = `pipeline-studio-decisions-${new Date().toISOString().slice(0, 10)}.json`; anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
    setNotice(`Downloaded ${snapshot.items.length} redacted displayed decisions.`);
  }

  async function decideSolution(decision: "approved" | "declined" | "revision_requested") {
    if (!selected?.projectId || !solution) return;
    const feedback = solutionFeedback.trim();
    if (decision === "revision_requested" && feedback.length < 3) { setNotice("Describe the change you need."); return; }
    setSolutionWorking(true);
    try {
      const lifecycle = await getProjectLifecycle({ endpoint, projectId: selected.projectId });
      await decideProjectSolution({ endpoint, projectId: selected.projectId, expectedRevision: lifecycle.revision, artifactDigest: solution.digest, decision, feedback: decision === "revision_requested" ? feedback : null, idempotencyKey: `solution:${decision}:${crypto.randomUUID()}` });
      setSolutionFeedback(""); setSolution(null); await refresh();
      setNotice(decision === "approved" ? "Solution approved. Delivery planning can begin." : decision === "declined" ? "Solution declined. Downstream planning was cancelled." : "Changes requested. The solution returned to design.");
    } catch (error) { setNotice(error instanceof Error ? error.message : "The solution decision could not be saved safely."); }
    finally { setSolutionWorking(false); }
  }

  if (!snapshot && connection === "loading") return <State title="Building your decision queue…" detail="Reading bounded request, project, provider, autonomy, validation, and recovery evidence." />;
  if (!snapshot) return <State title="Decision Inbox is offline" detail="Start Codkesh locally. No sample decisions or inferred blockers are shown." action={<Button onClick={() => void refresh()}><ArrowClockwise />Retry</Button>} />;

  return (
    <section className="space-y-4" aria-labelledby="decision-inbox-title">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex flex-wrap gap-2">
            <Badge tone={connection === "live" ? "positive" : "caution"}>{connection === "live" ? <ShieldCheck weight="fill" /> : <Warning weight="fill" />}{connection === "live" ? "Live decision evidence" : "Preserved stale queue"}</Badge>
            <Badge>{snapshot.provenance.replaceAll("_", " ")}</Badge><Badge>$0 automatic spend</Badge>
          </div>
          <h2 id="decision-inbox-title" className="mt-4 text-2xl font-semibold tracking-tight">Decision inbox</h2>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">Everything waiting for a person, provider, policy, or recovery step—prioritized from canonical local evidence.</p>
        </div>
        <div className="flex gap-2"><Button variant="secondary" onClick={download}><DownloadSimple />Export</Button><Button variant="secondary" onClick={() => void refresh()}><ArrowClockwise />Refresh</Button></div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 2xl:grid-cols-7">
        <Metric label="Open" value={snapshot.summary.open} icon={<FunnelSimple />} />
        <Metric label="Critical" value={snapshot.summary.critical} icon={<Siren />} caution />
        <Metric label="Overdue" value={snapshot.summary.overdue} icon={<ClockCountdown />} caution />
        <Metric label="Approvals" value={snapshot.summary.approvals} icon={<UserFocus />} />
        <Metric label="Projects blocked" value={snapshot.summary.blockedProjects} icon={<Warning />} caution />
        <Metric label="Provider waits" value={snapshot.summary.providerWaits} icon={<HourglassHigh />} />
        <Metric label="Oldest" value={snapshot.summary.oldestObservedAt ? relativeAge(snapshot.summary.oldestObservedAt) : "—"} icon={<CheckCircle />} />
      </div>

      <Card>
        <CardContent className="grid gap-4 p-4 lg:grid-cols-[minmax(14rem,1fr)_auto] lg:items-center">
          <label className="relative block">
            <MagnifyingGlass className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <span className="sr-only">Search decisions</span>
            <input value={search} onChange={(event) => setSearch(event.target.value)} maxLength={80} placeholder="Search decisions, reasons, or providers" className="h-11 w-full rounded-full bg-muted/60 pl-11 pr-11 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/30" />
            {search && <button type="button" aria-label="Clear decision search" onClick={() => setSearch("")} className="absolute right-3 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded-full hover:bg-background"><X /></button>}
          </label>
          <div className="flex gap-1 overflow-x-auto rounded-full bg-muted/55 p-1" role="group" aria-label="Decision time range">
            {ranges.map((item) => <button key={item} type="button" aria-pressed={range === item} onClick={() => setRange(item)} className={cn("min-w-12 rounded-full px-3 py-2 text-xs font-semibold outline-none focus-visible:ring-3 focus-visible:ring-ring/30", range === item && "bg-primary text-primary-foreground")}>{item === "all" ? "All" : item.toUpperCase()}</button>)}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-3">
          <div><CardTitle>Focus the queue</CardTitle><CardDescription>Counts describe the selected time range before facet filters.</CardDescription></div>
          {filtersActive > 0 && <Button variant="ghost" size="sm" onClick={clearFilters}><X />Clear {filtersActive}</Button>}
        </CardHeader>
        <CardContent className="mt-4 space-y-3">
          <FacetRow label="Category">{categories.map((item) => <Filter key={item} label={readable(item)} count={facetCount(snapshot.facets.categories, item)} active={activeCategories.includes(item)} onClick={() => toggle(item, setActiveCategories)} />)}</FacetRow>
          <FacetRow label="Priority">{priorities.map((item) => <Filter key={item} label={readable(item)} count={facetCount(snapshot.facets.priorities, item)} active={activePriorities.includes(item)} onClick={() => toggle(item, setActivePriorities)} />)}</FacetRow>
          <FacetRow label="Owner">{owners.map((item) => <Filter key={item} label={readable(item)} count={facetCount(snapshot.facets.owners, item)} active={activeOwners.includes(item)} onClick={() => toggle(item, setActiveOwners)} />)}</FacetRow>
          <FacetRow label="Age">{ages.map((item) => <Filter key={item} label={readable(item)} count={facetCount(snapshot.facets.ages, item)} active={activeAges.includes(item)} onClick={() => toggle(item, setActiveAges)} />)}</FacetRow>
        </CardContent>
      </Card>

      {snapshot.items.length === 0 ? <AllClear filtered={filtersActive > 0} /> : (
        <div className="grid min-w-0 gap-4 2xl:grid-cols-[minmax(0,1fr)_25rem]">
          <div className="grid min-w-0 gap-3 lg:grid-cols-2" aria-label="Decision priority lanes">
            {lanes.map(([priority, items]) => (
              <Card key={priority} className="min-w-0">
                <CardHeader className="flex flex-row items-center justify-between gap-3"><div><Badge tone={priorityTone(priority)} className="w-fit">{readable(priority)}</Badge><CardDescription className="mt-2">{laneDescription(priority)}</CardDescription></div><strong className="text-2xl">{items.length}</strong></CardHeader>
                <CardContent className="mt-2 space-y-2">
                  {items.length === 0 ? <p className="rounded-3xl bg-muted/35 p-4 text-xs text-muted-foreground">No {priority} decisions in this scope.</p> : items.map((item) => <DecisionRow key={item.id} item={item} selected={selected?.id === item.id} onSelect={() => setSelectedId(item.id)} />)}
                </CardContent>
              </Card>
            ))}
          </div>
          <Card className="h-fit 2xl:sticky 2xl:top-24">
            <CardHeader>{selected ? <><div className="flex flex-wrap gap-2"><Badge tone={priorityTone(selected.priority)}>{readable(selected.priority)}</Badge><Badge>{readable(selected.category)}</Badge><Badge>{readable(selected.owner)} owns next step</Badge></div><CardTitle className="mt-4">{selected.title}</CardTitle><CardDescription>{selected.reason}</CardDescription></> : null}</CardHeader>
            <CardContent className="mt-4">
              {selected && <><div className="rounded-3xl bg-muted/50 p-4"><Fact label="Next action" value={selected.nextAction} /><Fact label="Authority boundary" value={readable(selected.authorityBoundary)} /><Fact label="Effect" value={readable(selected.effect)} /><Fact label="Maximum automatic cost" value="$0" /><Fact label="Reversible" value={selected.reversible ? "Yes" : "No"} /><Fact label="Observed" value={formatDateTime(selected.observedAt)} />{selected.retryAt && <Fact label="Retry after" value={formatDateTime(selected.retryAt)} />}<Fact label="Source" value={readable(selected.source)} /></div>{selected.source === "project_solution" && solution && viewedSolution && <div className="mt-4 space-y-3">{solutionHistory.length > 1 && <select aria-label="Solution revision" value={viewedSolution.digest} onChange={(event) => setViewedSolutionDigest(event.target.value)} className="h-10 w-full rounded-full bg-muted/60 px-4 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/30">{solutionHistory.map((item) => <option key={item.digest} value={item.digest}>Revision {item.revision}{item.digest === solution.digest ? " · current" : ""}</option>)}</select>}<div className="max-h-80 overflow-auto rounded-3xl bg-muted/45 p-4"><pre className="whitespace-pre-wrap font-sans text-xs leading-6">{viewedSolution.markdown}</pre></div>{viewedSolution.digest !== solution.digest && <p className="text-xs text-muted-foreground">Historical revision · read only</p>}<textarea aria-label="Requested solution changes" value={solutionFeedback} onChange={(event) => setSolutionFeedback(event.target.value)} rows={3} maxLength={10_000} placeholder="Changes you need…" disabled={viewedSolution.digest !== solution.digest} className="w-full resize-y rounded-3xl bg-muted/60 px-4 py-3 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/30 disabled:opacity-50" /><div className="grid gap-2 sm:grid-cols-3"><Button onClick={() => void decideSolution("approved")} disabled={solutionWorking || viewedSolution.digest !== solution.digest}><CheckCircle />Approve</Button><Button variant="secondary" onClick={() => void decideSolution("revision_requested")} disabled={solutionWorking || solutionFeedback.trim().length < 3 || viewedSolution.digest !== solution.digest}>Request changes</Button><Button variant="ghost" onClick={() => void decideSolution("declined")} disabled={solutionWorking || viewedSolution.digest !== solution.digest}>Decline</Button></div></div>}<div className="mt-4 rounded-3xl bg-primary/[.07] p-4"><strong className="text-xs">Canonical evidence</strong><ul className="mt-2 space-y-1 text-xs leading-5 text-muted-foreground">{selected.evidence.map((entry) => <li key={entry}>• {entry}</li>)}</ul></div><div className="mt-4 rounded-3xl bg-muted/45 p-4"><strong className="text-xs">Privacy boundary</strong><p className="mt-1 text-xs leading-5 text-muted-foreground">Credentials, personal paths, prompts, source content, and provider bodies are excluded.</p></div>{selected.source !== "project_solution" && <a href={selected.reference.path} className="mt-4 flex h-10 items-center justify-center gap-2 rounded-full bg-primary px-4 text-xs font-semibold text-primary-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/30">{selected.reference.label}<ArrowSquareOut /></a>}</>}
            </CardContent>
          </Card>
        </div>
      )}
      <div className="flex flex-col gap-1 px-1 text-xs text-muted-foreground sm:flex-row sm:justify-between"><p aria-live="polite">{notice}</p><p>{snapshot.retention.earliestObservedAt ? `Bounded since ${formatDateTime(snapshot.retention.earliestObservedAt)}` : "No retained decisions"} · maximum {snapshot.retention.maximumItems}</p></div>
    </section>
  );
}

function DecisionRow({ item, selected, onSelect }: { item: DecisionItem; selected: boolean; onSelect: () => void }) {
  return <button type="button" aria-pressed={selected} onClick={onSelect} className={cn("w-full rounded-3xl bg-muted/40 p-4 text-left outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/30", selected && "bg-primary/[.09]")}><div className="flex items-center justify-between gap-2"><Badge tone={item.age === "overdue" ? "caution" : "neutral"}>{readable(item.age)}</Badge><span className="text-[10px] text-muted-foreground">{relativeAge(item.observedAt)}</span></div><strong className="mt-3 block text-sm">{item.title}</strong><span className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">{item.reason}</span><div className="mt-3 flex items-center justify-between gap-2"><span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{readable(item.category)} · {readable(item.owner)}</span><ArrowSquareOut className="text-primary" /></div></button>;
}
function Metric({ label, value, icon, caution = false }: { label: string; value: number | string; icon: React.ReactNode; caution?: boolean }) { return <Card className="p-5"><div className="flex justify-between gap-3"><div><span className="text-xs text-muted-foreground">{label}</span><strong className="mt-2 block text-2xl">{value}</strong></div><span className={caution && value !== 0 ? "text-amber-500" : "text-primary"}>{icon}</span></div></Card>; }
function FacetRow({ label, children }: { label: string; children: React.ReactNode }) { return <div className="flex flex-col gap-2 sm:flex-row sm:items-center"><span className="w-20 shrink-0 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</span><div className="flex gap-2 overflow-x-auto pb-1">{children}</div></div>; }
function Filter({ label, count, active, onClick }: { label: string; count: number; active: boolean; onClick: () => void }) { return <button type="button" aria-pressed={active} onClick={onClick} className={cn("shrink-0 rounded-full bg-muted px-3 py-2 text-[11px] font-semibold outline-none focus-visible:ring-3 focus-visible:ring-ring/30", active && "bg-primary text-primary-foreground")}>{label} · {count}</button>; }
function Fact({ label, value }: { label: string; value: string }) { return <div className="mb-3 last:mb-0"><span className="block text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span><strong className="mt-1 block text-xs">{value}</strong></div>; }
function AllClear({ filtered }: { filtered: boolean }) { return <Card><CardContent className="grid min-h-60 place-items-center p-8 text-center"><div><CheckCircle className="mx-auto text-emerald-500" size={38} weight="fill" /><strong className="mt-4 block text-lg">{filtered ? "No decisions match these filters" : "All clear"}</strong><p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground">{filtered ? "Clear a filter or expand the time range. Canonical decisions remain unchanged." : "No retained canonical evidence currently requires a person, provider, policy, or recovery step."}</p></div></CardContent></Card>; }
function State({ title, detail, action }: { title: string; detail: string; action?: React.ReactNode }) { return <section aria-live="polite" className="grid min-h-[24rem] place-items-center"><div className="max-w-md rounded-4xl bg-card p-8 text-center"><UserFocus className="mx-auto text-primary" size={36} /><h2 className="mt-5 text-xl font-semibold">{title}</h2><p className="mt-2 text-sm leading-6 text-muted-foreground">{detail}</p>{action && <div className="mt-5 flex justify-center">{action}</div>}</div></section>; }
function facetCount(facets: readonly { value: string; count: number }[], value: string): number { return facets.find((item) => item.value === value)?.count ?? 0; }
function priorityTone(priority: DecisionPriority): "positive" | "caution" | "active" | "neutral" { return priority === "critical" || priority === "high" ? "caution" : priority === "medium" ? "active" : "neutral"; }
function laneDescription(priority: DecisionPriority): string { return priority === "critical" ? "Immediate review" : priority === "high" ? "Blocking or failed" : priority === "medium" ? "Human decision" : "Monitor or wait"; }
function readable(value: string): string { return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase()); }
function relativeAge(value: number): string { const minutes = Math.max(0, Math.floor((Date.now() - value) / 60_000)); return minutes < 1 ? "now" : minutes < 60 ? `${minutes}m` : minutes < 1_440 ? `${Math.floor(minutes / 60)}h` : `${Math.floor(minutes / 1_440)}d`; }
function formatDateTime(value: number): string { return new Date(value).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }); }
