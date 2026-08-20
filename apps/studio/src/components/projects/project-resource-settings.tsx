import { ArrowClockwise } from "@phosphor-icons/react/ArrowClockwise";
import { CaretDown } from "@phosphor-icons/react/CaretDown";
import { Check } from "@phosphor-icons/react/Check";
import { Cloud } from "@phosphor-icons/react/Cloud";
import { Code } from "@phosphor-icons/react/Code";
import { Database } from "@phosphor-icons/react/Database";
import { HardDrives } from "@phosphor-icons/react/HardDrives";
import { MagnifyingGlass } from "@phosphor-icons/react/MagnifyingGlass";
import { PlugsConnected } from "@phosphor-icons/react/PlugsConnected";
import { useCallback, useEffect, useMemo, useState, type ComponentType } from "react";

import type { PublicIntegrationConnectionCollection } from "../../../../../packages/runtime/src/integration-connections.js";
import type { LocalProjectSnapshot, ProjectResourceSelection } from "../../../../../packages/runtime/src/local-projects.js";
import { listIntegrationConnections } from "../../integration-connection-client.js";
import { listLocalProjects, setLocalProjectResources } from "../../local-project-client.js";
import { Button } from "../ui/button.js";

type Resource = ProjectResourceSelection["resources"][number];
type Icon = ComponentType<{ size?: number; className?: string }>;
const kindMap = { github_repository: "github_repository", jira_project: "jira_project", telegram_chat: "telegram_chat", slack_channel: "slack_channel", discord_channel: "discord_channel", google_calendar: "google_calendar", cloudflare_account: "cloudflare_account", gcloud_project: "gcloud_project", aws_account: "aws_account" } as const;
const notificationKinds: readonly Resource["kind"][] = ["slack_channel", "discord_channel", "telegram_chat"];
const slots: readonly { id: string; label: string; note: string; icon: Icon; kinds: readonly Resource["kind"][]; multiple?: boolean }[] = [
  { id: "code", label: "Code repository", note: "The primary repository Codkesh works in", icon: Code, kinds: ["github_repository"] },
  { id: "planning", label: "Jira project", note: "Planning, delivery status, and evidence", icon: PlugsConnected, kinds: ["jira_project"] },
  { id: "notifications", label: "Notifications", note: "Channels for approvals and updates", icon: PlugsConnected, kinds: notificationKinds, multiple: true },
  { id: "deployment", label: "Deployment", note: "Where this project can be hosted", icon: Cloud, kinds: ["cloudflare_account", "gcloud_project", "aws_account", "vercel_project"] },
  { id: "database", label: "Database", note: "A dedicated application database", icon: Database, kinds: ["supabase_project", "cockroach_database"] },
  { id: "storage", label: "Object storage", note: "A bucket for files and generated assets", icon: HardDrives, kinds: ["cloudflare_r2_bucket", "gcloud_storage_bucket", "aws_s3_bucket"] },
];

export function ProjectResourceSettings(props: { endpoint: string; projectId: string }) {
  const [project, setProject] = useState<LocalProjectSnapshot | null>(null);
  const [connections, setConnections] = useState<PublicIntegrationConnectionCollection | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [state, setState] = useState<"loading" | "ready" | "saving" | "offline">("loading");
  const [notice, setNotice] = useState("");
  const refresh = useCallback(async () => {
    setState("loading");
    try {
      const [projects, discovered] = await Promise.all([listLocalProjects({ endpoint: props.endpoint }), listIntegrationConnections({ endpoint: props.endpoint })]);
      const current = projects.projects.find((item) => item.id === props.projectId) ?? null;
      setProject(current); setConnections(discovered); setSelected(new Set((current?.resources ?? []).map(resourceKey))); setState("ready"); setNotice("");
    } catch { setState("offline"); setNotice("Project resources are temporarily unavailable."); }
  }, [props.endpoint, props.projectId]);
  useEffect(() => { void refresh(); }, [refresh]);
  const choices = useMemo(() => {
    const items: Resource[] = [];
    for (const connection of connections?.connections ?? []) {
      if (connection.state !== "ready") continue;
      for (const resource of connection.resources) {
        const kind = kindMap[resource.kind as keyof typeof kindMap]; if (!kind) continue;
        items.push({ kind, connectionId: `${connection.provider}:${connection.accountLabel ?? "account"}`, resourceId: resource.id, label: resource.label, url: resource.url, role: notificationKinds.includes(kind) ? "notifications" : "primary" });
      }
    }
    for (const bound of project?.resources ?? []) {
      const item = { kind: bound.kind, connectionId: bound.connectionId, resourceId: bound.resourceId, label: bound.label, url: bound.url, role: bound.role };
      if (!items.some((candidate) => resourceKey(candidate) === resourceKey(item))) items.push(item);
    }
    return items;
  }, [connections, project]);
  const select = (slot: typeof slots[number], nextKeys: readonly string[]) => setSelected((current) => {
    const next = new Set(current); for (const choice of choices) if (slot.kinds.includes(choice.kind)) next.delete(resourceKey(choice)); for (const key of nextKeys) next.add(key); return next;
  });
  const save = async () => {
    if (!project) return; setState("saving");
    try {
      await setLocalProjectResources({ endpoint: props.endpoint, projectId: project.id, selection: { schemaVersion: 1, expectedRevision: project.resourceRevision ?? 0, resources: choices.filter((resource) => selected.has(resourceKey(resource))) }, idempotencyKey: `project-settings:${crypto.randomUUID()}` });
      setNotice("Project settings saved."); await refresh();
    } catch (error) { setState("ready"); setNotice(error instanceof Error ? error.message : "Project settings could not be saved."); }
  };
  if (state === "loading") return <p className="py-8 text-sm text-muted-foreground">Loading project settings…</p>;
  if (state === "offline" || !project) return <div className="rounded-2xl bg-amber-500/10 p-4 text-sm">{notice || "Project not found."}</div>;
  return <section className="space-y-6" aria-labelledby="project-settings-title">
    <div className="flex items-start justify-between gap-3"><div><h2 id="project-settings-title" className="text-lg font-semibold">Project setup</h2><p className="mt-1 text-sm text-muted-foreground">One resource per role. Notification channels can be multiple.</p></div><Button variant="ghost" size="icon" onClick={() => void refresh()} aria-label="Refresh project resources"><ArrowClockwise /></Button></div>
    <div className="grid gap-3 lg:grid-cols-2">{slots.map((slot) => <ResourcePicker key={slot.id} slot={slot} choices={choices.filter((choice) => slot.kinds.includes(choice.kind))} selected={choices.filter((choice) => slot.kinds.includes(choice.kind) && selected.has(resourceKey(choice))).map(resourceKey)} onChange={(keys) => select(slot, keys)} />)}</div>
    <div className="flex items-center justify-between gap-3 pt-2"><p className="text-xs text-muted-foreground" aria-live="polite">{notice}</p><Button onClick={() => void save()} disabled={state === "saving"}>{state === "saving" ? "Saving…" : "Save changes"}</Button></div>
  </section>;
}

