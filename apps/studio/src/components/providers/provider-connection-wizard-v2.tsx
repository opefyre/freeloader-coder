import { Dialog } from "@base-ui/react/dialog";
import { ArrowClockwise } from "@phosphor-icons/react/ArrowClockwise";
import { ArrowSquareOut } from "@phosphor-icons/react/ArrowSquareOut";
import { Check } from "@phosphor-icons/react/Check";
import { Key } from "@phosphor-icons/react/Key";
import { MagnifyingGlass } from "@phosphor-icons/react/MagnifyingGlass";
import { Trash } from "@phosphor-icons/react/Trash";
import { Warning } from "@phosphor-icons/react/Warning";
import { X } from "@phosphor-icons/react/X";
import { useCallback, useEffect, useMemo, useState } from "react";

import type { PublicProviderConnection, PublicProviderConnectionCollection } from "../../../../../packages/runtime/src/provider-connections.js";
import { connectProvider, listProviderConnections, mutateProviderConnection } from "../../provider-connection-client.js";
import { cn } from "../../lib/utils.js";
import { Button, buttonVariants } from "../ui/button.js";

type Busy = "connect" | "reprobe" | "model" | "revoke" | "delete" | null;

export function ProviderConnectionWizard({ endpoint }: { endpoint: string }) {
  const [data, setData] = useState<PublicProviderConnectionCollection | null>(null);
  const [query, setQuery] = useState("");
  const [providerId, setProviderId] = useState<string | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [notice, setNotice] = useState("");
  const refresh = useCallback(async () => {
    try { setData(await listProviderConnections({ endpoint })); setNotice(""); }
    catch { setNotice("AI providers are temporarily unavailable."); }
  }, [endpoint]);
  useEffect(() => { void refresh(); }, [refresh]);
  const providers = useMemo(() => (data?.catalog ?? []).filter((item) => item.label.toLowerCase().includes(query.toLowerCase())), [data, query]);
  const ready = data?.connections.filter((item) => item.admission.admitted).length ?? 0;
  const selected = data?.catalog.find((item) => item.id === providerId) ?? null;
  const connection = data?.connections.find((item) => item.providerId === providerId);
  const mutate = async (target: PublicProviderConnection, action: Exclude<Busy, "connect" | null>, modelId?: string) => {
    if (busy) return;
    if (action === "delete" && !window.confirm(`Delete ${target.providerLabel} from this computer?`)) return;
    if (action === "revoke" && !window.confirm(`Revoke the stored key for ${target.providerLabel}?`)) return;
    setBusy(action); setNotice("");
    try {
      await mutateProviderConnection({ endpoint, connectionId: target.id, action, ...(modelId ? { modelId } : {}), idempotencyKey: `provider:${action}:${crypto.randomUUID()}` });
      setNotice(action === "reprobe" ? `${target.providerLabel} checked.` : "Connection updated."); await refresh();
    } catch (error) { setNotice(error instanceof Error ? error.message : "The provider check did not complete."); }
    finally { setBusy(null); }
  };
  return <section className="mx-auto max-w-5xl space-y-6" aria-labelledby="ai-providers-title">
    <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div><h2 id="ai-providers-title" className="text-xl font-semibold tracking-tight">AI providers</h2><p className="mt-1 text-sm text-muted-foreground">{ready} ready · paid routes disabled</p></div>
      <div className="flex gap-2"><label className="flex h-10 min-w-0 items-center gap-2 rounded-2xl bg-muted/60 px-3 sm:w-64"><MagnifyingGlass className="shrink-0 text-muted-foreground" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find a provider" className="min-w-0 flex-1 bg-transparent text-sm outline-none" /></label><Button size="icon" variant="ghost" onClick={() => void refresh()} aria-label="Refresh providers"><ArrowClockwise /></Button></div>
    </header>
    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
      {providers.map((provider) => {
        const current = data?.connections.find((item) => item.providerId === provider.id);
        const state = status(current);
        return <button key={provider.id} type="button" onClick={() => setProviderId(provider.id)} className="group flex min-h-24 items-center gap-4 rounded-3xl bg-muted/45 p-4 text-left outline-none transition duration-200 hover:-translate-y-0.5 hover:bg-muted/70 hover:shadow-lg hover:shadow-black/5 focus-visible:ring-3 focus-visible:ring-ring/30">
          <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-background text-primary"><Key size={21} weight="duotone" /></span>
          <span className="min-w-0 flex-1"><strong className="block truncate text-sm">{provider.label}</strong><span className="mt-1 block truncate text-xs text-muted-foreground">{current?.modelId ?? (provider.freeAccess === "permanent" ? "Free" : "Free allowance")}</span></span>
          <span className={cn("grid size-6 shrink-0 place-items-center rounded-full", state === "ready" ? "bg-emerald-500 text-white" : state === "check" ? "bg-amber-400/15 text-amber-500" : "bg-background text-muted-foreground")}>{state === "ready" ? <Check size={13} weight="bold" /> : state === "check" ? <Warning size={14} weight="fill" /> : <span className="size-1.5 rounded-full bg-current" />}</span>
        </button>;
      })}
    </div>
    {!data && <div className="rounded-3xl bg-amber-400/10 p-5 text-sm">{notice || "Loading providers…"}</div>}
    <ProviderDialog open={providerId !== null} onOpenChange={(open) => { if (!open) setProviderId(null); }} provider={selected} connection={connection} endpoint={endpoint} busy={busy} setBusy={setBusy} notice={notice} setNotice={setNotice} refresh={refresh} mutate={mutate} />
    {notice && <p role="status" aria-live="polite" className="text-sm text-muted-foreground">{notice}</p>}
  </section>;
}

