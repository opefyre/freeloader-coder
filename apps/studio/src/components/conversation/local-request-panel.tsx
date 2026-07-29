import { ArrowRight } from "@phosphor-icons/react/ArrowRight";
import { ArrowClockwise } from "@phosphor-icons/react/ArrowClockwise";
import { ArrowDown } from "@phosphor-icons/react/ArrowDown";
import { ArrowUp } from "@phosphor-icons/react/ArrowUp";
import { CheckCircle } from "@phosphor-icons/react/CheckCircle";
import { Fingerprint } from "@phosphor-icons/react/Fingerprint";
import { FloppyDisk } from "@phosphor-icons/react/FloppyDisk";
import { GitBranch } from "@phosphor-icons/react/GitBranch";
import { HourglassMedium } from "@phosphor-icons/react/HourglassMedium";
import { LockKey } from "@phosphor-icons/react/LockKey";
import { Play } from "@phosphor-icons/react/Play";
import { ShieldCheck } from "@phosphor-icons/react/ShieldCheck";
import { Stop } from "@phosphor-icons/react/Stop";
import { Trash } from "@phosphor-icons/react/Trash";
import { Warning } from "@phosphor-icons/react/Warning";
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";

import type { LocalProjectSnapshot } from "../../../../../packages/runtime/src/local-projects.js";
import type {
  LocalDraftPlan,
  LocalRequest,
} from "../../../../../packages/runtime/src/local-requests.js";
import { listLocalProjects } from "../../local-project-client.js";
import {
  archiveLocalRequest,
  approveLocalPlan,
  advanceLocalExecution,
  advanceLocalRequest,
  authorizeLocalExecution,
  advanceLocalPatch,
  advanceLocalCommit,
  advanceLocalIntegration,
  approveLocalIntegration,
  previewLocalIntegration,
  approveLocalCommit,
  approveLocalPatch,
  cancelLocalRequest,
  createLocalRequest,
  listLocalRequests,
  previewLocalPatch,
  previewLocalCommit,
  advanceLocalChangeSet,
  approveLocalChangeSet,
  previewLocalChangeSet,
  updateLocalPlan,
} from "../../local-request-client.js";
import { Badge } from "../ui/badge.js";
import { Button } from "../ui/button.js";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../ui/card.js";

const LocalProposalCard = lazy(async () => {
  const module = await import("./local-proposal-card.js");
  return { default: module.LocalProposalCard };
});
const LocalProposalControls = lazy(async () => {
  const module = await import("./local-proposal-card.js");
  return { default: module.LocalProposalControls };
});

const endpoint =
  import.meta.env.VITE_PIPELINE_STUDIO_CONTROL_URL ?? "http://127.0.0.1:4312";

