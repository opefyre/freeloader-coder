import { ArrowRight } from "@phosphor-icons/react/ArrowRight";
import { BracketsCurly } from "@phosphor-icons/react/BracketsCurly";
import { Check } from "@phosphor-icons/react/Check";
import { CheckCircle } from "@phosphor-icons/react/CheckCircle";
import { CirclesThreePlus } from "@phosphor-icons/react/CirclesThreePlus";
import { Cpu } from "@phosphor-icons/react/Cpu";
import { Desktop } from "@phosphor-icons/react/Desktop";
import { HardDrives } from "@phosphor-icons/react/HardDrives";
import { LinkSimple } from "@phosphor-icons/react/LinkSimple";
import { LockKey } from "@phosphor-icons/react/LockKey";
import { PlugsConnected } from "@phosphor-icons/react/PlugsConnected";
import { Pulse } from "@phosphor-icons/react/Pulse";
import { ShieldCheck } from "@phosphor-icons/react/ShieldCheck";
import { Sparkle } from "@phosphor-icons/react/Sparkle";
import { ThermometerHot } from "@phosphor-icons/react/ThermometerHot";
import { WarningCircle } from "@phosphor-icons/react/WarningCircle";
import { useMemo, useState } from "react";

import { buildFabricSchedule, fabricWorkers } from "../../tool-device-fixture.js";
import { cn } from "../../lib/utils.js";
import { Badge } from "../ui/badge.js";
import { Button } from "../ui/button.js";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card.js";

type View = "catalogue" | "devices" | "scheduler";
type WorkerMode = "healthy" | "thermal" | "sleeping";

const tools = [
  {
    id: "github",
    title: "GitHub workspace",
    description: "Repository reads, scoped branches, checkpoints, and verified publish.",
    origin: "Official",
    trust: "Signed",
    version: "1.4.0",
    permissions: ["Read selected repos", "Write studio branches", "Create draft PR"],
    effect: "External write",
    source: "https://github.com/opefyre/pipeline-studio",
    ticket: "https://opefyre.atlassian.net/browse/PIPE-80"
  },
  {
    id: "jira",
    title: "Jira planning",
    description: "Import exact work, preserve hierarchy, and sync evidence after approval.",
    origin: "Verified community",
    trust: "Reviewed",
    version: "1.2.1",
    permissions: ["Read PIPE work", "Add evidence comments", "Move approved status"],
    effect: "External write",
    source: "https://developer.atlassian.com/cloud/jira/platform/rest/v3/",
    ticket: "https://opefyre.atlassian.net/browse/PIPE-83"
  },
  {
    id: "local-mcp",
    title: "Local docs MCP",
    description: "Search local documentation through a constrained stdio process.",
    origin: "Local development",
    trust: "Quarantined",
    version: "0.3.0",
    permissions: ["Read approved docs"],
    effect: "Local read",
    source: "https://modelcontextprotocol.io/",
    ticket: "https://opefyre.atlassian.net/browse/PIPE-81"
  }
] as const;

const capabilityRows = [
  { label: "Model inference", main: "—", spare: "2 local" },
  { label: "Code execution", main: "Monitor", spare: "Ready" },
  { label: "Containers", main: "Ready", spare: "Ready" },
  { label: "Validation", main: "On demand", spare: "Primary" },
  { label: "Review", main: "Human", spare: "Worker" }
] as const;

