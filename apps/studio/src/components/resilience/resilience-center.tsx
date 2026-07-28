import { ArrowClockwise } from "@phosphor-icons/react/ArrowClockwise";
import { CheckCircle } from "@phosphor-icons/react/CheckCircle";
import { Database } from "@phosphor-icons/react/Database";
import { DownloadSimple } from "@phosphor-icons/react/DownloadSimple";
import { HardDrives } from "@phosphor-icons/react/HardDrives";
import { ShieldCheck } from "@phosphor-icons/react/ShieldCheck";
import { Trash } from "@phosphor-icons/react/Trash";
import { Warning } from "@phosphor-icons/react/Warning";
import { useState } from "react";
import { cn } from "../../lib/utils.js";
import { Badge } from "../ui/badge.js";
import { Button } from "../ui/button.js";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card.js";

const storage = [
  { label: "Artifacts", value: 43, size: "1.8 GB" },
  { label: "Projects", value: 28, size: "1.2 GB" },
  { label: "Evidence", value: 19, size: "804 MB" },
  { label: "Conversations", value: 10, size: "422 MB" },
] as const;
const services = [
  { name: "API", state: "Healthy", note: "1 process" },
  { name: "Worker", state: "Healthy", note: "1 process · lease active" },
  { name: "Validator", state: "Healthy", note: "Image ready" },
  { name: "Model gateway", state: "Slow", note: "Active request · not stalled" },
] as const;
const faults = ["429", "Timeout", "Crash", "Disk", "Network", "DB lock", "Worker", "Lease", "Duplicate", "OAuth"] as const;

