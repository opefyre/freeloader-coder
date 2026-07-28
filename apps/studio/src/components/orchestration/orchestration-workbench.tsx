import { ArrowDown } from "@phosphor-icons/react/ArrowDown";
import { Brain } from "@phosphor-icons/react/Brain";
import { Check } from "@phosphor-icons/react/Check";
import { GitMerge } from "@phosphor-icons/react/GitMerge";
import { LinkSimple } from "@phosphor-icons/react/LinkSimple";
import { LockKey } from "@phosphor-icons/react/LockKey";
import { PencilSimple } from "@phosphor-icons/react/PencilSimple";
import { Pulse } from "@phosphor-icons/react/Pulse";
import { Scissors } from "@phosphor-icons/react/Scissors";
import { ShieldCheck } from "@phosphor-icons/react/ShieldCheck";
import { Trash } from "@phosphor-icons/react/Trash";
import { TreeStructure } from "@phosphor-icons/react/TreeStructure";
import { useMemo, useState } from "react";

import {
  classifyTaskActivity,
  type ActivityEvidence,
} from "../../../../../packages/orchestration/src/durable-scheduler.js";
import {
  editReadinessAssumption,
  type ReadinessDecision,
} from "../../../../../packages/orchestration/src/decision-policy.js";
import {
  approveTaskPlan,
  chooseTaskAssignments,
  editTaskPlan,
  type EditableTaskPlan,
  type PlannedTask,
} from "../../../../../packages/orchestration/src/task-planner.js";
import {
  groundingSnapshot,
  initialReadinessDecision,
  initialTaskPlan,
} from "../../orchestration-fixture.js";
import { cn } from "../../lib/utils.js";
import { Badge } from "../ui/badge.js";
import { Button } from "../ui/button.js";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../ui/card.js";

const activityEvidence: Record<"active" | "slow" | "stalled", ActivityEvidence> = {
  active: {
    heartbeatAt: 920,
    modelActivityAt: 940,
    validationActivityAt: null,
    toolActivityAt: 900,
    modelRequestActive: true,
    validationActive: false,
    expectedStageDurationMs: 120,
  },
  slow: {
    heartbeatAt: 650,
    modelActivityAt: 700,
    validationActivityAt: null,
    toolActivityAt: 620,
    modelRequestActive: true,
    validationActive: false,
    expectedStageDurationMs: 120,
  },
  stalled: {
    heartbeatAt: 200,
    modelActivityAt: 240,
    validationActivityAt: null,
    toolActivityAt: 180,
    modelRequestActive: false,
    validationActive: false,
    expectedStageDurationMs: 120,
  },
};

const workbenchSplit: readonly PlannedTask[] = [
  {
    ...initialTaskPlan.tasks.find((task) => task.id === "workbench")!,
    id: "workbench-shell",
    title: "Build planning shell",
    outcome: "The bounded task graph is visible.",
    allowedFiles: ["apps/studio/src/components/orchestration/shell.tsx"],
    estimatedMinutes: 25,
  },
  {
    ...initialTaskPlan.tasks.find((task) => task.id === "workbench")!,
    id: "workbench-actions",
    title: "Add safe plan actions",
    outcome: "Every plan edit preserves dependency validity.",
    allowedFiles: ["apps/studio/src/components/orchestration/actions.tsx"],
    dependsOn: ["workbench-shell"],
    estimatedMinutes: 30,
  },
];

