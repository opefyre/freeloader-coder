import { ArrowClockwise } from "@phosphor-icons/react/ArrowClockwise";
import { CheckCircle } from "@phosphor-icons/react/CheckCircle";
import { FolderOpen } from "@phosphor-icons/react/FolderOpen";
import { ShieldCheck } from "@phosphor-icons/react/ShieldCheck";
import { Trash } from "@phosphor-icons/react/Trash";
import { Warning } from "@phosphor-icons/react/Warning";
import { useCallback, useEffect, useRef, useState } from "react";

import type {
  LocalProjectCollection,
  LocalProjectSnapshot,
} from "../../../../../packages/runtime/src/local-projects.js";
import {
  forgetLocalProject,
  listLocalProjects,
  registerLocalProject,
  rescanLocalProject,
} from "../../local-project-client.js";
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

type ViewState =
  | { status: "loading"; collection: LocalProjectCollection | null; error: null }
  | {
      status: "ready" | "offline" | "working";
      collection: LocalProjectCollection | null;
      error: string | null;
    };

export function LocalProjectsPanel() {
  const [state, setState] = useState<ViewState>({
    status: "loading",
    collection: null,
    error: null,
  });
  const [path, setPath] = useState("");
  const [notice, setNotice] = useState(
    "Only bounded repository metadata is read. Source files, secrets, and absolute paths never enter Studio."
  );
  const [forgetCandidate, setForgetCandidate] = useState<string | null>(null);
  const disposed = useRef(false);

  const refresh = useCallback(async () => {
    try {
      const collection = await listLocalProjects({ endpoint });
      if (!disposed.current) {
        setState({ status: "ready", collection, error: null });
      }
    } catch {
      if (!disposed.current) {
        setState((previous) => ({
          status: "offline",
          collection: previous.collection,
          error: "Local runtime is offline. The last safe project view is preserved.",
        }));
      }
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

  const register = async () => {
    if (!path.trim()) {
      setNotice("Paste an absolute path to an existing local Git repository.");
      return;
    }
    setState((previous) => ({ ...previous, status: "working", error: null }));
    setNotice("Inspecting bounded metadata. No repository command is running.");
    try {
      await registerLocalProject({
        endpoint,
        path: path.trim(),
        idempotencyKey: `register:${crypto.randomUUID()}`,
      });
      setPath("");
      setNotice("Project registered. Review observed facts and explicit limitations below.");
      await refresh();
    } catch (error) {
      setState((previous) => ({
        status: "ready",
        collection: previous.collection,
        error: error instanceof Error ? error.message : "Registration failed safely.",
      }));
    }
  };

  const rescan = async (projectId: string) => {
    setState((previous) => ({ ...previous, status: "working", error: null }));
    setNotice("Refreshing read-only metadata. The last good observation remains available.");
    try {
      await rescanLocalProject({ endpoint, projectId });
      setNotice("Read-only scan refreshed.");
      await refresh();
    } catch (error) {
      setState((previous) => ({
        status: "ready",
        collection: previous.collection,
        error: error instanceof Error ? error.message : "Rescan failed safely.",
      }));
    }
  };

  const forget = async (projectId: string) => {
    setState((previous) => ({ ...previous, status: "working", error: null }));
    try {
      await forgetLocalProject({ endpoint, projectId });
      setForgetCandidate(null);
      setNotice(
        "Registration forgotten. The repository and every file inside it remain untouched."
      );
      await refresh();
    } catch (error) {
      setState((previous) => ({
        status: "ready",
        collection: previous.collection,
        error: error instanceof Error ? error.message : "Forget failed safely.",
      }));
    }
  };

  const projects = state.collection?.projects ?? [];
  return (
    <section className="space-y-4" aria-labelledby="local-projects-title">
      <Card className="bg-primary/[.035]">
        <CardHeader className="gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={state.status === "offline" ? "caution" : "positive"}>
                {state.status === "offline"
                  ? "Runtime offline"
                  : state.status === "working"
                    ? "Reading metadata"
                    : "Live local registry"}
              </Badge>
              <Badge>Read-only onboarding</Badge>
            </div>
            <CardTitle id="local-projects-title" className="mt-4 text-xl">
              Your real local projects
            </CardTitle>
            <CardDescription>
              Register an existing Git worktree. Studio stores its path only in a private
              local registry and sends the browser an opaque identity.
            </CardDescription>
          </div>
          <Button variant="secondary" onClick={() => void refresh()}>
            <ArrowClockwise />
            Refresh runtime
          </Button>
        </CardHeader>
        <CardContent className="mt-6">
          <label htmlFor="local-project-path" className="text-xs font-semibold">
            Absolute repository path
          </label>
          <div className="mt-2 flex flex-col gap-2 lg:flex-row">
            <input
              id="local-project-path"
              value={path}
              onChange={(event) => setPath(event.target.value)}
              placeholder="/Users/you/Projects/my-app"
              autoComplete="off"
              spellCheck={false}
              disabled={state.status === "working"}
              className="h-11 min-w-0 flex-1 rounded-2xl bg-muted px-4 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/30"
            />
            <Button
              onClick={() => void register()}
              disabled={state.status === "working" || state.status === "offline"}
            >
              <FolderOpen weight="fill" />
              Register and inspect
            </Button>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <BoundaryFact label="Repository writes" value="None" />
            <BoundaryFact label="Commands or AI" value="None" />
            <BoundaryFact label="Browser path access" value="None" />
          </div>
          {(state.error || notice) && (
            <p
              aria-live="polite"
              className="mt-4 rounded-2xl bg-muted/55 p-4 text-xs leading-5 text-muted-foreground"
            >
              {state.error ?? notice}
            </p>
          )}
        </CardContent>
      </Card>

      {state.status === "loading" && (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            Checking the private local registry…
          </CardContent>
        </Card>
      )}

      {state.status !== "loading" && projects.length === 0 && (
        <Card>
          <CardContent className="grid min-h-48 place-items-center p-6 text-center">
            <div>
              <FolderOpen size={32} className="mx-auto text-primary" weight="duotone" />
              <strong className="mt-4 block">No real project registered yet</strong>
              <p className="mx-auto mt-2 max-w-lg text-sm text-muted-foreground">
                The guided example further down is synthetic. Registering a folder above
                creates the first real local observation.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 xl:grid-cols-2">
        {projects.map((project) => (
          <ProjectObservation
            key={project.id}
            project={project}
            working={state.status === "working"}
            forgetCandidate={forgetCandidate}
            onRescan={() => void rescan(project.id)}
            onRequestForget={() => setForgetCandidate(project.id)}
            onCancelForget={() => setForgetCandidate(null)}
            onConfirmForget={() => void forget(project.id)}
          />
        ))}
      </div>
    </section>
  );
}

function ProjectObservation(props: {
  project: LocalProjectSnapshot;
  working: boolean;
  forgetCandidate: string | null;
  onRescan: () => void;
  onRequestForget: () => void;
  onCancelForget: () => void;
  onConfirmForget: () => void;
}) {
  const { project } = props;
  const freshness =
    Date.now() - project.observedAt <= project.validForMs ? "Current" : "Stale";
  return (
    <Card>
      <CardHeader className="gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={project.state === "ready" ? "positive" : "caution"}>
              {project.state}
            </Badge>
            <Badge>{freshness}</Badge>
          </div>
          <CardTitle className="mt-4 text-xl">{project.displayName}</CardTitle>
          <CardDescription>
            Opaque identity {project.id.slice(-8)} · observed{" "}
            {new Date(project.observedAt).toLocaleTimeString()}
          </CardDescription>
        </div>
        <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-primary/10 text-primary">
          {project.warnings.length > 0 ? (
            <Warning size={22} weight="duotone" />
          ) : (
            <CheckCircle size={22} weight="duotone" />
          )}
        </span>
      </CardHeader>
      <CardContent className="mt-6 space-y-5">
        <div className="grid gap-3 sm:grid-cols-2">
          {project.facts.map((fact) => (
            <div key={fact.label} className="rounded-2xl bg-muted/50 p-4">
              <span className="text-[10px] font-semibold uppercase tracking-[.14em] text-muted-foreground">
                {fact.label}
              </span>
              <strong className="mt-2 block text-sm">{fact.value}</strong>
              <span className="mt-1 block text-[11px] text-muted-foreground">
                Evidence: {fact.evidence}
              </span>
            </div>
          ))}
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <ListBlock label="Bounded inferences" items={project.inferences} />
          <ListBlock label="Your decisions" items={project.decisions} />
        </div>
        {project.warnings.length > 0 && (
          <div className="rounded-2xl bg-amber-400/[.08] p-4">
            <div className="flex items-center gap-2 text-xs font-semibold">
              <Warning className="text-amber-700 dark:text-amber-300" />
              Honest limitations
            </div>
            <ul className="mt-3 space-y-2 text-xs leading-5 text-muted-foreground">
              {project.warnings.map((warning) => (
                <li key={warning}>• {warning}</li>
              ))}
            </ul>
          </div>
        )}
        {props.forgetCandidate === project.id ? (
          <div className="rounded-2xl bg-muted/55 p-4">
            <div className="flex items-start gap-3">
              <ShieldCheck className="mt-0.5 shrink-0 text-primary" />
              <p className="text-xs leading-5 text-muted-foreground">
                Forget only this registry entry and its cached metadata? The repository
                folder and every file remain untouched.
              </p>
            </div>
            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <Button variant="secondary" onClick={props.onCancelForget}>
                Keep registration
              </Button>
              <Button onClick={props.onConfirmForget}>Forget registration</Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              variant="secondary"
              onClick={props.onRequestForget}
              disabled={props.working}
            >
              <Trash />
              Forget
            </Button>
            <Button onClick={props.onRescan} disabled={props.working}>
              <ArrowClockwise />
              Rescan metadata
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function BoundaryFact(props: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-muted/45 p-3">
      <span className="text-[10px] uppercase tracking-[.12em] text-muted-foreground">
        {props.label}
      </span>
      <strong className="mt-1 block text-xs">{props.value}</strong>
    </div>
  );
}

function ListBlock(props: { label: string; items: readonly string[] }) {
  return (
    <div className="rounded-2xl bg-muted/45 p-4">
      <strong className="text-xs">{props.label}</strong>
      {props.items.length === 0 ? (
        <p className="mt-2 text-xs text-muted-foreground">None observed.</p>
      ) : (
        <ul className="mt-3 space-y-2 text-xs leading-5 text-muted-foreground">
          {props.items.map((item) => (
            <li key={item}>• {item}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