export function ResilienceCenter() {
  const [backup, setBackup] = useState(false);
  const [restore, setRestore] = useState<"idle" | "verified">("idle");
  const [deletion, setDeletion] = useState(false);
  const [interruption, setInterruption] = useState<"normal" | "quota" | "recovery">("normal");
  const [chaos, setChaos] = useState(false);
  return (
    <section aria-labelledby="resilience-title" className="mb-7 space-y-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex flex-wrap gap-2"><Badge tone="positive"><ShieldCheck weight="fill" /> Data protected</Badge><Badge>Schema v3 · verified</Badge><a href="https://opefyre.atlassian.net/browse/PIPE-88" target="_blank" rel="noreferrer" className="text-xs font-semibold text-primary hover:underline">PIPE-88–96</a></div>
          <h2 id="resilience-title" className="mt-4 text-2xl font-semibold">Local data and reliability</h2>
          <p className="mt-1 text-sm text-muted-foreground">Own, migrate, back up, recover, and prove the system without trusting a running process blindly.</p>
        </div>
        <Badge tone="positive">Error budget · 82% remaining</Badge>
      </div>

      <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(20rem,.85fr)]">
        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-3"><div><CardTitle>Storage ownership</CardTitle><CardDescription>4.2 GB · Main project · credentials excluded.</CardDescription></div><Database className="text-primary" size={24} /></CardHeader>
          <CardContent className="mt-5 space-y-3">
            {storage.map((item) => <div key={item.label} className="grid grid-cols-[6rem_1fr_4rem] items-center gap-3 text-xs"><span>{item.label}</span><span className="h-2 overflow-hidden rounded-full bg-muted"><span className="block h-full rounded-full bg-primary" style={{ width: `${item.value}%` }} /></span><strong className="text-right">{item.size}</strong></div>)}
            <div className="mt-4 grid gap-2 sm:grid-cols-3">
              <Button variant="secondary" onClick={() => setBackup(true)}><DownloadSimple /> Preview backup</Button>
              <Button variant="secondary" onClick={() => setRestore("verified")}><ArrowClockwise /> Verify restore</Button>
              <Button variant="ghost" onClick={() => setDeletion(true)}><Trash /> Deletion dry run</Button>
            </div>
            {(backup || restore === "verified" || deletion) && <div className="rounded-3xl bg-primary/[.08] p-4 text-xs leading-5" aria-live="polite">
              {deletion ? "Dry run: 312 MB deletable · active task, checkpoint, audit, and 2 shared artifacts preserved · revoke GitHub and Jira grants separately · bounded undo snapshot available."
                : restore === "verified" ? "Restore verified against empty, existing, older, and newer profiles. Conflicts default to Keep existing; nothing is overwritten silently."
                  : "Encrypted backup preview: projects, selected conversations, task history, and evidence · destination /Backups · credentials and provider tokens excluded."}
            </div>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Atomic migration</CardTitle><CardDescription>Backup → migrate → verify → commit. Failure restores v2.</CardDescription></CardHeader>
          <CardContent className="mt-5">
            <div className="grid grid-cols-4 gap-2">
              {["Snapshot", "Migrate", "Verify", "Commit"].map((step, index) => <div key={step} className="rounded-2xl bg-emerald-400/[.08] p-3 text-center"><CheckCircle className="mx-auto text-emerald-500" weight="fill" /><strong className="mt-2 block text-[10px]">{step}</strong><span className="text-[9px] text-muted-foreground">0{index + 1}</span></div>)}
            </div>
            <div className="mt-4 rounded-3xl bg-muted/50 p-4"><strong className="text-sm">v2 → v3 verified</strong><p className="mt-1 text-xs leading-5 text-muted-foreground">Idempotent replay: current. Rollback metadata retained. Newer incompatible profiles open read-only.</p></div>
          </CardContent>
        </Card>
      </div>

      <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(20rem,.8fr)]">
        <Card>
          <CardHeader className="flex flex-row items-start justify-between"><div><CardTitle>Outcome health</CardTitle><CardDescription>Safe progress and real activity—not process existence.</CardDescription></div><Badge tone="positive">Healthy</Badge></CardHeader>
          <CardContent className="mt-5 grid gap-2 sm:grid-cols-2">
            {services.map((service) => <button key={service.name} type="button" className="rounded-3xl bg-muted/50 p-4 text-left outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/30"><div className="flex justify-between"><strong className="text-sm">{service.name}</strong><Badge tone={service.state === "Healthy" ? "positive" : "caution"}>{service.state}</Badge></div><span className="mt-2 block text-xs text-muted-foreground">{service.note}</span></button>)}
            <p className="sm:col-span-2 rounded-2xl bg-primary/[.07] p-3 text-xs">Exact-scope recovery only: duplicate process, active request, migration, external effect, and live lease checks run before restart.</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Interruption recovery</CardTitle><CardDescription>Sleep, restart, offline, quota, credentials, worker, and environment remain distinct.</CardDescription></CardHeader>
          <CardContent className="mt-5">
            <div className={cn("rounded-3xl p-4", interruption === "normal" ? "bg-emerald-400/[.08]" : "bg-amber-400/[.10]")}>
              <strong className="text-sm">{interruption === "normal" ? "Ready" : interruption === "quota" ? "Quota wait scheduled" : "Read-only recovery"}</strong>
              <p className="mt-2 text-xs leading-5 text-muted-foreground">{interruption === "normal" ? "Checkpoint and idempotency journal current." : interruption === "quota" ? "Work preserved · lease released · wake at 00:00 UTC · no busy polling." : "Partial write detected · last valid checkpoint restored · external effects will not repeat."}</p>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2"><Button size="sm" variant="secondary" onClick={() => setInterruption("quota")}>Simulate quota</Button><Button size="sm" variant="ghost" onClick={() => setInterruption("recovery")}>Simulate partial write</Button></div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between"><div><CardTitle>Reliability release gate</CardTitle><CardDescription>Failure injection proves recovery, integrity, idempotency, and safe terminal states.</CardDescription></div><Button variant="secondary" onClick={() => setChaos(true)}><HardDrives /> Run restore drill</Button></CardHeader>
        <CardContent className="mt-5">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5 xl:grid-cols-10">{faults.map((fault) => <div key={fault} className={cn("rounded-2xl p-3 text-center", chaos ? "bg-emerald-400/[.08]" : "bg-muted/50")}><span className="text-[10px] font-semibold">{fault}</span><span className="mt-2 block text-[9px] text-muted-foreground">{chaos ? "Passed" : "Ready"}</span></div>)}</div>
          <p className="mt-4 rounded-2xl bg-muted/50 p-3 text-xs" aria-live="polite">{chaos ? "Release allowed: backup/restore and rollback passed; data integrity preserved; 0 duplicate effects; unrecoverable faults reached a bounded safe state." : "Release gate ready. Any data-integrity loss or duplicate external effect blocks release."}</p>
        </CardContent>
      </Card>
    </section>
  );
}
