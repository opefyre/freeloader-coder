import { ArrowClockwise } from "@phosphor-icons/react/ArrowClockwise";
import { CheckCircle } from "@phosphor-icons/react/CheckCircle";
import { FolderOpen } from "@phosphor-icons/react/FolderOpen";
import { Warning } from "@phosphor-icons/react/Warning";
import { ArrowSquareOut } from "@phosphor-icons/react/ArrowSquareOut";
import { useCallback, useEffect, useMemo, useState } from "react";

import type { LocalProjectSnapshot } from "../../../../../packages/runtime/src/local-projects.js";
import type { LocalRequest } from "../../../../../packages/runtime/src/local-requests.js";
import type { OwnerAnswer, ProjectLifecycleRecord } from "../../../../../packages/orchestration/src/project-lifecycle.js";
import type { SolutionDocument, SolutionRun } from "../../../../../packages/orchestration/src/solution-design.js";
import type { DeliveryPlanRun } from "../../../../../packages/orchestration/src/delivery-plan.js";
import type { ProjectExecutionRecord } from "../../../../../packages/orchestration/src/project-execution.js";
import { answerProjectClarifications, decideProjectSolution, getProjectBacklogRun, getProjectExecution, getProjectLifecycle, getProjectSolution, getProjectSolutionRun, listLocalProjects } from "../../local-project-client.js";
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
  const [solutionRuns, setSolutionRuns] = useState<readonly SolutionRun[]>([]);
  const [backlogRuns, setBacklogRuns] = useState<readonly DeliveryPlanRun[]>([]);
  const [executions, setExecutions] = useState<readonly ProjectExecutionRecord[]>([]);
  const [selectedSolution, setSelectedSolution] = useState<ProjectLifecycleRecord | null>(null);
  const [selectedClarification, setSelectedClarification] = useState<ProjectLifecycleRecord | null>(null);
  const [clarificationChoices, setClarificationChoices] = useState<Record<string, string>>({});
  const [customAnswers, setCustomAnswers] = useState<Record<string, string>>({});
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
      setSolutionRuns((await Promise.all(projectCollection.projects.map((project) => getProjectSolutionRun({ endpoint: props.endpoint, projectId: project.id }).catch(() => null)))).filter((record): record is SolutionRun => record !== null));
      setBacklogRuns((await Promise.all(projectCollection.projects.map((project) => getProjectBacklogRun({ endpoint: props.endpoint, projectId: project.id }).catch(() => null)))).filter((record): record is DeliveryPlanRun => record !== null));
      setExecutions((await Promise.all(projectCollection.projects.map((project) => getProjectExecution({ endpoint: props.endpoint, projectId: project.id }).catch(() => null)))).filter((record): record is ProjectExecutionRecord => record !== null));
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
  const clarificationItems = lifecycles.filter((lifecycle) => lifecycle.stage === "clarification" && lifecycle.questions.length > 0 && (projectId === "all" || lifecycle.projectId === projectId));
  const researchActions = solutionRuns.filter((run) => run.state === "needs_user" && (projectId === "all" || run.projectId === projectId));
  const backlogActions = backlogRuns.filter((run) => run.state === "needs_user" && (projectId === "all" || run.projectId === projectId));
  const executionActions = executions.filter((record) => ["needs_user", "quarantined"].includes(record.state) && (projectId === "all" || record.projectId === projectId));
  const scopedProjects = projects.filter((project) => projectId === "all" || project.id === projectId);
  const attentionCount = actionItems.length + solutionItems.length + clarificationItems.length + researchActions.length + backlogActions.length + executionActions.length;
  const completedProjects = scopedProjects.filter((project) => project.lifecycleStage === "complete").length;
  const jiraProjects = scopedProjects.filter((project) => project.progress).length;

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
  async function answerClarifications() {
    if (!selectedClarification) return;
    const answers: OwnerAnswer[] = selectedClarification.questions.map((question) => {
      const choice = clarificationChoices[question.id];
      return choice === "__custom__"
        ? { questionId: question.id, optionId: null, customAnswer: customAnswers[question.id]?.trim() || null, answeredAt: Date.now() }
        : { questionId: question.id, optionId: choice ?? null, customAnswer: null, answeredAt: Date.now() };
    });
    if (answers.some((answer) => answer.optionId === null && answer.customAnswer === null)) { setNotice("Answer every question to continue."); return; }
    setWorking(true); setNotice("");
    try {
      await answerProjectClarifications({ endpoint: props.endpoint, projectId: selectedClarification.projectId, expectedRevision: selectedClarification.revision, answers, idempotencyKey: `clarifications:${crypto.randomUUID()}` });
      setSelectedClarification(null); setClarificationChoices({}); setCustomAnswers({}); await refresh();
    } catch (error) { setNotice(error instanceof Error ? error.message : "The answers could not be saved safely."); }
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
        actionItems.length === 0 && solutionItems.length === 0 && clarificationItems.length === 0 && researchActions.length === 0 && backlogActions.length === 0 && executionActions.length === 0 ? (
          <Empty title="Nothing needs you" detail="The pipeline can continue without an owner decision right now." positive />
        ) : (
          <div className="space-y-6">
            {scopedProjects.filter((project) => clarificationItems.some((item) => item.projectId === project.id) || executionActions.some((item) => item.projectId === project.id) || backlogActions.some((item) => item.projectId === project.id) || researchActions.some((item) => item.projectId === project.id) || solutionItems.some((item) => item.projectId === project.id) || actionItems.some((item) => item.projectId === project.id)).map((project) => <section key={project.id} aria-labelledby={`actions-${project.id}`}><div className="mb-3 flex items-center gap-2"><h2 id={`actions-${project.id}`} className="font-semibold">{project.displayName}</h2><Badge>{(project.lifecycleStage ?? "intake").replaceAll("_", " ")}</Badge></div><div className="grid gap-3">
            {clarificationItems.filter((item) => item.projectId === project.id).map((lifecycle) => <button key={`clarification-${lifecycle.projectId}`} type="button" onClick={() => { setSelectedClarification(lifecycle); setClarificationChoices({}); setCustomAnswers({}); setNotice(""); }} className="rounded-3xl bg-card p-5 text-left outline-none hover:bg-muted/55 focus-visible:ring-3 focus-visible:ring-ring/30"><div className="flex items-start gap-4"><span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-amber-500/12 text-amber-500"><Warning weight="fill" /></span><span className="min-w-0 flex-1"><strong>Choose the project direction</strong><span className="mt-2 block text-sm leading-6 text-muted-foreground">{lifecycle.questions.length} focused question{lifecycle.questions.length === 1 ? "" : "s"} block the next stage. Current work remains safe.</span></span><span className="text-xs text-muted-foreground">Answer</span></div></button>)}
            {executionActions.filter((item) => item.projectId === project.id).map((record) => { const task = record.tasks.find((candidate) => ["needs_user", "quarantined"].includes(candidate.status)); return <a href={`/projects/${record.projectId}`} key={`execution-${record.projectId}`} className="rounded-3xl bg-card p-5 outline-none hover:bg-muted/55 focus-visible:ring-3 focus-visible:ring-ring/30"><div className="flex items-start gap-4"><span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-amber-500/12 text-amber-500"><Warning weight="fill" /></span><span className="min-w-0 flex-1"><strong>Implementation needs you</strong><span className="mt-2 block text-sm leading-6 text-muted-foreground">{task?.safeMessage ?? "A verified execution task requires attention."}</span></span><span className="text-xs text-muted-foreground">Resolve</span></div></a>; })}
            {backlogActions.filter((item) => item.projectId === project.id).map((run) => <a href={`/projects/${run.projectId}`} key={`backlog-${run.projectId}`} className="rounded-3xl bg-card p-5 outline-none hover:bg-muted/55 focus-visible:ring-3 focus-visible:ring-ring/30"><div className="flex items-start gap-4"><span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-amber-500/12 text-amber-500"><Warning weight="fill" /></span><span className="min-w-0 flex-1"><strong>Delivery planning needs you</strong><span className="mt-2 block text-sm leading-6 text-muted-foreground">{run.safeMessage}</span></span><span className="text-xs text-muted-foreground">Resolve</span></div></a>)}
            {researchActions.filter((item) => item.projectId === project.id).map((run) => <a href={`/projects/${run.projectId}`} key={`research-${run.projectId}`} className="rounded-3xl bg-card p-5 outline-none hover:bg-muted/55 focus-visible:ring-3 focus-visible:ring-ring/30"><div className="flex items-start gap-4"><span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-amber-500/12 text-amber-500"><Warning weight="fill" /></span><span className="min-w-0 flex-1"><strong>Solution research needs you</strong><span className="mt-2 block text-sm leading-6 text-muted-foreground">{run.safeMessage}</span></span><span className="text-xs text-muted-foreground">Resolve</span></div></a>)}
            {solutionItems.filter((item) => item.projectId === project.id).map((lifecycle) => (
              <button key={`solution-${lifecycle.projectId}`} type="button" onClick={() => void openSolution(lifecycle)} className="rounded-3xl bg-card p-5 text-left outline-none hover:bg-muted/55 focus-visible:ring-3 focus-visible:ring-ring/30">
                <div className="flex items-start gap-4"><span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-amber-500/12 text-amber-500"><Warning weight="fill" /></span><span className="min-w-0 flex-1"><span className="flex flex-wrap items-center gap-2"><strong>Review the proposed solution</strong><Badge>{projectNames.get(lifecycle.projectId) ?? "Unknown project"}</Badge></span><span className="mt-2 line-clamp-2 block text-sm leading-6 text-muted-foreground">Product and technical review passed. Planning is waiting for your decision.</span></span><span className="text-xs text-muted-foreground">Review</span></div>
              </button>
            ))}
            {actionItems.filter((item) => item.projectId === project.id).map((request) => (
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
                    </span>
                    <span className="mt-2 line-clamp-2 block text-sm leading-6 text-muted-foreground">{request.outcome}</span>
                  </span>
                  <span className="text-xs text-muted-foreground">Review</span>
                </div>
              </button>
            ))}
            </div></section>)}
          </div>
        )
      ) : (
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-3" aria-label="Portfolio summary">
            <Metric value={String(scopedProjects.length)} label="Projects" />
            <Metric value={String(attentionCount)} label="Need you" tone={attentionCount > 0 ? "attention" : "normal"} />
            <Metric value={`${completedProjects}/${scopedProjects.length}`} label="Complete" />
          </div>
          <div className="grid gap-3 lg:grid-cols-2">
          {scopedProjects.map((project) => {
            const jira = (project.resources ?? []).find((resource) => resource.kind === "jira_project");
            const execution = executions.find((record) => record.projectId === project.id);
            const verified = execution?.tasks.filter((task) => task.status === "completed").length ?? 0;
            const projectAttention = actionItems.filter((item) => item.projectId === project.id).length
              + solutionItems.filter((item) => item.projectId === project.id).length
              + clarificationItems.filter((item) => item.projectId === project.id).length
              + researchActions.filter((item) => item.projectId === project.id).length
              + backlogActions.filter((item) => item.projectId === project.id).length
              + executionActions.filter((item) => item.projectId === project.id).length;
            const providers = new Set(execution?.tasks.flatMap((task) => [task.assignment?.providerId, ...task.reviews.map((review) => review.providerId)].filter((value): value is string => Boolean(value))) ?? []);
            const validations = execution?.tasks.flatMap((task) => task.validations) ?? [];
            const passedValidations = validations.filter((item) => item.passed).length;
            const retries = execution?.tasks.reduce((sum, task) => sum + task.attempt, 0) ?? 0;
            const stale = project.progress ? Date.now() - project.progress.observedAt > 5 * 60_000 : false;
            return (
              <Card key={project.id}>
                <CardContent className="p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-primary/10 text-primary"><FolderOpen /></span>
                      <div className="min-w-0"><strong className="block truncate">{project.displayName}</strong><span className="mt-1 block text-xs text-muted-foreground">{(project.lifecycleStage ?? "intake").replaceAll("_", " ")}</span></div>
                    </div>
                    <Badge>{projectAttention > 0 ? `${projectAttention} need you` : "On track"}</Badge>
                  </div>
                  <div className="mt-5 rounded-2xl bg-muted/55 p-4">
                    {jira && project.progress ? (
                      <>
                        <div className="flex items-center justify-between gap-3 text-sm"><strong>{project.progress.percent}%</strong>{jira?.url ? <a href={jira.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 truncate text-xs text-muted-foreground hover:text-foreground">Jira · {jira.label}<ArrowSquareOut /></a> : <span className="text-xs text-muted-foreground">Jira</span>}</div>
                        <div className="mt-3 h-2 overflow-hidden rounded-full bg-background" role="img" aria-label={`${project.progress.percent}% complete: ${project.progress.completed} of ${project.progress.total} Jira items completed, ${project.progress.blocked} blocked`}><div className="h-full rounded-full bg-primary" style={{ width: `${project.progress.percent}%` }} /></div>
                        <p className="mt-3 text-xs text-muted-foreground">{project.progress.completed} of {project.progress.total} completed · {project.progress.blocked} blocked · {stale ? "stale" : formatFreshness(project.progress.observedAt)}</p>
                      </>
                    ) : (
                      <div className="flex items-start gap-3"><Warning className="mt-0.5 shrink-0 text-amber-500" /><div><strong className="text-sm">Jira progress unavailable</strong><p className="mt-1 text-xs leading-5 text-muted-foreground">{jira ? "The selected Jira project has not completed its first synchronization." : "Select a Jira project in this project's setup to make Jira the progress source."}</p></div></div>
                    )}
                  </div>
                  <div className="mt-4">
                    <span className="text-[10px] font-semibold uppercase tracking-[.14em] text-muted-foreground">Latest update</span>
                    {project.latestUpdate?.url ? <a href={project.latestUpdate.url} target="_blank" rel="noreferrer" className="mt-2 flex items-start gap-2 text-sm leading-6 hover:text-primary"><span className="line-clamp-2">{project.latestUpdate.summary}</span><ArrowSquareOut className="mt-1 shrink-0" /></a> : <p className="mt-2 line-clamp-2 text-sm leading-6">{project.latestUpdate?.summary ?? "No verified activity yet."}</p>}
                    <p className="mt-2 text-xs text-muted-foreground">{project.latestUpdate ? `${project.latestUpdate.source} · ${formatFreshness(project.latestUpdate.occurredAt)}` : "Unknown · no source observed"}</p>
                  </div>
                  <div className="mt-4 grid grid-cols-4 gap-2" aria-label={`${project.displayName} delivery health`}>
                    <MiniMetric value={`${verified}/${execution?.tasks.length ?? 0}`} label="Tasks" />
                    <MiniMetric value={`${passedValidations}/${validations.length}`} label="Checks" />
                    <MiniMetric value={String(providers.size)} label="Providers" />
                    <MiniMetric value={String(retries)} label="Retries" />
                  </div>
                </CardContent>
              </Card>
            );
          })}
          </div>
          {jiraProjects === 0 && scopedProjects.length > 0 && <p className="text-center text-xs text-muted-foreground">No selected Jira project has produced a current observation.</p>}
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
      {selectedClarification && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-background/75 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="clarification-title">
          <Card className="max-h-[90vh] w-full max-w-2xl overflow-auto"><CardContent className="p-6">
            <div className="flex items-start justify-between gap-4"><div><Badge>{projectNames.get(selectedClarification.projectId)}</Badge><h2 id="clarification-title" className="mt-4 text-xl font-semibold">Choose the direction</h2></div><Button variant="ghost" size="sm" onClick={() => setSelectedClarification(null)}>Close</Button></div>
            <div className="mt-5 space-y-5">{selectedClarification.questions.map((question) => <fieldset key={question.id} className="rounded-3xl bg-muted/45 p-4"><legend className="px-1 text-sm font-semibold">{question.prompt}</legend><p className="mt-1 text-xs leading-5 text-muted-foreground">{question.whyItMatters}</p><div className="mt-3 grid gap-2 sm:grid-cols-2">{question.options.map((option) => <button key={option.id} type="button" aria-pressed={clarificationChoices[question.id] === option.id} onClick={() => setClarificationChoices((current) => ({ ...current, [question.id]: option.id }))} className={`rounded-2xl px-4 py-3 text-left text-sm font-semibold ${clarificationChoices[question.id] === option.id ? "bg-primary text-primary-foreground" : "bg-background hover:bg-background/70"}`}>{option.label}<span className={`mt-1 block text-xs font-normal ${clarificationChoices[question.id] === option.id ? "text-primary-foreground/75" : "text-muted-foreground"}`}>{option.consequence}</span></button>)}{question.allowsCustomAnswer && <button type="button" aria-pressed={clarificationChoices[question.id] === "__custom__"} onClick={() => setClarificationChoices((current) => ({ ...current, [question.id]: "__custom__" }))} className={`rounded-2xl px-4 py-3 text-left text-sm font-semibold ${clarificationChoices[question.id] === "__custom__" ? "bg-primary text-primary-foreground" : "bg-background hover:bg-background/70"}`}>Something else</button>}</div>{clarificationChoices[question.id] === "__custom__" && <textarea aria-label={`Custom answer for ${question.prompt}`} value={customAnswers[question.id] ?? ""} onChange={(event) => setCustomAnswers((current) => ({ ...current, [question.id]: event.target.value }))} rows={2} maxLength={2_000} className="mt-3 w-full resize-y rounded-2xl bg-background px-4 py-3 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/30" />}</fieldset>)}</div>
            {notice && <p role="status" className="mt-4 text-xs text-amber-500">{notice}</p>}
            <div className="mt-5 flex justify-end"><Button onClick={() => void answerClarifications()} disabled={working || selectedClarification.questions.some((question) => !clarificationChoices[question.id])}><CheckCircle />Continue</Button></div>
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

function Metric(props: { value: string; label: string; tone?: "normal" | "attention" }) {
  return <div className="rounded-3xl bg-muted/45 p-5"><strong className={props.tone === "attention" ? "text-2xl text-amber-500" : "text-2xl"}>{props.value}</strong><span className="mt-1 block text-xs text-muted-foreground">{props.label}</span></div>;
}

function MiniMetric(props: { value: string; label: string }) {
  return <div className="rounded-2xl bg-muted/45 px-3 py-2"><strong className="block text-sm">{props.value}</strong><span className="text-[10px] text-muted-foreground">{props.label}</span></div>;
}

function formatFreshness(timestamp: number) {
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1_000));
  if (seconds < 60) return "now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
