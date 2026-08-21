import { ArrowClockwise } from "@phosphor-icons/react/ArrowClockwise";
import { FileText } from "@phosphor-icons/react/FileText";
import { Warning } from "@phosphor-icons/react/Warning";
import { X } from "@phosphor-icons/react/X";
import { useCallback, useEffect, useState } from "react";

import { getProjectArtifact, listProjectArtifacts, type ProjectArtifactDocument, type ProjectArtifactInspection } from "../../local-project-client.js";
import { Badge } from "../ui/badge.js";
import { Button } from "../ui/button.js";
import { InfrastructureDeliveryPanel } from "./infrastructure-delivery-panel.js";
import { MarkdownDocument } from "./markdown-document.js";
import { ProjectResearchControl } from "./project-research-control.js";

export function ProjectArtifactWorkspace(props: { endpoint: string; projectId: string }) {
  const [items, setItems] = useState<readonly ProjectArtifactInspection[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "offline">("loading");
  const [notice, setNotice] = useState("");
  const [document, setDocument] = useState<ProjectArtifactDocument | null>(null);
  const refresh = useCallback(async () => {
    try { setItems(await listProjectArtifacts(props)); setState("ready"); setNotice(""); }
    catch { setState("offline"); setNotice("Artifact status is unavailable. Existing project files were not changed."); }
  }, [props.endpoint, props.projectId]);
  useEffect(() => { void refresh(); }, [refresh]);
  const open = async (item: ProjectArtifactInspection) => {
    try {
      setDocument(await getProjectArtifact({ ...props, kind: item.kind }));
      setNotice("");
    } catch { setNotice(`${item.fileName} could not be displayed. The file remains unchanged.`); }
  };
  return <><section aria-labelledby="project-artifacts-title" className="rounded-[1.75rem] bg-card p-5 sm:p-6">
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
        return <button key={item.kind} type="button" disabled={item.state !== "ready"} onClick={() => void open(item)} className="flex min-h-28 items-start gap-3 rounded-2xl bg-muted/45 p-4 text-left outline-none transition-[transform,background-color,box-shadow] duration-200 hover:-translate-y-0.5 hover:bg-muted hover:shadow-lg hover:shadow-black/5 focus-visible:ring-3 focus-visible:ring-ring/30 disabled:cursor-default disabled:opacity-75 disabled:hover:translate-y-0 disabled:hover:shadow-none">
          <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-background text-primary"><FileText /></span>
          <span className="min-w-0 flex-1"><span className="flex items-start justify-between gap-2"><strong className="truncate text-sm">{label(item.kind)}</strong><Badge tone={tone}>{displayState}</Badge></span><span className="mt-2 block text-xs text-muted-foreground">{item.approvalState === "pending" ? "Approval pending" : item.approvalState === "approved" ? "Approved" : "No approval needed"}{item.revision > 0 ? ` · v${item.revision}` : ""}</span><span className="mt-1 block text-xs text-muted-foreground">{item.state === "missing" ? "Create or restore this file" : item.state === "conflicted" ? "Resolve the local file conflict" : `${item.confidence} evidence · ${formatTime(item.updatedAt)}`}</span></span>
        </button>;
      })}
    </div>}
    {notice && state === "ready" && <p className="mt-4 text-xs text-muted-foreground" aria-live="polite">{notice}</p>}
  </section>
  {document && <div role="dialog" aria-modal="true" aria-labelledby="artifact-viewer-title" className="fixed inset-0 z-50 grid place-items-center bg-background/75 p-3 backdrop-blur-sm animate-in fade-in sm:p-8" onMouseDown={(event) => { if (event.target === event.currentTarget) setDocument(null); }}>
    <article className="flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-[2rem] bg-card shadow-2xl animate-in zoom-in-95 slide-in-from-bottom-3">
      <header className="flex items-center justify-between gap-4 px-5 py-4 sm:px-7"><div className="min-w-0"><h2 id="artifact-viewer-title" className="truncate text-lg font-semibold">{document.fileName}</h2><p className="mt-0.5 text-xs text-muted-foreground">Version {document.metadata.revision} · {formatTime(document.metadata.updatedAt)}</p></div><Button variant="ghost" size="icon" onClick={() => setDocument(null)} aria-label="Close document"><X /></Button></header>
      <div className="overflow-y-auto px-5 pb-8 sm:px-10"><MarkdownDocument body={document.body} /></div>
    </article>
  </div>}
  <ProjectResearchControl endpoint={props.endpoint} projectId={props.projectId} />
  <InfrastructureDeliveryPanel endpoint={props.endpoint} projectId={props.projectId} /></>;
}

function label(kind: ProjectArtifactInspection["kind"]) { return ({ context: "Context", memory: "Memory", research: "Research", product: "Product", design: "Design", delivery_plan: "Delivery plan", ops_rules: "Operating rules", infra: "Infrastructure", security: "Security", decisions: "Decisions", status: "Status" })[kind]; }
function formatTime(value: string) { const age = Date.now() - Date.parse(value); if (age < 60_000) return "just now"; if (age < 3_600_000) return `${Math.floor(age / 60_000)}m ago`; if (age < 86_400_000) return `${Math.floor(age / 3_600_000)}h ago`; return `${Math.floor(age / 86_400_000)}d ago`; }
