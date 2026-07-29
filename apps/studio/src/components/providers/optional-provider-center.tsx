import { ArrowSquareOut } from "@phosphor-icons/react/ArrowSquareOut";
import { CheckCircle } from "@phosphor-icons/react/CheckCircle";
import { CurrencyDollar } from "@phosphor-icons/react/CurrencyDollar";
import { LockKey } from "@phosphor-icons/react/LockKey";
import { Power } from "@phosphor-icons/react/Power";
import { Robot } from "@phosphor-icons/react/Robot";
import { ShieldCheck } from "@phosphor-icons/react/ShieldCheck";
import { Warning } from "@phosphor-icons/react/Warning";
import { useState } from "react";

import { Button } from "../ui/button.js";
import { Badge } from "../ui/badge.js";
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from "../ui/card.js";
import { cn } from "../../lib/utils.js";

type OptionalId = "openai" | "codex" | "anthropic";
type Simulation = "default" | "budget" | "emergency";

const integrations = [
  {
    id: "openai",
    name: "OpenAI API",
    kind: "API-key billing",
    interface: "Responses API",
    ticket: "PIPE-114",
    source: "https://developers.openai.com/api/docs/guides/migrate-to-responses",
    note: "Separate from ChatGPT and Codex subscriptions. Uses vault-only key references and store: false.",
  },
  {
    id: "codex",
    name: "Codex worker",
    kind: "Codex login or entitlement",
    interface: "App server / SDK",
    ticket: "PIPE-115",
    source: "https://learn.chatgpt.com/docs/app-server",
    note: "Threads, turns, approvals, sandbox, and events stay distinct from generic model requests.",
  },
  {
    id: "anthropic",
    name: "Anthropic API",
    kind: "Anthropic Console billing",
    interface: "Messages API",
    ticket: "PIPE-116",
    source: "https://docs.anthropic.com/en/api/messages",
    note: "Separate from consumer Claude plans. Provider failure cannot weaken independent review.",
  },
] as const;

