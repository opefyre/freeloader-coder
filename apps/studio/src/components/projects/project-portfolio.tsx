import { ArrowClockwise } from "@phosphor-icons/react/ArrowClockwise";
import { ArrowRight } from "@phosphor-icons/react/ArrowRight";
import { ArrowSquareOut } from "@phosphor-icons/react/ArrowSquareOut";
import { CheckCircle } from "@phosphor-icons/react/CheckCircle";
import { FolderOpen } from "@phosphor-icons/react/FolderOpen";
import { GitBranch } from "@phosphor-icons/react/GitBranch";
import { ListChecks } from "@phosphor-icons/react/ListChecks";
import { Warning } from "@phosphor-icons/react/Warning";
import { useCallback, useEffect, useMemo, useState } from "react";

import type { LocalProjectSnapshot } from "../../../../../packages/runtime/src/local-projects.js";
import { listLocalProjects } from "../../local-project-client.js";
import { Badge } from "../ui/badge.js";
import { Button } from "../ui/button.js";
import { Card, CardContent } from "../ui/card.js";
import { ProjectResearchControl } from "./project-research-control.js";

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

  const summary = useMemo(() => ({
    active: projects.filter((project) => !["complete", "cancelled"].includes(project.lifecycleStage ?? "intake")).length,
    attention: projects.filter(needsAttention).length,
    verified: projects.filter((project) => project.reconciliation?.confidence === "verified").length,
  }), [projects]);

  return (
    <section aria-labelledby="projects-title">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="projects-title" className="text-lg font-semibold">Your projects</h2>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={() => void refresh()} aria-label="Refresh projects">
            <ArrowClockwise />
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
          </span>
        </button>
      ) : (
        <div>
          <div className="mb-3 grid grid-cols-3 gap-2" aria-label="Project portfolio summary">
            <PortfolioMetric value={summary.active} label="Active" />
            <PortfolioMetric value={summary.attention} label="Needs attention" tone={summary.attention > 0 ? "caution" : "neutral"} />
            <PortfolioMetric value={summary.verified} label="Verified" />
          </div>
          <div className="grid gap-3 lg:grid-cols-2">
          {projects.map((project) => {
            const resources = project.resources ?? [];
            const jira = resources.find((resource) => resource.kind === "jira_project");
            const repositories = resources.filter((resource) => resource.kind === "github_repository");
            const attention = needsAttention(project);
            const confidence = project.reconciliation?.confidence ?? "unknown";
            const currentEvidence = project.reconciliation?.evidence.filter((item) => item.status === "current") ?? [];
            const progress = project.progress;
            return (
              <Card key={project.id} className="overflow-hidden border-0 shadow-none">
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
                        <Badge tone={attention ? "caution" : confidence === "verified" ? "positive" : "neutral"}>
                          {attention ? <Warning /> : <CheckCircle />}
                          {attention ? "Needs attention" : confidence === "verified" ? "Verified" : "Monitoring"}
                        </Badge>
                      </div>
                      <p className="mt-1 truncate text-xs text-muted-foreground">
                        Local folder · {project.workspaceLabel ?? "selected privately"}
                      </p>
                    </div>
                  </div>

                  <div className="mt-5 rounded-2xl bg-muted/55 p-4">
                    <span className="text-[10px] font-semibold uppercase tracking-[.14em] text-muted-foreground">Latest update</span>
                    {project.latestUpdate?.url ? (
                      <a href={project.latestUpdate.url} target="_blank" rel="noreferrer" className="mt-2 flex items-start gap-2 text-sm leading-6 hover:text-primary">
                        <span className="line-clamp-2">{project.latestUpdate.summary}</span>
                        <ArrowSquareOut className="mt-1 shrink-0" />
                      </a>
                    ) : <p className="mt-2 line-clamp-2 text-sm leading-6">{project.latestUpdate?.summary ?? "No verified activity yet."}</p>}
                    <div className="mt-2 flex items-center justify-between gap-3 text-xs text-muted-foreground">
                      <span>{project.latestUpdate?.source ?? "No source"}</span>
                      <span>{project.latestUpdate ? relativeTime(project.latestUpdate.occurredAt) : "Not observed"}</span>
                    </div>
                  </div>

                  <div className="mt-4" aria-label={`${project.displayName} Jira progress`}>
                    <div className="flex items-center justify-between gap-3 text-xs">
                      <span className="font-medium">{progress ? `${progress.percent}% complete` : "Progress unavailable"}</span>
                      <span className="text-muted-foreground">{progress ? `${progress.completed}/${progress.total} · ${progress.blocked} blocked` : "Jira required"}</span>
                    </div>
                    <div
                      className="mt-2 h-2 overflow-hidden rounded-full bg-muted"
                      role="progressbar"
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={progress?.percent}
                      aria-label={progress ? `${project.displayName}: ${progress.completed} of ${progress.total} Jira items complete, ${progress.blocked} blocked` : `${project.displayName}: Jira progress unavailable`}
                    >
                      {progress && <div className="h-full rounded-full bg-primary" style={{ width: `${progress.percent}%` }} />}
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground">
                      {progress ? `Jira · ${relativeTime(progress.observedAt)}` : "No percentage is inferred without Jira evidence."}
                    </p>
                  </div>

                  <div className="mt-4 flex items-center justify-between gap-3 rounded-2xl bg-muted/40 px-4 py-3 text-xs">
                    <span className="text-muted-foreground">Next milestone</span>
                    <strong className="text-right">{nextMilestone(project.lifecycleStage)}</strong>
                  </div>

                  <div className="mt-4 flex flex-wrap gap-2">
                    <Badge><ListChecks />{jira ? jira.label : "Jira not selected"}</Badge>
                    <Badge><GitBranch />{repositories.length ? `${repositories.length} GitHub repo${repositories.length === 1 ? "" : "s"}` : "GitHub not selected"}</Badge>
                  </div>
                  <ProjectResearchControl endpoint={endpoint} projectId={project.id} />

                  <div className="mt-5 flex items-center justify-between gap-3">
                    <details className="group min-w-0 text-xs text-muted-foreground">
                      <summary className="cursor-pointer list-none outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/30">
                        {currentEvidence.length}/{project.reconciliation?.evidence.length ?? 0} sources current
                      </summary>
                      <div className="mt-2 space-y-1" aria-label={`${project.displayName} metric sources`}>
                        {(project.reconciliation?.evidence ?? []).map((item) => (
                          <p key={item.source}>{item.source} · {item.status}{item.observedAt ? ` · ${relativeTime(item.observedAt)}` : ""}</p>
                        ))}
                        {(project.reconciliation?.disagreements ?? []).slice(0, 3).map((item, index) => <p key={`${item.code}-${index}`} className="text-amber-600 dark:text-amber-400">{item.summary}</p>)}
                      </div>
                    </details>
                    <Button variant="secondary" size="sm" onClick={() => props.openProject(project.id)}>
                      Open project
                      <ArrowRight />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
          </div>
        </div>
      )}
    </section>
  );
}

function PortfolioMetric(props: { value: number; label: string; tone?: "neutral" | "caution" }) {
  return (
    <div className={`rounded-2xl bg-muted/55 px-4 py-3 ${props.tone === "caution" ? "text-amber-700 dark:text-amber-300" : ""}`}>
      <strong className="block text-lg leading-none">{props.value}</strong>
      <span className="mt-1 block text-[11px] text-muted-foreground">{props.label}</span>
    </div>
  );
}

function needsAttention(project: LocalProjectSnapshot): boolean {
  return project.state !== "ready" || project.lifecycleStage === "blocked" || (project.reconciliation?.disagreements.length ?? 0) > 0;
}

function nextMilestone(stage: LocalProjectSnapshot["lifecycleStage"]): string {
  return ({
    intake: "Context review",
    context_review: "Resolve open questions",
    clarification: "Solution design",
    solution_design: "Owner approval",
    awaiting_design_approval: "Approve design",
    backlog_design: "Backlog QA",
    backlog_qa: "Start delivery",
    delivery: "Complete verified work",
    blocked: "Resolve blocker",
    complete: "No milestone",
    cancelled: "No milestone",
  } as const)[stage ?? "intake"];
}

function relativeTime(timestamp: number): string {
  const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
