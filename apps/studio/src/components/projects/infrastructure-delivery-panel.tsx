import { ArrowClockwise } from "@phosphor-icons/react/ArrowClockwise";
import { CheckCircle } from "@phosphor-icons/react/CheckCircle";
import { CloudArrowUp } from "@phosphor-icons/react/CloudArrowUp";
import { ShieldCheck } from "@phosphor-icons/react/ShieldCheck";
import { Warning } from "@phosphor-icons/react/Warning";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  approveInfrastructurePreview,
  createInfrastructurePreview,
  executeInfrastructurePreview,
  getInfrastructureDeliveryStatus,
  rollbackInfrastructurePreview,
} from "../../infrastructure-delivery-client.js";
import type { InfrastructureDeliveryStatus } from "../../../../../packages/orchestration/src/infrastructure-delivery.js";
import { Badge } from "../ui/badge.js";
import { Button } from "../ui/button.js";

export function InfrastructureDeliveryPanel(props: { endpoint: string; projectId: string }) {
  const [status, setStatus] = useState<InfrastructureDeliveryStatus | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "offline" | "working">("loading");
  const [notice, setNotice] = useState("");
  const refresh = useCallback(async () => {
    try { setStatus(await getInfrastructureDeliveryStatus(props)); setState("ready"); }
    catch { setState("offline"); setNotice("Release status is unavailable. No provider action was attempted."); }
  }, [props.endpoint, props.projectId]);
  useEffect(() => { void refresh(); }, [refresh]);
  const current = status?.operations[0] ?? null;
  const resource = status?.design?.resources[0] ?? null;
  const resourceKind = resource?.kind.toLowerCase() ?? "";
  const supported = resource?.provider === "Cloudflare" && ["pages", "pages_disposable"].includes(resourceKind);
  const disposable = resourceKind === "pages_disposable";
  const expired = Boolean(current && current.preview.expiresAt <= Date.now() && !current.receipt);
  const canPrepare = Boolean(status?.design && resource && supported && (!current || expired || current.receipt));
  const canRun = Boolean(current && !expired && !current.receipt);

  const prepare = async () => {
    if (!status?.design || !resource) return;
    setState("working"); setNotice("");
    try {
      await createInfrastructurePreview({
        ...props,
        idempotencyKey: `infra-preview:${crypto.randomUUID()}`,
        body: { schemaVersion: 1, requestId: status.design.requestId, provider: resource.provider, accountId: resource.accountId, projectOrTenantId: resource.projectOrTenantId, resourceId: resource.resourceId, region: resource.region, action: disposable ? "create" : "deploy", permissions: ["pages:write"], maximumCostUsd: 0, reversible: true, rollbackAction: status.design.rollback[0] ?? (disposable ? "Delete the exact disposable project and verify absence." : "Delete the exact deployment and verify absence.") },
      });
      await refresh(); setNotice("Deployment review is ready. Nothing has been deployed.");
    } catch (error) { setState("ready"); setNotice(safeMessage(error)); }
  };

  const approveAndDeploy = async () => {
    if (!current || !canRun) return;
    setState("working"); setNotice("");
    try {
      if (!current.approval) await approveInfrastructurePreview({ ...props, previewId: current.preview.id, idempotencyKey: `infra-approve:${crypto.randomUUID()}` });
      const receipt = await executeInfrastructurePreview({ ...props, previewId: current.preview.id, idempotencyKey: `infra-execute:${crypto.randomUUID()}` });
      await refresh(); setNotice(receipt.safeMessage);
    } catch (error) { await refresh(); setNotice(safeMessage(error)); }
  };

  const rollback = async () => {
    if (!current?.receipt || current.receipt.state !== "verified") return;
    setState("working"); setNotice("");
    try {
      const receipt = await rollbackInfrastructurePreview({ ...props, previewId: current.preview.id, idempotencyKey: `infra-rollback:${crypto.randomUUID()}` });
      await refresh(); setNotice(receipt.safeMessage);
    } catch (error) { await refresh(); setNotice(safeMessage(error)); }
  };

  if (state === "loading" || (!status?.design && state === "ready")) return null;
  return <section aria-labelledby="infrastructure-delivery-title" className="rounded-[1.75rem] bg-card p-5 shadow-[0_18px_50px_rgba(35,45,75,.08)] sm:p-6 dark:shadow-[0_18px_50px_rgba(0,0,0,.16)]">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="flex items-start gap-3"><span className="grid size-10 place-items-center rounded-2xl bg-primary/12 text-primary"><CloudArrowUp /></span><div><h2 id="infrastructure-delivery-title" className="text-lg font-semibold">Release</h2><p className="mt-1 text-sm text-muted-foreground">Review the exact change before Codkesh touches a provider.</p></div></div>
      <Button variant="ghost" size="sm" onClick={() => void refresh()} disabled={state === "working"}><ArrowClockwise />Refresh</Button>
    </div>
    {state === "offline" ? <Message caution>{notice}</Message> : <div className="mt-5 space-y-3">
      {resource && <div className="grid gap-2 sm:grid-cols-3">
        <Fact label="Target" value={`${resource.provider} · ${resource.resourceId}`} />
        <Fact label="Cost limit" value="$0.00" positive />
        <Fact label="Undo" value={current?.preview.reversible === false ? "Unavailable" : "Automatic rollback"} positive={current?.preview.reversible !== false} />
      </div>}
      {current && !current.receipt && !expired && <div className="rounded-3xl bg-muted/45 p-4 sm:p-5">
        <div className="flex flex-wrap items-center gap-2"><Badge tone={current.approval ? "active" : "caution"}>{current.approval ? "Approved" : "Your approval"}</Badge><span className="text-xs text-muted-foreground">Expires {new Date(current.preview.expiresAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span></div>
        <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2"><Detail label="Account" value={current.preview.accountId} /><Detail label="Project" value={current.preview.resourceId} /><Detail label="Permission" value={current.preview.permissions.join(", ")} /><Detail label="Expected result" value="A verified HTTPS deployment" /></dl>
        <div className="mt-4 flex items-start gap-2 rounded-2xl bg-amber-500/10 p-3 text-xs leading-5"><ShieldCheck className="mt-0.5 shrink-0 text-amber-500" /><span>Approving will deploy this exact target now. If verification fails, Codkesh will remove the exact deployment automatically.</span></div>
      </div>}
      {expired && <Message caution>This review expired. Prepare a new one so the target and authority are current.</Message>}
      {resource && !supported && <Message caution>This approved provider does not have a bounded release adapter yet. No provider action is available.</Message>}
      {current?.receipt && <Receipt receipt={current.receipt} />}
      <div className="flex flex-wrap gap-2">
        {canPrepare && <Button onClick={() => void prepare()} disabled={state === "working"}>{state === "working" ? "Preparing…" : "Review deployment"}</Button>}
        {canRun && <Button onClick={() => void approveAndDeploy()} disabled={state === "working"}>{state === "working" ? "Deploying…" : current?.approval ? "Retry deployment" : "Approve and deploy"}</Button>}
        {current?.receipt?.state === "verified" && <Button variant="destructive" onClick={() => void rollback()} disabled={state === "working"}>{state === "working" ? "Removing…" : disposable ? "Remove disposable release" : "Roll back release"}</Button>}
      </div>
      {notice && <p className="text-xs text-muted-foreground" aria-live="polite">{notice}</p>}
    </div>}
  </section>;
}

function Receipt({ receipt }: { receipt: NonNullable<InfrastructureDeliveryStatus["operations"][number]["receipt"]> }) {
  const healthy = receipt.state === "verified";
  return <div className={`rounded-3xl p-4 sm:p-5 ${healthy ? "bg-emerald-500/10" : "bg-amber-500/10"}`}>
    <div className="flex items-center gap-2">{healthy ? <CheckCircle className="text-emerald-500" weight="fill" /> : <Warning className="text-amber-500" />}<strong className="text-sm">{healthy ? "Release verified" : receipt.state === "rolled_back" ? "Release rolled back" : "Owner attention needed"}</strong></div>
    <div className="mt-3 grid gap-2 sm:grid-cols-2">{receipt.checks.map((check) => <div key={check.name} className="rounded-2xl bg-background/55 p-3"><span className="flex items-center gap-2 text-xs font-semibold">{check.passed ? <CheckCircle className="text-emerald-500" weight="fill" /> : <Warning className="text-amber-500" />}{check.name}</span><p className="mt-1 text-[11px] leading-4 text-muted-foreground">{check.evidence}</p></div>)}</div>
    {healthy && receipt.endpoint && <a href={receipt.endpoint} target="_blank" rel="noreferrer" className="mt-4 inline-flex text-xs font-semibold text-primary underline-offset-4 hover:underline">Open verified release</a>}
  </div>;
}

function Fact({ label, value, positive = false }: { label: string; value: string; positive?: boolean }) { return <div className="rounded-2xl bg-muted/45 p-3"><span className="text-[10px] uppercase tracking-[.14em] text-muted-foreground">{label}</span><strong className={`mt-1 block truncate text-sm ${positive ? "text-emerald-500" : ""}`}>{value}</strong></div>; }
function Detail({ label, value }: { label: string; value: string }) { return <div><dt className="text-[10px] uppercase tracking-[.14em] text-muted-foreground">{label}</dt><dd className="mt-1 break-all font-medium">{value}</dd></div>; }
function Message({ children, caution = false }: { children: string; caution?: boolean }) { return <div className={`mt-5 flex items-start gap-3 rounded-2xl p-4 text-sm ${caution ? "bg-amber-500/10" : "bg-muted/45"}`}><Warning className="mt-0.5 shrink-0 text-amber-500" /><p>{children}</p></div>; }
function safeMessage(error: unknown): string { return error instanceof Error ? error.message : "The release action could not be completed safely."; }
