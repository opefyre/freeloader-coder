import { Database } from "@phosphor-icons/react/Database";
import { Info } from "@phosphor-icons/react/Info";
import { Warning } from "@phosphor-icons/react/Warning";
import { X } from "@phosphor-icons/react/X";

import type { PresentationProvenance } from "../../../../../packages/ui/src/provenance.js";
import type { ControlPlaneConnectionState } from "../../control-plane-client.js";
import { Badge } from "../ui/badge.js";
import { Button } from "../ui/button.js";

const demoProvenance: PresentationProvenance = {
  mode: "synthetic_fixture",
  generatedAt: "2026-07-29T09:00:00.000Z",
  sourceClasses: [
    "Live local projects, requests, provider connections, and operations",
    "Synthetic tasks and pipeline events",
    "Synthetic provider health and quota observations",
    "Local product fixtures and release evidence",
  ],
  externallyVerifiedAt: null,
};

export function DemoModeButton({
  open,
  connection,
}: {
  open: () => void;
  connection: ControlPlaneConnectionState;
}) {
  const label =
    connection.status === "connecting"
      ? "Checking runtime"
      : connection.status === "live"
        ? "Local runtime"
        : connection.status === "stale"
          ? "Snapshot stale"
          : "Runtime offline";
  const setupReady =
    connection.status === "live" &&
    connection.snapshot.setup.state === "ready" &&
    connection.snapshot.services.some(
      (service) =>
        service.id === "control_plane" && service.state === "available"
    );
  return (
    <button
      type="button"
      onClick={open}
      className="rounded-full outline-none focus-visible:ring-3 focus-visible:ring-ring/30"
      aria-label={`${label}. Live and simulated surfaces are labelled. Inspect provenance`}
    >
      <Badge tone={setupReady ? "positive" : "caution"}>
        <Database weight="fill" />
        {label}
      </Badge>
    </button>
  );
}

export function DemoDataDisclosure({
  close,
  simulateRouteFailure,
  connection,
  endpoint,
  refresh,
}: {
  close: () => void;
  simulateRouteFailure: () => void;
  connection: ControlPlaneConnectionState;
  endpoint: string;
  refresh: () => Promise<void>;
}) {
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
                Runtime truth and demo data
              </h2>
            </div>
          </div>
          <Button variant="ghost" size="icon" aria-label="Close data provenance" onClick={close}>
            <X />
          </Button>
        </div>

        <p className="mt-5 text-sm leading-6 text-muted-foreground">
          Overview, registered projects, local requests, and configured provider
          connections use validated local runtime state. Workspaces that are not
          connected yet remain explicitly labelled simulations and never turn
          fixture records into live tasks, providers, or accounts.
        </p>

        <RuntimeObservation connection={connection} endpoint={endpoint} />

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
          <DisclosureFact label="Live claim" value="Local sources only" />
          <DisclosureFact label="Simulations" value="Labelled per workspace" />
          <DisclosureFact label="Automatic spend" value="$0 maximum" />
          <DisclosureFact label="External effects" value="Approval gated" />
        </div>

        <div className="mt-6 grid gap-2 sm:grid-cols-3">
          <Button variant="secondary" onClick={() => void refresh()}>
            Refresh runtime
          </Button>
          <Button variant="secondary" onClick={simulateRouteFailure}>
            <Warning />
            Preview safe failure
          </Button>
          <Button onClick={close}>I understand</Button>
        </div>
      </section>
    </div>
  );
}

function RuntimeObservation({
  connection,
  endpoint,
}: {
  connection: ControlPlaneConnectionState;
  endpoint: string;
}) {
  const label =
    connection.status === "connecting"
      ? "Checking local runtime"
      : connection.status === "live"
        ? "Current local observation"
        : connection.status === "stale"
          ? "Last observation is stale"
          : "Local runtime unavailable";
  const summary =
    connection.snapshot === null
      ? "No validated runtime snapshot is available."
      : `${connection.snapshot.services.length} bounded service observation · setup ${connection.snapshot.setup.state.replace("_", " ")}`;
  return (
    <div className="mt-5 rounded-3xl bg-primary/[.07] p-5" aria-live="polite">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <strong className="text-sm">{label}</strong>
        <Badge tone={connection.status === "live" ? "positive" : "caution"}>
          {connection.status}
        </Badge>
      </div>
      <p className="mt-2 text-sm text-muted-foreground">{summary}</p>
      <p className="mt-2 text-xs text-muted-foreground">
        Read-only loopback origin: {new URL(endpoint).origin}
      </p>
      {connection.observedAt !== null && (
        <p className="mt-1 text-xs text-muted-foreground">
          Last observed {new Date(connection.observedAt).toLocaleTimeString()}
        </p>
      )}
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