export function LocalRequestPanel(props: {
  mode: "compose" | "queue";
  navigate?: (view: "work" | "projects") => void;
}) {
  const [projects, setProjects] = useState<readonly LocalProjectSnapshot[]>([]);
  const [requests, setRequests] = useState<readonly LocalRequest[]>([]);
  const [projectId, setProjectId] = useState("");
  const [outcome, setOutcome] = useState("");
  const [status, setStatus] = useState<"loading" | "ready" | "working" | "offline">(
    "loading"
  );
  const [notice, setNotice] = useState(
    "Loading live local projects and durable request state…"
  );
  const [patchDrafts, setPatchDrafts] = useState<
    Record<string, { path: string; content: string }>
  >({});
  const [commitMessages, setCommitMessages] = useState<Record<string, string>>({});
  const [changeSetDrafts, setChangeSetDrafts] = useState<Record<string, Array<{
    type: "create" | "replace" | "delete"; path: string; content: string;
  }>>>({});
  const disposed = useRef(false);

  const refresh = useCallback(async () => {
    try {
      const [projectCollection, requestCollection] = await Promise.all([
        listLocalProjects({ endpoint }),
        listLocalRequests({ endpoint }),
      ]);
      if (disposed.current) return;
      setProjects(projectCollection.projects);
      setRequests(requestCollection.requests);
      setProjectId((current) =>
        projectCollection.projects.some((project) => project.id === current)
          ? current
          : projectCollection.projects[0]?.id ?? ""
      );
      setStatus("ready");
      setNotice("Live local state observed. No worker or provider activity is implied.");
    } catch {
      if (disposed.current) return;
      setStatus("offline");
      setNotice("Local runtime is offline. Last observed queue state is preserved.");
    }
  }, []);

  useEffect(() => {
    disposed.current = false;
    void refresh();
    const timer = window.setInterval(() => void refresh(), 10_000);
    return () => {
      disposed.current = true;
      window.clearInterval(timer);
    };
  }, [refresh]);

  async function submit() {
    if (!projectId || outcome.trim().length < 3) {
      setNotice("Choose a registered project and describe an outcome.");
      return;
    }
    setStatus("working");
    try {
      await createLocalRequest({
        endpoint,
        projectId,
        outcome: outcome.trim(),
        idempotencyKey: `request:${crypto.randomUUID()}`,
      });
      setOutcome("");
      await refresh();
      setNotice("Request saved locally and queued. No worker or model has started.");
    } catch (error) {
      setStatus("ready");
      setNotice(error instanceof Error ? error.message : "Request failed safely.");
    }
  }

  async function mutate(request: LocalRequest, action: "cancel" | "archive") {
    setStatus("working");
    try {
      if (action === "cancel") {
        await cancelLocalRequest({
          endpoint,
          requestId: request.id,
          idempotencyKey: `cancel:${request.id}`,
        });
      } else {
        await archiveLocalRequest({
          endpoint,
          requestId: request.id,
          idempotencyKey: `archive:${request.id}`,
        });
      }
      await refresh();
      setNotice(
        action === "cancel"
          ? "Queued request cancelled. No execution was interrupted."
          : "Cancelled request archived from the local queue."
      );
    } catch (error) {
      setStatus("ready");
      setNotice(error instanceof Error ? error.message : "Queue action failed safely.");
    }
  }

  async function advance(
    request: LocalRequest,
    action: "approve" | "ground" | "claim" | "checkpoint" | "release" | "reconcile"
  ) {
    setStatus("working");
    try {
      await advanceLocalRequest({
        endpoint,
        requestId: request.id,
        action,
        idempotencyKey: `${action}:${request.id}`,
      });
      await refresh();
      setNotice({
        approve: "Zero-effect contract approved. No work has started.",
        ground: "Bounded local grounding and deterministic draft plan created.",
        claim: "Local coordinator lease claimed. No command or provider was invoked.",
        checkpoint: "Zero external effects observed and checkpoint evidence recorded.",
        release: "Lease released. The zero-effect lifecycle proof is complete.",
        reconcile: "Expired lease reconciled to interrupted for explicit review.",
      }[action]);
    } catch (error) {
      setStatus("ready");
      setNotice(error instanceof Error ? error.message : "Lifecycle action failed safely.");
    }
  }

  async function editPlan(
    request: LocalRequest,
    edit:
      | { type: "edit_task"; taskId: string; title: string; estimatedMinutes: number }
      | { type: "reorder"; order: string[] }
  ) {
    if (!request.plan) return;
    setStatus("working");
    try {
      await updateLocalPlan({
        endpoint,
        requestId: request.id,
        edit: {
          schemaVersion: 1,
          expectedRevision: request.plan.revision,
          ...edit,
        },
        idempotencyKey: `plan-edit:${request.id}:${request.plan.revision}:${crypto.randomUUID()}`,
      });
      await refresh();
      setNotice("Plan revision saved locally. No execution authority was granted.");
    } catch (error) {
      setStatus("ready");
      setNotice(error instanceof Error ? error.message : "Plan edit failed safely.");
    }
  }

  async function approvePlan(request: LocalRequest) {
    if (!request.plan) return;
    setStatus("working");
    try {
      await approveLocalPlan({
        endpoint,
        requestId: request.id,
        approval: {
          schemaVersion: 1,
          expectedRevision: request.plan.revision,
        },
        idempotencyKey: `plan-approve:${request.id}:${request.plan.revision}`,
      });
      await refresh();
      setNotice("Plan frozen and approved. Execution remains unauthorized.");
    } catch (error) {
      setStatus("ready");
      setNotice(error instanceof Error ? error.message : "Plan approval failed safely.");
    }
  }

  async function authorizeExecution(request: LocalRequest) {
    if (!request.plan || request.plan.state !== "approved") return;
    setStatus("working");
    try {
      await authorizeLocalExecution({
        endpoint,
        requestId: request.id,
        authorization: {
          schemaVersion: 1,
          expectedPlanRevision: request.plan.revision,
          expectedPlanDigest: request.plan.digest,
          isolationProfile: "native_bounded_worktree",
        },
        idempotencyKey: `execution-authorize:${request.id}:${request.plan.digest}`,
      });
      await refresh();
      setNotice(
        "Clean Git baseline verified and isolated-worktree-only authority recorded. No workspace or task started."
      );
    } catch (error) {
      setStatus("ready");
      setNotice(error instanceof Error ? error.message : "Execution authorization failed safely.");
    }
  }

  async function mutateExecution(
    request: LocalRequest,
    action: "prepare" | "start" | "validate" | "cancel" | "reconcile"
  ) {
    setStatus("working");
    try {
      await advanceLocalExecution({
        endpoint,
        requestId: request.id,
        action,
        idempotencyKey: `execution-${action}:${request.id}:${request.execution?.authority.digest ?? "none"}`,
      });
      await refresh();
      setNotice({
        prepare:
          "Private Git worktree prepared and baseline verified. No task, model, network, or arbitrary command started.",
        start:
          "Bounded run recorded. No validation command or source mutation has happened yet.",
        validate:
          "Fixed-argument Git validation and bounded change observation completed in the isolated workspace.",
        cancel: "Execution cancelled. The isolated workspace was preserved for explicit recovery.",
        reconcile: "Interrupted preparation reconciled without claiming completion.",
      }[action]);
    } catch (error) {
      setStatus("ready");
      setNotice(error instanceof Error ? error.message : "Execution action failed safely.");
    }
  }

  async function previewPatch(request: LocalRequest) {
    const execution = request.execution;
    const draft = patchDrafts[request.id];
    if (!execution?.run || !draft?.path || draft.content.length > 65_536) {
      setNotice("Choose one approved file and keep replacement text within 64 KiB.");
      return;
    }
    setStatus("working");
    try {
      await previewLocalPatch({
        endpoint,
        requestId: request.id,
        proposal: {
          schemaVersion: 1,
          expectedAuthorityDigest: execution.authority.digest,
          expectedRunDigest: execution.run.digest,
          path: draft.path,
          expectedBeforeDigest: null,
          replacementContent: draft.content,
        },
        idempotencyKey: `patch-preview:${request.id}:${execution.run.digest}:${draft.path}`,
      });
      await refresh();
      setNotice("Exact replacement preview recorded. No source file was written.");
    } catch (error) {
      setStatus("ready");
      setNotice(error instanceof Error ? error.message : "Patch preview failed safely.");
    }
  }

  async function approvePatch(request: LocalRequest) {
    const preview = request.execution?.patch?.preview;
    if (!preview) return;
    setStatus("working");
    try {
      await approveLocalPatch({
        endpoint,
        requestId: request.id,
        approval: { schemaVersion: 1, expectedPreviewDigest: preview.digest },
        idempotencyKey: `patch-approve:${request.id}:${preview.digest}`,
      });
      await refresh();
      setNotice("Exact isolated patch approved. Application has not started.");
    } catch (error) {
      setStatus("ready");
      setNotice(error instanceof Error ? error.message : "Patch approval failed safely.");
    }
  }

  async function mutatePatch(
    request: LocalRequest,
    action: "apply" | "rollback" | "reconcile"
  ) {
    setStatus("working");
    try {
      await advanceLocalPatch({
        endpoint,
        requestId: request.id,
        action,
        idempotencyKey: `patch-${action}:${request.id}:${request.execution?.patch?.preview.digest ?? "none"}`,
      });
      await refresh();
      setNotice({
        apply:
          "Approved replacement applied and verified inside the isolated worktree only.",
        rollback: "Exact pre-patch isolated bytes restored and verified.",
        reconcile: "Interrupted patch preserved for explicit inspection.",
      }[action]);
    } catch (error) {
      setStatus("ready");
      setNotice(error instanceof Error ? error.message : "Patch action failed safely.");
    }
  }

  async function previewCommit(request: LocalRequest) {
    const execution = request.execution;
    const message = commitMessages[request.id]?.trim() ?? "";
    if (!execution?.run || message.length < 3) {
      setNotice("Enter a clear local commit message.");
      return;
    }
    setStatus("working");
    try {
      await previewLocalCommit({
        endpoint,
        requestId: request.id,
        proposal: {
          schemaVersion: 1,
          expectedAuthorityDigest: execution.authority.digest,
          expectedRunDigest: execution.run.digest,
          message,
        },
        idempotencyKey: `commit-preview:${request.id}:${execution.run.digest}:${message}`,
      });
      await refresh();
      setNotice("Hook-free local commit preview recorded. Nothing was staged.");
    } catch (error) {
      setStatus("ready");
      setNotice(error instanceof Error ? error.message : "Commit preview failed safely.");
    }
  }

  async function previewChangeSet(request: LocalRequest) {
    const execution = request.execution;
    const operations = changeSetDrafts[request.id] ?? [];
    if (!execution?.run || operations.length === 0 || operations.some((item) => !item.path || (item.type !== "delete" && new TextEncoder().encode(item.content).length > 65_536))) {
      setNotice("Add 1–12 complete file operations; each text file must remain within 64 KiB."); return;
    }
    setStatus("working");
    try {
      await previewLocalChangeSet({
        endpoint, requestId: request.id,
        proposal: {
          schemaVersion: 1, expectedAuthorityDigest: execution.authority.digest,
          expectedRunDigest: execution.run.digest,
          operations: operations.map((item) => ({
            type: item.type, path: item.path, expectedBeforeDigest: null,
            content: item.type === "delete" ? null : item.content,
          })),
        },
        idempotencyKey: `change-set-preview:${request.id}:${execution.run.digest}:${operations.length}`,
      });
      await refresh(); setNotice("Exact multi-file change-set preview recorded. No file was written.");
    } catch (error) {
      setStatus("ready"); setNotice(error instanceof Error ? error.message : "Change-set preview failed safely.");
    }
  }

  async function approveChangeSet(request: LocalRequest) {
    const preview = request.execution?.changeSet?.preview; if (!preview) return;
    setStatus("working");
    try {
      await approveLocalChangeSet({ endpoint, requestId: request.id,
        approval: { schemaVersion: 1, expectedPreviewDigest: preview.digest },
        idempotencyKey: `change-set-approve:${request.id}:${preview.digest}` });
      await refresh(); setNotice("Exact multi-file change set approved. Application has not started.");
    } catch (error) {
      setStatus("ready"); setNotice(error instanceof Error ? error.message : "Change-set approval failed safely.");
    }
  }

  async function mutateChangeSet(request: LocalRequest, action: "apply" | "rollback" | "reconcile") {
    setStatus("working");
    try {
      await advanceLocalChangeSet({ endpoint, requestId: request.id, action,
        idempotencyKey: `change-set-${action}:${request.id}:${request.execution?.changeSet?.preview.digest ?? "none"}` });
      await refresh();
      setNotice({ apply: "All approved file operations applied and verified inside the isolated worktree.", rollback: "Every pre-change file state restored and verified.", reconcile: "Interrupted change set classified from filesystem truth without blind retry." }[action]);
    } catch (error) {
      setStatus("ready"); setNotice(error instanceof Error ? error.message : "Change-set action failed safely.");
    }
  }

  async function approveCommit(request: LocalRequest) {
    const preview = request.execution?.commit?.preview;
    if (!preview) return;
    setStatus("working");
    try {
      await approveLocalCommit({
        endpoint,
        requestId: request.id,
        approval: { schemaVersion: 1, expectedPreviewDigest: preview.digest },
        idempotencyKey: `commit-approve:${request.id}:${preview.digest}`,
      });
      await refresh();
      setNotice("Exact isolated commit approved. It has not been created.");
    } catch (error) {
      setStatus("ready");
      setNotice(error instanceof Error ? error.message : "Commit approval failed safely.");
    }
  }

  async function mutateCommit(
    request: LocalRequest,
    action: "create" | "undo" | "reconcile"
  ) {
    setStatus("working");
    try {
      await advanceLocalCommit({
        endpoint,
        requestId: request.id,
        action,
        idempotencyKey: `commit-${action}:${request.id}:${request.execution?.commit?.preview.digest ?? "none"}`,
      });
      await refresh();
      setNotice({
        create: "Local isolated commit created and verified. It was not pushed or merged.",
        undo: "Isolated commit undone; validated patch remains uncommitted.",
        reconcile: "Interrupted commit preserved for explicit Git inspection.",
      }[action]);
    } catch (error) {
      setStatus("ready");
      setNotice(error instanceof Error ? error.message : "Commit action failed safely.");
    }
  }

  async function previewIntegration(request: LocalRequest) {
    const receipt = request.execution?.commit?.receipt;
    if (!receipt) return;
    setStatus("working");
    try {
      await previewLocalIntegration({
        endpoint, requestId: request.id,
        proposal: { schemaVersion: 1, expectedCommitReceiptDigest: receipt.digest },
        idempotencyKey: `integration-preview:${request.id}:${receipt.digest}`,
      });
      await refresh();
      setNotice("Local canonical integration is conflict-free. Nothing was changed.");
    } catch (error) {
      setStatus("ready");
      setNotice(error instanceof Error ? error.message : "Integration preview failed safely.");
    }
  }

  async function approveIntegration(request: LocalRequest) {
    const preview = request.execution?.integration?.preview;
    if (!preview) return;
    setStatus("working");
    try {
      await approveLocalIntegration({
        endpoint, requestId: request.id,
        approval: { schemaVersion: 1, expectedPreviewDigest: preview.digest },
        idempotencyKey: `integration-approve:${request.id}:${preview.digest}`,
      });
      await refresh();
      setNotice("Exact local canonical integration approved. Nothing was pushed.");
    } catch (error) {
      setStatus("ready");
      setNotice(error instanceof Error ? error.message : "Integration approval failed safely.");
    }
  }

  async function mutateIntegration(request: LocalRequest, action: "create" | "undo" | "reconcile") {
    setStatus("working");
    try {
      await advanceLocalIntegration({
        endpoint, requestId: request.id, action,
        idempotencyKey: `integration-${action}:${request.id}:${request.execution?.integration?.preview.digest ?? "none"}`,
      });
      await refresh();
      setNotice({
        create: "Commit integrated into the canonical local branch. It was not pushed or published.",
        undo: "Canonical branch restored to its exact previous HEAD.",
        reconcile: "Interrupted integration preserved for exact Git inspection.",
      }[action]);
    } catch (error) {
      setStatus("ready");
      setNotice(error instanceof Error ? error.message : "Integration action failed safely.");
    }
  }

  const projectNames = new Map(projects.map((project) => [project.id, project.displayName]));
  return (
    <section className="space-y-4" aria-labelledby={`local-request-${props.mode}-title`}>
      <Card className="bg-primary/[.035]">
        <CardHeader className="gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex flex-wrap gap-2">
              <Badge tone={status === "offline" ? "caution" : "positive"}>
                {status === "offline" ? "Runtime offline" : "Live local state"}
              </Badge>
              <Badge>No AI · no source changes</Badge>
            </div>
            <CardTitle id={`local-request-${props.mode}-title`} className="mt-4 text-xl">
              {props.mode === "compose" ? "Create real local work" : "Real local work queue"}
            </CardTitle>
            <CardDescription>
              {props.mode === "compose"
                ? "Turn an outcome into a durable, project-linked queue entry after local safety checks."
                : "Observed request state only. Time passing never becomes invented progress."}
            </CardDescription>
          </div>
          <Button variant="secondary" onClick={() => void refresh()} disabled={status === "working"}>
            <ArrowClockwise />
            Refresh
          </Button>
        </CardHeader>
        <CardContent className="mt-6">
          {props.mode === "compose" && projects.length > 0 && (
            <div className="grid gap-4 lg:grid-cols-[15rem_minmax(0,1fr)]">
              <label className="text-xs font-semibold">
                Target project
                <select
                  value={projectId}
                  onChange={(event) => setProjectId(event.target.value)}
                  className="mt-2 h-11 w-full rounded-2xl bg-muted px-3 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/30"
                >
                  {projects.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.displayName}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs font-semibold">
                Outcome
                <textarea
                  value={outcome}
                  onChange={(event) => setOutcome(event.target.value)}
                  rows={3}
                  maxLength={20_000}
                  placeholder="Describe the result you want…"
                  className="mt-2 w-full resize-none rounded-3xl bg-muted px-4 py-3 text-sm leading-6 outline-none focus-visible:ring-3 focus-visible:ring-ring/30"
                />
              </label>
              <div className="lg:col-start-2 flex flex-wrap items-center justify-between gap-3">
                <span className="text-xs text-muted-foreground">
                  Deterministic preview · smallest reversible change · repository checks
                </span>
                <Button
                  onClick={() => void submit()}
                  disabled={status !== "ready" || !projectId || outcome.trim().length < 3}
                >
                  Queue local request
                  <ArrowRight />
                </Button>
              </div>
            </div>
          )}
          {props.mode === "compose" && projects.length === 0 && status !== "loading" && (
            <div className="grid min-h-32 place-items-center text-center">
              <div>
                <Warning size={28} className="mx-auto text-primary" />
                <strong className="mt-3 block text-sm">Register a project first</strong>
                <p className="mt-1 text-xs text-muted-foreground">
                  Requests cannot target an unregistered or browser-supplied path.
                </p>
                {props.navigate && (
                  <Button className="mt-4" variant="secondary" onClick={() => props.navigate?.("projects")}>
                    Open Projects
                  </Button>
                )}
              </div>
            </div>
          )}
          <p aria-live="polite" className="mt-4 rounded-2xl bg-muted/55 p-4 text-xs leading-5 text-muted-foreground">
            {notice}
          </p>
        </CardContent>
      </Card>

      {(props.mode === "queue" || requests.length > 0) && (
        <div className="grid gap-3 xl:grid-cols-2">
          {requests.map((request) => (
            <Card key={request.id}>
              <CardContent className="p-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap gap-2">
                      <Badge tone={request.state === "queued" ? "active" : "neutral"}>
                        {request.state === "queued" ? <HourglassMedium /> : <CheckCircle />}
                        {request.state.replaceAll("_", " ")}
                      </Badge>
                      <Badge>{projectNames.get(request.projectId) ?? "Unregistered project"}</Badge>
                    </div>
                    <strong className="mt-4 block text-sm leading-6">{request.outcome}</strong>
                    <p className="mt-2 text-xs leading-5 text-muted-foreground">
                      {request.workPreview?.checks.join(" · ") ?? "Needs user input"}
                    </p>
                    {request.run && (
                      <div className="mt-4 rounded-2xl bg-muted/50 p-3">
                        <div className="flex items-center gap-2 text-[10px] uppercase tracking-[.14em] text-muted-foreground">
                          <Fingerprint className="text-primary" />
                          Contract {request.run.contract.digest.slice(0, 12)}
                        </div>
                        <div className="mt-3 grid gap-2 sm:grid-cols-3">
                          <DecisionFact label="Effects" value="None" />
                          <DecisionFact label="Maximum cost" value="$0.00" />
                          <DecisionFact label="Undo" value="Release lease" />
                        </div>
                        <ol className="mt-3 space-y-2" aria-label="Durable run events">
                          {request.run.events.map((event) => (
                            <li key={event.sequence} className="flex gap-3 text-[11px] leading-5">
                              <span className="grid size-5 shrink-0 place-items-center rounded-full bg-primary/12 font-semibold text-primary">
                                {event.sequence}
                              </span>
                              <span>
                                <strong>{event.type.replaceAll("_", " ")}</strong>
                                <span className="block text-muted-foreground">{event.detail}</span>
                              </span>
                            </li>
                          ))}
                        </ol>
                      </div>
                    )}
                    {request.grounding && request.topology && request.plan && (
                      <div className="mt-4 rounded-2xl bg-primary/[.055] p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <strong className="text-xs">Real topology and execution plan</strong>
                          <span className="text-[10px] uppercase tracking-[.13em] text-muted-foreground">
                            revision {request.plan.revision} · {request.plan.state}
                          </span>
                        </div>
                        <div className="mt-3 grid gap-2 sm:grid-cols-3">
                          <DecisionFact
                            label="Observed paths"
                            value={`${request.topology.entries.length}${request.topology.truncated ? "+" : ""}`}
                          />
                          <DecisionFact
                            label="Plan tasks"
                            value={String(request.plan.tasks.length)}
                          />
                          <DecisionFact
                            label="Authority"
                            value="No execution"
                          />
                        </div>
                        <div className="mt-3 flex flex-wrap gap-2">
                          {request.grounding.sources.map((source) => (
                            <span key={source.path} className="rounded-full bg-background px-2.5 py-1 text-[10px]">
                              {source.path} · {source.classification}
                            </span>
                          ))}
                        </div>
                        <ol className="mt-3 space-y-3" aria-label="Dependency-aware execution plan">
                          {request.plan.order.map((taskId, index) => {
                            const task = request.plan?.tasks.find((candidate) => candidate.id === taskId);
                            if (!task) return null;
                            return (
                              <li key={`${task.id}:${request.plan?.revision}`}>
                                <PlanTaskEditor
                                  task={task}
                                  index={index}
                                  count={request.plan?.tasks.length ?? 0}
                                  locked={request.plan?.state === "approved"}
                                  working={status === "working"}
                                  onSave={(title, estimatedMinutes) =>
                                    void editPlan(request, {
                                      type: "edit_task",
                                      taskId: task.id,
                                      title,
                                      estimatedMinutes,
                                    })
                                  }
                                  onMove={(direction) => {
                                    const order = [...(request.plan?.order ?? [])];
                                    const target = index + direction;
                                    if (target < 0 || target >= order.length) return;
                                    [order[index], order[target]] = [order[target]!, order[index]!];
                                    void editPlan(request, { type: "reorder", order });
                                  }}
                                />
                              </li>
                            );
                          })}
                        </ol>
                        {request.plan.approval && (
                          <div className="mt-3 flex items-center gap-2 rounded-2xl bg-background/70 p-3 text-[11px]">
                            <LockKey className="shrink-0 text-primary" />
                            <span>
                              Frozen approval {request.plan.approval.digest.slice(0, 12)} · zero-effect ·
                              execution unauthorized
                            </span>
                          </div>
                        )}
                        {request.execution && (
                          <div className="mt-3 rounded-2xl bg-background/70 p-3">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <span className="flex items-center gap-2 text-[11px] font-semibold">
                                <ShieldCheck className="text-primary" />
                                Execution authority
                              </span>
                              <Badge
                                tone={
                                  ["validated", "review_ready"].includes(request.execution.state)
                                    ? "positive"
                                    : request.execution.state === "failed"
                                      ? "critical"
                                      : "active"
                                }
                              >
                                {request.execution.state}
                              </Badge>
                            </div>
                            <div className="mt-3 grid gap-2 sm:grid-cols-3">
                              <DecisionFact
                                label="Baseline"
                                value={request.execution.authority.preflight.baseline.slice(0, 10)}
                              />
                              <DecisionFact
                                label="Permitted files"
                                value={String(
                                  new Set(
                                    request.execution.authority.manifest.tasks.flatMap(
                                      (task) => task.allowedFiles
                                    )
                                  ).size
                                )}
                              />
                              <DecisionFact label="Maximum cost" value="$0.00" />
                            </div>
                            <p className="mt-3 text-[10px] leading-5 text-muted-foreground">
                              Allows one private Git worktree only · excludes canonical writes,
                              network, providers, credentials, paid usage, publishing, and deployment
                            </p>
                            {request.execution.workspace && (
                              <p className="mt-2 text-[10px] font-medium">
                                {request.execution.workspace.branch} · workspace{" "}
                                {request.execution.workspace.state}
                              </p>
                            )}
                            {request.execution.run && (
                              <div className="mt-3 bg-primary/[.055] p-3">
                                <div className="grid gap-2 sm:grid-cols-3">
                                  <DecisionFact
                                    label="Bounded run"
                                    value={request.execution.run.id.slice("execution_".length, 12)}
                                  />
                                  <DecisionFact
                                    label="Validation"
                                    value={
                                      request.execution.run.attempts.at(-1)?.state ??
                                      "Not started"
                                    }
                                  />
                                  <DecisionFact
                                    label="Observed changes"
                                    value={String(
                                      request.execution.run.changes?.changedPaths.length ?? 0
                                    )}
                                  />
                                </div>
                                {request.execution.run.attempts.at(-1) && (
                                  <p className="mt-2 text-[10px] text-muted-foreground">
                                    git diff --check · fixed argv · 10s limit · 64 KiB output cap
                                  </p>
                                )}
                                {(request.execution.run.changes?.blockers.length ?? 0) > 0 && (
                                  <p className="mt-2 text-[10px] font-medium text-destructive">
                                    {request.execution.run.changes?.blockers[0]}
                                  </p>
                                )}
                              </div>
                            )}
                            {request.execution.run?.state === "ready" &&
                              !request.execution.patch && !request.execution.changeSet && !request.execution.proposal && (
                                <div className="mt-3 bg-primary/[.055] p-3">
                                  <div className="flex flex-wrap items-center justify-between gap-2">
                                    <div>
                                      <p className="text-[11px] font-semibold">Atomic multi-file change set</p>
                                      <p className="mt-1 text-[10px] text-muted-foreground">1–12 create, replace, or delete operations · previewed together · rolled back together</p>
                                    </div>
                                    <Button size="sm" variant="secondary" disabled={(changeSetDrafts[request.id]?.length ?? 0) >= 12} onClick={() => setChangeSetDrafts((current) => ({ ...current, [request.id]: [...(current[request.id] ?? []), { type: "replace", path: "", content: "" }] }))}>
                                      Add operation
                                    </Button>
                                  </div>
                                  <div className="mt-3 grid gap-3">
                                    {(changeSetDrafts[request.id] ?? []).map((operation, index) => (
                                      <div key={`${request.id}-change-${index}`} className="bg-background/65 p-3">
                                        <div className="grid gap-2 sm:grid-cols-[8rem_minmax(0,1fr)_auto]">
                                          <select aria-label={`Operation ${index + 1} type`} value={operation.type} onChange={(event) => setChangeSetDrafts((current) => ({ ...current, [request.id]: (current[request.id] ?? []).map((item, itemIndex) => itemIndex === index ? { ...item, type: event.target.value as "create" | "replace" | "delete" } : item) }))} className="h-10 rounded-xl bg-background/80 px-3 text-xs outline-none focus:ring-2 focus:ring-primary">
                                            <option value="replace">Replace</option><option value="create">Create</option><option value="delete">Delete</option>
                                          </select>
                                          {operation.type === "create" ? (
                                            <input aria-label={`Operation ${index + 1} approved path`} value={operation.path} onChange={(event) => setChangeSetDrafts((current) => ({ ...current, [request.id]: (current[request.id] ?? []).map((item, itemIndex) => itemIndex === index ? { ...item, path: event.target.value } : item) }))} placeholder="Approved new project-relative path" className="h-10 rounded-xl bg-background/80 px-3 text-xs outline-none focus:ring-2 focus:ring-primary" />
                                          ) : (
                                            <select aria-label={`Operation ${index + 1} approved path`} value={operation.path} onChange={(event) => setChangeSetDrafts((current) => ({ ...current, [request.id]: (current[request.id] ?? []).map((item, itemIndex) => itemIndex === index ? { ...item, path: event.target.value } : item) }))} className="h-10 rounded-xl bg-background/80 px-3 text-xs outline-none focus:ring-2 focus:ring-primary">
                                              <option value="">Choose approved file</option>
                                              {[...new Set(request.execution?.authority.manifest.tasks.flatMap((task) => task.allowedFiles) ?? [])].map((path) => <option key={path} value={path}>{path}</option>)}
                                            </select>
                                          )}
                                          <Button size="sm" variant="secondary" aria-label={`Remove operation ${index + 1}`} onClick={() => setChangeSetDrafts((current) => ({ ...current, [request.id]: (current[request.id] ?? []).filter((_, itemIndex) => itemIndex !== index) }))}><Trash /></Button>
                                        </div>
                                        {operation.type !== "delete" && (
                                          <textarea aria-label={`Operation ${index + 1} content`} value={operation.content} onChange={(event) => setChangeSetDrafts((current) => ({ ...current, [request.id]: (current[request.id] ?? []).map((item, itemIndex) => itemIndex === index ? { ...item, content: event.target.value } : item) }))} maxLength={65_536} rows={4} placeholder={operation.type === "create" ? "Complete new UTF-8 file content…" : "Complete replacement UTF-8 file content…"} className="mt-2 w-full resize-y rounded-xl bg-background/80 p-3 font-mono text-xs outline-none focus:ring-2 focus:ring-primary" />
                                        )}
                                      </div>
                                    ))}
                                  </div>
                                  <Button size="sm" className="mt-3" disabled={status === "working" || (changeSetDrafts[request.id]?.length ?? 0) === 0} onClick={() => void previewChangeSet(request)}><Fingerprint />Preview atomic change set</Button>
                                </div>
                              )}
                            {request.execution.run?.state === "ready" &&
                              !request.execution.patch && !request.execution.changeSet && !request.execution.proposal && (
                                <div className="mt-3 bg-primary/[.055] p-3">
                                  <p className="text-[11px] font-semibold">
                                    Exact isolated replacement
                                  </p>
                                  <div className="mt-3 grid gap-2">
                                    <select
                                      aria-label="Approved patch target"
                                      value={patchDrafts[request.id]?.path ?? ""}
                                      onChange={(event) =>
                                        setPatchDrafts((current) => ({
                                          ...current,
                                          [request.id]: {
                                            path: event.target.value,
                                            content: current[request.id]?.content ?? "",
                                          },
                                        }))
                                      }
                                      className="h-10 rounded-xl bg-background/80 px-3 text-xs outline-none focus:ring-2 focus:ring-primary"
                                    >
                                      <option value="">Choose an approved file</option>
                                      {[
                                        ...new Set(
                                          request.execution.authority.manifest.tasks.flatMap(
                                            (task) => task.allowedFiles
                                          )
                                        ),
                                      ].map((path) => (
                                        <option key={path} value={path}>
                                          {path}
                                        </option>
                                      ))}
                                    </select>
                                    <textarea
                                      aria-label="Replacement text"
                                      value={patchDrafts[request.id]?.content ?? ""}
                                      onChange={(event) =>
                                        setPatchDrafts((current) => ({
                                          ...current,
                                          [request.id]: {
                                            path: current[request.id]?.path ?? "",
                                            content: event.target.value,
                                          },
                                        }))
                                      }
                                      maxLength={65_536}
                                      rows={6}
                                      placeholder="Paste the complete replacement text…"
                                      className="resize-y rounded-xl bg-background/80 p-3 font-mono text-xs outline-none focus:ring-2 focus:ring-primary"
                                    />
                                    <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                                      <span>Single existing UTF-8 file · 64 KiB maximum</span>
                                      <span>
                                        {new TextEncoder().encode(
                                          patchDrafts[request.id]?.content ?? ""
                                        ).length.toLocaleString()}{" "}
                                        bytes
                                      </span>
                                    </div>
                                    <Button
                                      size="sm"
                                      onClick={() => void previewPatch(request)}
                                      disabled={
                                        status === "working" ||
                                        !patchDrafts[request.id]?.path
                                      }
                                    >
                                      <Fingerprint />
                                      Preview exact replacement
                                    </Button>
                                  </div>
                                </div>
                              )}
                            {request.execution.patch && (
                              <div className="mt-3 bg-primary/[.055] p-3">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <strong className="text-[11px]">
                                    {request.execution.patch.preview.path}
                                  </strong>
                                  <Badge
                                    tone={
                                      request.execution.patch.state === "applied"
                                        ? "positive"
                                        : request.execution.patch.state === "interrupted"
                                          ? "critical"
                                          : "active"
                                    }
                                  >
                                    {request.execution.patch.state}
                                  </Badge>
                                </div>
                                <div className="mt-3 grid gap-2 sm:grid-cols-3">
                                  <DecisionFact
                                    label="Before"
                                    value={request.execution.patch.preview.beforeDigest.slice(0, 10)}
                                  />
                                  <DecisionFact
                                    label="After"
                                    value={request.execution.patch.preview.afterDigest.slice(0, 10)}
                                  />
                                  <DecisionFact
                                    label="Byte delta"
                                    value={String(
                                      request.execution.patch.preview.afterBytes -
                                        request.execution.patch.preview.beforeBytes
                                    )}
                                  />
                                </div>
                                <p className="mt-2 text-[10px] text-muted-foreground">
                                  Applied means isolated bytes verified · never committed, merged,
                                  pushed, published, or deployed
                                </p>
                              </div>
                            )}
                            {request.execution.changeSet && (
                              <div className="mt-3 bg-primary/[.055] p-3">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <strong className="text-[11px]">Multi-file change set</strong>
                                  <Badge tone={request.execution.changeSet.state === "applied" ? "positive" : request.execution.changeSet.state === "interrupted" ? "critical" : "active"}>{request.execution.changeSet.state}</Badge>
                                </div>
                                <div className="mt-3 grid gap-2 sm:grid-cols-3">
                                  <DecisionFact label="Operations" value={String(request.execution.changeSet.preview.operations.length)} />
                                  <DecisionFact label="Before" value={`${request.execution.changeSet.preview.totalBeforeBytes.toLocaleString()} bytes`} />
                                  <DecisionFact label="After" value={`${request.execution.changeSet.preview.totalAfterBytes.toLocaleString()} bytes`} />
                                </div>
                                <p className="mt-2 text-[10px] text-muted-foreground">{request.execution.changeSet.preview.operations.map((item) => `${item.type} ${item.path}`).join(" · ")}</p>
                              </div>
                            )}
                            {request.execution.proposal && (
                              <Suspense
                                fallback={
                                  <div className="mt-3 bg-primary/[.055] p-3 text-[11px] text-muted-foreground">
                                    Loading proposal evidence…
                                  </div>
                                }
                              >
                                <LocalProposalCard proposal={request.execution.proposal} />
                              </Suspense>
                            )}
                            {request.execution.state === "review_ready" &&
                              !request.execution.commit && (
                                <div className="mt-3 bg-primary/[.055] p-3">
                                  <p className="text-[11px] font-semibold">
                                    Local isolated commit
                                  </p>
                                  <input
                                    aria-label="Local commit message"
                                    value={commitMessages[request.id] ?? ""}
                                    onChange={(event) =>
                                      setCommitMessages((current) => ({
                                        ...current,
                                        [request.id]: event.target.value,
                                      }))
                                    }
                                    maxLength={200}
                                    placeholder="Describe the validated change…"
                                    className="mt-3 h-10 w-full rounded-xl bg-background/80 px-3 text-xs outline-none focus:ring-2 focus:ring-primary"
                                  />
                                  <p className="mt-2 text-[10px] text-muted-foreground">
                                    Hooks and signing disabled · local identity · never pushed
                                  </p>
                                  <Button
                                    size="sm"
                                    className="mt-3"
                                    onClick={() => void previewCommit(request)}
                                    disabled={
                                      status === "working" ||
                                      (commitMessages[request.id]?.trim().length ?? 0) < 3
                                    }
                                  >
                                    <Fingerprint />
                                    Preview local commit
                                  </Button>
                                </div>
                              )}
                            {request.execution.commit && (
                              <div className="mt-3 bg-primary/[.055] p-3">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <strong className="text-[11px]">
                                    {request.execution.commit.preview.message}
                                  </strong>
                                  <Badge
                                    tone={
                                      request.execution.commit.state === "created"
                                        ? "positive"
                                        : request.execution.commit.state === "interrupted"
                                          ? "critical"
                                          : "active"
                                    }
                                  >
                                    {request.execution.commit.state}
                                  </Badge>
                                </div>
                                <p className="mt-2 text-[10px] text-muted-foreground">
                                  {request.execution.commit.preview.changedPaths.length} paths · +
                                  {request.execution.commit.preview.insertions} / −
                                  {request.execution.commit.preview.deletions} · parent{" "}
                                  {request.execution.commit.preview.parentCommit.slice(0, 8)}
                                </p>
                                {request.execution.commit.receipt && (
                                  <p className="mt-2 text-[10px] font-medium">
                                    Commit {request.execution.commit.receipt.commit.slice(0, 10)} ·{" "}
                                    {request.execution.commit.receipt.branch} · not pushed
                                  </p>
                                )}
                              </div>
                            )}
                            {request.execution.integration && (
                              <div className="mt-3 bg-primary/[.055] p-3">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <strong className="text-[11px]">Local canonical integration</strong>
                                  <Badge tone={request.execution.integration.state === "created" ? "positive" : request.execution.integration.state === "interrupted" ? "critical" : "active"}>
                                    {request.execution.integration.state}
                                  </Badge>
                                </div>
                                <p className="mt-2 text-[10px] text-muted-foreground">
                                  {request.execution.integration.preview.targetBranch} · {request.execution.integration.preview.targetHead.slice(0, 8)} · {request.execution.integration.preview.changedPaths.length} paths · conflict probe passed
                                </p>
                                {request.execution.integration.receipt && (
                                  <p className="mt-2 text-[10px] font-medium">
                                    Local HEAD {request.execution.integration.receipt.resultingHead.slice(0, 10)} · not pushed
                                  </p>
                                )}
                              </div>
                            )}
                          </div>
                        )}
                        <p className="mt-3 text-[10px] text-muted-foreground">
                          Grounding citations explain why · topology paths define proposed targets · no
                          model or worker has run
                        </p>
                      </div>
                    )}
                  </div>
                  <span className="text-[10px] text-muted-foreground">
                    {new Date(request.createdAt).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                </div>
                <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                  <span className="text-[10px] uppercase tracking-[.15em] text-muted-foreground">
                    {request.workPreview?.provenance.replaceAll("_", " ") ?? request.provenance}
                  </span>
                  <div className="flex flex-wrap gap-2">
                  {request.state === "queued" && (
                    <>
                      <Button size="sm" onClick={() => void advance(request, "approve")} disabled={status === "working"}>
                        <CheckCircle />
                        Approve zero-effect contract
                      </Button>
                      <Button size="sm" variant="secondary" onClick={() => void mutate(request, "cancel")} disabled={status === "working"}>
                        <Stop />
                        Cancel safely
                      </Button>
                    </>
                  )}
                  {request.state === "approved" && !request.plan && (
                    <Button size="sm" onClick={() => void advance(request, "ground")} disabled={status === "working"}>
                      <Fingerprint />
                      Ground and draft plan
                    </Button>
                  )}
                  {request.state === "approved" && request.plan?.state === "draft" && (
                    <Button size="sm" onClick={() => void approvePlan(request)} disabled={status === "working"}>
                      <LockKey />
                      Approve and freeze plan
                    </Button>
                  )}
                  {request.state === "approved" && request.plan?.state === "approved" && (
                    <>
                      {!request.execution && (
                        <Button
                          size="sm"
                          onClick={() => void authorizeExecution(request)}
                          disabled={status === "working"}
                        >
                          <ShieldCheck />
                          Authorize isolated preparation
                        </Button>
                      )}
                      {request.execution?.state === "authorized" && (
                        <Button
                          size="sm"
                          onClick={() => void mutateExecution(request, "prepare")}
                          disabled={status === "working"}
                        >
                          <Play />
                          Prepare isolated workspace
                        </Button>
                      )}
                      {request.execution?.state === "ready" && !request.execution.run && (
                        <Button
                          size="sm"
                          onClick={() => void mutateExecution(request, "start")}
                          disabled={status === "working"}
                        >
                          <Play />
                          Start bounded run
                        </Button>
                      )}
                      {request.execution?.state === "ready" &&
                        request.execution.run?.state === "ready" && (
                          <>
                            {!request.execution.patch && !request.execution.changeSet && (
                              <Suspense fallback={null}>
                                <LocalProposalControls
                                  endpoint={endpoint}
                                  request={request}
                                  working={status === "working"}
                                  onComplete={async (message) => {
                                    await refresh();
                                    setNotice(message);
                                  }}
                                  onError={(message) => {
                                    setStatus("ready");
                                    setNotice(message);
                                  }}
                                />
                              </Suspense>
                            )}
                            {request.execution.patch?.state === "previewed" && (
                              <Button
                                size="sm"
                                onClick={() => void approvePatch(request)}
                                disabled={status === "working"}
                              >
                                <LockKey />
                                Approve exact patch
                              </Button>
                            )}
                            {request.execution.patch?.state === "approved" && (
                              <Button
                                size="sm"
                                onClick={() => void mutatePatch(request, "apply")}
                                disabled={status === "working"}
                              >
                                <FloppyDisk />
                                Apply inside worktree
                              </Button>
                            )}
                            {request.execution.patch?.state === "applied" && (
                              <>
                                <Button
                                  size="sm"
                                  onClick={() => void mutateExecution(request, "validate")}
                                  disabled={status === "working"}
                                >
                                  <CheckCircle />
                                  Validate isolated patch
                                </Button>
                                <Button
                                  size="sm"
                                  variant="secondary"
                                  onClick={() => void mutatePatch(request, "rollback")}
                                  disabled={status === "working"}
                                >
                                  <ArrowClockwise />
                                  Roll back isolated patch
                                </Button>
                              </>
                            )}
                            {request.execution.patch?.state === "applying" && (
                              <Button
                                size="sm"
                                variant="secondary"
                                onClick={() => void mutatePatch(request, "reconcile")}
                                disabled={status === "working"}
                              >
                                <ArrowClockwise />
                                Reconcile patch interruption
                              </Button>
                            )}
                            {request.execution.changeSet?.state === "previewed" && (
                              <Button
                                size="sm"
                                onClick={() => void approveChangeSet(request)}
                                disabled={status === "working"}
                              >
                                <LockKey />
                                Approve exact change set
                              </Button>
                            )}
                            {request.execution.changeSet?.state === "approved" && (
                              <Button
                                size="sm"
                                onClick={() => void mutateChangeSet(request, "apply")}
                                disabled={status === "working"}
                              >
                                <FloppyDisk />
                                Apply all files atomically
                              </Button>
                            )}
                            {request.execution.changeSet?.state === "applied" && (
                              <>
                                <Button
                                  size="sm"
                                  onClick={() => void mutateExecution(request, "validate")}
                                  disabled={status === "working"}
                                >
                                  <CheckCircle />
                                  Validate complete change set
                                </Button>
                                <Button
                                  size="sm"
                                  variant="secondary"
                                  onClick={() => void mutateChangeSet(request, "rollback")}
                                  disabled={status === "working"}
                                >
                                  <ArrowClockwise />
                                  Roll back every file
                                </Button>
                              </>
                            )}
                            {request.execution.changeSet?.state === "applying" && (
                              <Button
                                size="sm"
                                variant="secondary"
                                onClick={() => void mutateChangeSet(request, "reconcile")}
                                disabled={status === "working"}
                              >
                                <ArrowClockwise />
                                Reconcile interrupted change set
                              </Button>
                            )}
                          </>
                        )}
                      {[
                        "authorized",
                        "preparing",
                        "ready",
                        "validating",
                        "validated",
                        "review_ready",
                        "failed",
                      ].includes(
                        request.execution?.state ?? ""
                      ) && (
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => void mutateExecution(request, "cancel")}
                          disabled={status === "working"}
                        >
                          <Stop />
                          Cancel and preserve
                        </Button>
                      )}
                      {["preparing", "validating"].includes(
                        request.execution?.state ?? ""
                      ) && (
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => void mutateExecution(request, "reconcile")}
                          disabled={status === "working"}
                        >
                          <ArrowClockwise />
                          Reconcile interruption
                        </Button>
                      )}
                    </>
                  )}
                  {request.state === "claimed" && (
                    <Button size="sm" onClick={() => void advance(request, "checkpoint")} disabled={status === "working"}>
                      <CheckCircle />
                      Record zero-effect checkpoint
                    </Button>
                  )}
                  {request.execution?.commit?.state === "previewed" && (
                    <Button
                      size="sm"
                      onClick={() => void approveCommit(request)}
                      disabled={status === "working"}
                    >
                      <LockKey />
                      Approve local commit
                    </Button>
                  )}
                  {request.execution?.commit?.state === "approved" && (
                    <Button
                      size="sm"
                      onClick={() => void mutateCommit(request, "create")}
                      disabled={status === "working"}
                    >
                      <GitBranch />
                      Create isolated commit
                    </Button>
                  )}
                  {request.execution?.commit?.state === "created" && (
                    <>
                      {!request.execution.integration && (
                        <Button size="sm" onClick={() => void previewIntegration(request)} disabled={status === "working"}>
                          <GitBranch /> Preview local integration
                        </Button>
                      )}
                      <Button size="sm" variant="secondary" onClick={() => void mutateCommit(request, "undo")} disabled={status === "working" || Boolean(request.execution.integration)}>
                        <ArrowClockwise /> Undo isolated commit
                      </Button>
                    </>
                  )}
                  {request.execution?.integration?.state === "previewed" && (
                    <Button size="sm" onClick={() => void approveIntegration(request)} disabled={status === "working"}>
                      <LockKey /> Approve local integration
                    </Button>
                  )}
                  {request.execution?.integration?.state === "approved" && (
                    <Button size="sm" onClick={() => void mutateIntegration(request, "create")} disabled={status === "working"}>
                      <GitBranch /> Integrate into local branch
                    </Button>
                  )}
                  {request.execution?.integration?.state === "created" && (
                    <Button size="sm" variant="secondary" onClick={() => void mutateIntegration(request, "undo")} disabled={status === "working"}>
                      <ArrowClockwise /> Undo local integration
                    </Button>
                  )}
                  {request.execution?.integration?.state === "creating" && (
                    <Button size="sm" variant="secondary" onClick={() => void mutateIntegration(request, "reconcile")} disabled={status === "working"}>
                      <ArrowClockwise /> Reconcile integration
                    </Button>
                  )}
                  {request.execution?.commit?.state === "creating" && (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => void mutateCommit(request, "reconcile")}
                      disabled={status === "working"}
                    >
                      <ArrowClockwise />
                      Reconcile commit interruption
                    </Button>
                  )}
                  {request.state === "checkpointed" && (
                    <Button size="sm" onClick={() => void advance(request, "release")} disabled={status === "working"}>
                      <CheckCircle />
                      Release proof lease
                    </Button>
                  )}
                  {["completed", "interrupted", "cancelled"].includes(request.state) && (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => void mutate(request, "archive")}
                      disabled={status === "working"}
                    >
                      <Trash />
                      Archive
                    </Button>
                  )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
          {requests.length === 0 && status !== "loading" && (
            <Card>
              <CardContent className="grid min-h-36 place-items-center p-6 text-center">
                <div>
                  <HourglassMedium size={30} className="mx-auto text-primary" />
                  <strong className="mt-3 block text-sm">The real queue is empty</strong>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Synthetic examples below are not active work.
                  </p>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </section>
  );
}

function DecisionFact({ label, value }: { label: string; value: string }) {
  return (
    <span>
      <span className="block text-[9px] uppercase tracking-[.13em] text-muted-foreground">
        {label}
      </span>
      <strong className="mt-1 block text-[11px]">{value}</strong>
    </span>
  );
}

function PlanTaskEditor(props: {
  task: LocalDraftPlan["tasks"][number];
  index: number;
  count: number;
  locked: boolean;
  working: boolean;
  onSave: (title: string, estimatedMinutes: number) => void;
  onMove: (direction: -1 | 1) => void;
}) {
  const [title, setTitle] = useState(props.task.title);
  const [estimatedMinutes, setEstimatedMinutes] = useState(props.task.estimatedMinutes);
  const changed =
    title.trim() !== props.task.title ||
    estimatedMinutes !== props.task.estimatedMinutes;
  return (
    <article className="rounded-2xl bg-background/75 p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 gap-3">
          <span className="grid size-7 shrink-0 place-items-center rounded-full bg-primary/12 text-[11px] font-semibold text-primary">
            {props.index + 1}
          </span>
          <div className="min-w-0 flex-1">
            {props.locked ? (
              <strong className="text-xs leading-5">{props.task.title}</strong>
            ) : (
              <label className="block text-[10px] font-semibold uppercase tracking-[.12em] text-muted-foreground">
                Task title
                <input
                  value={title}
                  maxLength={160}
                  onChange={(event) => setTitle(event.target.value)}
                  className="mt-1 h-9 w-full rounded-xl bg-muted px-3 text-xs font-medium normal-case tracking-normal text-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/30"
                />
              </label>
            )}
            <p className="mt-2 text-[11px] leading-5 text-muted-foreground">
              Targets · {props.task.allowedFiles.join(" · ")}
            </p>
            <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
              Depends on · {props.task.dependsOn.length > 0
                ? props.task.dependsOn.map((id) => id.slice(-6)).join(" · ")
                : "Nothing"}
            </p>
            <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
              Cites · {props.task.citedSources.join(" · ")}
            </p>
          </div>
        </div>
        <Badge tone={props.task.risk === "high" ? "caution" : "neutral"}>
          {props.task.risk} risk
        </Badge>
      </div>
      <div className="mt-3 flex flex-wrap items-end justify-between gap-2">
        <div className="flex items-center gap-2">
          <GitBranch className="text-primary" />
          {props.locked ? (
            <span className="text-[11px]">{props.task.estimatedMinutes} min</span>
          ) : (
            <label className="text-[10px] font-semibold uppercase tracking-[.12em] text-muted-foreground">
              Minutes
              <input
                type="number"
                min={5}
                max={480}
                step={5}
                value={estimatedMinutes}
                onChange={(event) => setEstimatedMinutes(Number(event.target.value))}
                className="ml-2 h-8 w-20 rounded-xl bg-muted px-2 text-xs normal-case tracking-normal text-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/30"
              />
            </label>
          )}
        </div>
        {!props.locked && (
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="ghost"
              aria-label={`Move ${props.task.title} earlier`}
              disabled={props.working || props.index === 0}
              onClick={() => props.onMove(-1)}
            >
              <ArrowUp />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              aria-label={`Move ${props.task.title} later`}
              disabled={props.working || props.index === props.count - 1}
              onClick={() => props.onMove(1)}
            >
              <ArrowDown />
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={
                props.working ||
                !changed ||
                title.trim().length === 0 ||
                estimatedMinutes < 5 ||
                estimatedMinutes > 480
              }
              onClick={() => props.onSave(title.trim(), estimatedMinutes)}
            >
              <FloppyDisk />
              Save task
            </Button>
          </div>
        )}
      </div>
    </article>
  );
}
