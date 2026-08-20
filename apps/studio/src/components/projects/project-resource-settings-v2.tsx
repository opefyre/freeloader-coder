import { Dialog } from "@base-ui/react/dialog";
import { ArrowClockwise } from "@phosphor-icons/react/ArrowClockwise";
import { Bell } from "@phosphor-icons/react/Bell";
import { CaretRight } from "@phosphor-icons/react/CaretRight";
import { Check } from "@phosphor-icons/react/Check";
import { Cloud } from "@phosphor-icons/react/Cloud";
import { Code } from "@phosphor-icons/react/Code";
import { Database } from "@phosphor-icons/react/Database";
import { DiscordLogo } from "@phosphor-icons/react/DiscordLogo";
import { GithubLogo } from "@phosphor-icons/react/GithubLogo";
import { HardDrives } from "@phosphor-icons/react/HardDrives";
import { MagnifyingGlass } from "@phosphor-icons/react/MagnifyingGlass";
import { PlugsConnected } from "@phosphor-icons/react/PlugsConnected";
import { SlackLogo } from "@phosphor-icons/react/SlackLogo";
import { TelegramLogo } from "@phosphor-icons/react/TelegramLogo";
import { X } from "@phosphor-icons/react/X";
import { useCallback, useEffect, useMemo, useState, type ComponentType, type ReactNode } from "react";

import type { PublicIntegrationConnectionCollection } from "../../../../../packages/runtime/src/integration-connections.js";
import type { LocalProjectSnapshot, ProjectResourceSelection } from "../../../../../packages/runtime/src/local-projects.js";
import { listIntegrationConnections, probeJiraConnection } from "../../integration-connection-client.js";
import { listLocalProjects, setLocalProjectResources } from "../../local-project-client.js";
import { Button } from "../ui/button.js";

type Resource = ProjectResourceSelection["resources"][number];
type ResourceKind = Resource["kind"];
type Icon = ComponentType<{ size?: number; className?: string; weight?: "regular" | "fill" | "duotone" }>;
type Slot = { id: string; label: string; note: string; icon: Icon; kinds: readonly ResourceKind[]; multiple?: boolean; group: "workspace" | "notifications" | "infrastructure" };

const kindMap: Partial<Record<string, ResourceKind>> = {
  github_repository: "github_repository", jira_project: "jira_project",
  telegram_chat: "telegram_chat", slack_channel: "slack_channel", discord_channel: "discord_channel",
  google_calendar: "google_calendar", cloudflare_account: "cloudflare_account", gcloud_project: "gcloud_project",
  aws_account: "aws_account", vercel_team: "vercel_project", cloudflare_r2_bucket: "cloudflare_r2_bucket",
  gcloud_storage_bucket: "gcloud_storage_bucket", aws_s3_bucket: "aws_s3_bucket",
};
const notificationKinds: readonly ResourceKind[] = ["slack_channel", "discord_channel", "telegram_chat"];
const slots: readonly Slot[] = [
  { id: "code", label: "Code", note: "One GitHub repository", icon: Code, kinds: ["github_repository"], group: "workspace" },
  { id: "planning", label: "Planning", note: "One Jira project", icon: PlugsConnected, kinds: ["jira_project"], group: "workspace" },
  { id: "notifications", label: "Notifications", note: "Slack, Discord, and Telegram", icon: Bell, kinds: notificationKinds, multiple: true, group: "notifications" },
  { id: "deployment", label: "Hosting", note: "Account or team used for deployment", icon: Cloud, kinds: ["cloudflare_account", "gcloud_project", "aws_account", "vercel_project"], group: "infrastructure" },
  { id: "database", label: "Database", note: "Dedicated application database", icon: Database, kinds: ["supabase_project", "cockroach_database"], group: "infrastructure" },
  { id: "storage", label: "Storage", note: "Bucket for project files and assets", icon: HardDrives, kinds: ["cloudflare_r2_bucket", "gcloud_storage_bucket", "aws_s3_bucket"], group: "infrastructure" },
];
const providerMeta = {
  slack: { label: "Slack", icon: SlackLogo }, discord: { label: "Discord", icon: DiscordLogo }, telegram: { label: "Telegram", icon: TelegramLogo },
  github: { label: "GitHub", icon: GithubLogo }, jira: { label: "Jira", icon: PlugsConnected }, cloudflare: { label: "Cloudflare", icon: Cloud },
  gcloud: { label: "Google Cloud", icon: Cloud }, aws: { label: "AWS", icon: Cloud }, vercel: { label: "Vercel", icon: Cloud },
} as const;

