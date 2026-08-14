import { Bell } from "@phosphor-icons/react/Bell";
import { BellRinging } from "@phosphor-icons/react/BellRinging";
import { CheckCircle } from "@phosphor-icons/react/CheckCircle";
import { Clock } from "@phosphor-icons/react/Clock";
import { Gear } from "@phosphor-icons/react/Gear";
import { ShieldWarning } from "@phosphor-icons/react/ShieldWarning";
import { Warning } from "@phosphor-icons/react/Warning";
import { X } from "@phosphor-icons/react/X";
import { useEffect, useMemo, useRef, useState } from "react";

import type { AttentionAction, AttentionCategory, AttentionDisposition, AttentionItem, AttentionSeverity, AttentionSnapshot, QuietHours } from "../../../../../packages/runtime/src/attention.js";
import { applyAttentionAction, fetchAttention, previewAttentionAction, previewQuietHours, updateQuietHours } from "../../attention-client.js";
import { listLocalProjects } from "../../local-project-client.js";
import { cn } from "../../lib/utils.js";
import { Badge } from "../ui/badge.js";
import { Button } from "../ui/button.js";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card.js";

const severities: readonly AttentionSeverity[] = ["critical", "high", "medium", "info"];
const categories: readonly AttentionCategory[] = ["action", "recovery", "provider", "completion", "security", "system"];
const dispositions: readonly AttentionDisposition[] = ["unread", "read", "acknowledged", "snoozed"];

export function AttentionBell({ endpoint, openCenter, activate }: { endpoint: string; openCenter: () => void; activate: (path: string) => void }) {
  const [open, setOpen] = useState(false);
  const [snapshot, setSnapshot] = useState<AttentionSnapshot | null>(null);
  const [offline, setOffline] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let active = true;
    const refresh = () => void fetchAttention({ endpoint, query: { includeSuppressed: false } }).then((value) => { if (active) { setSnapshot(value); setOffline(false); } }).catch(() => { if (active) setOffline(true); });
    refresh();
    const timer = window.setInterval(refresh, 15_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [endpoint]);
  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", close);
    panel.current?.querySelector<HTMLElement>("button")?.focus();
    return () => window.removeEventListener("keydown", close);
  }, [open]);
  const items = snapshot?.items.filter((item) => item.disposition === "unread" && !item.suppressed).slice(0, 4) ?? [];
  const badge = snapshot?.summary.badge ?? 0;
  return <div className="relative">
    <Button variant="ghost" size="icon" aria-label={offline ? "Attention Center unavailable" : badge ? `Open Attention Center, ${badge} unread` : "Open Attention Center, all clear"} aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen((value) => !value)}>
      {badge ? <BellRinging weight="fill" /> : <Bell />}
      {badge > 0 && <span className="absolute right-0.5 top-0.5 min-w-4 rounded-full bg-primary px-1 text-center text-[9px] font-bold leading-4 text-primary-foreground">{badge}</span>}
    </Button>
    {open && <div ref={panel} role="dialog" aria-label="Attention preview" className="fixed inset-x-3 top-17 z-[65] overflow-hidden rounded-[1.75rem] bg-popover/97 shadow-2xl ring-1 ring-foreground/[.07] backdrop-blur-xl sm:absolute sm:inset-auto sm:right-0 sm:top-12 sm:w-[25rem]">
      <div className="flex items-center justify-between p-4"><div><strong className="text-sm">Attention Center</strong><p className="mt-0.5 text-[11px] text-muted-foreground">{snapshot?.quietHoursActive ? "Quiet hours active · critical still delivered" : "Live canonical attention"}</p></div><Button variant="ghost" size="icon" aria-label="Close attention preview" onClick={() => setOpen(false)}><X /></Button></div>
      <div className="max-h-[25rem] space-y-1 overflow-y-auto p-2 pt-0" aria-live="polite">
        {offline ? <Empty icon={<Warning />} title="Attention is offline" detail="No sample count is substituted." /> : items.length === 0 ? <Empty icon={<CheckCircle />} title="All clear" detail="Nothing unsuppressed needs attention." /> : items.map((item) => <button key={item.id} type="button" onClick={() => { setOpen(false); activate(item.reference.path); }} className="flex w-full items-start gap-3 rounded-2xl p-3 text-left hover:bg-muted focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/30"><SeverityIcon severity={item.severity} /><span className="min-w-0 flex-1"><strong className="block truncate text-xs">{item.title}</strong><span className="mt-1 block line-clamp-2 text-[11px] leading-4 text-muted-foreground">{item.reason}</span></span><Badge tone={item.severity === "critical" ? "critical" : item.severity === "high" ? "caution" : "neutral"}>{readable(item.severity)}</Badge></button>)}
      </div>
      <div className="flex items-center justify-between bg-muted/35 p-3"><span className="text-[10px] text-muted-foreground">{snapshot ? `${snapshot.summary.unread} unread · ${snapshot.summary.snoozed} snoozed` : "Live state unavailable"}</span><Button size="sm" onClick={() => { setOpen(false); openCenter(); }}>Open center</Button></div>
    </div>}
  </div>;
}

