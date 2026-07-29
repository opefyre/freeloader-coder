import { ArrowRight } from "@phosphor-icons/react/ArrowRight";
import { ChatCircleDots } from "@phosphor-icons/react/ChatCircleDots";
import { Clock } from "@phosphor-icons/react/Clock";
import { FolderOpen } from "@phosphor-icons/react/FolderOpen";
import { Gear } from "@phosphor-icons/react/Gear";
import { ListChecks } from "@phosphor-icons/react/ListChecks";
import { MagnifyingGlass } from "@phosphor-icons/react/MagnifyingGlass";
import { PlugsConnected } from "@phosphor-icons/react/PlugsConnected";
import { Pulse } from "@phosphor-icons/react/Pulse";
import { ShieldCheck } from "@phosphor-icons/react/ShieldCheck";
import { Sparkle } from "@phosphor-icons/react/Sparkle";
import { Warning } from "@phosphor-icons/react/Warning";
import { X } from "@phosphor-icons/react/X";
import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";

import type { SearchResult, SearchScope, UniversalSearchSnapshot } from "../../../../../packages/runtime/src/universal-search.js";
import { fetchUniversalSearch } from "../../search-client.js";
import { cn } from "../../lib/utils.js";
import { Badge } from "../ui/badge.js";
import { Button } from "../ui/button.js";

const scopes: readonly SearchScope[] = ["workspace", "request", "decision", "attention", "activity", "project", "provider", "evidence", "settings"];