export function OrchestrationWorkbench() {
  const [readiness, setReadiness] = useState<ReadinessDecision>(initialReadinessDecision);
  const [assumption, setAssumption] = useState(readiness.assumptions[0]?.value ?? "");
  const [plan, setPlan] = useState<EditableTaskPlan>(initialTaskPlan);
  const [activityMode, setActivityMode] = useState<"active" | "slow" | "stalled">("active");
  const [notice, setNotice] = useState("Draft plan is ready for inspection.");
  const assignments = useMemo(() => chooseTaskAssignments(plan.tasks), [plan.tasks]);
  const activity = classifyTaskActivity({
    evidence: activityEvidence[activityMode],
    now: 1_000,
    minimumGraceMs: 150,
    maximumSilentMs: 600,
    expectedDurationMultiplier: 1,
  });

  function updatePlan(next: EditableTaskPlan, message: string) {
    setPlan(next);
    setNotice(message);
  }

  function editEstimate() {
    const task = plan.tasks.find((item) => item.id === "docs");
    if (!task) return;
    updatePlan(
      editTaskPlan(plan, {
        type: "edit",
        taskId: task.id,
        patch: { estimatedMinutes: task.estimatedMinutes === 20 ? 30 : 20 },
      }),
      "Estimate updated. Dependency order remains valid.",
    );
  }

  function reorderIndependentWork() {
    const next = [...plan.order];
    const docsIndex = next.indexOf("docs");
    if (docsIndex < 0) return;
    next.splice(docsIndex, 1);
    const reviewIndex = next.indexOf("review");
    next.splice(Math.max(0, reviewIndex), 0, "docs");
    updatePlan(
      editTaskPlan(plan, { type: "reorder", order: next }),
      "Independent documentation moved without unblocking dependent work early.",
    );
  }

  function splitWorkbench() {
    updatePlan(
      editTaskPlan(plan, {
        type: "split",
        taskId: "workbench",
        first: workbenchSplit[0]!,
        second: workbenchSplit[1]!,
      }),
      "Workbench split into a shell and dependent actions task.",
    );
  }

  function mergeWorkbench() {
    const merged: PlannedTask = {
      ...initialTaskPlan.tasks.find((task) => task.id === "workbench")!,
      id: "workbench-merged",
      title: "Build and connect planning workbench",
    };
    updatePlan(
      editTaskPlan(plan, {
        type: "merge",
        taskIds: ["workbench-shell", "workbench-actions"],
        merged,
      }),
      "Workbench tasks merged; external dependencies were preserved.",
    );
  }

  function removeDocs() {
    updatePlan(
      editTaskPlan(plan, { type: "remove", taskId: "docs" }),
      "Optional documentation removed from this run.",
    );
  }

  function cycleActivity() {
    setActivityMode((current) =>
      current === "active" ? "slow" : current === "slow" ? "stalled" : "active"
    );
  }

  return (
    <section aria-labelledby="orchestration-workbench-title" className="space-y-4">
      <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1.05fr)_minmax(0,.95fr)]">
        <Card className="min-w-0">
          <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone="active">
                  <Brain weight="duotone" />
                  Readiness brain
                </Badge>
                <Badge tone="positive">Implementer eligible</Badge>
                <a
                  href="https://opefyre.atlassian.net/browse/PIPE-56"
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs font-semibold text-primary hover:underline"
                >
                  PIPE-56
                </a>
              </div>
              <CardTitle id="orchestration-workbench-title" className="mt-4 text-xl">
                Intent becomes an explicit decision
              </CardTitle>
              <CardDescription>
                Stable inputs produce the same outcome. Material uncertainty never reaches a worker.
              </CardDescription>
            </div>
            <span className="rounded-full bg-primary/12 px-3 py-1.5 text-xs font-semibold text-primary">
              {readiness.classification.replaceAll("_", " ")}
            </span>
          </CardHeader>
          <CardContent className="mt-6">
            <label className="text-xs font-semibold" htmlFor="readiness-assumption">
              Editable operating assumption
            </label>
            <textarea
              id="readiness-assumption"
              value={assumption}
              onChange={(event) => setAssumption(event.target.value)}
              disabled={plan.state === "approved"}
              className="mt-2 min-h-24 w-full resize-none rounded-3xl bg-muted/55 px-4 py-3 text-sm leading-6 outline-none focus-visible:ring-3 focus-visible:ring-ring/30 disabled:opacity-60"
            />
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
              <span className="text-xs text-muted-foreground">
                Source · {readiness.assumptions[0]?.source}
              </span>
              <Button
                size="sm"
                variant="secondary"
                disabled={plan.state === "approved" || !assumption.trim()}
                onClick={() => {
                  setReadiness(editReadinessAssumption(
                    readiness,
                    readiness.assumptions[0]!.id,
                    assumption,
                  ));
                  setNotice("Assumption saved and included in the approved execution contract.");
                }}
              >
                <PencilSimple />
                Save assumption
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card className="min-w-0">
          <CardHeader className="flex flex-row items-start justify-between gap-4">
            <div>
              <CardTitle>Canonical grounding</CardTitle>
              <CardDescription>One cited contract for workers and reviewers.</CardDescription>
            </div>
            <Badge tone="positive">
              <ShieldCheck weight="fill" />
              Fresh
            </Badge>
          </CardHeader>
          <CardContent className="mt-5">
            <div className="space-y-2">
              {groundingSnapshot.citations.map((citation) => (
                <a
                  key={citation.path}
                  href={`https://github.com/opefyre/pipeline-studio/blob/main/${citation.path}#L${citation.lines.split("–")[0]}`}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center justify-between gap-4 rounded-2xl bg-muted/50 px-3 py-2.5 text-xs outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/30"
                >
                  <span className="min-w-0">
                    <strong className="block truncate">{citation.label}</strong>
                    <span className="mt-0.5 block truncate text-muted-foreground">
                      {citation.path}:{citation.lines}
                    </span>
                  </span>
                  <LinkSimple className="shrink-0 text-primary" />
                </a>
              ))}
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              {groundingSnapshot.rules.map((rule) => (
                <span key={`${rule.scope}-${rule.text}`} className="rounded-full bg-primary/[.08] px-2.5 py-1 text-[10px]">
                  {rule.protected && <LockKey className="mr-1 inline text-primary" />}
                  {rule.scope} · {rule.text}
                </span>
              ))}
            </div>
            <p className="mt-4 truncate font-mono text-[10px] text-muted-foreground">
              {groundingSnapshot.digest}
            </p>
          </CardContent>
        </Card>
      </div>

      <Card className="min-w-0">
        <CardHeader className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={plan.state === "approved" ? "positive" : "active"}>
                <TreeStructure weight="duotone" />
                {plan.state === "approved" ? "Approved" : "Editable draft"}
              </Badge>
              <Badge>{plan.tasks.length} bounded tasks · revision {plan.revision}</Badge>
            </div>
            <CardTitle className="mt-4 text-xl">Dependency-aware task plan</CardTitle>
            <CardDescription>
              Scope, checks, dependencies, estimates, and specialist assignments travel together.
            </CardDescription>
          </div>
          <Button
            disabled={plan.state === "approved"}
            onClick={() => updatePlan(approveTaskPlan(plan), "Plan approved. Editing is now locked.")}
          >
            <Check weight="bold" />
            Approve plan
          </Button>
        </CardHeader>
        <CardContent className="mt-6">
          <div className="grid gap-2">
            {plan.order.map((id, index) => {
              const task = plan.tasks.find((item) => item.id === id)!;
              const assignment = assignments.find((item) => item.taskId === id)!;
              return (
                <article key={id} className="rounded-3xl bg-muted/45 p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="flex min-w-0 items-start gap-3">
                      <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-background text-xs font-semibold">
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      <div className="min-w-0">
                        <strong className="block text-sm">{task.title}</strong>
                        <p className="mt-1 text-xs leading-5 text-muted-foreground">{task.outcome}</p>
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-1.5 sm:justify-end">
                      <Badge>{task.estimatedMinutes} min</Badge>
                      <Badge tone={assignment.strategy === "specialist" ? "caution" : "neutral"}>
                        {assignment.strategy === "specialist" ? "Specialist" : "Single model"}
                      </Badge>
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-1.5 pl-0 sm:pl-11">
                    <span className="rounded-full bg-background/70 px-2 py-1 text-[10px]">
                      {task.dependsOn.length ? `After ${task.dependsOn.join(", ")}` : "Independent"}
                    </span>
                    <span className="max-w-full truncate rounded-full bg-background/70 px-2 py-1 text-[10px]">
                      {task.allowedFiles.join(", ")}
                    </span>
                    <span className="rounded-full bg-background/70 px-2 py-1 text-[10px]">
                      {task.checks.length} checks
                    </span>
                  </div>
                </article>
              );
            })}
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            {plan.tasks.some((task) => task.id === "docs") && (
              <>
                <Button size="sm" variant="secondary" disabled={plan.state === "approved"} onClick={editEstimate}>
                  <PencilSimple /> Edit estimate
                </Button>
                <Button size="sm" variant="secondary" disabled={plan.state === "approved"} onClick={reorderIndependentWork}>
                  <ArrowDown /> Reorder safely
                </Button>
                <Button size="sm" variant="ghost" disabled={plan.state === "approved"} onClick={removeDocs}>
                  <Trash /> Remove optional
                </Button>
              </>
            )}
            {plan.tasks.some((task) => task.id === "workbench") && (
              <Button size="sm" variant="secondary" disabled={plan.state === "approved"} onClick={splitWorkbench}>
                <Scissors /> Split workbench
              </Button>
            )}
            {plan.tasks.some((task) => task.id === "workbench-shell") && (
              <Button size="sm" variant="secondary" disabled={plan.state === "approved"} onClick={mergeWorkbench}>
                <GitMerge /> Merge workbench
              </Button>
            )}
          </div>
          <p className="mt-4 text-xs text-muted-foreground" aria-live="polite">{notice}</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle>Durable scheduler evidence</CardTitle>
            <CardDescription>
              Recovery decisions use leases, heartbeats, real model activity, and idempotent effects.
            </CardDescription>
          </div>
          <Button variant="secondary" size="sm" onClick={cycleActivity}>
            <Pulse /> Cycle evidence
          </Button>
        </CardHeader>
        <CardContent className="mt-5 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          <SchedulerFact label="Activity" value={activity} tone={activity} />
          <SchedulerFact label="Lease owner" value="worker-spare-01" />
          <SchedulerFact label="Claimable now" value="1 of 4 tasks" />
          <SchedulerFact label="Replay effect" value="Already recorded · skipped" />
        </CardContent>
      </Card>
    </section>
  );
}

function SchedulerFact({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "active" | "slow" | "stalled";
}) {
  return (
    <div className="rounded-3xl bg-muted/50 p-4">
      <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </span>
      <strong className={cn(
        "mt-2 block text-sm capitalize",
        tone === "active" && "text-emerald-600 dark:text-emerald-300",
        tone === "slow" && "text-amber-600 dark:text-amber-300",
        tone === "stalled" && "text-destructive",
      )}>
        {value}
      </strong>
    </div>
  );
}
