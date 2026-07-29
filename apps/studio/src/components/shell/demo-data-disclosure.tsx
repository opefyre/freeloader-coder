import { Database } from "@phosphor-icons/react/Database";
import { Info } from "@phosphor-icons/react/Info";
import { X } from "@phosphor-icons/react/X";

import {
  assessPresentationProvenance,
  type PresentationProvenance,
} from "../../../../../packages/ui/src/provenance.js";
import { Badge } from "../ui/badge.js";
import { Button } from "../ui/button.js";

const demoProvenance: PresentationProvenance = {
  mode: "synthetic_fixture",
  generatedAt: "2026-07-29T09:00:00.000Z",
  sourceClasses: [
    "Synthetic tasks and pipeline events",
    "Synthetic provider health and quota observations",
    "Local product fixtures and release evidence",
  ],
  externallyVerifiedAt: null,
};

const assessment = assessPresentationProvenance(
  demoProvenance,
  new Date("2026-07-29T09:00:00.000Z")
);

export function DemoModeButton({ open }: { open: () => void }) {
  return (
    <button
      type="button"
      onClick={open}
      className="rounded-full outline-none focus-visible:ring-3 focus-visible:ring-ring/30"
      aria-label="Demo workspace. Inspect data provenance"
    >
      <Badge tone="caution">
        <Database weight="fill" />
        {assessment.label}
      </Badge>
    </button>
  );
}

export function DemoDataDisclosure({ close }: { close: () => void }) {
  return (
    <div
      className="fixed inset-0 z-[70] grid place-items-end bg-background/55 p-3 backdrop-blur-sm sm:place-items-center"
      role="presentation"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) close();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="data-provenance-title"
        className="w-full max-w-lg rounded-[2rem] bg-popover p-6 shadow-2xl sm:p-7"
      >
        <div className="flex items-start justify-between gap-4">
          <div className="flex gap-3">
            <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-primary/12 text-primary">
              <Info size={22} weight="fill" />
            </span>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">
                Data provenance
              </p>
              <h2 id="data-provenance-title" className="mt-1 text-xl font-semibold">
                This is a demo workspace
              </h2>
            </div>
          </div>
          <Button variant="ghost" size="icon" aria-label="Close data provenance" onClick={close}>
            <X />
          </Button>
        </div>

        <p className="mt-5 text-sm leading-6 text-muted-foreground">
          The interface demonstrates real product behavior with synthetic records.
          It is not reporting a running pipeline or connected provider accounts.
        </p>

        <div className="mt-5 rounded-3xl bg-muted/70 p-5">
          <strong className="text-sm">Sources represented</strong>
          <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
            {demoProvenance.sourceClasses.map((source) => (
              <li key={source} className="flex gap-2">
                <span className="mt-2 size-1.5 shrink-0 rounded-full bg-primary" />
                {source}
              </li>
            ))}
          </ul>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <DisclosureFact label="Live claim" value="Not permitted" />
          <DisclosureFact label="External verification" value="None" />
          <DisclosureFact label="Provider calls" value="None" />
          <DisclosureFact label="Writes or deployment" value="None" />
        </div>

        <Button className="mt-6 w-full" onClick={close}>
          I understand
        </Button>
      </section>
    </div>
  );
}

function DisclosureFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-muted/55 px-4 py-3">
      <span className="block text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
        {label}
      </span>
      <strong className="mt-1 block text-sm">{value}</strong>
    </div>
  );
}
