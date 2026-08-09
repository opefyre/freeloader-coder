import { ArrowClockwise } from "@phosphor-icons/react/ArrowClockwise";
import { CheckCircle } from "@phosphor-icons/react/CheckCircle";
import { FolderOpen } from "@phosphor-icons/react/FolderOpen";
import { Warning } from "@phosphor-icons/react/Warning";
import { useCallback, useEffect, useMemo, useState } from "react";

import type { LocalProjectSnapshot } from "../../../../../packages/runtime/src/local-projects.js";
import type { LocalRequest } from "../../../../../packages/runtime/src/local-requests.js";
import type { ProjectLifecycleRecord } from "../../../../../packages/orchestration/src/project-lifecycle.js";
import type { SolutionDocument } from "../../../../../packages/orchestration/src/solution-design.js";
import { decideProjectSolution, getProjectLifecycle, getProjectSolution, listLocalProjects } from "../../local-project-client.js";
import { listLocalRequests } from "../../local-request-client.js";
import { Badge } from "../ui/badge.js";
import { Button } from "../ui/button.js";
import { Card, CardContent } from "../ui/card.js";

export function ProjectActivityDashboard(props: {
  endpoint: string;
  mode: "actions" | "analytics";
}) {
  const requestedProject = new URLSearchParams(window.location.search).get("project") ?? "all";
  const [projectId, setProjectId] = useState(requestedProject);
  const [projects, setProjects] = useState<readonly LocalProjectSnapshot[]>([]);
  const [requests, setRequests] = useState<readonly LocalRequest[]>([]);
  const [status, setStatus] = useState<"loading" | "live" | "offline">("loading");
  const [selected, setSelected] = useState<LocalRequest | null>(null);
  const [lifecycles, setLifecycles] = useState<readonly ProjectLifecycleRecord[]>([]);
  const [selectedSolution, setSelectedSolution] = useState<ProjectLifecycleRecord | null>(null);
  const [solution, setSolution] = useState<SolutionDocument | null>(null);
  const [feedback, setFeedback] = useState("");
  const [notice, setNotice] = useState("");
  const [working, setWorking] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [projectCollection, requestCollection] = await Promise.all([
        listLocalProjects({ endpoint: props.endpoint }),
        listLocalRequests({ endpoint: props.endpoint }),
      ]);
      setProjects(projectCollection.projects);
      setRequests(requestCollection.requests);
      setLifecycles((await Promise.all(projectCollection.projects.map((project) => getProjectLifecycle({ endpoint: props.endpoint, projectId: project.id }).catch(() => null)))).filter((record): record is ProjectLifecycleRecord => record !== null));
      setStatus("live");
    } catch {
      setStatus("offline");
    }
  }, [props.endpoint]);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 15_000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const visibleRequests = useMemo(
    () => projectId === "all" ? requests : requests.filter((request) => request.projectId === projectId),
    [projectId, requests]
  );
  const projectNames = useMemo(() => new Map(projects.map((project) => [project.id, project.displayName])), [projects]);
  const actionItems = visibleRequests.filter((request) =>
    request.state === "needs_input" ||
    request.state === "interrupted" ||
    (request.plan?.state === "draft" && request.grounding)
  );
  const solutionItems = lifecycles.filter((lifecycle) => lifecycle.stage === "awaiting_design_approval" && (projectId === "all" || lifecycle.projectId === projectId));

  async function openSolution(lifecycle: ProjectLifecycleRecord) {
    setSelectedSolution(lifecycle); setFeedback(""); setNotice("");
    try { setSolution(await getProjectSolution({ endpoint: props.endpoint, projectId: lifecycle.projectId })); }
    catch { setSolution(null); setNotice("The solution artifact could not be verified."); }
  }
  async function decide(decision: "approved" | "declined" | "revision_requested") {
    if (!selectedSolution || !solution) return;
    if (decision === "revision_requested" && feedback.trim().length < 3) { setNotice("Describe the change you need."); return; }
    setWorking(true);
    try {
      await decideProjectSolution({ endpoint: props.endpoint, projectId: selectedSolution.projectId, expectedRevision: selectedSolution.revision, artifactDigest: solution.digest, decision, feedback: decision === "revision_requested" ? feedback.trim() : null, idempotencyKey: `solution:${decision}:${crypto.randomUUID()}` });
      setSelectedSolution(null); setSolution(null); setFeedback(""); await refresh();
    } catch (error) { setNotice(error instanceof Error ? error.message : "The solution decision could not be saved safely."); }
    finally { setWorking(false); }
  }

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="text-xs font-semibold text-muted-foreground">
          Project
          <select
            value={projectId}
            onChange={(event) => {
              const next = event.target.value;
              setProjectId(next);
              const url = new URL(window.location.href);
              if (next === "all") url.searchParams.delete("project");
              else url.searchParams.set("project", next);
              window.history.replaceState({}, "", `${url.pathname}${url.search}`);
            }}
            className="ml-2 h-10 rounded-2xl bg-muted px-4 text-sm text-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/30"
          >
            <option value="all">All projects</option>
            {projects.map((project) => <option key={project.id} value={project.id}>{project.displayName}</option>)}
          </select>
        </label>
        <Button variant="ghost" size="sm" onClick={() => void refresh()}>
          <ArrowClockwise /> Refresh
        </Button>
      </div>

      {status === "offline" ? (
        <Empty title="Local runtime unavailable" detail="No cached or sample status is substituted." />
      ) : props.mode === "actions" ? (
        actionItems.length === 0 && solutionItems.length === 0 ? (
          <Empty title="Nothing needs you" detail="The pipeline can continue without an owner decision right now." positive />
        ) : (
          <div className="grid gap-3">
            {solutionItems.map((lifecycle) => (
              <button key={`solution-${lifecycle.projectId}`} type="button" onClick={() => void openSolution(lifecycle)} className="rounded-3xl bg-card p-5 text-left outline-none hover:bg-muted/55 focus-visible:ring-3 focus-visible:ring-ring/30">
                <div className="flex items-start gap-4"><span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-amber-500/12 text-amber-500"><Warning weight="fill" /></span><span className="min-w-0 flex-1"><span className="flex flex-wrap items-center gap-2"><strong>Review the proposed solution</strong><Badge>{projectNames.get(lifecycle.projectId) ?? "Unknown project"}</Badge></span><span className="mt-2 line-clamp-2 block text-sm leading-6 text-muted-foreground">Product and technical review passed. Planning is waiting for your decision.</span></span><span className="text-xs text-muted-foreground">Review</span></div>
              </button>
            ))}
            {actionItems.map((request) => (
              <button
                key={request.id}
                type="button"
                onClick={() => setSelected(request)}
                className="rounded-3xl bg-card p-5 text-left outline-none hover:bg-muted/55 focus-visible:ring-3 focus-visible:ring-ring/30"
              >
                <div className="flex items-start gap-4">
                  <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-amber-500/12 text-amber-500"><Warning weight="fill" /></span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <strong>{actionTitle(request)}</strong>
                      <Badge>{projectNames.get(request.projectId) ?? "Unknown project"}</Badge>
                    </span>
                    <span className="mt-2 line-clamp-2 block text-sm leading-6 text-muted-foreground">{request.outcome}</span>
                  </span>
                  <span className="text-xs text-muted-foreground">Review</span>
                </div>
              </button>
            ))}
          </div>
        )
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {projects.filter((project) => projectId === "all" || project.id === projectId).map((project) => {
            const projectRequests = requests.filter((request) => request.projectId === project.id);
            const jira = (project.resources ?? []).find((resource) => resource.kind === "jira_project");
            const latest = [...projectRequests].sort((a, b) => b.updatedAt - a.updatedAt)[0];
            return (
              <Card key={project.id}>
                <CardContent className="p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-primary/10 text-primary"><FolderOpen /></span>
                      <div className="min-w-0"><strong className="block truncate">{project.displayName}</strong><span className="mt-1 block text-xs text-muted-foreground">{(project.lifecycleStage ?? "intake").replaceAll("_", " ")}</span></div>
                    </div>
                    <Badge>{projectRequests.length} work item{projectRequests.length === 1 ? "" : "s"}</Badge>
                  </div>
                  <div className="mt-5 rounded-2xl bg-muted/55 p-4">
                    {jira && project.progress ? (
                      <>
                        <div className="flex items-center justify-between text-sm"><strong>{project.progress.percent}%</strong><span className="text-xs text-muted-foreground">Jira · {jira.label}</span></div>
                        <div className="mt-3 h-2 overflow-hidden rounded-full bg-background"><div className="h-full rounded-full bg-primary" style={{ width: `${project.progress.percent}%` }} /></div>
                        <p className="mt-3 text-xs text-muted-foreground">{project.progress.completed} of {project.progress.total} completed · {project.progress.blocked} blocked</p>
                      </>
                    ) : (
                      <div className="flex items-start gap-3"><Warning className="mt-0.5 shrink-0 text-amber-500" /><div><strong className="text-sm">Jira progress unavailable</strong><p className="mt-1 text-xs leading-5 text-muted-foreground">{jira ? "The selected Jira project has not completed its first synchronization." : "Select a Jira project in this project's setup to make Jira the progress source."}</p></div></div>
                    )}
                  </div>
                  <div className="mt-4">
                    <span className="text-[10px] font-semibold uppercase tracking-[.14em] text-muted-foreground">Latest update</span>
                    <p className="mt-2 line-clamp-2 text-sm leading-6">{latest?.outcome ?? "No pipeline work has started."}</p>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {selected && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-background/75 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="action-detail-title">
          <Card className="w-full max-w-xl">
            <CardContent className="p-6">
              <div className="flex items-start justify-between gap-4"><div><Badge>{projectNames.get(selected.projectId)}</Badge><h2 id="action-detail-title" className="mt-4 text-xl font-semibold">{actionTitle(selected)}</h2></div><Button variant="ghost" size="sm" onClick={() => setSelected(null)}>Close</Button></div>
              <p className="mt-4 text-sm leading-7 text-muted-foreground">{selected.outcome}</p>
              {selected.findings.length > 0 && <ul className="mt-4 space-y-2">{selected.findings.map((finding) => <li key={finding.code} className="rounded-2xl bg-muted p-3 text-xs leading-5"><strong>{finding.title}</strong><span className="mt-1 block text-muted-foreground">{finding.detail}</span></li>)}</ul>}
              <div className="mt-6 flex justify-end"><Button variant="secondary" onClick={() => setSelected(null)}>Done</Button></div>
            </CardContent>
          </Card>
        </div>
      )}
      {selectedSolution && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-background/75 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="solution-review-title">
          <Card className="max-h-[90vh] w-full max-w-3xl overflow-auto"><CardContent className="p-6">
            <div className="flex items-start justify-between gap-4"><div><Badge>{projectNames.get(selectedSolution.projectId)}</Badge><h2 id="solution-review-title" className="mt-4 text-xl font-semibold">Proposed solution</h2></div><Button variant="ghost" size="sm" onClick={() => { setSelectedSolution(null); setSolution(null); }}>Close</Button></div>
            {solution ? <><pre className="mt-5 max-h-[48vh] overflow-auto whitespace-pre-wrap rounded-3xl bg-muted/55 p-5 font-sans text-sm leading-7">{solution.markdown}</pre><textarea aria-label="Requested solution changes" value={feedback} onChange={(event) => setFeedback(event.target.value)} rows={3} maxLength={10_000} placeholder="Changes you need…" className="mt-4 w-full resize-y rounded-3xl bg-muted px-4 py-3 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/30" /><div className="mt-4 grid gap-2 sm:grid-cols-3"><Button onClick={() => void decide("approved")} disabled={working}><CheckCircle />Approve</Button><Button variant="secondary" onClick={() => void decide("revision_requested")} disabled={working || feedback.trim().length < 3}>Request changes</Button><Button variant="ghost" onClick={() => void decide("declined")} disabled={working}>Decline</Button></div></> : <p className="mt-5 rounded-3xl bg-muted p-4 text-sm text-muted-foreground">{notice || "Verifying the solution…"}</p>}
            {notice && solution && <p role="status" className="mt-3 text-xs text-muted-foreground">{notice}</p>}
          </CardContent></Card>
        </div>
      )}
    </section>
  );
}

function actionTitle(request: LocalRequest): string {
  if (request.state === "interrupted") return "Interrupted work needs a decision";
  if (request.plan?.state === "draft" && request.grounding) return "Review the proposed design";
  return "Answer a project question";
}

function Empty(props: { title: string; detail: string; positive?: boolean }) {
  return <div className="grid min-h-64 place-items-center rounded-4xl bg-muted/45 p-8 text-center"><div>{props.positive ? <CheckCircle className="mx-auto text-emerald-500" size={30} weight="fill" /> : <Warning className="mx-auto text-amber-500" size={30} weight="fill" />}<strong className="mt-4 block">{props.title}</strong><p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">{props.detail}</p></div></div>;
}