export function GlobalCommandCenter({
  endpoint,
  close,
  activate,
}: {
  endpoint: string;
  close: () => void;
  activate: (path: string) => void;
}) {
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [activeScopes, setActiveScopes] = useState<SearchScope[]>([]);
  const [snapshot, setSnapshot] = useState<UniversalSearchSnapshot | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "offline">("loading");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const previousFocus = useRef<HTMLElement | null>(document.activeElement as HTMLElement | null);

  useEffect(() => {
    inputRef.current?.focus();
    return () => previousFocus.current?.focus();
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    setState("loading");
    void fetchUniversalSearch({ endpoint, query: { query: deferredQuery, scopes: activeScopes, limit: 32 }, signal: controller.signal })
      .then((next) => { setSnapshot(next); setState("ready"); setActiveIndex(0); })
      .catch(() => { if (!controller.signal.aborted) setState("offline"); });
    return () => controller.abort();
  }, [activeScopes, deferredQuery, endpoint]);

  const results = snapshot?.results ?? [];
  const selected = results[activeIndex] ?? null;
  const groups = useMemo(() => groupResults(results), [results]);
  const listboxId = "global-command-results";

  function toggleScope(scope: SearchScope) {
    setActiveScopes((current) => current.includes(scope) ? current.filter((item) => item !== scope) : [...current, scope]);
  }
  function select(index: number) {
    const result = results[index];
    if (result) activate(result.reference.path);
  }
  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") { event.preventDefault(); setActiveIndex((current) => results.length ? (current + 1) % results.length : 0); }
    else if (event.key === "ArrowUp") { event.preventDefault(); setActiveIndex((current) => results.length ? (current - 1 + results.length) % results.length : 0); }
    else if (event.key === "Home") { event.preventDefault(); setActiveIndex(0); }
    else if (event.key === "End") { event.preventDefault(); setActiveIndex(Math.max(0, results.length - 1)); }
    else if (event.key === "Enter" && selected) { event.preventDefault(); activate(selected.reference.path); }
    else if (event.key === "Escape") { event.preventDefault(); close(); }
  }

  return (
    <div className="fixed inset-0 z-[70] grid place-items-start overflow-y-auto bg-background/58 px-3 py-[7vh] backdrop-blur-xl sm:px-6 sm:py-[10vh]">
      <button type="button" className="absolute inset-0 cursor-default" aria-label="Close command center" onClick={close} />
      <section role="dialog" aria-modal="true" aria-labelledby="command-center-title" className="relative mx-auto w-full max-w-4xl overflow-hidden rounded-[2rem] bg-popover/96 shadow-2xl ring-1 ring-foreground/[.07]">
        <div className="flex items-center gap-3 px-5 py-4 sm:px-6">
          <MagnifyingGlass className="shrink-0 text-primary" size={21} />
          <label className="min-w-0 flex-1">
            <span id="command-center-title" className="sr-only">Universal command center</span>
            <input
              ref={inputRef}
              role="combobox"
              aria-expanded="true"
              aria-controls={listboxId}
              aria-autocomplete="list"
              aria-activedescendant={selected ? `command-result-${selected.id}` : undefined}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={onKeyDown}
              maxLength={80}
              placeholder="Find work, decisions, activity, providers, or any Studio page…"
              className="w-full bg-transparent text-base outline-none placeholder:text-muted-foreground"
            />
          </label>
          {query && <Button variant="ghost" size="icon" aria-label="Clear search" onClick={() => setQuery("")}><X /></Button>}
          <kbd className="hidden rounded-xl bg-muted px-2.5 py-1.5 text-[10px] font-semibold text-muted-foreground sm:block">ESC</kbd>
        </div>

        <div className="flex gap-2 overflow-x-auto bg-muted/35 px-5 py-3 sm:px-6" aria-label="Search scopes">
          {scopes.map((scope) => <button key={scope} type="button" aria-pressed={activeScopes.includes(scope)} onClick={() => toggleScope(scope)} className={cn("shrink-0 rounded-full bg-background/70 px-3 py-2 text-[11px] font-semibold outline-none focus-visible:ring-3 focus-visible:ring-ring/30", activeScopes.includes(scope) && "bg-primary text-primary-foreground")}>{readable(scope)} · {scopeCount(snapshot, scope)}</button>)}
          {activeScopes.length > 0 && <button type="button" onClick={() => setActiveScopes([])} className="shrink-0 rounded-full px-3 py-2 text-[11px] font-semibold text-muted-foreground hover:bg-background">Clear scopes</button>}
        </div>

        <div className="grid min-h-[25rem] lg:grid-cols-[minmax(0,1fr)_18rem]">
          <div id={listboxId} role="listbox" aria-label="Search results" className="max-h-[32rem] overflow-y-auto p-3 sm:p-4">
            {state === "loading" && results.length === 0 ? <Status icon={<Sparkle />} title="Searching canonical local state…" detail="Superseded searches are cancelled automatically." /> :
             state === "offline" ? <Status icon={<Warning />} title="Live search is unavailable" detail="Start the local control plane. No sample results are substituted." /> :
             results.length === 0 ? <Status icon={<MagnifyingGlass />} title={query ? "No canonical result matches" : "No destination is available"} detail={query ? "Try fewer words or clear a scope. Search does not invent approximate results." : "The local workspace registry is unavailable."} /> :
             <div className="space-y-5">{groups.map(([scope, entries]) => <section key={scope} aria-labelledby={`command-group-${scope}`}><div className="mb-2 flex items-center justify-between px-2"><h3 id={`command-group-${scope}`} className="text-[10px] font-semibold uppercase tracking-[.16em] text-muted-foreground">{readable(scope)}</h3><span className="text-[10px] text-muted-foreground">{entries.length}</span></div><div className="space-y-1">{entries.map(({ result, index }) => <ResultRow key={result.id} result={result} active={index === activeIndex} onHover={() => setActiveIndex(index)} onActivate={() => select(index)} />)}</div></section>)}</div>}
          </div>

          <aside className="hidden bg-muted/32 p-5 lg:block">
            {selected ? <><div className="flex flex-wrap gap-2"><Badge>{readable(selected.scope)}</Badge><Badge>{readable(selected.matchReason)}</Badge></div><strong className="mt-5 block text-sm">{selected.title}</strong><p className="mt-2 text-xs leading-5 text-muted-foreground">{selected.subtitle}</p><div className="mt-5 rounded-3xl bg-background/70 p-4"><Fact label="Canonical state" value={readable(selected.state)} /><Fact label="Source reference" value={selected.sourceRecordId.slice(-18)} /><Fact label="Observed" value={selected.observedAt ? formatDateTime(selected.observedAt) : "Workspace registry"} /><Fact label="Effect" value="Navigation only" /></div><div className="mt-4 rounded-3xl bg-primary/[.07] p-4"><strong className="text-xs">Privacy boundary</strong><p className="mt-1 text-xs leading-5 text-muted-foreground">No credentials, prompts, source bodies, personal paths, or provider bodies are indexed.</p></div></> : <Status icon={<ShieldCheck />} title="Safe navigation only" detail="Commands cannot mutate work, call providers, write externally, or enable paid use." compact />}
          </aside>
        </div>

        <footer className="flex flex-col gap-2 bg-muted/35 px-5 py-3 text-[10px] text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <span aria-live="polite">{state === "ready" && snapshot ? `${snapshot.summary.returned} of ${snapshot.summary.matched} bounded results${snapshot.summary.truncated ? " · refined by limit" : ""}` : state === "loading" ? "Searching…" : "Search unavailable"}</span>
          <span>↑↓ Navigate · Enter Open · Esc Close · $0 automatic spend</span>
        </footer>
      </section>
    </div>
  );
}