export function ToolDeviceFabric() {
  const [view, setView] = useState<View>("catalogue");
  const [selectedTool, setSelectedTool] = useState<(typeof tools)[number]["id"]>("github");
  const [enabled, setEnabled] = useState<string[]>(["github", "jira"]);
  const [mcpState, setMcpState] = useState<"quarantined" | "approved" | "connected">("quarantined");
  const [pairing, setPairing] = useState<"idle" | "code" | "confirmed">("idle");
  const [workerMode, setWorkerMode] = useState<WorkerMode>("healthy");
  const [actionNote, setActionNote] = useState("No device action is pending.");
  const schedule = useMemo(() => buildFabricSchedule(workerMode), [workerMode]);
  const activeTool = tools.find((tool) => tool.id === selectedTool) ?? tools[0]!;

  return (
    <section aria-labelledby="fabric-title" className="space-y-4 pt-4">
      <Card className="relative">
        <div className="pointer-events-none absolute right-6 top-5 hidden grid-cols-6 gap-1.5 opacity-50 md:grid">
          {Array.from({ length: 24 }, (_, index) => (
            <span
              key={index}
              className={cn(
                "size-1.5 rounded-full",
                index % 5 === 0 ? "bg-primary" : "bg-foreground/15"
              )}
            />
          ))}
        </div>
        <CardHeader className="relative max-w-3xl">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="active"><CirclesThreePlus weight="fill" /> Sprint 13</Badge>
            <Badge>Interactive contract demo</Badge>
            <a
              href="https://opefyre.atlassian.net/browse/PIPE-80"
              target="_blank"
              rel="noreferrer"
              className="text-xs font-semibold text-primary hover:underline"
            >
              PIPE-80–87
            </a>
          </div>
          <CardTitle id="fabric-title" className="mt-4 text-2xl">
            Tool & device fabric
          </CardTitle>
          <CardDescription className="max-w-2xl leading-6">
            One permission boundary for every action. One controller for every task. Heavy work goes to the spare machine without surrendering authority.
          </CardDescription>
        </CardHeader>
        <CardContent className="mt-5 grid gap-3 sm:grid-cols-3">
          <PulseFact icon={ShieldCheck} value="3" label="governed tools" note="0 implicit grants" />
          <PulseFact icon={Desktop} value="2" label="trusted devices" note="1 compute worker" />
          <PulseFact icon={Pulse} value="100%" label="lease authority" note="controller owned" />
        </CardContent>
      </Card>

      <div
        role="tablist"
        aria-label="Tool and device fabric views"
        className="grid grid-cols-3 gap-1 rounded-3xl bg-muted/65 p-1"
      >
        {([
          ["catalogue", "Tool catalogue"],
          ["devices", "Device mesh"],
          ["scheduler", "Work routing"]
        ] as const).map(([id, label]) => (
          <button
            key={id}
            role="tab"
            type="button"
            aria-selected={view === id}
            onClick={() => setView(id)}
            className={cn(
              "min-h-11 rounded-[1.15rem] px-2 text-xs font-semibold text-muted-foreground outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/30 sm:text-sm",
              view === id && "bg-card text-foreground shadow-sm"
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {view === "catalogue" && (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(20rem,.72fr)]">
          <Card>
            <CardHeader className="flex flex-row items-start justify-between gap-3">
              <div>
                <CardTitle>Permissioned catalogue</CardTitle>
                <CardDescription>Discovery is not permission. Inspect before enabling.</CardDescription>
              </div>
              <Badge tone="positive">Schema v1</Badge>
            </CardHeader>
            <CardContent className="mt-5 space-y-2">
              {tools.map((tool) => {
                const selected = selectedTool === tool.id;
                const active = enabled.includes(tool.id);
                return (
                  <button
                    key={tool.id}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => setSelectedTool(tool.id)}
                    className={cn(
                      "grid w-full gap-3 rounded-3xl bg-muted/45 p-4 text-left outline-none transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/30 sm:grid-cols-[auto_1fr_auto] sm:items-center",
                      selected && "bg-primary/[.09]"
                    )}
                  >
                    <span className="grid size-11 place-items-center rounded-2xl bg-background text-primary">
                      {tool.id === "github" ? <BracketsCurly size={22} /> : tool.id === "jira" ? <LinkSimple size={22} /> : <PlugsConnected size={22} />}
                    </span>
                    <span className="min-w-0">
                      <span className="flex flex-wrap items-center gap-2">
                        <strong className="text-sm">{tool.title}</strong>
                        <Badge tone={tool.trust === "Quarantined" ? "caution" : "positive"}>{tool.trust}</Badge>
                      </span>
                      <span className="mt-1 block text-xs text-muted-foreground">
                        {tool.origin} · v{tool.version} · {tool.effect}
                      </span>
                    </span>
                    <Badge tone={active ? "active" : "neutral"}>{active ? "Enabled" : "Off"}</Badge>
                  </button>
                );
              })}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex items-center justify-between gap-3">
                <CardTitle>{activeTool.title}</CardTitle>
                <Badge tone={activeTool.trust === "Quarantined" ? "caution" : "positive"}>{activeTool.trust}</Badge>
              </div>
              <CardDescription>{activeTool.description}</CardDescription>
            </CardHeader>
            <CardContent className="mt-5 space-y-4">
              <div className="grid gap-2">
                {activeTool.permissions.map((permission) => (
                  <div key={permission} className="flex items-center gap-2 rounded-2xl bg-muted/45 px-3 py-2.5 text-xs">
                    <Check className="shrink-0 text-primary" weight="bold" />
                    {permission}
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <a href={activeTool.source} target="_blank" rel="noreferrer" className="rounded-2xl bg-muted/45 p-3 font-semibold hover:bg-muted">
                  Source <ArrowRight className="ml-1 inline" />
                </a>
                <a href={activeTool.ticket} target="_blank" rel="noreferrer" className="rounded-2xl bg-muted/45 p-3 font-semibold hover:bg-muted">
                  Work item <ArrowRight className="ml-1 inline" />
                </a>
              </div>
              <Button
                className="w-full"
                variant={enabled.includes(activeTool.id) ? "secondary" : "default"}
                onClick={() => setEnabled((current) =>
                  current.includes(activeTool.id)
                    ? current.filter((id) => id !== activeTool.id)
                    : [...current, activeTool.id]
                )}
              >
                {enabled.includes(activeTool.id) ? <LockKey /> : <ShieldCheck />}
                {enabled.includes(activeTool.id) ? "Disable and reconcile" : "Review and enable"}
              </Button>
            </CardContent>
          </Card>

          <Card className="xl:col-span-2">
            <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <CardTitle>Constrained MCP lifecycle</CardTitle>
                <CardDescription>Local docs MCP · stdio · one approved directory · no network.</CardDescription>
              </div>
              <Badge tone={mcpState === "connected" ? "positive" : "caution"}>{mcpState}</Badge>
            </CardHeader>
            <CardContent className="mt-5">
              <div className="grid gap-3 md:grid-cols-[1fr_auto_1fr_auto_1fr] md:items-center">
                <LifecycleNode icon={PlugsConnected} label="Discovered" detail="1 tool found" active />
                <ArrowRight className="hidden text-muted-foreground md:block" />
                <LifecycleNode icon={ShieldCheck} label="Quarantined" detail="Effects reviewed" active={mcpState !== "quarantined"} />
                <ArrowRight className="hidden text-muted-foreground md:block" />
                <LifecycleNode icon={CheckCircle} label="Connected" detail="Project-scoped" active={mcpState === "connected"} />
              </div>
              <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                <Button
                  className="sm:flex-1"
                  onClick={() => setMcpState((state) => state === "quarantined" ? "approved" : "connected")}
                  disabled={mcpState === "connected"}
                >
                  <ShieldCheck />
                  {mcpState === "quarantined" ? "Approve read-only effect" : mcpState === "approved" ? "Connect isolated server" : "Verified connection"}
                </Button>
                <Button variant="secondary" onClick={() => setMcpState("quarantined")}>
                  Revoke and quarantine
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {view === "devices" && (
        <div className="space-y-4">
          <Card>
            <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <CardTitle>Private device mesh</CardTitle>
                <CardDescription>Mutually authenticated. LAN or private network only.</CardDescription>
              </div>
              <Button variant="secondary" onClick={() => setPairing(pairing === "idle" ? "code" : pairing === "code" ? "confirmed" : "idle")}>
                <CirclesThreePlus />
                {pairing === "idle" ? "Pair a worker" : pairing === "code" ? "Confirm this device" : "Pairing verified"}
              </Button>
            </CardHeader>
            <CardContent className="mt-5">
              {pairing !== "idle" && (
                <div className={cn("mb-4 rounded-3xl p-4", pairing === "confirmed" ? "bg-emerald-400/[.08]" : "bg-primary/[.08]")} aria-live="polite">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <strong className="text-sm">{pairing === "confirmed" ? "Mutual identity verified" : "Single-use pairing code"}</strong>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {pairing === "confirmed" ? "Credential is device-bound and revocable." : "Expires in 04:58 · confirmation required on controller."}
                      </p>
                    </div>
                    <span className="font-mono text-xl font-semibold tracking-[.28em]">{pairing === "confirmed" ? "••••••••" : "7A9C2F10"}</span>
                  </div>
                </div>
              )}
              <div className="relative grid gap-4 md:grid-cols-2">
                <span className="pointer-events-none absolute left-1/2 top-1/2 hidden h-0.5 w-12 -translate-x-1/2 bg-primary/40 md:block" />
                <DeviceCard
                  title="Main Mac"
                  role="Controller · monitor and review"
                  detail="24 GB · source authority"
                  status="Online"
                  active="Human review"
                  icon={Desktop}
                  primary={false}
                />
                <DeviceCard
                  title="Spare Mac"
                  role="Primary compute worker"
                  detail="8 GB · 431 GB free · 2 local models"
                  status={workerMode === "healthy" ? "Busy" : workerMode === "thermal" ? "Thermal drain" : "Sleeping"}
                  active={workerMode === "healthy" ? "PIPE-86 · implementation" : "Lease preserved"}
                  icon={HardDrives}
                  primary
                />
              </div>
            </CardContent>
          </Card>

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(20rem,.7fr)]">
            <Card>
              <CardHeader>
                <CardTitle>Capability matrix</CardTitle>
                <CardDescription>Signed discovery report · observed 42s ago.</CardDescription>
              </CardHeader>
              <CardContent className="mt-5">
                <div className="grid grid-cols-[minmax(8rem,1fr)_minmax(5rem,.7fr)_minmax(5rem,.7fr)] gap-2 text-xs">
                  <span className="px-3 text-muted-foreground">Capability</span>
                  <strong className="px-3 text-center">Main</strong>
                  <strong className="px-3 text-center">Spare</strong>
                  {capabilityRows.flatMap((row) => [
                    <span key={`${row.label}-label`} className="rounded-2xl bg-muted/45 px-3 py-2.5 font-medium">{row.label}</span>,
                    <span key={`${row.label}-main`} className="rounded-2xl bg-muted/45 px-2 py-2.5 text-center text-muted-foreground">{row.main}</span>,
                    <span key={`${row.label}-spare`} className="rounded-2xl bg-primary/[.08] px-2 py-2.5 text-center font-semibold text-primary">{row.spare}</span>
                  ])}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Safe device controls</CardTitle>
                <CardDescription>Actions affect future leases, never active work.</CardDescription>
              </CardHeader>
              <CardContent className="mt-5 space-y-2">
                {[
                  ["Drain", "Finish current lease"],
                  ["Move next work", "Keep active lease"],
                  ["Repair", "Blocked while active"]
                ].map(([label, note]) => (
                  <button
                    key={label}
                    type="button"
                    onClick={() => setActionNote(`${label}: ${note}. No active model or validator was restarted.`)}
                    className="flex w-full items-center justify-between rounded-2xl bg-muted/45 p-3 text-left text-xs outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/30"
                  >
                    <strong>{label}</strong>
                    <span className="text-muted-foreground">{note}</span>
                  </button>
                ))}
                <p className="rounded-2xl bg-emerald-400/[.07] p-3 text-xs leading-5 text-muted-foreground" aria-live="polite">{actionNote}</p>
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {view === "scheduler" && (
        <div className="space-y-4">
          <Card>
            <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <CardTitle>Capability-aware work routing</CardTitle>
                <CardDescription>Policy + locality + load + resource pressure. Stable inputs produce the same route.</CardDescription>
              </div>
              <div className="flex rounded-2xl bg-muted/55 p-1" role="group" aria-label="Worker state simulation">
                {([
                  ["healthy", "Healthy"],
                  ["thermal", "Thermal"],
                  ["sleeping", "Sleep"]
                ] as const).map(([mode, label]) => (
                  <button
                    key={mode}
                    type="button"
                    aria-pressed={workerMode === mode}
                    onClick={() => setWorkerMode(mode)}
                    className={cn(
                      "rounded-xl px-3 py-2 text-xs font-semibold text-muted-foreground",
                      workerMode === mode && "bg-card text-foreground shadow-sm"
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </CardHeader>
            <CardContent className="mt-5 space-y-3">
              {schedule.map((decision, index) => {
                const task = ["Implementation", "Independent validation", "Controller-only planning"][index] ?? "Work";
                const remote = decision.deviceId === fabricWorkers[1]!.report.deviceId;
                return (
                  <div key={decision.taskId} className="grid gap-3 rounded-3xl bg-muted/40 p-4 md:grid-cols-[minmax(8rem,.7fr)_auto_minmax(11rem,1fr)] md:items-center">
                    <div>
                      <div className="flex items-center gap-2">
                        <Badge tone="active">{decision.taskId}</Badge>
                        <strong className="text-sm">{task}</strong>
                      </div>
                      <p className="mt-2 text-xs text-muted-foreground">
                        {index === 2 ? "Private · source local" : "Trusted devices · free-only"}
                      </p>
                    </div>
                    <ArrowRight className="hidden text-primary md:block" />
                    <div className={cn("rounded-2xl p-3", remote ? "bg-primary/[.09]" : "bg-card")}>
                      <div className="flex items-center justify-between gap-3">
                        <span className="flex items-center gap-2 text-sm font-semibold">
                          {remote ? <HardDrives className="text-primary" /> : <Desktop className="text-primary" />}
                          {remote ? "Spare Mac" : decision.deviceId ? "Main Mac" : "Waiting safely"}
                        </span>
                        <Badge tone={decision.deviceId ? "positive" : "caution"}>
                          {decision.deviceId ? `score ${decision.score}` : "No eligible worker"}
                        </Badge>
                      </div>
                      <p className="mt-2 text-xs leading-5 text-muted-foreground">{decision.reason}</p>
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>

          <div className="grid gap-4 md:grid-cols-3">
            <SchedulerMetric icon={Cpu} label="Main Mac load" value={workerMode === "healthy" ? "12%" : "9%"} segments={2} />
            <SchedulerMetric icon={Pulse} label="Lease freshness" value="08:41" segments={5} />
            <SchedulerMetric icon={workerMode === "thermal" ? ThermometerHot : Sparkle} label="Worker policy" value={workerMode === "healthy" ? "Optimal" : workerMode === "thermal" ? "Draining" : "Preserved"} segments={workerMode === "healthy" ? 5 : 2} caution={workerMode !== "healthy"} />
          </div>

          {workerMode !== "healthy" && (
            <div className="flex items-start gap-3 rounded-3xl bg-amber-400/[.09] p-4 text-sm" role="status">
              <WarningCircle className="mt-0.5 shrink-0 text-amber-400" size={20} weight="fill" />
              <div>
                <strong>Automatic safety response</strong>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  New work moved to an eligible device. The active lease stays authoritative until expiry and effect reconciliation—no duplicate execution.
                </p>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function PulseFact({
  icon: Icon,
  value,
  label,
  note
}: {
  icon: typeof Pulse;
  value: string;
  label: string;
  note: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-3xl bg-muted/45 p-4">
      <span className="grid size-11 place-items-center rounded-2xl bg-primary/[.10] text-primary">
        <Icon size={22} weight="duotone" />
      </span>
      <span>
        <span className="block text-lg font-semibold">{value} <span className="text-sm text-muted-foreground">{label}</span></span>
        <span className="block text-xs text-muted-foreground">{note}</span>
      </span>
    </div>
  );
}

function LifecycleNode({
  icon: Icon,
  label,
  detail,
  active
}: {
  icon: typeof ShieldCheck;
  label: string;
  detail: string;
  active: boolean;
}) {
  return (
    <div className={cn("flex items-center gap-3 rounded-3xl bg-muted/45 p-4", active && "bg-primary/[.09]")}>
      <span className={cn("grid size-10 place-items-center rounded-2xl bg-background text-muted-foreground", active && "text-primary")}>
        <Icon size={20} />
      </span>
      <span>
        <strong className="block text-sm">{label}</strong>
        <span className="block text-xs text-muted-foreground">{detail}</span>
      </span>
    </div>
  );
}

function DeviceCard({
  title,
  role,
  detail,
  status,
  active,
  icon: Icon,
  primary
}: {
  title: string;
  role: string;
  detail: string;
  status: string;
  active: string;
  icon: typeof Desktop;
  primary: boolean;
}) {
  return (
    <div className={cn("relative rounded-3xl bg-muted/45 p-5", primary && "bg-primary/[.09]")}>
      <div className="flex items-start justify-between gap-4">
        <span className="grid size-12 place-items-center rounded-2xl bg-background text-primary">
          <Icon size={25} weight="duotone" />
        </span>
        <Badge tone={status === "Online" || status === "Busy" ? "positive" : "caution"}>{status}</Badge>
      </div>
      <h3 className="mt-5 font-semibold">{title}</h3>
      <p className="mt-1 text-xs text-muted-foreground">{role}</p>
      <p className="mt-4 text-xs">{detail}</p>
      <div className="mt-3 flex items-center gap-2 rounded-2xl bg-background/80 px-3 py-2 text-xs">
        <span className={cn("size-2 rounded-full", status === "Online" || status === "Busy" ? "bg-emerald-400" : "bg-amber-400")} />
        {active}
      </div>
    </div>
  );
}

function SchedulerMetric({
  icon: Icon,
  label,
  value,
  segments,
  caution = false
}: {
  icon: typeof Cpu;
  label: string;
  value: string;
  segments: number;
  caution?: boolean;
}) {
  return (
    <Card>
      <CardContent className="pt-5 sm:pt-6">
        <div className="flex items-center justify-between gap-3">
          <span className="grid size-10 place-items-center rounded-2xl bg-primary/[.10] text-primary"><Icon size={20} /></span>
          <strong>{value}</strong>
        </div>
        <p className="mt-4 text-xs text-muted-foreground">{label}</p>
        <div className="mt-3 grid grid-cols-5 gap-1.5" aria-label={`${label}: ${value}`}>
          {Array.from({ length: 5 }, (_, index) => (
            <span key={index} className={cn("h-1.5 rounded-full bg-muted", index < segments && (caution ? "bg-amber-400" : "bg-primary"))} />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
