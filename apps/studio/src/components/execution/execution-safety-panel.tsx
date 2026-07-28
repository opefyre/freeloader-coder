import { Check } from "@phosphor-icons/react/Check";
import { Code } from "@phosphor-icons/react/Code";
import { Cpu } from "@phosphor-icons/react/Cpu";
import { Desktop } from "@phosphor-icons/react/Desktop";
import { FolderOpen } from "@phosphor-icons/react/FolderOpen";
import { GitBranch } from "@phosphor-icons/react/GitBranch";
import { MagnifyingGlass } from "@phosphor-icons/react/MagnifyingGlass";
import { Pause } from "@phosphor-icons/react/Pause";
import { Play } from "@phosphor-icons/react/Play";
import { ShieldCheck } from "@phosphor-icons/react/ShieldCheck";
import { Warning } from "@phosphor-icons/react/Warning";
import { useState } from "react";

import {
  checkpointTimeline,
  conflictPreview,
  executionProfiles,
  executionTools,
  resourceSnapshot,
  type CheckpointId,
  type ExecutionProfileId,
} from "../../execution-fixture.js";
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

const toolIcons = {
  search: MagnifyingGlass,
  code: Code,
  terminal: Desktop,
  git: GitBranch,
  preview: FolderOpen,
} as const;