export function OptionalProviderCenter() {
  const [selectedId, setSelectedId] = useState<OptionalId>("openai");
  const [simulation, setSimulation] = useState<Simulation>("default");
  const selected = integrations.find((item) => item.id === selectedId) ?? integrations[0];
  const decision = simulation === "default"
    ? {
        title: "Denied by default",
        detail: "No credential, authorization, route, budget, or final confirmation exists.",
        tone: "positive" as const,
      }
    : simulation === "budget"
      ? {
          title: "Hard budget reached",
          detail: "The call stops locally. It cannot fall through to another paid provider.",
          tone: "caution" as const,
        }
      : {
          title: "Emergency shutdown active",
          detail: "Every new paid call is denied immediately; existing evidence remains available.",
          tone: "critical" as const,
        };

  return (
    <Card className="min-w-0 xl:col-span-2" aria-labelledby="optional-provider-title">
      <CardHeader className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex flex-wrap gap-2">
            <Badge tone="positive">$0 spent</Badge>
            <Badge tone="neutral">0 paid calls</Badge>
            <Badge tone="caution">All integrations disabled</Badge>
          </div>
          <CardTitle id="optional-provider-title" className="mt-4 text-xl">
            Optional power stays behind hard limits
          </CardTitle>
          <CardDescription className="max-w-2xl">
            Integration contracts are installed, but nothing can execute until
            credentials, an exact route, role scope, four hard budgets, and final
            approval all agree.
          </CardDescription>
        </div>
        <a
          href="https://opefyre.atlassian.net/browse/PIPE-113"
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
        >
          Paid safety policy <ArrowSquareOut />
        </a>
      </CardHeader>
      <CardContent className="mt-7 grid gap-4 2xl:grid-cols-[16rem_minmax(0,1fr)_21rem]">
        <div className="grid gap-2 sm:grid-cols-3 2xl:grid-cols-1" role="list" aria-label="Optional integrations">
          {integrations.map((item) => (
            <button
              key={item.id}
              type="button"
              role="listitem"
              aria-pressed={selected.id === item.id}
              onClick={() => setSelectedId(item.id)}
              className={cn(
                "rounded-3xl bg-muted/50 p-4 text-left outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/30",
                selected.id === item.id && "bg-primary/[.10]"
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="grid size-9 place-items-center rounded-xl bg-background text-primary">
                  {item.id === "codex" ? <Robot /> : <LockKey />}
                </span>
                <Badge tone="neutral">Off</Badge>
              </div>
              <strong className="mt-4 block text-sm">{item.name}</strong>
              <span className="mt-1 block text-xs text-muted-foreground">{item.kind}</span>
            </button>
          ))}
        </div>

        <div className="rounded-4xl bg-muted/40 p-5 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <span className="text-[10px] uppercase tracking-[.14em] text-muted-foreground">Selected integration</span>
              <h3 className="mt-2 text-xl font-semibold">{selected.name}</h3>
              <p className="mt-1 text-xs text-muted-foreground">{selected.interface}</p>
            </div>
            <Badge tone="caution">Not configured</Badge>
          </div>
          <p className="mt-6 text-sm leading-6 text-muted-foreground">{selected.note}</p>
          <div className="mt-6 grid gap-2 sm:grid-cols-2">
            {[
              ["Credential", "Missing · vault reference only"],
              ["Role scope", "None approved"],
              ["Hard budgets", "Request · task · day · month"],
              ["Fallback", "Paid fallback denied"],
            ].map(([label, value]) => (
              <div key={label} className="rounded-2xl bg-background/70 p-4">
                <span className="text-[10px] uppercase tracking-[.12em] text-muted-foreground">{label}</span>
                <strong className="mt-2 block text-xs">{value}</strong>
              </div>
            ))}
          </div>
          <div className="mt-5 flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" onClick={() => setSimulation("default")}>
              <ShieldCheck /> Review setup
            </Button>
            <a
              href={selected.source}
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-9 items-center gap-2 rounded-xl px-3 text-xs font-semibold text-primary hover:bg-primary/[.08]"
            >
              Official interface <ArrowSquareOut />
            </a>
            <a
              href={`https://opefyre.atlassian.net/browse/${selected.ticket}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-9 items-center gap-2 rounded-xl px-3 text-xs font-semibold text-primary hover:bg-primary/[.08]"
            >
              {selected.ticket} <ArrowSquareOut />
            </a>
          </div>
        </div>

        <div className="rounded-4xl bg-foreground/[.035] p-5">
          <span className="text-[10px] uppercase tracking-[.14em] text-muted-foreground">Safety simulator</span>
          <div className="mt-4 grid grid-cols-3 gap-2" role="group" aria-label="Paid safety simulations">
            <SimulationButton active={simulation === "default"} label="Default" onClick={() => setSimulation("default")} />
            <SimulationButton active={simulation === "budget"} label="Budget" onClick={() => setSimulation("budget")} />
            <SimulationButton active={simulation === "emergency"} label="Stop all" onClick={() => setSimulation("emergency")} />
          </div>
          <div className="mt-5 rounded-3xl bg-background/75 p-5" aria-live="polite">
            <span className={cn(
              "grid size-10 place-items-center rounded-xl",
              decision.tone === "critical" ? "bg-rose-400/12 text-rose-500" :
                decision.tone === "caution" ? "bg-amber-400/12 text-amber-600" :
                  "bg-emerald-400/12 text-emerald-600"
            )}>
              {simulation === "emergency" ? <Power /> : simulation === "budget" ? <CurrencyDollar /> : <CheckCircle />}
            </span>
            <Badge tone={decision.tone} className="mt-4">{decision.title}</Badge>
            <p className="mt-3 text-xs leading-5 text-muted-foreground">{decision.detail}</p>
          </div>
          <p className="mt-4 flex items-start gap-2 text-xs leading-5 text-muted-foreground">
            <Warning className="mt-0.5 shrink-0 text-primary" />
            ChatGPT, Codex, and Claude subscriptions do not enable API billing.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

function SimulationButton({
  active, label, onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "rounded-2xl bg-background/70 px-2 py-3 text-[11px] font-semibold outline-none hover:bg-background focus-visible:ring-3 focus-visible:ring-ring/30",
        active && "bg-primary/[.13] text-primary"
      )}
    >
      {label}
    </button>
  );
}
