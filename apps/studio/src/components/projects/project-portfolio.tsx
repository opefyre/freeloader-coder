import { ArrowClockwise } from "@phosphor-icons/react/ArrowClockwise";
import { ArrowRight } from "@phosphor-icons/react/ArrowRight";
import { FolderOpen } from "@phosphor-icons/react/FolderOpen";
import { Plus } from "@phosphor-icons/react/Plus";
import { Warning } from "@phosphor-icons/react/Warning";
import { useCallback, useEffect, useState } from "react";

import type { LocalProjectSnapshot } from "../../../../../packages/runtime/src/local-projects.js";
import { listLocalProjects } from "../../local-project-client.js";
import { Button } from "../ui/button.js";

const endpoint = import.meta.env.VITE_PIPELINE_STUDIO_CONTROL_URL ?? "http://127.0.0.1:4312";

export function ProjectPortfolio(props: {
  openProject: (projectId: string) => void;
  startProject: () => void;
}) {
  const [projects, setProjects] = useState<readonly LocalProjectSnapshot[]>([]);
  const [offline, setOffline] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const projectCollection = await listLocalProjects({ endpoint });
      setProjects(projectCollection.projects);
      setOffline(false);
    } catch {
      setOffline(true);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 15_000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  return (
    <section aria-labelledby="projects-title">
      <div className="mb-3 flex items-center justify-between gap-3 px-1">
        <h2 id="projects-title" className="text-sm font-semibold">Recent projects</h2>
        <div className="flex gap-1">
          <Button variant="ghost" size="icon" onClick={() => void refresh()} aria-label="Refresh projects"><ArrowClockwise /></Button>
          <Button variant="ghost" size="sm" onClick={props.startProject}><Plus />New</Button>
        </div>
      </div>

      {offline ? (
        <p className="rounded-2xl bg-muted/50 px-4 py-5 text-sm text-muted-foreground">Projects are temporarily unavailable.</p>
      ) : projects.length === 0 ? (
        <button
          type="button"
          onClick={props.startProject}
          className="flex w-full items-center gap-3 rounded-2xl bg-muted/45 px-4 py-4 text-left outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/30"
        >
          <FolderOpen /><span className="text-sm font-medium">Start your first project</span>
        </button>
      ) : (
        <div className="divide-y divide-foreground/[.06]">
          {projects.map((project) => {
            const attention = needsAttention(project);
            const update = project.latestUpdate?.summary ?? (project.lifecycleStage ?? "intake").replaceAll("_", " ");
            return (
              <button key={project.id} type="button" onClick={() => props.openProject(project.id)} className="group flex w-full items-center gap-3 rounded-xl px-2 py-3 text-left outline-none hover:bg-muted/60 focus-visible:ring-3 focus-visible:ring-ring/30">
                <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-muted text-muted-foreground"><FolderOpen size={17} weight="duotone" /></span>
                <span className="min-w-0 flex-1"><strong className="block truncate text-sm">{project.displayName}</strong><span className="mt-0.5 block truncate text-xs capitalize text-muted-foreground">{update}</span></span>
                {attention && <Warning className="shrink-0 text-amber-500" aria-label="Needs attention" />}
                <span className="hidden shrink-0 text-xs text-muted-foreground sm:block">{project.latestUpdate ? relativeTime(project.latestUpdate.occurredAt) : ""}</span>
                <ArrowRight className="shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}

function needsAttention(project: LocalProjectSnapshot): boolean {
  return project.state !== "ready" || project.lifecycleStage === "blocked" || (project.reconciliation?.disagreements.length ?? 0) > 0;
}

function relativeTime(timestamp: number): string {
  const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