export function ProjectResourceSettings(props: { endpoint: string; projectId: string }) {
  const [project, setProject] = useState<LocalProjectSnapshot | null>(null);
  const [connections, setConnections] = useState<PublicIntegrationConnectionCollection | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [state, setState] = useState<"loading" | "ready" | "saving" | "offline">("loading");
  const [notice, setNotice] = useState("");
  const refresh = useCallback(async () => {
    setState("loading");
    try {
      const [projects, discovered] = await Promise.all([
        listLocalProjects({ endpoint: props.endpoint }),
        probeJiraConnection({ endpoint: props.endpoint, idempotencyKey: `jira-project-refresh:${crypto.randomUUID()}` })
          .catch(() => listIntegrationConnections({ endpoint: props.endpoint })),
      ]);
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
        const kind = kindMap[resource.kind]; if (!kind) continue;
        items.push({ kind, connectionId: `${connection.provider}:${connection.accountLabel ?? "account"}`, resourceId: resource.id, label: resource.label, url: resource.url, role: notificationKinds.includes(kind) ? "notifications" : "primary" });
      }
    }
    for (const bound of project?.resources ?? []) if (!items.some((candidate) => resourceKey(candidate) === resourceKey(bound))) items.push({ kind: bound.kind, connectionId: bound.connectionId, resourceId: bound.resourceId, label: bound.label, url: bound.url, role: bound.role });
    return items;
  }, [connections, project]);
  const select = (slot: Slot, nextKeys: readonly string[]) => setSelected((current) => {
    const next = new Set(current); for (const choice of choices) if (slot.kinds.includes(choice.kind)) next.delete(resourceKey(choice)); for (const key of nextKeys) next.add(key); return next;
  });
  const save = async () => {
    if (!project) return; setState("saving");
    try {
      await setLocalProjectResources({ endpoint: props.endpoint, projectId: project.id, selection: { schemaVersion: 1, expectedRevision: project.resourceRevision ?? 0, resources: choices.filter((resource) => selected.has(resourceKey(resource))) }, idempotencyKey: `project-settings:${crypto.randomUUID()}` });
      setNotice("Saved"); await refresh();
    } catch (error) { setState("ready"); setNotice(error instanceof Error ? error.message : "Could not save changes."); }
  };
  if (state === "loading") return <ProjectSettingsSkeleton />;
  if (state === "offline" || !project) return <div className="rounded-2xl bg-amber-500/10 p-4 text-sm">{notice || "Project not found."}</div>;
  const statuses = new Map((connections?.connections ?? []).map((connection) => [connection.provider, connection.state]));
  return <section className="mx-auto max-w-5xl space-y-8" aria-labelledby="project-settings-title">
    <header className="flex items-start justify-between gap-3"><div><h2 id="project-settings-title" className="text-xl font-semibold tracking-tight">Project resources</h2><p className="mt-1 text-sm text-muted-foreground">Choose what this project can use.</p></div><Button variant="ghost" size="icon" onClick={() => void refresh()} aria-label="Refresh project resources"><ArrowClockwise /></Button></header>
    <ResourceSection title="Workspace" note="Core project sources"><div className="grid gap-2 sm:grid-cols-2">{slots.filter((slot) => slot.group === "workspace").map((slot) => <ResourcePicker key={slot.id} slot={slot} choices={choices.filter((choice) => slot.kinds.includes(choice.kind))} selected={choices.filter((choice) => slot.kinds.includes(choice.kind) && selected.has(resourceKey(choice))).map(resourceKey)} statuses={statuses} onChange={(keys) => select(slot, keys)} />)}</div></ResourceSection>
    <ResourceSection title="Notifications" note="Choose any combination">{slots.filter((slot) => slot.group === "notifications").map((slot) => <ResourcePicker key={slot.id} slot={slot} choices={choices.filter((choice) => slot.kinds.includes(choice.kind))} selected={choices.filter((choice) => slot.kinds.includes(choice.kind) && selected.has(resourceKey(choice))).map(resourceKey)} statuses={statuses} onChange={(keys) => select(slot, keys)} />)}</ResourceSection>
    <ResourceSection title="Infrastructure" note="Optional until the design is approved"><div className="grid gap-2 md:grid-cols-3">{slots.filter((slot) => slot.group === "infrastructure").map((slot) => <ResourcePicker key={slot.id} slot={slot} choices={choices.filter((choice) => slot.kinds.includes(choice.kind))} selected={choices.filter((choice) => slot.kinds.includes(choice.kind) && selected.has(resourceKey(choice))).map(resourceKey)} statuses={statuses} onChange={(keys) => select(slot, keys)} />)}</div></ResourceSection>
    <footer className="sticky bottom-3 z-10 flex items-center justify-between gap-3 rounded-2xl bg-card/90 p-3 shadow-xl shadow-black/10 backdrop-blur-xl"><p className="px-2 text-xs text-muted-foreground" aria-live="polite">{notice}</p><Button onClick={() => void save()} disabled={state === "saving"}>{state === "saving" ? "Saving…" : "Save changes"}</Button></footer>
  </section>;
}