export function AttentionCenter({ endpoint, activate }: { endpoint: string; activate: (path: string) => void }) {
  const [snapshot, setSnapshot] = useState<AttentionSnapshot | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "offline">("loading");
  const [selectedId, setSelectedId] = useState("");
  const [search, setSearch] = useState("");
  const [severity, setSeverity] = useState<AttentionSeverity[]>([]);
  const [category, setCategory] = useState<AttentionCategory[]>([]);
  const [view, setView] = useState<"active" | "history">("active");
  const [projectId, setProjectId] = useState("");
  const [projects, setProjects] = useState<readonly { id: string; displayName: string }[]>([]);
  const [pending, setPending] = useState<AttentionAction | null>(null);
  const [working, setWorking] = useState(false);
  const [notice, setNotice] = useState("");
  const deferredQuery = useMemo(() => ({
    search,
    severities: severity,
    categories: category,
    dispositions: view === "active" ? ["unread", "snoozed"] as AttentionDisposition[] : ["read", "acknowledged"] as AttentionDisposition[],
    projectId: projectId || null,
  }), [search, severity, category, view, projectId]);
  function refresh() {
    const controller = new AbortController();
    setState("loading");
    void fetchAttention({ endpoint, query: deferredQuery, signal: controller.signal }).then((value) => { setSnapshot(value); setState("ready"); setSelectedId((current) => value.items.some((item) => item.id === current) ? current : value.items[0]?.id ?? ""); }).catch(() => setState("offline"));
    return () => controller.abort();
  }
  useEffect(refresh, [endpoint, deferredQuery]);
  useEffect(() => {
    const controller = new AbortController();
    void listLocalProjects({ endpoint, signal: controller.signal })
      .then((value) => setProjects(value.projects.map(({ id, displayName }) => ({ id, displayName }))))
      .catch(() => setProjects([]));
    return () => controller.abort();
  }, [endpoint]);
  const selected = snapshot?.items.find((item) => item.id === selectedId) ?? snapshot?.items[0] ?? null;
  const groups = useMemo(() => severities.map((value) => [value, snapshot?.items.filter((item) => item.severity === value) ?? []] as const).filter((entry) => entry[1].length), [snapshot]);
  async function confirm() {
    if (!pending) return;
    setWorking(true);
    try {
      await previewAttentionAction(endpoint, pending);
      const result = await applyAttentionAction(endpoint, pending, `attention.${pending.itemId}.${pending.action}.${pending.expectedRevision}`);
      refresh();
      setNotice(`${readable(pending.action)} recorded locally. Receipt ${result.receipt.id.slice(-8)}.`);
      setPending(null);
    } catch (error) { setNotice(error instanceof Error ? error.message : "Attention action failed."); refresh(); }
    finally { setWorking(false); }
  }
  return <section className="space-y-4" aria-labelledby="attention-center-title">
    <Card className="overflow-hidden">
      <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div><Badge tone={snapshot?.summary.critical ? "critical" : "positive"}>{snapshot?.summary.critical ? `${snapshot.summary.critical} critical` : "No critical alerts"}</Badge><h2 id="attention-center-title" className="mt-4 text-2xl font-semibold tracking-tight">Action Center</h2><CardDescription className="mt-2 max-w-2xl">Decisions that need you, without duplicate noise.</CardDescription></div>
        <div className="flex flex-wrap gap-2"><Summary label="Unread" value={snapshot?.summary.unread ?? 0} /><Summary label="Snoozed" value={snapshot?.summary.snoozed ?? 0} /><Summary label="Suppressed" value={snapshot?.summary.suppressed ?? 0} /></div>
      </CardHeader>
      <CardContent className="mt-6">
        <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="inline-flex w-fit rounded-full bg-muted p-1" aria-label="Decision queue view">
            <Filter label="Needs you" pressed={view === "active"} toggle={() => setView("active")} />
            <Filter label="History" pressed={view === "history"} toggle={() => setView("history")} />
          </div>
          <label><span className="sr-only">Filter by project</span><select aria-label="Filter by project" value={projectId} onChange={(event) => setProjectId(event.target.value)} className="h-10 max-w-full rounded-full bg-muted px-4 text-xs font-semibold outline-none focus-visible:ring-3 focus-visible:ring-ring/30"><option value="">All projects</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.displayName}</option>)}</select></label>
        </div>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <label className="flex-1"><span className="sr-only">Search attention</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Find an alert, project, provider, or next action…" maxLength={80} className="h-11 w-full rounded-full bg-muted px-4 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/30" /></label>
          <div className="flex gap-2 overflow-x-auto" aria-label="Attention filters">{severities.map((value) => <Filter key={value} label={`${readable(value)} · ${facetCount(snapshot, "severities", value)}`} pressed={severity.includes(value)} toggle={() => setSeverity(toggle(severity, value))} />)}</div>
        </div>
        <div className="mt-3 flex gap-2 overflow-x-auto" aria-label="Attention categories">{categories.map((value) => <Filter key={value} label={`${readable(value)} · ${facetCount(snapshot, "categories", value)}`} pressed={category.includes(value)} toggle={() => setCategory(toggle(category, value))} />)}{(severity.length + category.length > 0) && <button className="shrink-0 rounded-full px-3 py-2 text-[11px] text-muted-foreground hover:bg-muted" onClick={() => { setSeverity([]); setCategory([]); }}>Clear filters</button>}</div>
      </CardContent>
    </Card>

    {notice && <div role="status" className="rounded-2xl bg-primary/[.08] px-4 py-3 text-xs">{notice}</div>}
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
      <Card><CardHeader><CardTitle>Priority lanes</CardTitle><CardDescription>Severity is evidence-based. Repeated observations update one stable item.</CardDescription></CardHeader><CardContent className="mt-5 min-h-[28rem]">
        {state === "loading" && !snapshot ? <Empty icon={<Clock />} title="Refreshing canonical attention…" detail="Current filters are applied locally by the control plane." /> : state === "offline" ? <Empty icon={<Warning />} title="Attention Center is offline" detail="Your last view is not presented as current." /> : !snapshot?.items.length ? <Empty icon={<CheckCircle />} title={search || severity.length || category.length || projectId ? "No attention matches these filters" : view === "history" ? "No resolved decisions yet" : "All clear"} detail={search || severity.length || category.length || projectId ? "Clear a filter to inspect the rest of the bounded current state." : view === "history" ? "Resolved decisions will appear here with their evidence." : "Nothing currently requires your attention."} /> : <div className="space-y-6">{groups.map(([lane, items]) => <section key={lane} aria-labelledby={`attention-${lane}`}><div className="mb-2 flex items-center justify-between"><h3 id={`attention-${lane}`} className="text-[10px] font-semibold uppercase tracking-[.16em] text-muted-foreground">{readable(lane)}</h3><span className="text-[10px] text-muted-foreground">{items.length}</span></div><div className="space-y-1">{items.map((item) => <AttentionRow key={item.id} item={item} selected={selected?.id === item.id} select={() => setSelectedId(item.id)} />)}</div></section>)}</div>}
      </CardContent></Card>
      <div className="space-y-4">
        <Card><CardHeader><CardTitle>{selected?.title ?? "Canonical details"}</CardTitle><CardDescription>{selected?.reason ?? "Select an attention item to inspect its evidence."}</CardDescription></CardHeader><CardContent className="mt-5">
          {selected ? <><div className="flex flex-wrap gap-2"><Badge>{readable(selected.category)}</Badge><Badge>{readable(selected.disposition)}</Badge>{selected.suppressed && <Badge tone="caution">Suppressed</Badge>}</div><div className="mt-5 rounded-3xl bg-muted/60 p-4"><Fact label="Next action" value={selected.nextAction} /><Fact label="Authority" value={readable(selected.authorityBoundary)} /><Fact label="Observed" value={formatDate(selected.observedAt)} /><Fact label="Repeat count" value={String(selected.repeatCount)} /><Fact label="Effect" value="Local preference only · $0" /></div><div className="mt-4 space-y-2">{selected.evidence.map((fact) => <div key={fact} className="rounded-2xl bg-muted/45 px-3 py-2 text-xs">{fact}</div>)}</div><div className="mt-5 grid grid-cols-2 gap-2"><Button onClick={() => setPending({ action: "acknowledge", itemId: selected.id, expectedRevision: selected.revision })} disabled={selected.disposition === "acknowledged"}>Acknowledge</Button><Button variant="secondary" onClick={() => setPending(selected.disposition === "snoozed" ? { action: "unsnooze", itemId: selected.id, expectedRevision: selected.revision } : { action: "snooze", itemId: selected.id, expectedRevision: selected.revision, durationMinutes: 60 })}>{selected.disposition === "snoozed" ? "Unsnooze" : "Snooze 1h"}</Button><Button variant="ghost" className="col-span-2" onClick={() => activate(selected.reference.path)}>{selected.reference.label}</Button></div></> : <Empty icon={<ShieldWarning />} title="Privacy boundary" detail="Credentials, prompts, source bodies, provider bodies, and personal paths are never included." />}
        </CardContent></Card>
        {snapshot && <QuietHoursCard endpoint={endpoint} snapshot={snapshot} update={refresh} notify={setNotice} />}
      </div>
    </div>
    {pending && <div className="fixed inset-0 z-[80] grid place-items-center bg-background/60 p-4 backdrop-blur-sm"><section role="dialog" aria-modal="true" aria-labelledby="attention-confirm-title" className="w-full max-w-md rounded-[2rem] bg-popover p-6 shadow-2xl ring-1 ring-foreground/[.07]"><Badge tone="caution">Local confirmation</Badge><h2 id="attention-confirm-title" className="mt-4 text-xl font-semibold">{readable(pending.action)} this item?</h2><p className="mt-2 text-sm leading-6 text-muted-foreground">This changes only the local attention disposition. It does not change task state, contact a provider, write externally, or spend money.</p><div className="mt-6 flex gap-2"><Button onClick={() => void confirm()} disabled={working}>{working ? "Applying…" : "Confirm"}</Button><Button variant="ghost" onClick={() => setPending(null)} disabled={working}>Cancel</Button></div></section></div>}
  </section>;
}

