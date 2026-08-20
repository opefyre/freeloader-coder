import { ArrowClockwise } from "@phosphor-icons/react/ArrowClockwise";
import { Check } from "@phosphor-icons/react/Check";
import { PlugsConnected } from "@phosphor-icons/react/PlugsConnected";
import { useCallback, useEffect, useMemo, useState } from "react";

import type { PublicIntegrationConnectionCollection } from "../../../../../packages/runtime/src/integration-connections.js";
import type { LocalProjectSnapshot, ProjectResourceSelection } from "../../../../../packages/runtime/src/local-projects.js";
import { listIntegrationConnections } from "../../integration-connection-client.js";
import { listLocalProjects, setLocalProjectResources } from "../../local-project-client.js";
import { Button } from "../ui/button.js";

type SelectableResource = ProjectResourceSelection["resources"][number];

const kindMap = {
  github_repository: "github_repository",
  jira_project: "jira_project",
  telegram_chat: "telegram_chat",
  slack_channel: "slack_channel",
  discord_channel: "discord_channel",
  google_calendar: "google_calendar",
  cloudflare_account: "cloudflare_account",
  gcloud_project: "gcloud_project",
  aws_account: "aws_account",
} as const;

export function ProjectSettingsPanel(props: { endpoint: string; projectId: string }) {
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
        listIntegrationConnections({ endpoint: props.endpoint }),
      ]);
      const current = projects.projects.find((item) => item.id === props.projectId) ?? null;
      setProject(current);
      setConnections(discovered);
      setSelected(new Set((current?.resources ?? []).map(resourceKey)));
      setState("ready");
      setNotice("");
    } catch {
      setState("offline");
      setNotice("Project resources are temporarily unavailable.");
    }
  }, [props.endpoint, props.projectId]);

  useEffect(() => { void refresh(); }, [refresh]);

  const choices = useMemo(() => {
    const discovered: SelectableResource[] = [];
    for (const connection of connections?.connections ?? []) {
      if (connection.state !== "ready") continue;
      for (const resource of connection.resources) {
        const kind = kindMap[resource.kind as keyof typeof kindMap];
        if (!kind) continue;
        discovered.push({
          kind,
          connectionId: `${connection.provider}:${connection.accountLabel ?? "account"}`,
          resourceId: resource.id,
          label: resource.label,
          url: resource.url,
          role: kind === "jira_project" ? "primary" : kind.endsWith("channel") || kind === "telegram_chat" ? "notifications" : "additional",
        });
      }
    }
    for (const bound of project?.resources ?? []) {
      const candidate = { kind: bound.kind, connectionId: bound.connectionId, resourceId: bound.resourceId, label: bound.label, url: bound.url, role: bound.role };
      if (!discovered.some((item) => resourceKey(item) === resourceKey(candidate))) discovered.push(candidate);
    }
    return discovered;
  }, [connections, project]);

  const toggle = (resource: SelectableResource) => {
    const key = resourceKey(resource);
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else {
        if (resource.kind === "jira_project") {
          for (const choice of choices) if (choice.kind === "jira_project") next.delete(resourceKey(choice));
        }
        next.add(key);
      }
      return next;
    });
  };

  const save = async () => {
    if (!project) return;
    setState("saving");
    try {
      await setLocalProjectResources({
        endpoint: props.endpoint,
        projectId: project.id,
        selection: { schemaVersion: 1, expectedRevision: project.resourceRevision ?? 0, resources: choices.filter((resource) => selected.has(resourceKey(resource))) },
        idempotencyKey: `project-settings:${crypto.randomUUID()}`,
      });
      setNotice("Project resources saved.");
      await refresh();
    } catch (error) {
      setState("ready");
      setNotice(error instanceof Error ? error.message : "Project resources could not be saved.");
    }
  };

  if (state === "loading") return <p className="py-8 text-sm text-muted-foreground">Loading project settings…</p>;
  if (state === "offline" || !project) return <div className="rounded-2xl bg-amber-500/10 p-4 text-sm">{notice || "Project not found."}</div>;

  const groups = groupChoices(choices);
  return <section className="space-y-6" aria-labelledby="project-settings-title">
    <div className="flex items-start justify-between gap-3">
      <div><h2 id="project-settings-title" className="text-lg font-semibold">Resources</h2><p className="mt-1 text-sm text-muted-foreground">Choose what this project can use.</p></div>
      <Button variant="ghost" size="icon" onClick={() => void refresh()} aria-label="Refresh project resources"><ArrowClockwise /></Button>
    </div>
    {groups.length === 0 ? <div className="rounded-2xl bg-muted/55 p-5"><PlugsConnected className="mb-3 text-muted-foreground" /><p className="text-sm font-medium">No resources available</p><p className="mt-1 text-xs text-muted-foreground">Connect apps in Settings first.</p></div> : groups.map(([label, resources]) => <div key={label}>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{label}</h3>
      <div className="grid gap-2 sm:grid-cols-2">{resources.map((resource) => {
        const active = selected.has(resourceKey(resource));
        return <button key={resourceKey(resource)} type="button" aria-pressed={active} onClick={() => toggle(resource)} className={`flex min-h-14 items-center gap-3 rounded-2xl px-4 py-3 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/30 ${active ? "bg-primary/12 text-foreground" : "bg-muted/55 hover:bg-muted"}`}>
          <span className={`grid size-6 shrink-0 place-items-center rounded-full ${active ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground"}`}>{active ? <Check size={14} weight="bold" /> : <PlugsConnected size={14} />}</span>
          <span className="min-w-0"><strong className="block truncate text-sm">{resource.label}</strong><span className="block truncate text-xs capitalize text-muted-foreground">{resource.kind.replaceAll("_", " ")}</span></span>
        </button>;
      })}</div>
    </div>)}
    <div className="flex items-center justify-between gap-3 pt-2"><p className="text-xs text-muted-foreground" aria-live="polite">{notice}</p><Button onClick={() => void save()} disabled={state === "saving"}>{state === "saving" ? "Saving…" : "Save changes"}</Button></div>
  </section>;
}

function resourceKey(resource: Pick<SelectableResource, "kind" | "resourceId">) { return `${resource.kind}:${resource.resourceId}`; }
function groupChoices(choices: readonly SelectableResource[]): ReadonlyArray<readonly [string, readonly SelectableResource[]]> {
  const definitions = [["Code", ["github_repository"]], ["Planning", ["jira_project"]], ["Notifications", ["slack_channel", "discord_channel", "telegram_chat"]], ["Google", ["google_calendar"]], ["Infrastructure", ["cloudflare_account", "gcloud_project", "aws_account"]]] as const;
  return definitions.map(([label, kinds]) => [label, choices.filter((choice) => (kinds as readonly string[]).includes(choice.kind))] as const).filter(([, resources]) => resources.length > 0);
}