function ResourcePicker({ slot, choices, selected, onChange }: { slot: typeof slots[number]; choices: readonly Resource[]; selected: readonly string[]; onChange: (keys: readonly string[]) => void }) {
  const [open, setOpen] = useState(false); const [query, setQuery] = useState("");
  const visible = choices.filter((choice) => choice.label.toLowerCase().includes(query.trim().toLowerCase()));
  const selectedResources = choices.filter((choice) => selected.includes(resourceKey(choice)));
  const summary = selectedResources.length === 0 ? "Not selected" : slot.multiple ? `${selectedResources.length} selected` : selectedResources[0]?.label ?? "Selected";
  return <div className="relative rounded-3xl bg-muted/45 p-4 transition-[transform,background-color,box-shadow] duration-200 hover:-translate-y-0.5 hover:bg-muted/60 hover:shadow-lg hover:shadow-black/5">
    <div className="flex items-start gap-3"><span className="grid size-9 shrink-0 place-items-center rounded-xl bg-background text-primary"><slot.icon size={18} /></span><div className="min-w-0 flex-1"><strong className="block text-sm">{slot.label}</strong><span className="mt-0.5 block text-xs text-muted-foreground">{slot.note}</span></div></div>
    <button type="button" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((value) => !value)} className="mt-4 flex h-11 w-full items-center justify-between gap-3 rounded-2xl bg-background/80 px-4 text-left text-sm outline-none transition-all duration-200 hover:bg-background hover:shadow-sm focus-visible:ring-3 focus-visible:ring-ring/30"><span className={selectedResources.length ? "truncate" : "truncate text-muted-foreground"}>{summary}</span><CaretDown className={`shrink-0 transition-transform duration-200 ${open ? "rotate-180" : ""}`} /></button>
    {open && <div className="absolute inset-x-4 top-[calc(100%-0.5rem)] z-30 overflow-hidden rounded-2xl bg-popover p-2 shadow-2xl animate-in fade-in zoom-in-95 slide-in-from-top-2">
      <label className="flex h-10 items-center gap-2 rounded-xl bg-muted/70 px-3"><MagnifyingGlass className="text-muted-foreground" /><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search…" className="min-w-0 flex-1 bg-transparent text-sm outline-none" /></label>
      <div role="listbox" aria-multiselectable={slot.multiple || undefined} className="mt-2 max-h-56 overflow-y-auto">{visible.map((choice) => { const key = resourceKey(choice); const active = selected.includes(key); return <button key={key} type="button" role="option" aria-selected={active} onClick={() => { onChange(slot.multiple ? active ? selected.filter((item) => item !== key) : [...selected, key] : active ? [] : [key]); if (!slot.multiple) setOpen(false); }} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"><span className={`grid size-5 place-items-center rounded-full ${active ? "bg-primary text-primary-foreground" : "bg-muted"}`}>{active && <Check size={12} weight="bold" />}</span><span className="truncate">{choice.label}</span></button>; })}{visible.length === 0 && <div className="px-3 py-5 text-center"><p className="text-sm">No resources found</p><p className="mt-1 text-xs text-muted-foreground">Connect one in global Settings.</p></div>}</div>
    </div>}
  </div>;
}
function resourceKey(resource: Pick<Resource, "kind" | "resourceId">) { return `${resource.kind}:${resource.resourceId}`; }
