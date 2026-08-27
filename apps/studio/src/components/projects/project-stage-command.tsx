import { ArrowRight } from "@phosphor-icons/react/ArrowRight";
import { CheckCircle } from "@phosphor-icons/react/CheckCircle";
import { CaretDown } from "@phosphor-icons/react/CaretDown";
import { Info } from "@phosphor-icons/react/Info";
import { Warning } from "@phosphor-icons/react/Warning";

import { ownerProjectGuidance } from "../../../../../packages/runtime/src/owner-project-guidance.js";
import type { LocalProjectSnapshot } from "../../../../../packages/runtime/src/local-projects.js";
import { Badge } from "../ui/badge.js";
import { Button } from "../ui/button.js";

export function ProjectStageCommand(props: {
  project: LocalProjectSnapshot;
  activate: (destination: "overview" | "resources" | "progress" | "actions") => void;
}) {
  const model = ownerProjectGuidance(props.project);
  const Icon = model.ownerState === "complete" ? CheckCircle : model.ownerState === "autonomous" ? Info : Warning;
  const tone = model.ownerState === "complete" ? "positive" : model.ownerState === "autonomous" ? "neutral" : "caution";
  return (
    <section aria-labelledby="project-stage-title" className="rounded-[1.75rem] bg-card p-5 sm:p-6">
      <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 gap-3">
          <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-primary/10 text-primary"><Icon size={22} weight="duotone" /></span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2"><span className="text-xs font-medium text-muted-foreground">Current stage</span><Badge tone={tone}>{model.ownerStateLabel}</Badge></div>
            <h2 id="project-stage-title" className="mt-2 text-xl font-semibold tracking-[-0.02em]">{model.stageLabel}</h2>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">{model.outcome}</p>
          </div>
        </div>
        <Button className="w-full shrink-0 sm:w-auto" onClick={() => props.activate(model.primaryAction.destination)}>{model.primaryAction.label}<ArrowRight /></Button>
      </div>
      <details className="group mt-4 rounded-2xl bg-muted/45 px-4 py-3">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-xs font-semibold outline-none focus-visible:ring-3 focus-visible:ring-ring/30">
          What this action changes
          <CaretDown className="transition-transform group-open:rotate-180" />
        </summary>
        <dl className="mt-3 grid gap-3 text-sm md:grid-cols-3">
          <Fact label="Approval boundary" value={model.approvalBoundary} />
          <Fact label="What happens next" value={model.downstreamEffect} />
          <Fact label="If something is wrong" value={model.recovery} />
        </dl>
        <p className="mt-3 text-xs font-medium text-muted-foreground">Maximum automatic cost: $0</p>
      </details>
    </section>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return <div className="min-w-0"><dt className="text-xs font-semibold">{label}</dt><dd className="mt-1 text-xs leading-5 text-muted-foreground">{value}</dd></div>;
}