function ProviderDialog({ open, onOpenChange, provider, connection, endpoint, busy, setBusy, notice, setNotice, refresh, mutate }: { open: boolean; onOpenChange: (open: boolean) => void; provider: PublicProviderConnectionCollection["catalog"][number] | null; connection: PublicProviderConnection | undefined; endpoint: string; busy: Busy; setBusy: (busy: Busy) => void; notice: string; setNotice: (notice: string) => void; refresh: () => Promise<void>; mutate: (connection: PublicProviderConnection, action: Exclude<Busy, "connect" | null>, modelId?: string) => Promise<void> }) {
  const [modelId, setModelId] = useState(""); const [secret, setSecret] = useState(""); const [attested, setAttested] = useState(false); const [details, setDetails] = useState(false);
  useEffect(() => { setModelId(connection?.modelId ?? provider?.models[0]?.id ?? ""); setSecret(""); setAttested(false); setDetails(false); }, [provider, connection]);
  if (!provider) return null;
  const connect = async () => {
    if (!modelId || !attested || secret.length < 8 || busy) return; setBusy("connect"); setNotice("");
    try { await connectProvider({ endpoint, idempotencyKey: `provider:connect:${crypto.randomUUID()}`, connection: { schemaVersion: 1, id: provider.id, providerId: provider.id, modelId, secret, freeOnlyAttestation: true, billingEnabled: false, privacyClass: "training_eligible", capabilityRoles: ["planner", "implementer", "reviewer"] } }); setNotice(`${provider.label} connected.`); setSecret(""); await refresh(); }
    catch (error) { setNotice(error instanceof Error ? error.message : "Connection checks did not complete."); }
    finally { setBusy(null); }
  };
  return <Dialog.Root open={open} onOpenChange={onOpenChange}><Dialog.Portal><Dialog.Backdrop className="fixed inset-0 z-50 bg-background/75 backdrop-blur-md transition-opacity data-[ending-style]:opacity-0 data-[starting-style]:opacity-0" /><Dialog.Popup className="fixed inset-x-3 bottom-3 z-50 max-h-[90vh] overflow-y-auto rounded-[1.75rem] bg-card p-5 shadow-2xl outline-none transition duration-200 data-[ending-style]:translate-y-4 data-[ending-style]:opacity-0 data-[starting-style]:translate-y-4 data-[starting-style]:opacity-0 sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:w-[min(36rem,calc(100vw-2rem))] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:p-6">
    <header className="flex items-start justify-between gap-4"><div><Dialog.Title className="text-xl font-semibold tracking-tight">{provider.label}</Dialog.Title><Dialog.Description className="mt-1 text-sm text-muted-foreground">{connection ? statusLabel(connection) : "Connect a free account"}</Dialog.Description></div><Dialog.Close aria-label="Close" className="grid size-9 place-items-center rounded-full bg-muted outline-none transition hover:bg-foreground hover:text-background"><X /></Dialog.Close></header>
    <div className="mt-6 space-y-3">
      <label className="block"><span className="mb-2 block text-xs font-medium text-muted-foreground">Model</span><select value={modelId} onChange={(event) => setModelId(event.target.value)} className={fieldClass}>{provider.models.map((model) => <option key={model.id} value={model.id}>{model.label}</option>)}</select></label>
      {!connection && <><label className="block"><span className="mb-2 block text-xs font-medium text-muted-foreground">API key</span><input type="password" autoComplete="new-password" value={secret} onChange={(event) => setSecret(event.target.value)} placeholder="Paste API key" className={fieldClass} /></label><label className="flex items-start gap-3 rounded-2xl bg-muted/55 p-4 text-sm"><input type="checkbox" checked={attested} onChange={(event) => setAttested(event.target.checked)} className="mt-0.5 accent-primary" /><span>This account has no billing enabled.</span></label><div className="flex items-center justify-between gap-3"><a href={provider.dashboardUrl} target="_blank" rel="noreferrer" className={buttonVariants({ variant: "ghost", size: "sm" })}>Get API key <ArrowSquareOut /></a><Button disabled={busy !== null || secret.length < 8 || !attested} onClick={() => void connect()}>{busy === "connect" ? "Checking…" : "Connect"}</Button></div></>}
      {connection && <><div className="flex items-center justify-between gap-3 rounded-2xl bg-muted/55 p-4"><div><strong className="block text-sm">{connection.admission.admitted ? "Ready to use" : "Check required"}</strong><span className="mt-1 block text-xs text-muted-foreground">{connection.maskedCredential}</span></div><Button size="sm" disabled={busy !== null} onClick={() => void mutate(connection, modelId === connection.modelId ? "reprobe" : "model", modelId)}><ArrowClockwise className={cn(busy && "animate-spin")} />{modelId === connection.modelId ? "Check now" : "Save model"}</Button></div><button type="button" onClick={() => setDetails(!details)} className="text-xs font-medium text-muted-foreground hover:text-foreground">{details ? "Hide details" : "Show details"}</button>{details && <div className="rounded-2xl bg-muted/40 p-4 text-xs leading-5 text-muted-foreground"><p>{connection.admission.detail}</p><p className="mt-2">Canary: {connection.canary.status} · Cost: {connection.cost.zeroCost && !connection.cost.billingEnabled ? "$0 verified" : "blocked"}</p></div>}<div className="flex justify-end gap-2"><Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => void mutate(connection, "revoke")}>Revoke key</Button><Button size="sm" variant="destructive" disabled={busy !== null} onClick={() => void mutate(connection, "delete")}><Trash />Delete</Button></div></>}
      {notice && <p role="status" aria-live="polite" className="rounded-2xl bg-muted/50 p-3 text-xs">{notice}</p>}
    </div>
  </Dialog.Popup></Dialog.Portal></Dialog.Root>;
}

function status(connection?: PublicProviderConnection): "ready" | "check" | "off" { if (!connection || connection.credentialState !== "active") return "off"; return connection.admission.admitted ? "ready" : "check"; }
function statusLabel(connection: PublicProviderConnection) { if (connection.credentialState !== "active") return "Key revoked"; return connection.admission.admitted ? "Connected and ready" : "Connected · check required"; }
const fieldClass = "h-11 w-full rounded-2xl bg-muted/60 px-4 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/30";
