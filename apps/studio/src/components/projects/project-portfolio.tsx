import { ArrowClockwise } from "@phosphor-icons/react/ArrowClockwise";
import { ArrowRight } from "@phosphor-icons/react/ArrowRight";
import { FolderOpen } from "@phosphor-icons/react/FolderOpen";
import { GitBranch } from "@phosphor-icons/react/GitBranch";
import { ListChecks } from "@phosphor-icons/react/ListChecks";
import { useCallback, useEffect, useMemo, useState } from "react";

import type { LocalProjectSnapshot } from "../../../../../packages/runtime/src/local-projects.js";
import type { LocalRequest } from "../../../../../packages/runtime/src/local-requests.js";
import { listLocalProjects } from "../../local-project-client.js";
import { listLocalRequests } from "../../local-request-client.js";
import { Badge } from "../ui/badge.js";
import { Button } from "../ui/button.js";
import { Card, CardContent } from "../ui/card.js";

const endpoint = import.meta.env.VITE_PIPELINE_STUDIO_CONTROL_URL ?? "http://127.0.0.1:4312";

export function ProjectPortfolio(props: {
  openActivity: (projectId: string) => void;
  startProject: () => void;
}) {
  const [projects, setProjects] = useState<readonly LocalProjectSnapshot[]>([]);
  const [requests, setRequests] = useState<readonly LocalRequest[]>([]);
  const [offline, setOffline] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [projectCollection, requestCollection] = await Promise.all([
        listLocalProjects({ endpoint }),
        listLocalRequests({ endpoint }),
      ]);
      setProjects(projectCollection.projects);
      setRequests(requestCollection.requests);
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

  const latestByProject = useMemo(() => {
    const latest = new Map<string, LocalRequest>();
    for (const request of requests) {
      const current = latest.get(request.projectId);
      if (!current || request.updatedAt > current.updatedAt) latest.set(request.projectId, request);
    }
    return latest;
  }, [requests]);

  return (
    <section aria-labelledby="projects-title">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="projects-title" className="text-lg font-semibold">Your projects</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            One workspace, its selected tools, and its latest verified update.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={() => void refresh()} aria-label="Refresh projects">
            <ArrowClockwise />
            Refresh
          </Button>
          <Button size="sm" onClick={props.startProject}>New project</Button>
        </div>
      </div>

      {offline ? (
        <div className="rounded-3xl bg-muted p-5 text-sm text-muted-foreground">
          The local runtime is unavailable. Existing project files were not changed.
        </div>
      ) : projects.length === 0 ? (
        <button
          type="button"
          onClick={props.startProject}
          className="grid min-h-40 w-full place-items-center rounded-3xl bg-muted/55 p-8 text-center outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/30"
        >
          <span>
            <FolderOpen className="mx-auto text-primary" size={28} weight="duotone" />
            <strong className="mt-3 block">Start your first project</strong>
            <span className="mt-1 block text-sm text-muted-foreground">Choose a local folder, describe the outcome, then connect its resources.</span>
          </span>
        </button>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {projects.map((project) => {
            const latest = latestByProject.get(project.id);
            const resources = project.resources ?? [];
            const jira = resources.find((resource) => resource.kind === "jira_project");
            const repositories = resources.filter((resource) => resource.kind === "github_repository");
            return (
              <Card key={project.id} className="overflow-hidden">
                <CardContent className="p-5">
                  <div className="flex items-start gap-3">
                    <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-primary/10 text-primary">
                      <FolderOpen size={21} weight="duotone" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <strong className="truncate">{project.displayName}</strong>
                        <Badge tone={project.lifecycleStage === "blocked" ? "caution" : "neutral"}>
                          {(project.lifecycleStage ?? "intake").replaceAll("_", " ")}
                        </Badge>
                      </div>
                      <p className="mt-1 truncate text-xs text-muted-foreground">
                        Local folder · {project.workspaceLabel ?? "selected privately"}
                      </p>
                    </div>
                  </div>

                  <div className="mt-5 rounded-2xl bg-muted/55 p-4">
                    <span className="text-[10px] font-semibold uppercase tracking-[.14em] text-muted-foreground">Latest update</span>
                    <p className="mt-2 line-clamp-2 text-sm leading-6">
                      {latest?.outcome ?? "Workspace connected. No project work has started yet."}
                    </p>
                    <div className="mt-2 flex items-center justify-between gap-3 text-xs text-muted-foreground">
                      <span>{latest ? latest.state.replaceAll("_", " ") : "Ready for intake"}</span>
                      <span>{latest ? relativeTime(latest.updatedAt) : relativeTime(project.observedAt)}</span>
                    </div>
                  </div>

                  <div className="mt-4 flex flex-wrap gap-2">
                    <Badge><ListChecks />{jira ? jira.label : "Jira not selected"}</Badge>
                    <Badge><GitBranch />{repositories.length ? `${repositories.length} GitHub repo${repositories.length === 1 ? "" : "s"}` : "GitHub not selected"}</Badge>
                  </div>

                  <div className="mt-5 flex items-center justify-between gap-3">
                    <span className="text-xs text-muted-foreground">
                      {project.progress ? `${project.progress.percent}% from Jira` : "Progress appears after Jira is selected"}
                    </span>
                    <Button variant="secondary" size="sm" onClick={() => props.openActivity(project.id)}>
                      Open project
                      <ArrowRight />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </section>
  );
}

function relativeTime(timestamp: number): string {
  const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