function ResultRow({ result, active, onHover, onActivate }: { result: SearchResult; active: boolean; onHover: () => void; onActivate: () => void }) {
  const Icon = iconFor(result.scope);
  return <button id={`command-result-${result.id}`} role="option" aria-selected={active} type="button" onMouseEnter={onHover} onFocus={onHover} onClick={onActivate} className={cn("flex w-full items-center gap-3 rounded-2xl p-3 text-left outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/30", active && "bg-primary/[.09]")}><span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-muted text-primary"><Icon size={19} weight="duotone" /></span><span className="min-w-0 flex-1"><strong className="block truncate text-sm">{result.title}</strong><span className="mt-0.5 block truncate text-xs text-muted-foreground">{result.subtitle}</span></span><span className="hidden text-[10px] text-muted-foreground sm:block">{result.observedAt ? relativeAge(result.observedAt) : readable(result.state)}</span><ArrowRight className="shrink-0 text-muted-foreground" /></button>;
}
function Status({ icon, title, detail, compact = false }: { icon: React.ReactNode; title: string; detail: string; compact?: boolean }) { return <div className={cn("grid place-items-center px-6 text-center", compact ? "min-h-52" : "min-h-[22rem]")}><div><span className="mx-auto grid size-12 place-items-center rounded-2xl bg-primary/10 text-primary">{icon}</span><strong className="mt-4 block text-sm">{title}</strong><p className="mt-2 max-w-sm text-xs leading-5 text-muted-foreground">{detail}</p></div></div>; }
function Fact({ label, value }: { label: string; value: string }) { return <div className="mb-3 last:mb-0"><span className="block text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span><strong className="mt-1 block text-xs">{value}</strong></div>; }
function groupResults(results: readonly SearchResult[]): [SearchScope, { result: SearchResult; index: number }[]][] { const groups = new Map<SearchScope, { result: SearchResult; index: number }[]>(); results.forEach((result, index) => groups.set(result.scope, [...(groups.get(result.scope) ?? []), { result, index }])); return [...groups]; }
function scopeCount(snapshot: UniversalSearchSnapshot | null, scope: SearchScope): number { return snapshot?.summary.scopes.find((item) => item.value === scope)?.count ?? 0; }
function iconFor(scope: SearchScope) { return scope === "request" ? ListChecks : scope === "decision" || scope === "attention" ? ChatCircleDots : scope === "activity" ? Pulse : scope === "project" ? FolderOpen : scope === "provider" ? PlugsConnected : scope === "evidence" ? ShieldCheck : scope === "settings" ? Gear : Sparkle; }
function readable(value: string): string { return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase()); }
function relativeAge(value: number): string { const minutes = Math.max(0, Math.floor((Date.now() - value) / 60_000)); return minutes < 1 ? "now" : minutes < 60 ? `${minutes}m` : minutes < 1_440 ? `${Math.floor(minutes / 60)}h` : `${Math.floor(minutes / 1_440)}d`; }
function formatDateTime(value: number): string { return new Date(value).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }); }