export function ExecutionSafetyPanel() {
  const [profile, setProfile] = useState<ExecutionProfileId>("standard");
  const [paused, setPaused] = useState(false);
  const [checkpoint, setCheckpoint] = useState<CheckpointId>("validation");
  const [showConflict, setShowConflict] = useState(false);
  const [decision, setDecision] = useState<string>();
  const selectedProfile = executionProfiles.find((item) => item.id === profile)!;
  const selectedCheckpoint = checkpointTimeline.find((item) => item.id === checkpoint)!;

  return (
    <section
      aria-labelledby="execution-guardrails-title"
      className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(20rem,.65fr)]"
    >
      <Card className="min-w-0 bg-[color-mix(in_oklch,var(--card)_90%,var(--primary)_10%)]">
        <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="positive">
                <ShieldCheck weight="fill" />
                Strong isolation
              </Badge>
              <Badge>Task branch · no host secrets</Badge>
            </div>
            <CardTitle id="execution-guardrails-title" className="mt-4 text-xl">
              Safe execution console
            </CardTitle>
            <CardDescription>
              Every action stays inside a recoverable workspace with explicit tools,
              limits, and checkpoints.
            </CardDescription>
          </div>
          <Button
            variant={paused ? "default" : "secondary"}
            onClick={() => setPaused((value) => !value)}
            aria-pressed={paused}
          >
            {paused ? <Play weight="fill" /> : <Pause weight="fill" />}
            {paused ? "Resume safely" : "Pause safely"}
          </Button>
        </CardHeader>
        <CardContent className="mt-7">
          <div
            className={cn(
              "rounded-3xl p-4",
              paused ? "bg-amber-400/[.10]" : "bg-emerald-400/[.08]"
            )}
            aria-live="polite"
          >
            <div className="flex items-start gap-3">
              <span
                className={cn(
                  "mt-0.5 grid size-8 shrink-0 place-items-center rounded-xl",
                  paused
                    ? "bg-amber-400/15 text-amber-600 dark:text-amber-300"
                    : "bg-emerald-400/15 text-emerald-600 dark:text-emerald-300"
                )}
              >
                {paused ? <Pause weight="fill" /> : <Check weight="bold" />}
              </span>
              <div>
                <strong className="text-sm">
                  {paused ? "Paused at a recoverable boundary" : "Workspace is healthy and bounded"}
                </strong>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  {paused
                    ? "State, branch, artifacts, and the validation checkpoint are preserved. Resume will re-check resources first."
                    : "Changes are isolated from your workspace. Network access is allowlisted and secrets are never exposed to tools."}
                </p>
              </div>
            </div>
          </div>

          <div className="mt-6">
            <div className="flex items-end justify-between gap-4">
              <div>
                <h3 className="text-sm font-semibold">Compute profile</h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  Choose the pace; safety limits stay enforced.
                </p>
              </div>
              <Badge tone="active">{selectedProfile.eyebrow}</Badge>
            </div>
            <div className="mt-3 grid gap-2 md:grid-cols-3" role="radiogroup" aria-label="Compute profile">
              {executionProfiles.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  role="radio"
                  aria-checked={profile === item.id}
                  onClick={() => setProfile(item.id)}
                  className={cn(
                    "rounded-3xl bg-muted/55 p-4 text-left outline-none transition-[background-color,transform] hover:-translate-y-0.5 hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/30",
                    profile === item.id && "bg-primary/[.12]"
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <strong className="text-sm">{item.label}</strong>
                    {profile === item.id && (
                      <span className="grid size-6 place-items-center rounded-full bg-primary text-primary-foreground">
                        <Check size={13} weight="bold" />
                      </span>
                    )}
                  </div>
                  <p className="mt-2 min-h-10 text-xs leading-5 text-muted-foreground">
                    {item.description}
                  </p>
                  <div className="mt-4 flex flex-wrap gap-1.5">
                    {item.limits.map((limit) => (
                      <span key={limit} className="rounded-full bg-background/65 px-2 py-1 text-[10px]">
                        {limit}
                      </span>
                    ))}
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div className="mt-7">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">Explicit tool access</h3>
              <span className="text-xs text-muted-foreground">Unknown tools are refused</span>
            </div>
            <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
              {executionTools.map((tool) => {
                const Icon = toolIcons[tool.icon];
                return (
                  <button
                    key={tool.name}
                    type="button"
                    className="rounded-2xl bg-muted/50 p-3 text-left outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/30"
                    title={`${tool.state}: ${tool.effect}`}
                  >
                    <Icon className="text-primary" size={18} weight="duotone" />
                    <strong className="mt-3 block text-xs">{tool.name}</strong>
                    <span className="mt-1 block text-[10px] text-muted-foreground">
                      {tool.effect}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div>
            <CardTitle>Resource comfort</CardTitle>
            <CardDescription>{resourceSnapshot.explanation}</CardDescription>
          </div>
          <Badge tone="positive">{resourceSnapshot.state}</Badge>
        </CardHeader>
        <CardContent className="mt-6">
          <div className="flex items-end justify-between">
            <div>
              <span className="text-xs text-muted-foreground">Execution host</span>
              <strong className="mt-1 block text-lg">{resourceSnapshot.machine}</strong>
            </div>
            <span className="grid size-12 place-items-center rounded-2xl bg-primary/10 text-primary">
              <Cpu size={24} weight="duotone" />
            </span>
          </div>
          <div className="mt-7 space-y-4">
            <ResourceMeter label="Memory pressure" value={resourceSnapshot.memory} />
            <ResourceMeter label="Disk use" value={resourceSnapshot.disk} />
            <ResourceMeter label="Thermal pressure" value={resourceSnapshot.temperature} />
          </div>
          <div className="mt-6 grid grid-cols-2 gap-2">
            <div className="rounded-2xl bg-muted/50 p-3">
              <span className="text-[10px] text-muted-foreground">Power</span>
              <strong className="mt-1 block text-xs">{resourceSnapshot.battery}</strong>
            </div>
            <div className="rounded-2xl bg-muted/50 p-3">
              <span className="text-[10px] text-muted-foreground">Active</span>
              <strong className="mt-1 block text-xs">
                {resourceSnapshot.activeTasks} bounded tasks
              </strong>
            </div>
          </div>
          <p className="mt-5 rounded-2xl bg-primary/[.08] p-3 text-xs leading-5 text-muted-foreground">
            Low disk, memory, battery, heat, or sleep automatically reduces work or
            pauses at a resumable checkpoint.
          </p>
        </CardContent>
      </Card>

      <Card className="min-w-0 xl:col-span-2">
        <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle>Reversible checkpoint timeline</CardTitle>
            <CardDescription>
              Inspect what changed, keep it, or restore safely without touching unrelated work.
            </CardDescription>
          </div>
          <Button variant="secondary" onClick={() => setShowConflict((value) => !value)}>
            <Warning />
            {showConflict ? "Hide conflict example" : "Preview a conflict"}
          </Button>
        </CardHeader>
        <CardContent className="mt-6">
          <div className="grid gap-2 sm:grid-cols-5" role="list" aria-label="Checkpoint timeline">
            {checkpointTimeline.map((item) => (
              <button
                key={item.id}
                type="button"
                role="listitem"
                aria-current={checkpoint === item.id ? "step" : undefined}
                onClick={() => setCheckpoint(item.id)}
                className={cn(
                  "rounded-3xl bg-muted/50 p-4 text-left outline-none transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/30",
                  checkpoint === item.id && "bg-primary/[.12]"
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <span
                    className={cn(
                      "grid size-7 place-items-center rounded-full text-[11px]",
                      item.state === "verified" &&
                        "bg-emerald-400/15 text-emerald-600 dark:text-emerald-300",
                      item.state === "current" && "bg-primary/15 text-primary",
                      (item.state === "waiting" || item.state === "locked") &&
                        "bg-background/65 text-muted-foreground"
                    )}
                  >
                    {item.state === "verified" ? <Check weight="bold" /> : item.time}
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    {item.files ? `${item.files} files` : "Clean"}
                  </span>
                </div>
                <strong className="mt-4 block text-xs">{item.label}</strong>
                <span className="mt-1 block text-[10px] leading-4 text-muted-foreground">
                  {item.note}
                </span>
              </button>
            ))}
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-2 rounded-3xl bg-muted/45 p-4">
            <div className="mr-auto min-w-[12rem]">
              <strong className="text-sm">{selectedCheckpoint.label} checkpoint</strong>
              <p className="mt-1 text-xs text-muted-foreground">
                Restore affects {selectedCheckpoint.files} task files; unrelated changes are preserved.
              </p>
            </div>
            <Button
              size="sm"
              onClick={() => setDecision(`Kept ${selectedCheckpoint.label} checkpoint`)}
            >
              <Check />
              Keep this result
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setDecision(`Restore prepared for ${selectedCheckpoint.label}`)}
            >
              Restore preview
            </Button>
          </div>

          {showConflict && (
            <div className="mt-5 rounded-3xl bg-amber-400/[.08] p-4 sm:p-5">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <Badge tone="caution">Guided conflict</Badge>
                  <strong className="mt-2 block text-sm">{conflictPreview.path}</strong>
                </div>
                <span className="text-xs text-muted-foreground">
                  Nothing is applied until you choose
                </span>
              </div>
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                {[conflictPreview.current, conflictPreview.proposed].map((side) => (
                  <div key={side.label} className="min-w-0 rounded-2xl bg-background/75 p-4">
                    <strong className="text-xs">{side.label}</strong>
                    <pre className="mt-3 overflow-auto text-[11px] leading-5 text-muted-foreground">
                      {side.lines.join("\n")}
                    </pre>
                  </div>
                ))}
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                {conflictPreview.options.map((option) => (
                  <Button
                    key={option}
                    size="sm"
                    variant="secondary"
                    onClick={() => setDecision(option)}
                  >
                    {option}
                  </Button>
                ))}
              </div>
            </div>
          )}

          {decision && (
            <p className="mt-4 flex items-center gap-2 text-xs text-emerald-600 dark:text-emerald-300" role="status">
              <Check weight="bold" />
              {decision}. Decision recorded locally with actor, checkpoint, and restore impact.
            </p>
          )}
        </CardContent>
      </Card>
    </section>
  );
}

function ResourceMeter({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <strong>{value}%</strong>
      </div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-primary" style={{ width: `${value}%` }} />
      </div>
    </div>
  );
}

