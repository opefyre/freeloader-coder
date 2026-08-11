import { ArrowClockwise } from "@phosphor-icons/react/ArrowClockwise";
import { FileText } from "@phosphor-icons/react/FileText";
import { Warning } from "@phosphor-icons/react/Warning";
import { useCallback, useEffect, useState } from "react";

import { listProjectArtifacts, openProjectArtifact, type ProjectArtifactInspection } from "../../local-project-client.js";
import { Badge } from "../ui/badge.js";
import { Button } from "../ui/button.js";

export function ProjectArtifactWorkspace(props: { endpoint: string; projectId: string }) {
  const [items, setItems] = useState<readonly ProjectArtifactInspection[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "offline">("loading");
  const [notice, setNotice] = useState("");
  const refresh = useCallback(async () => {
    try { setItems(await listProjectArtifacts(props)); setState("ready"); setNotice(""); }
    catch { setState("offline"); setNotice("Artifact status is unavailable. Existing project files were not changed."); }
  }, [props.endpoint, props.projectId]);
  useEffect(() => { void refresh(); }, [refresh]);
  const open = async (item: ProjectArtifactInspection) => {
    try {
      await openProjectArtifact({ ...props, kind: item.kind, idempotencyKey: `artifact-open:${crypto.randomUUID()}` });
      setNotice(`${item.fileName} opened on this computer.`);
    } catch { setNotice(`${item.fileName} could not be opened. The file remains unchanged.`); }
  };
  return <section aria-labelledby="project-artifacts-title" className="rounded-[1.75rem] bg-card p-5 sm:p-6">
    <div className="flex items-center justify-between gap-3">
      <div><h2 id="project-artifacts-title" className="text-lg font-semibold">Project files</h2><p className="mt-1 text-sm text-muted-foreground">Plans, decisions, and operating context.</p></div>
      <Button variant="ghost" size="sm" onClick={() => void refresh()} aria-label="Refresh project files"><ArrowClockwise />Refresh</Button>
    </div>
    {state === "loading" ? <p className="mt-5 text-sm text-muted-foreground" aria-live="polite">Checking files…</p> : state === "offline" ? <div className="mt-5 flex items-start gap-3 rounded-2xl bg-amber-500/10 p-4"><Warning className="mt-0.5 text-amber-500" /><p className="text-sm">{notice}</p></div> : <div className="mt-5 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
      {items.map((item) => {
        const age = Date.now() - Date.parse(item.updatedAt);
        const freshness = age > 86_400_000 ? "Stale" : "Current";
        const conflicted = item.state === "conflicted" || item.citations.invalid > 0;
        const displayState = item.state === "missing" ? "Missing" : conflicted ? "Conflict" : freshness;
        const tone = item.state !== "ready" || conflicted || freshness === "Stale" ? "caution" : item.approvalState === "approved" || item.approvalState === "not_required" ? "positive" : "neutral";
        return <button key={item.kind} type="button" disabled={item.state !== "ready"} onClick={() => void open(item)} className="flex min-h-28 items-start gap-3 rounded-2xl bg-muted/45 p-4 text-left outline-none transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/30 disabled:cursor-default disabled:opacity-75">
          <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-background text-primary"><FileText /></span>
          <span className="min-w-0 flex-1"><span className="flex items-start justify-between gap-2"><strong className="truncate text-sm">{label(item.kind)}</strong><Badge tone={tone}>{displayState}</Badge></span><span className="mt-2 block text-xs text-muted-foreground">{item.approvalState === "pending" ? "Approval pending" : item.approvalState === "approved" ? "Approved" : "No approval needed"}{item.revision > 0 ? ` · v${item.revision}` : ""}</span><span className="mt-1 block text-xs text-muted-foreground">{item.state === "missing" ? "Create or restore this file" : item.state === "conflicted" ? "Resolve the local file conflict" : `${item.confidence} evidence · ${formatTime(item.updatedAt)}`}</span></span>
        </button>;
      })}
    </div>}
    {notice && state === "ready" && <p className="mt-4 text-xs text-muted-foreground" aria-live="polite">{notice}</p>}
  </section>;
}

function label(kind: ProjectArtifactInspection["kind"]) { return ({ context: "Context", memory: "Memory", research: "Research", product: "Product", design: "Design", delivery_plan: "Delivery plan", ops_rules: "Operating rules", infra: "Infrastructure", security: "Security", decisions: "Decisions", status: "Status" })[kind]; }
function formatTime(value: string) { const age = Date.now() - Date.parse(value); if (age < 60_000) return "just now"; if (age < 3_600_000) return `${Math.floor(age / 60_000)}m ago`; if (age < 86_400_000) return `${Math.floor(age / 3_600_000)}h ago`; return `${Math.floor(age / 86_400_000)}d ago`; }
