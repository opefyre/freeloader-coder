import { ArrowSquareOut } from "@phosphor-icons/react/ArrowSquareOut";
import { Brain } from "@phosphor-icons/react/Brain";
import { CheckCircle } from "@phosphor-icons/react/CheckCircle";
import { ClockCountdown } from "@phosphor-icons/react/ClockCountdown";
import { Gauge } from "@phosphor-icons/react/Gauge";
import { GlobeHemisphereWest } from "@phosphor-icons/react/GlobeHemisphereWest";
import { Lightning } from "@phosphor-icons/react/Lightning";
import { LockKey } from "@phosphor-icons/react/LockKey";
import { ShieldCheck } from "@phosphor-icons/react/ShieldCheck";
import { Warning } from "@phosphor-icons/react/Warning";
import { useMemo, useState } from "react";

import { Badge } from "../ui/badge.js";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card.js";
import { cn } from "../../lib/utils.js";

type ExpandedProviderId = "nvidia-nim" | "huggingface" | "mistral" | "zhipu" | "sambanova";
type Simulation = "ready" | "quota" | "restricted" | "unverified";

interface MeshProvider {
  readonly id: ExpandedProviderId;
  readonly name: string;
  readonly model: string;
  readonly access: string;
  readonly status: "free" | "experiment";
  readonly requests: number;
  readonly requestLimit: number | null;
  readonly tokens: number;
  readonly tokenLimit: number | null;
  readonly reserve: number;
  readonly capabilities: readonly string[];
  readonly dashboardUrl: string;
  readonly evidenceUrl: string;
  readonly workItem: string;
  readonly note: string;
}

const providers: readonly MeshProvider[] = [
  {
    id: "nvidia-nim",
    name: "NVIDIA NIM",
    model: "Llama 3.1 8B Instruct",
    access: "Developer Program",
    status: "free",
    requests: 14,
    requestLimit: 30,
    tokens: 182_000,
    tokenLimit: 1_000_000,
    reserve: 4,
    capabilities: ["Chat", "JSON", "Review"],
    dashboardUrl: "https://build.nvidia.com/explore/discover",
    evidenceUrl: "https://docs.api.nvidia.com/nim/docs/product",
    workItem: "FREE-NVIDIA",
    note: "Only free Developer Program endpoints are admitted; enterprise and paid routes are rejected."
  },
  {
    id: "mistral",
    name: "Mistral",
    model: "mistral-small-latest",
    access: "Experiment plan",
    status: "experiment",
    requests: 1,
    requestLimit: null,
    tokens: 8_400,
    tokenLimit: null,
    reserve: 0,
    capabilities: ["Chat", "JSON", "Tools"],
    dashboardUrl: "https://console.mistral.ai/",
    evidenceUrl: "https://help.mistral.ai/en/articles/347464-how-can-i-check-my-api-usage",
    workItem: "PIPE-180",
    note: "Unknown limits stay unknown. The scheduler uses one request at a time."
  },
  {
    id: "zhipu",
    name: "Zhipu GLM",
    model: "glm-4.7-flash",
    access: "Explicit free model",
    status: "free",
    requests: 8,
    requestLimit: 100,
    tokens: 96_000,
    tokenLimit: 1_000_000,
    reserve: 8,
    capabilities: ["Chat", "JSON", "Tools"],
    dashboardUrl: "https://open.bigmodel.cn/",
    evidenceUrl: "https://docs.bigmodel.cn/cn/guide/start/quick-start",
    workItem: "PIPE-181",
    note: "Region and exact model access are checked before the route becomes eligible."
  },
  {
    id: "sambanova",
    name: "SambaNova",
    model: "DeepSeek-V3.1",
    access: "Scarce free allowance",
    status: "free",
    requests: 11,
    requestLimit: 20,
    tokens: 112_000,
    tokenLimit: 200_000,
    reserve: 4,
    capabilities: ["Chat", "Review"],
    dashboardUrl: "https://cloud.sambanova.ai/",
    evidenceUrl: "https://docs.sambanova.ai/cloud/docs/get-started/rate-limits",
    workItem: "PIPE-182",
    note: "Four daily requests are protected for review and recovery work."
  },
  {
    id: "huggingface",
    name: "Hugging Face",
    model: "GPT OSS 120B",
    access: "Recurring free-user credit",
    status: "free",
    requests: 0,
    requestLimit: null,
    tokens: 0,
    tokenLimit: null,
    reserve: 10,
    capabilities: ["Chat", "JSON"],
    dashboardUrl: "https://huggingface.co/settings/tokens",
    evidenceUrl: "https://huggingface.co/docs/inference-providers/en/pricing",
    workItem: "FREE-HF",
    note: "Routing stops when the monthly free-user credit is exhausted; paid overage is never enabled."
  }
] as const;