function ResourceSection({ title, note, children }: { title: string; note: string; children: ReactNode }) { return <section><div className="mb-3 flex items-baseline gap-2"><h3 className="text-sm font-semibold">{title}</h3><span className="text-xs text-muted-foreground">{note}</span></div>{children}</section>; }

function ResourcePicker({ slot, choices, selected, statuses, onChange }: { slot: Slot; choices: readonly Resource[]; selected: readonly string[]; statuses: ReadonlyMap<string, string>; onChange: (keys: readonly string[]) => void }) {
  const [open, setOpen] = useState(false); const [query, setQuery] = useState(""); const [provider, setProvider] = useState<string>("all");
  const selectedResources = choices.filter((choice) => selected.includes(resourceKey(choice)));
  const providerFor = (choice: Resource) => choice.connectionId.split(":", 1)[0] ?? "other";
  const applicableProviders = slot.id === "notifications" ? ["slack", "discord", "telegram"] : Array.from(new Set(choices.map(providerFor)));
  const visible = choices.filter((choice) => (provider === "all" || providerFor(choice) === provider) && `${choice.label} ${providerFor(choice)}`.toLowerCase().includes(query.trim().toLowerCase()));
  return <><button type="button" onClick={() => setOpen(true)} className="group flex min-h-24 w-full items-center gap-4 rounded-3xl bg-muted/45 p-4 text-left outline-none transition duration-200 hover:-translate-y-0.5 hover:bg-muted/70 hover:shadow-lg hover:shadow-black/5 focus-visible:ring-3 focus-visible:ring-ring/30">
    <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-background text-primary transition-transform duration-200 group-hover:scale-105"><slot.icon size={21} weight="duotone" /></span>
    <span className="min-w-0 flex-1"><strong className="block text-sm">{slot.label}</strong>{selectedResources.length ? <span className="mt-1 flex flex-wrap gap-1.5">{selectedResources.slice(0, 3).map((resource) => <span key={resourceKey(resource)} className="max-w-44 truncate rounded-full bg-background/80 px-2.5 py-1 text-xs">{resource.label}</span>)}{selectedResources.length > 3 && <span className="rounded-full bg-background/80 px-2.5 py-1 text-xs">+{selectedResources.length - 3}</span>}</span> : <span className="mt-1 block text-xs text-muted-foreground">{slot.note}</span>}</span><CaretRight className="shrink-0 text-muted-foreground transition-transform duration-200 group-hover:translate-x-0.5" />
  </button><Dialog.Root open={open} onOpenChange={setOpen}><Dialog.Portal><Dialog.Backdrop className="fixed inset-0 z-50 bg-background/75 backdrop-blur-md transition-opacity data-[ending-style]:opacity-0 data-[starting-style]:opacity-0" /><Dialog.Popup className="fixed inset-x-3 bottom-3 z-50 max-h-[88vh] overflow-hidden rounded-[1.75rem] bg-card shadow-2xl outline-none transition duration-200 data-[ending-style]:translate-y-4 data-[ending-style]:opacity-0 data-[starting-style]:translate-y-4 data-[starting-style]:opacity-0 sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:w-[min(42rem,calc(100vw-2rem))] sm:-translate-x-1/2 sm:-translate-y-1/2">
    <header className="flex items-start justify-between gap-4 px-5 pb-3 pt-5 sm:px-6"><div><Dialog.Title className="text-xl font-semibold tracking-tight">Choose {slot.label.toLowerCase()}</Dialog.Title><Dialog.Description className="mt-1 text-sm text-muted-foreground">{slot.multiple ? "Select as many as you need." : "Select one resource for this project."}</Dialog.Description></div><Dialog.Close className="grid size-9 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground outline-none transition hover:bg-foreground hover:text-background focus-visible:ring-3 focus-visible:ring-ring/30" aria-label="Close"><X /></Dialog.Close></header>
    {applicableProviders.length > 1 && <div className="flex gap-1 overflow-x-auto px-5 py-2 sm:px-6"><ProviderFilter active={provider === "all"} onClick={() => setProvider("all")}>All</ProviderFilter>{applicableProviders.map((id) => { const meta = providerMeta[id as keyof typeof providerMeta]; const ProviderIcon = meta?.icon ?? PlugsConnected; const status = statuses.get(id); return <ProviderFilter key={id} active={provider === id} onClick={() => setProvider(id)}><ProviderIcon />{meta?.label ?? id}<span className={`size-1.5 rounded-full ${status === "ready" ? "bg-emerald-400" : "bg-amber-400"}`} /></ProviderFilter>; })}</div>}
    <div className="px-5 pb-3 pt-2 sm:px-6"><label className="flex h-11 items-center gap-3 rounded-2xl bg-muted/70 px-4"><MagnifyingGlass className="text-muted-foreground" /><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder={`Search ${slot.label.toLowerCase()}…`} className="min-w-0 flex-1 bg-transparent text-sm outline-none" /></label></div>
    <div role="listbox" aria-multiselectable={slot.multiple || undefined} className="max-h-[48vh] overflow-y-auto px-3 pb-3 sm:px-4">{visible.map((choice) => { const key = resourceKey(choice); const active = selected.includes(key); const meta = providerMeta[providerFor(choice) as keyof typeof providerMeta]; const ProviderIcon = meta?.icon ?? PlugsConnected; return <button key={key} type="button" role="option" aria-selected={active} onClick={() => { onChange(slot.multiple ? active ? selected.filter((item) => item !== key) : [...selected, key] : [key]); if (!slot.multiple) setOpen(false); }} className="flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left text-sm outline-none transition hover:bg-muted focus-visible:bg-muted"><span className="grid size-9 shrink-0 place-items-center rounded-xl bg-muted"><ProviderIcon size={18} /></span><span className="min-w-0 flex-1"><strong className="block truncate font-medium">{choice.label}</strong><span className="mt-0.5 block text-xs text-muted-foreground">{meta?.label ?? providerFor(choice)}</span></span><span className={`grid size-6 shrink-0 place-items-center rounded-full transition ${active ? "bg-primary text-primary-foreground" : "bg-muted text-transparent"}`}><Check size={13} weight="bold" /></span></button>; })}{visible.length === 0 && <EmptyResourceState slot={slot} provider={provider} statuses={statuses} />}</div>
    {slot.multiple && <footer className="flex items-center justify-between gap-3 bg-muted/35 px-5 py-4 sm:px-6"><span className="text-xs text-muted-foreground">{selected.length} selected</span><Dialog.Close render={<Button />}>Done</Dialog.Close></footer>}
  </Dialog.Popup></Dialog.Portal></Dialog.Root></>;
}

