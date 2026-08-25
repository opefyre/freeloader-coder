import { ArrowClockwise } from "@phosphor-icons/react/ArrowClockwise";
import { ArrowRight } from "@phosphor-icons/react/ArrowRight";
import { FolderOpen } from "@phosphor-icons/react/FolderOpen";
import { Plus } from "@phosphor-icons/react/Plus";
import { useCallback, useEffect, useState } from "react";

import type { LocalProjectSnapshot } from "../../../../../packages/runtime/src/local-projects.js";
import { ownerProjectGuidance } from "../../../../../packages/runtime/src/owner-project-guidance.js";
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
        <div className="grid gap-2 sm:grid-cols-2">
          {projects.map((project) => {
            const attention = needsAttention(project);
            const guidance = ownerProjectGuidance(project);
            const update = project.latestUpdate?.summary ?? guidance.outcome;
            return (
              <button key={project.id} type="button" onClick={() => props.openProject(project.id)} className="group flex min-h-36 w-full flex-col rounded-3xl bg-muted/45 p-4 text-left outline-none transition duration-200 hover:-translate-y-0.5 hover:bg-muted/70 hover:shadow-lg hover:shadow-black/5 focus-visible:ring-3 focus-visible:ring-ring/30">
                <span className="flex w-full items-start gap-3"><span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-background text-muted-foreground transition-transform group-hover:scale-105"><FolderOpen size={18} weight="duotone" /></span><span className="min-w-0 flex-1"><strong className="block truncate text-sm">{project.displayName}</strong><span className="mt-1 block text-xs font-medium text-foreground">{guidance.stageLabel}</span><span className="mt-1 line-clamp-2 text-xs text-muted-foreground">{update}</span></span>{attention ? <span className="shrink-0 text-[11px] font-semibold text-amber-500">Needs attention</span> : <ArrowRight className="shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />}</span>
                <span className="mt-auto flex w-full items-end justify-between gap-3 pt-5"><span className="min-w-0 flex-1">{project.progress ? <><span className="mb-1.5 flex justify-between text-[11px] text-muted-foreground"><span>{project.progress.percent}%</span><span>{project.progress.completed}/{project.progress.total}</span></span><span className="block h-1.5 overflow-hidden rounded-full bg-background"><span className="block h-full rounded-full bg-primary transition-[width]" style={{ width: `${project.progress.percent}%` }} /></span></> : <span className="text-xs font-medium text-primary">{guidance.primaryAction.label}</span>}</span><span className="shrink-0 text-xs text-muted-foreground">{project.latestUpdate ? relativeTime(project.latestUpdate.occurredAt) : "Open project"}</span></span>
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