function QuietHoursCard({ endpoint, snapshot, update, notify }: { endpoint: string; snapshot: AttentionSnapshot; update: () => void; notify: (message: string) => void }) {
  const [value, setValue] = useState(snapshot.quietHours);
  const [working, setWorking] = useState(false);
  useEffect(() => setValue(snapshot.quietHours), [snapshot.quietHours]);
  async function save() {
    setWorking(true);
    try { await previewQuietHours(endpoint, value); const result = await updateQuietHours(endpoint, value, snapshot.revision, `attention.quiet-hours.${snapshot.revision}.${value.enabled}`); update(); notify(`Quiet hours updated. Receipt ${result.receipt.id.slice(-8)}.`); } catch (error) { notify(error instanceof Error ? error.message : "Quiet hours update failed."); } finally { setWorking(false); }
  }
  return <Card><CardHeader className="flex flex-row items-start justify-between"><div><CardTitle>Quiet hours</CardTitle><CardDescription>Non-critical delivery pauses locally. Critical alerts always bypass.</CardDescription></div><button type="button" role="switch" aria-checked={value.enabled} onClick={() => setValue({ ...value, enabled: !value.enabled })} className={cn("h-7 w-12 rounded-full bg-muted p-1", value.enabled && "bg-primary")}><span className={cn("block size-5 rounded-full bg-background transition-transform", value.enabled && "translate-x-5")} /></button></CardHeader><CardContent className="mt-5"><div className="grid grid-cols-2 gap-2"><TimeInput label="Start" value={value.startMinute} change={(startMinute) => setValue({ ...value, startMinute })} /><TimeInput label="End" value={value.endMinute} change={(endMinute) => setValue({ ...value, endMinute })} /></div><label className="mt-3 block text-[10px] uppercase tracking-wider text-muted-foreground">Timezone<input value={value.timeZone} onChange={(event) => setValue({ ...value, timeZone: event.target.value })} className="mt-1 h-10 w-full rounded-2xl bg-muted px-3 text-xs normal-case tracking-normal outline-none" /></label><div className="mt-4 flex items-center justify-between"><span className="text-[10px] text-muted-foreground">{snapshot.quietHoursActive ? `Active until ${snapshot.nextDeliveryAt ? formatDate(snapshot.nextDeliveryAt) : "next window"}` : "Delivery window open"}</span><Button size="sm" onClick={() => void save()} disabled={working}>{working ? "Saving…" : "Save"}</Button></div></CardContent></Card>;
}
function AttentionRow({ item, selected, select }: { item: AttentionItem; selected: boolean; select: () => void }) { return <button type="button" onClick={select} aria-pressed={selected} className={cn("flex w-full items-start gap-3 rounded-2xl p-3 text-left outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/30", selected && "bg-primary/[.09]")}><SeverityIcon severity={item.severity} /><span className="min-w-0 flex-1"><strong className="block truncate text-sm">{item.title}</strong><span className="mt-1 block line-clamp-2 text-xs leading-5 text-muted-foreground">{item.reason}</span><span className="mt-2 flex gap-2 text-[10px] text-muted-foreground"><span>{readable(item.category)}</span><span>·</span><span>{readable(item.disposition)}</span>{item.snoozedUntil && <><span>·</span><span>until {formatDate(item.snoozedUntil)}</span></>}</span></span>{item.suppressed && <Badge tone="caution">Quiet</Badge>}</button>; }
function SeverityIcon({ severity }: { severity: AttentionSeverity }) { const Icon = severity === "critical" || severity === "high" ? ShieldWarning : severity === "medium" ? Warning : CheckCircle; return <span className={cn("grid size-9 shrink-0 place-items-center rounded-2xl bg-muted", severity === "critical" && "bg-destructive/12 text-destructive", severity === "high" && "bg-amber-400/12 text-amber-700 dark:text-amber-300", severity === "info" && "text-emerald-700 dark:text-emerald-300")}><Icon size={18} weight="duotone" /></span>; }
function Filter({ label, pressed, toggle: onClick }: { label: string; pressed: boolean; toggle: () => void }) { return <button type="button" aria-pressed={pressed} onClick={onClick} className={cn("shrink-0 rounded-full bg-muted px-3 py-2 text-[11px] font-semibold outline-none focus-visible:ring-3 focus-visible:ring-ring/30", pressed && "bg-primary text-primary-foreground")}>{label}</button>; }
function Summary({ label, value }: { label: string; value: number }) { return <span className="min-w-20 rounded-2xl bg-muted/60 px-3 py-2 text-center"><strong className="block text-lg">{value}</strong><span className="text-[9px] uppercase tracking-wider text-muted-foreground">{label}</span></span>; }
function Fact({ label, value }: { label: string; value: string }) { return <div className="mb-3 last:mb-0"><span className="block text-[9px] uppercase tracking-wider text-muted-foreground">{label}</span><strong className="mt-1 block text-xs leading-5">{value}</strong></div>; }
function Empty({ icon, title, detail }: { icon: React.ReactNode; title: string; detail: string }) { return <div className="grid min-h-40 place-items-center p-6 text-center"><div><span className="mx-auto grid size-11 place-items-center rounded-2xl bg-primary/10 text-primary">{icon}</span><strong className="mt-3 block text-sm">{title}</strong><p className="mt-1 text-xs leading-5 text-muted-foreground">{detail}</p></div></div>; }
function TimeInput({ label, value, change }: { label: string; value: number; change: (value: number) => void }) { const text = `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`; return <label className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}<input type="time" value={text} onChange={(event) => { const [hour, minute] = event.target.value.split(":").map(Number); if (Number.isInteger(hour) && Number.isInteger(minute)) change((hour ?? 0) * 60 + (minute ?? 0)); }} className="mt-1 h-10 w-full rounded-2xl bg-muted px-3 text-xs normal-case tracking-normal outline-none" /></label>; }
function facetCount(snapshot: AttentionSnapshot | null, key: "severities" | "categories", value: string) { return snapshot?.facets[key].find((item) => item.value === value)?.count ?? 0; }
function toggle<T>(values: T[], value: T) { return values.includes(value) ? values.filter((entry) => entry !== value) : [...values, value]; }
function readable(value: string) { return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase()); }
function formatDate(value: number) { return new Date(value).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }); }