function ProviderFilter({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) { return <button type="button" onClick={onClick} className={`flex h-9 shrink-0 items-center gap-2 rounded-full px-3 text-xs font-medium outline-none transition ${active ? "bg-foreground text-background" : "bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground"}`}>{children}</button>; }
function EmptyResourceState({ slot, provider, statuses }: { slot: Slot; provider: string; statuses: ReadonlyMap<string, string> }) { const disconnected = provider !== "all" && statuses.get(provider) !== "ready"; return <div className="grid min-h-36 place-items-center px-6 text-center"><div><p className="text-sm font-medium">{disconnected ? `${providerMeta[provider as keyof typeof providerMeta]?.label ?? provider} is not connected` : `No ${slot.label.toLowerCase()} found`}</p><p className="mt-1 text-xs text-muted-foreground">{disconnected ? "Connect it in Settings, then return here." : "Try another search or connect a source in Settings."}</p></div></div>; }
function ProjectSettingsSkeleton() { return <div className="space-y-7" aria-label="Loading project resources"><div className="h-12 w-52 animate-pulse rounded-2xl bg-muted" /><div className="grid gap-3 sm:grid-cols-2">{Array.from({ length: 5 }, (_, index) => <div key={index} className="h-24 animate-pulse rounded-3xl bg-muted/50" />)}</div></div>; }
function resourceKey(resource: Pick<Resource, "kind" | "resourceId">) { return `${resource.kind}:${resource.resourceId}`; }