const simulationCopy: Record<Simulation, {
  readonly label: string;
  readonly result: string;
  readonly detail: string;
  readonly tone: "positive" | "caution" | "critical" | "neutral";
}> = {
  ready: {
    label: "Healthy",
    result: "Eligible now",
    detail: "Live evidence and canaries satisfy this route.",
    tone: "positive"
  },
  quota: {
    label: "Quota reached",
    result: "Scheduled, not retried",
    detail: "Work sleeps until the provider reset window.",
    tone: "caution"
  },
  restricted: {
    label: "Region blocked",
    result: "Needs your choice",
    detail: "The pipeline explains the restriction and offers eligible alternatives.",
    tone: "critical"
  },
  unverified: {
    label: "Evidence stale",
    result: "Route withheld",
    detail: "A cheap capability canary must pass before work can dispatch.",
    tone: "neutral"
  }
};

export function ExpandedProviderMesh() {
  const [selectedId, setSelectedId] = useState<ExpandedProviderId>("sambanova");
  const [simulation, setSimulation] = useState<Simulation>("ready");
  const selected = useMemo(
    () => providers.find((provider) => provider.id === selectedId) ?? providers[0]!,
    [selectedId]
  );
  const scenario = simulationCopy[simulation];
  const eligibleCount = providers.length;

  return (
    <Card className="relative min-w-0 overflow-hidden xl:col-span-2" aria-label="Expanded provider mesh">
      <div className="pointer-events-none absolute right-8 top-8 size-44 rounded-full bg-primary/[.055]" />
      <CardHeader className="relative flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex flex-wrap gap-2">
            <Badge tone="active">Provider mesh lab</Badge>
            <Badge tone="positive">$0 automatic spend</Badge>
            <Badge tone="neutral">Interactive demo</Badge>
          </div>
          <CardTitle className="mt-4 text-xl">More capacity. One safety contract.</CardTitle>
          <CardDescription className="max-w-2xl">
            Compare account evidence, test failure behavior, and see exactly why a route is admitted,
            scheduled, or withheld.
          </CardDescription>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <MeshMetric value={String(eligibleCount)} label="free routes" />
          <MeshMetric value="0" label="card required" />
          <MeshMetric value="0" label="paid calls" />
        </div>
      </CardHeader>

      <CardContent className="relative mt-7">
        <div className="grid gap-4 2xl:grid-cols-[15rem_minmax(0,1fr)_21rem]">
          <div className="grid gap-2 sm:grid-cols-2 2xl:grid-cols-1" role="list" aria-label="Expanded providers">
            {providers.map((provider) => (
              <div key={provider.id} role="listitem">
                <button
                  type="button"
                  aria-pressed={selected.id === provider.id}
                  onClick={() => setSelectedId(provider.id)}
                  className={cn(
                    "group flex w-full min-w-0 items-center gap-3 rounded-3xl bg-muted/45 p-3 text-left outline-none transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/30",
                    selected.id === provider.id && "bg-primary/[.11]"
                  )}
                >
                  <ProviderGlyph id={provider.id} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-2">
                      <strong className="truncate text-sm">{provider.name}</strong>
                      <span className="size-2 rounded-full bg-emerald-400" />
                    </span>
                    <span className="mt-1 block truncate text-[11px] text-muted-foreground">
                      {provider.access}
                    </span>
                  </span>
                </button>
              </div>
            ))}
          </div>

          <div className="min-w-0 rounded-4xl bg-muted/35 p-5 sm:p-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="flex items-center gap-3">
                <ProviderGlyph id={selected.id} large />
                <div>
                  <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                    Selected route
                  </span>
                  <h3 className="mt-1 text-lg font-semibold">{selected.name}</h3>
                  <p className="text-xs text-muted-foreground">{selected.model}</p>
                </div>
              </div>
              <Badge tone="positive">
                {selected.access}
              </Badge>
            </div>

            <div className="mt-7 grid gap-3 sm:grid-cols-2">
              <CapacityDial
                label="Requests"
                value={selected.requests}
                limit={selected.requestLimit}
                reserve={selected.reserve}
              />
              <CapacityDial
                label="Tokens"
                value={selected.tokens}
                limit={selected.tokenLimit}
                reserve={0}
                compact
              />
            </div>

            <div className="mt-4 grid grid-cols-3 gap-2">
              {selected.capabilities.map((capability) => (
                <span
                  key={capability}
                  className="flex items-center justify-center gap-1.5 rounded-2xl bg-background/70 px-2 py-3 text-[11px] font-semibold"
                >
                  <CheckCircle className="text-emerald-500" weight="fill" />
                  {capability}
                </span>
              ))}
            </div>
            <p className="mt-4 rounded-2xl bg-background/65 p-4 text-xs leading-5 text-muted-foreground">
              {selected.note}
            </p>
          </div>

          <div className="min-w-0 rounded-4xl bg-foreground/[.035] p-5">
            <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              Failure simulator
            </span>
            <div className="mt-4 grid grid-cols-2 gap-2" role="group" aria-label="Provider simulation">
              {(Object.keys(simulationCopy) as Simulation[]).map((key) => (
                <button
                  key={key}
                  type="button"
                  aria-pressed={simulation === key}
                  onClick={() => setSimulation(key)}
                  className={cn(
                    "rounded-2xl bg-background/70 px-3 py-3 text-left text-[11px] font-semibold outline-none hover:bg-background focus-visible:ring-3 focus-visible:ring-ring/30",
                    simulation === key && "bg-primary/[.13] text-primary"
                  )}
                >
                  {simulationCopy[key].label}
                </button>
              ))}
            </div>
            <div className="mt-5 rounded-3xl bg-background/70 p-5" aria-live="polite">
              <ScenarioIcon scenario={simulation} />
              <Badge tone={scenario.tone} className="mt-4">{scenario.result}</Badge>
              <p className="mt-3 text-xs leading-5 text-muted-foreground">{scenario.detail}</p>
              <div className="mt-5 flex items-center gap-2 text-[11px] font-semibold text-muted-foreground">
                <ShieldCheck className="text-primary" weight="duotone" />
                No unsafe fallback
              </div>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <a
                href={selected.dashboardUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 rounded-full bg-muted px-3 py-2 text-[11px] font-semibold hover:bg-muted/75"
              >
                Dashboard <ArrowSquareOut />
              </a>
              <a
                href={selected.evidenceUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 rounded-full bg-muted px-3 py-2 text-[11px] font-semibold hover:bg-muted/75"
              >
                Source <ArrowSquareOut />
              </a>
              <a
                href={`https://opefyre.atlassian.net/browse/${selected.workItem}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 rounded-full bg-muted px-3 py-2 text-[11px] font-semibold hover:bg-muted/75"
              >
                {selected.workItem} <ArrowSquareOut />
              </a>
            </div>
          </div>
        </div>

        <div className="mt-4 grid gap-2 sm:grid-cols-4" aria-label="Routing safety sequence">
          <FlowStep icon={LockKey} label="Redact" note="Secrets stay local" />
          <FlowStep icon={GlobeHemisphereWest} label="Verify" note="Plan, region, model" />
          <FlowStep icon={Lightning} label="Canary" note="Capability proof" />
          <FlowStep icon={Brain} label="Dispatch" note="Best safe route" />
        </div>
      </CardContent>
    </Card>
  );
}

function MeshMetric({ value, label }: { value: string; label: string }) {
  return (
    <div className="min-w-20 rounded-2xl bg-muted/50 px-3 py-3 text-center">
      <strong className="block text-lg tracking-tight">{value}</strong>
      <span className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
    </div>
  );
}

function ProviderGlyph({ id, large = false }: { id: ExpandedProviderId; large?: boolean }) {
  const glyph = {
    "nvidia-nim": "N",
    mistral: "M",
    zhipu: "智",
    sambanova: "S",
    huggingface: "H"
  }[id];
  return (
    <span className={cn(
      "grid shrink-0 place-items-center rounded-2xl bg-background font-semibold text-primary shadow-sm",
      large ? "size-12 text-sm" : "size-10 text-xs"
    )}>
      {glyph}
    </span>
  );
}

function CapacityDial({
  label,
  value,
  limit,
  reserve,
  compact = false
}: {
  label: string;
  value: number;
  limit: number | null;
  reserve: number;
  compact?: boolean;
}) {
  const progress = limit === null ? 16 : Math.min(92, Math.round((value / limit) * 100));
  const displayValue = compact ? compactNumber(value) : String(value);
  const displayLimit = limit === null ? "observing" : compact ? compactNumber(limit) : String(limit);
  const circumference = 2 * Math.PI * 38;
  return (
    <div className="flex items-center gap-4 rounded-3xl bg-background/70 p-4">
      <div className="relative size-20 shrink-0">
        <svg viewBox="0 0 88 88" className="-rotate-90" aria-hidden="true">
          <circle cx="44" cy="44" r="38" fill="none" stroke="currentColor" strokeWidth="7" className="text-muted" />
          <circle
            cx="44"
            cy="44"
            r="38"
            fill="none"
            stroke="currentColor"
            strokeWidth="7"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={circumference * (1 - progress / 100)}
            className="text-primary"
          />
        </svg>
        <span className="absolute inset-0 grid place-items-center text-xs font-semibold">{progress}%</span>
      </div>
      <div className="min-w-0">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</span>
        <strong className="mt-1 block text-base">{displayValue}</strong>
        <span className="text-[10px] text-muted-foreground">of {displayLimit}</span>
        {reserve > 0 && <span className="mt-1 block text-[10px] font-semibold text-primary">{reserve} reserved</span>}
      </div>
    </div>
  );
}

function FlowStep({
  icon: Icon,
  label,
  note
}: {
  icon: typeof ShieldCheck;
  label: string;
  note: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-2xl bg-muted/40 p-3">
      <span className="grid size-9 place-items-center rounded-xl bg-primary/[.12] text-primary">
        <Icon size={18} weight="duotone" />
      </span>
      <span>
        <strong className="block text-xs">{label}</strong>
        <span className="text-[10px] text-muted-foreground">{note}</span>
      </span>
    </div>
  );
}

function ScenarioIcon({ scenario }: { scenario: Simulation }) {
  const icons = {
    ready: <CheckCircle size={27} weight="fill" className="text-emerald-500" />,
    quota: <ClockCountdown size={27} weight="duotone" className="text-amber-500" />,
    restricted: <Warning size={27} weight="fill" className="text-red-400" />,
    unverified: <Gauge size={27} weight="duotone" className="text-muted-foreground" />
  };
  return icons[scenario];
}

function compactNumber(value: number): string {
  if (value >= 1_000_000) return `${value / 1_000_000}m`;
  if (value >= 1_000) return `${Math.round(value / 1_000)}k`;
  return String(value);
}
