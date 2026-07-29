import { ArrowRight } from "@phosphor-icons/react/ArrowRight";
import { ArrowClockwise } from "@phosphor-icons/react/ArrowClockwise";
import { CheckCircle } from "@phosphor-icons/react/CheckCircle";
import { HourglassMedium } from "@phosphor-icons/react/HourglassMedium";
import { Stop } from "@phosphor-icons/react/Stop";
import { Trash } from "@phosphor-icons/react/Trash";
import { Warning } from "@phosphor-icons/react/Warning";
import { useCallback, useEffect, useRef, useState } from "react";

import type { LocalProjectSnapshot } from "../../../../../packages/runtime/src/local-projects.js";
import type { LocalRequest } from "../../../../../packages/runtime/src/local-requests.js";
import { listLocalProjects } from "../../local-project-client.js";
import {
  archiveLocalRequest,
  cancelLocalRequest,
  createLocalRequest,
  listLocalRequests,
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
                  {request.state === "queued" ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => void mutate(request, "cancel")}
                      disabled={status === "working"}
                    >
                      <Stop />
                      Cancel safely
                    </Button>
                  ) : (
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
