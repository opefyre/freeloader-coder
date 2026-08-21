import { ArrowRight } from "@phosphor-icons/react/ArrowRight";
import { Check } from "@phosphor-icons/react/Check";
import { CheckCircle } from "@phosphor-icons/react/CheckCircle";
import { Cpu } from "@phosphor-icons/react/Cpu";
import { Desktop } from "@phosphor-icons/react/Desktop";
import { Gear } from "@phosphor-icons/react/Gear";
import { PlugsConnected } from "@phosphor-icons/react/PlugsConnected";
import { ShieldCheck } from "@phosphor-icons/react/ShieldCheck";
import { Warning } from "@phosphor-icons/react/Warning";
import { useState } from "react";

import {
  repairActions,
  runtimeChecks,
  runtimeServices,
  runtimeSetupStages,
  sandboxChoices,
  type SandboxChoiceId,
} from "../../runtime-setup-fixture.js";
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

type RuntimeState = "healthy" | "interrupted" | "repaired";

export function RuntimeSetupPanel() {
  const [sandbox, setSandbox] = useState<SandboxChoiceId>("native");
  const [runtimeState, setRuntimeState] = useState<RuntimeState>("healthy");
  const [showDependency, setShowDependency] = useState(false);
  const [notice, setNotice] = useState(
    "Preflight passed. Your existing configuration was preserved."
  );
  const selectedSandbox = sandboxChoices.find((item) => item.id === sandbox)!;

  const selectSandbox = (id: SandboxChoiceId) => {
    if (id === "container") {
      setShowDependency(true);
      setNotice(
        "Container mode is optional for this project and will not be installed automatically."
      );
      return;
    }
    setSandbox(id);
    setShowDependency(false);
    setNotice(
      "Native bounded mode selected with reduced isolation and strict tool restrictions."
    );
  };

  const repair = () => {
    setRuntimeState("repaired");
    setNotice(
      "Repair completed: stale lock released, free loopback port selected, derived views rebuilt, and services restarted. Projects, credentials, and checkpoints were preserved."
    );
  };

  return (
    <section aria-labelledby="runtime-readiness-title" className="space-y-4">
      <Card className="bg-[color-mix(in_oklch,var(--card)_92%,var(--primary)_8%)]">
        <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={runtimeState === "interrupted" ? "caution" : "positive"}>
                {runtimeState === "interrupted" ? (
                  <Warning weight="fill" />
                ) : (
                  <CheckCircle weight="fill" />
                )}
                {runtimeState === "interrupted"
                  ? "Recoverable interruption"
                  : runtimeState === "repaired"
                    ? "Repair verified"
                    : "Ready on this computer"}
              </Badge>
              <Badge>Demo runtime evidence</Badge>
            </div>
            <CardTitle id="runtime-readiness-title" className="mt-4 text-xl">
              Clone-to-running setup
            </CardTitle>
            <CardDescription>
              One local core, private state, loopback access, and a safe execution
              mode selected without requiring Docker.
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              onClick={() => {
                setNotice(
                  "Preflight re-ran safely. Node, npm, Git, memory, disk, private state, port, and controller checks passed."
                );
              }}
            >
              <Gear />
              Run preflight
            </Button>
            {runtimeState === "interrupted" ? (
              <Button onClick={repair}>
                <ShieldCheck weight="fill" />
                Repair local runtime
              </Button>
            ) : (
              <Button
                variant="secondary"
                onClick={() => {
                  setRuntimeState("interrupted");
                  setNotice(
                    "A simulated interruption was checkpointed. No uncertain effect will be replayed automatically."
                  );
                }}
              >
                Simulate interruption
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="mt-6">
          <div className="grid gap-2 sm:grid-cols-5" aria-label="Local setup progress">
            {runtimeSetupStages.map((stage, index) => (
              <div
                key={stage.id}
                className={cn(
                  "rounded-2xl p-3",
                  stage.state === "done"
                    ? "bg-emerald-400/[.07]"
                    : stage.state === "current"
                      ? "bg-primary/[.10]"
                      : "bg-muted/45"
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <span
                    className={cn(
                      "grid size-6 place-items-center rounded-full text-[10px] font-bold",
                      stage.state === "done"
                        ? "bg-emerald-400/15 text-emerald-700 dark:text-emerald-300"
                        : stage.state === "current"
                          ? "bg-primary/15 text-primary"
                          : "bg-background text-muted-foreground"
                    )}
                  >
                    {stage.state === "done" ? <Check weight="bold" /> : index + 1}
                  </span>
                  <span className="text-[10px] text-muted-foreground">{stage.note}</span>
                </div>
                <strong className="mt-3 block text-xs">{stage.label}</strong>
              </div>
            ))}
          </div>

          <div className="mt-6 grid gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(20rem,.9fr)]">
            <div className="rounded-3xl bg-muted/45 p-4 sm:p-5">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <h3 className="text-sm font-semibold">Computer preflight</h3>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Required, optional, and automatically repaired checks stay distinct.
                  </p>
                </div>
                <code className="rounded-full bg-background/70 px-3 py-1.5 text-[10px]">
                  npm run setup
                </code>
              </div>
              <div className="mt-4 grid gap-2 sm:grid-cols-2">
                {runtimeChecks.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-center gap-3 rounded-2xl bg-background/65 p-3"
                  >
                    <span
                      className={cn(
                        "grid size-8 shrink-0 place-items-center rounded-xl",
                        item.required
                          ? "bg-emerald-400/12 text-emerald-700 dark:text-emerald-300"
                          : "bg-primary/10 text-primary"
                      )}
                    >
                      {item.required ? <Check weight="bold" /> : <PlugsConnected />}
                    </span>
                    <div className="min-w-0">
                      <strong className="block truncate text-xs">{item.label}</strong>
                      <span className="mt-0.5 block truncate text-[10px] text-muted-foreground">
                        {item.value} · {item.state}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-3xl bg-muted/45 p-4 sm:p-5">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <h3 className="text-sm font-semibold">Local services</h3>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Exactly one controller owns this profile.
                  </p>
                </div>
                <span className="grid size-10 place-items-center rounded-2xl bg-primary/10 text-primary">
                  <Cpu size={21} weight="duotone" />
                </span>
              </div>
              <div className="mt-4 space-y-2">
                {runtimeServices.map((service) => (
                  <div
                    key={service.id}
                    className="flex items-center justify-between gap-4 rounded-2xl bg-background/65 px-3 py-2.5"
                  >
                    <div>
                      <strong className="block text-xs">{service.label}</strong>
                      <span className="text-[10px] text-muted-foreground">
                        {runtimeState === "interrupted" && service.id !== "core"
                          ? "Checkpoint preserved"
                          : service.note}
                      </span>
                    </div>
                    <Badge
                      tone={
                        runtimeState === "interrupted" && service.id !== "core"
                          ? "caution"
                          : "positive"
                      }
                    >
                      {runtimeState === "interrupted" && service.id !== "core"
                        ? "Interrupted"
                        : service.state}
                    </Badge>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="mt-6">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h3 className="text-sm font-semibold">Execution isolation</h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  The safest supported mode is selected automatically and labeled honestly.
                </p>
              </div>
              <Badge tone={selectedSandbox.id === "native" ? "caution" : "positive"}>
                {selectedSandbox.strength}
              </Badge>
            </div>
            <div className="mt-3 grid gap-3 md:grid-cols-2" role="radiogroup" aria-label="Execution isolation">
              {sandboxChoices.map((choice) => (
                <button
                  key={choice.id}
                  type="button"
                  role="radio"
                  aria-checked={sandbox === choice.id}
                  onClick={() => selectSandbox(choice.id)}
                  className={cn(
                    "rounded-3xl bg-muted/50 p-5 text-left outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/30",
                    sandbox === choice.id && "bg-primary/[.10]"
                  )}
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="grid size-10 place-items-center rounded-2xl bg-background/70 text-primary">
                      {choice.id === "native" ? (
                        <Desktop size={21} weight="duotone" />
                      ) : (
                        <ShieldCheck size={21} weight="duotone" />
                      )}
                    </span>
                    <Badge>{choice.recommendation}</Badge>
                  </div>
                  <strong className="mt-4 block text-sm">{choice.label}</strong>
                  <span className="mt-1 block text-xs font-semibold text-primary">
                    {choice.strength}
                  </span>
                  <p className="mt-2 text-xs leading-5 text-muted-foreground">
                    {choice.description}
                  </p>
                  <div className="mt-4 flex flex-wrap gap-1.5">
                    {choice.capabilities.map((capability) => (
                      <span
                        key={capability}
                        className="rounded-full bg-background/70 px-2 py-1 text-[10px]"
                      >
                        {capability}
                      </span>
                    ))}
                  </div>
                </button>
              ))}
            </div>
          </div>

          {showDependency && (
            <div className="mt-5 rounded-3xl bg-amber-400/[.08] p-5">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <Badge tone="caution">Optional dependency</Badge>
                  <strong className="mt-3 block text-sm">
                    Container isolation is not required for this project
                  </strong>
                  <p className="mt-2 max-w-2xl text-xs leading-5 text-muted-foreground">
                    Install Docker Desktop or Podman only when a future project or policy
                    requires strong isolation. Codkesh will verify the runtime and
                    isolation canary before enabling it.
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  <a
                    href="https://docs.docker.com/desktop/"
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-full bg-background/70 px-3 py-2 text-xs font-semibold hover:text-primary"
                  >
                    Docker instructions
                  </a>
                  <a
                    href="https://podman.io/docs/installation"
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-full bg-background/70 px-3 py-2 text-xs font-semibold hover:text-primary"
                  >
                    Podman instructions
                  </a>
                </div>
              </div>
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  onClick={() => {
                    setSandbox("container");
                    setShowDependency(false);
                    setNotice(
                      "Container verification resumed. Demo canary passed; strong isolation is selected."
                    );
                  }}
                >
                  Resume verification
                  <ArrowRight />
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    setSandbox("native");
                    setShowDependency(false);
                    setNotice(
                      "Continuing without Docker in truthful Native bounded mode."
                    );
                  }}
                >
                  Continue without Docker
                </Button>
              </div>
            </div>
          )}

          {runtimeState === "interrupted" && (
            <div className="mt-5 rounded-3xl bg-amber-400/[.08] p-5">
              <div className="flex items-center gap-3">
                <span className="grid size-10 place-items-center rounded-2xl bg-amber-400/15 text-amber-700 dark:text-amber-300">
                  <Warning weight="fill" />
                </span>
                <div>
                  <strong className="text-sm">Work stopped at a recoverable checkpoint</strong>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Attempted effects remain outcome-unknown and will not be duplicated.
                  </p>
                </div>
              </div>
              <ul className="mt-4 grid gap-2 sm:grid-cols-2">
                {repairActions.map((action) => (
                  <li
                    key={action}
                    className="flex gap-2 rounded-2xl bg-background/65 p-3 text-xs text-muted-foreground"
                  >
                    <Check className="mt-0.5 shrink-0 text-primary" weight="bold" />
                    {action}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <p
            role="status"
            className="mt-5 rounded-2xl bg-primary/[.08] p-3 text-xs leading-5 text-muted-foreground"
          >
            {notice}
          </p>
        </CardContent>
      </Card>
    </section>
  );
}
