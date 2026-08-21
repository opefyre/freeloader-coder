import { ArrowClockwise } from "@phosphor-icons/react/ArrowClockwise";
import { ArrowSquareOut } from "@phosphor-icons/react/ArrowSquareOut";
import { CheckCircle } from "@phosphor-icons/react/CheckCircle";
import { Key } from "@phosphor-icons/react/Key";
import { LockKey } from "@phosphor-icons/react/LockKey";
import { ShieldCheck } from "@phosphor-icons/react/ShieldCheck";
import { Trash } from "@phosphor-icons/react/Trash";
import { Warning } from "@phosphor-icons/react/Warning";
import { useCallback, useEffect, useMemo, useState } from "react";

import type {
  PublicProviderConnection,
  PublicProviderConnectionCollection
} from "../../../../../packages/runtime/src/provider-connections.js";
import {
  connectProvider,
  listProviderConnections,
  mutateProviderConnection
} from "../../provider-connection-client.js";
import { cn } from "../../lib/utils.js";
import { Badge } from "../ui/badge.js";
import { Button, buttonVariants } from "../ui/button.js";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "../ui/card.js";

type BusyAction = "connect" | "reprobe" | "model" | "revoke" | "delete" | null;

export function ProviderConnectionWizard({ endpoint }: { endpoint: string }) {
  const [collection, setCollection] = useState<PublicProviderConnectionCollection | null>(null);
  const [selectedProviderId, setSelectedProviderId] = useState("");
  const [connectionName, setConnectionName] = useState("");
  const [modelId, setModelId] = useState("");
  const [secret, setSecret] = useState("");
  const [attested, setAttested] = useState(false);
  const [busy, setBusy] = useState<BusyAction>(null);
  const [busyConnectionId, setBusyConnectionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(async (signal?: AbortSignal) => {
    try {
      const next = await listProviderConnections({ endpoint, ...(signal ? { signal } : {}) });
      setCollection(next);
      setError(null);
      setSelectedProviderId((current) => current || next.catalog[0]?.id || "");
    } catch (caught) {
      if (signal?.aborted) return;
      setError(safeMessage(caught, "The local core is unavailable. Start or repair Codkesh, then retry."));
    }
  }, [endpoint]);

  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal);
    return () => controller.abort();
  }, [refresh]);

  const selectedProvider = useMemo(
    () => collection?.catalog.find((provider) => provider.id === selectedProviderId) ?? null,
    [collection, selectedProviderId]
  );

  useEffect(() => {
    if (!selectedProvider) return;
    setModelId(selectedProvider.models[0]?.id ?? "");
    setConnectionName(uniqueConnectionName(selectedProvider.id, collection?.connections ?? []));
    setSecret("");
    setAttested(false);
  }, [selectedProvider, collection?.connections]);

  const connect = async () => {
    if (!selectedProvider || !modelId || !attested || busy) return;
    setBusy("connect");
    setError(null);
    setNotice("Running credential, model, quota, free-only, and structured-output admission checks…");
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 85_000);
    try {
      const result = await connectProvider({
        endpoint,
        idempotencyKey: idempotencyKey("connect"),
        signal: controller.signal,
        connection: {
          schemaVersion: 1,
          id: connectionName.trim(),
          providerId: selectedProvider.id,
          modelId,
          secret,
          freeOnlyAttestation: true,
          billingEnabled: false,
          privacyClass: "training_eligible",
          capabilityRoles: ["planner", "implementer", "reviewer"]
        }
      });
      setNotice(
        result.connection?.admission.admitted
          ? `${result.connection.providerLabel} passed every check and is available to free-only routing.`
          : result.connection?.admission.detail ?? "Connection checks completed."
      );
      setSecret("");
      setAttested(false);
      await refresh();
    } catch (caught) {
      setSecret("");
      setError(
        caught instanceof DOMException && caught.name === "AbortError"
          ? "The provider did not finish its live checks in time. No paid fallback was used; retry when the provider is responsive."
          : safeMessage(caught, "The connection checks failed safely.")
      );
      setNotice(null);
    } finally {
      window.clearTimeout(timeout);
      setBusy(null);
    }
  };

  const mutate = async (
    connection: PublicProviderConnection,
    action: Exclude<BusyAction, "connect" | null>,
    replacementModelId?: string
  ) => {
    if (busy) return;
    if (
      action === "delete" &&
      !window.confirm(`Delete ${connection.providerLabel} connection “${connection.id}” from this computer?`)
    ) return;
    if (
      action === "revoke" &&
      !window.confirm(`Revoke the locally stored credential for “${connection.id}”?`)
    ) return;
    setBusy(action);
    setBusyConnectionId(connection.id);
    setError(null);
    setNotice(action === "reprobe" ? `Re-checking ${connection.providerLabel}…` : null);
    try {
      const result = await mutateProviderConnection({
        endpoint,
        connectionId: connection.id,
        action,
        ...(replacementModelId ? { modelId: replacementModelId } : {}),
        idempotencyKey: idempotencyKey(action)
      });
      setNotice(
        result.outcome === "deleted"
          ? "Connection metadata and its local vault credential were removed."
          : result.connection?.admission.detail ?? `Connection ${result.outcome.replaceAll("_", " ")}.`
      );
      await refresh();
    } catch (caught) {
      setError(safeMessage(caught, "The connection operation failed safely."));
    } finally {
      setBusy(null);
      setBusyConnectionId(null);
    }
  };

  return (
    <div className="space-y-4" aria-label="Live provider connections">
      <Card>
        <CardHeader className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="active">Live connection studio</Badge>
              <Badge tone="positive">Automatic spend $0.00</Badge>
              <Badge tone={collection ? "positive" : "caution"}>
                {collection ? `${collection.connections.length} local` : "Core unavailable"}
              </Badge>
            </div>
            <CardTitle className="mt-4 text-xl">Connect, prove, and route</CardTitle>
            <CardDescription className="max-w-2xl">
              Keys travel once over loopback into the operating-system vault. A provider is usable
              only after current model, quota, cost, credential, and structured-output evidence passes.
            </CardDescription>
          </div>
          <Button variant="secondary" size="sm" onClick={() => void refresh()} disabled={busy !== null}>
            <ArrowClockwise className={cn(busy && "animate-spin")} />
            Refresh evidence
          </Button>
        </CardHeader>
        <CardContent className="mt-6 grid min-w-0 gap-5 xl:grid-cols-[16rem_minmax(0,1fr)_20rem]">
          <div className="space-y-2" role="list" aria-label="Verified free provider catalog">
            {(collection?.catalog ?? []).map((provider) => {
              const connection = collection?.connections.find((candidate) => candidate.providerId === provider.id);
              const status = connectionStatus(connection);
              return (
              <button
                key={provider.id}
                type="button"
                role="listitem"
                aria-pressed={provider.id === selectedProviderId}
                onClick={() => setSelectedProviderId(provider.id)}
                className={cn(
                  "flex w-full items-center gap-3 rounded-2xl bg-muted/45 p-3 text-left outline-none transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/30",
                  provider.id === selectedProviderId && "bg-primary/12 text-foreground"
                )}
              >
                <span className="grid size-9 place-items-center rounded-xl bg-background text-primary">
                  <Key size={18} weight="duotone" />
                </span>
                <span className="min-w-0 flex-1">
                  <strong className="block truncate text-sm">{provider.label}</strong>
                  <span className="block text-[11px] text-muted-foreground">
                    {provider.freeAccess === "permanent" ? "Permanent free" : "Account-limited free"}
                  </span>
                </span>
                {status === "ready" && (
                  <CheckCircle size={17} weight="fill" className="text-emerald-500" />
                )}
                {status === "recheck" && (
                  <Warning size={17} weight="fill" className="text-amber-500" />
                )}
              </button>
              );
            })}
            {!collection && (
              <div className="rounded-2xl bg-amber-400/10 p-4 text-xs leading-5 text-muted-foreground">
                Start the local core to load the verified connection catalog.
              </div>
            )}
          </div>

          <div className="min-w-0 rounded-4xl bg-muted/40 p-5 sm:p-6">
            {selectedProvider ? (
              <>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                      {selectedProvider.label}
                    </span>
                    <h3 className="mt-2 text-lg font-semibold tracking-tight">Secure live admission</h3>
                  </div>
                  <a
                    href={selectedProvider.dashboardUrl}
                    target="_blank"
                    rel="noreferrer"
                    className={buttonVariants({ variant: "secondary", size: "sm" })}
                  >
                    Get API key <ArrowSquareOut />
                  </a>
                </div>
                <p className="mt-3 text-sm leading-6 text-muted-foreground">{selectedProvider.summary}</p>
                <div className="mt-5 grid gap-3">
                  <Field label="Verified model">
                    <select value={modelId} onChange={(event) => setModelId(event.target.value)} className={fieldClass}>
                      {selectedProvider.models.map((model) => (
                        <option key={model.id} value={model.id}>{model.label}</option>
                      ))}
                    </select>
                  </Field>
                </div>
                <Field label="API key" className="mt-3">
                  <input
                    type="password"
                    value={secret}
                    onChange={(event) => setSecret(event.target.value)}
                    autoComplete="new-password"
                    placeholder="Stored locally; never shown again"
                    className={fieldClass}
                  />
                </Field>
                <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-2xl bg-background/65 p-4 text-xs leading-5">
                  <input
                    type="checkbox"
                    checked={attested}
                    onChange={(event) => setAttested(event.target.checked)}
                    className="mt-1 accent-primary"
                  />
                  <span>
                    <strong className="block text-foreground">I confirm this provider account has no billing enabled.</strong>
                    <span className="text-muted-foreground">
                      This attestation expires. Codkesh will never upgrade, top up, or route to paid models.
                    </span>
                  </span>
                </label>
                <Button
                  className="mt-5 w-full"
                  onClick={() => void connect()}
                  disabled={busy !== null || secret.length < 8 || !attested || !connectionName.trim() || !modelId}
                >
                  <LockKey />
                  {busy === "connect" ? "Running admission checks…" : "Store securely and verify"}
                </Button>
              </>
            ) : (
              <div className="grid min-h-64 place-items-center text-sm text-muted-foreground">
                Select a verified free provider.
              </div>
            )}
          </div>

          <div className="space-y-4">
            <div className="rounded-3xl bg-emerald-400/10 p-5">
              <ShieldCheck size={26} weight="fill" className="text-emerald-600 dark:text-emerald-300" />
              <strong className="mt-4 block">Denial of wallet</strong>
              <span className="mt-2 block text-4xl font-semibold tracking-tight">$0.00</span>
              <p className="mt-3 text-xs leading-5 text-muted-foreground">
                Paid, promotional-credit, billing-enabled, stale, revoked, and unproven routes fail closed.
              </p>
            </div>
            {selectedProvider && (
              <div className="rounded-3xl bg-muted/45 p-5">
                <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                  Source proof
                </span>
                <div className="mt-3 grid gap-2">
                  {selectedProvider.sourceUrls.map((url, index) => (
                    <a key={url} href={url} target="_blank" rel="noreferrer" className="flex items-center justify-between rounded-xl bg-background/70 px-3 py-2 text-xs hover:bg-background">
                      Official source {index + 1} <ArrowSquareOut />
                    </a>
                  ))}
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {(error || notice) && (
        <div
          role="status"
          aria-live="polite"
          className={cn(
            "fixed bottom-5 right-5 z-[100] flex max-w-md items-start gap-3 rounded-3xl bg-popover p-4 text-sm shadow-2xl",
            error ? "bg-red-400/10" : "bg-emerald-400/10"
          )}
        >
          {error ? <Warning size={20} weight="fill" className="text-red-500" /> : <CheckCircle size={20} weight="fill" className="text-emerald-500" />}
          <span>{error ?? notice}</span>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Operational connections</CardTitle>
          <CardDescription>
            Current local evidence only. Every action re-reads the vault and fails safely when proof is missing.
          </CardDescription>
        </CardHeader>
        <CardContent className="mt-5 grid gap-3 lg:grid-cols-2">
          {(collection?.connections ?? []).map((connection) => (
            <ConnectionCard
              key={connection.id}
              connection={connection}
              models={collection?.catalog.find((provider) => provider.id === connection.providerId)?.models ?? []}
              busy={busyConnectionId === connection.id ? busy : null}
              onAction={mutate}
            />
          ))}
          {collection && collection.connections.length === 0 && (
            <div className="rounded-3xl bg-muted/45 p-8 text-center lg:col-span-2">
              <Key size={28} weight="duotone" className="mx-auto text-primary" />
              <strong className="mt-3 block">No credentials stored</strong>
              <p className="mt-2 text-sm text-muted-foreground">Choose a provider above to create the first verified free-only route.</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function ConnectionCard({
  connection,
  models,
  busy,
  onAction
}: {
  connection: PublicProviderConnection;
  models: readonly { id: string; label: string }[];
  busy: BusyAction;
  onAction: (
    connection: PublicProviderConnection,
    action: Exclude<BusyAction, "connect" | null>,
    modelId?: string
  ) => Promise<void>;
}) {
  const [replacement, setReplacement] = useState(connection.modelId);
  const freshUntil = Math.min(connection.cost.expiresAt, connection.quota.expiresAt, connection.canary.expiresAt);
  const status = connectionStatus(connection);
  return (
    <section className="rounded-3xl bg-muted/45 p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <strong>{connection.providerLabel}</strong>
            <Badge tone={status === "ready" ? "positive" : "caution"}>
              {connectionStatusLabel(connection)}
            </Badge>
          </div>
          <span className="mt-1 block text-xs text-muted-foreground">{connection.id} · {connection.modelId}</span>
        </div>
        <span className="text-xs text-muted-foreground">{connection.maskedCredential}</span>
      </div>
      <div className="mt-4 grid grid-cols-3 gap-2 text-center">
        <Fact label="Cost" value={connection.cost.zeroCost && !connection.cost.billingEnabled ? "$0 proved" : "Denied"} />
        <Fact label="Canary" value={connection.canary.status} />
        <Fact label="Fresh until" value={new Date(freshUntil).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} />
      </div>
      <p className={cn("mt-4 rounded-2xl p-3 text-xs leading-5", connection.admission.admitted ? "bg-emerald-400/10" : "bg-amber-400/10")}>
        {connection.admission.detail}
      </p>
      {models.length > 1 && connection.credentialState === "active" && (
        <div className="mt-3 flex gap-2">
          <select value={replacement} onChange={(event) => setReplacement(event.target.value)} className={cn(fieldClass, "min-w-0 flex-1")}>
            {models.map((model) => <option key={model.id} value={model.id}>{model.label}</option>)}
          </select>
          <Button size="sm" variant="secondary" disabled={busy !== null || replacement === connection.modelId} onClick={() => void onAction(connection, "model", replacement)}>
            Verify model
          </Button>
        </div>
      )}
      <div className="mt-4 flex flex-wrap gap-2">
        <Button size="sm" variant="secondary" disabled={busy !== null || connection.credentialState !== "active"} onClick={() => void onAction(connection, "reprobe")}>
          <ArrowClockwise className={cn(busy === "reprobe" && "animate-spin")} /> Re-check
        </Button>
        <Button size="sm" variant="secondary" disabled={busy !== null || connection.credentialState !== "active"} onClick={() => void onAction(connection, "revoke")}>
          Revoke key
        </Button>
        <Button size="sm" variant="destructive" disabled={busy !== null} onClick={() => void onAction(connection, "delete")}>
          <Trash /> Delete
        </Button>
      </div>
    </section>
  );
}

function connectionStatus(connection: PublicProviderConnection | undefined): "ready" | "recheck" | "disconnected" {
  if (!connection) return "disconnected";
  if (connection.admission.admitted) return "ready";
  return connection.credentialState === "active" ? "recheck" : "disconnected";
}

function connectionStatusLabel(connection: PublicProviderConnection): string {
  const status = connectionStatus(connection);
  if (status === "ready") return "Ready";
  if (status === "recheck") return "Re-check required";
  return connection.credentialState === "revoked" ? "Key revoked" : "Not ready";
}

function Field({ label, className, children }: { label: string; className?: string; children: React.ReactNode }) {
  return (
    <label className={cn("block", className)}>
      <span className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-background/65 p-3">
      <span className="block text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
      <strong className="mt-1 block truncate text-xs">{value}</strong>
    </div>
  );
}

const fieldClass = "h-10 w-full rounded-xl bg-background/75 px-3 text-sm outline-none ring-0 focus-visible:ring-3 focus-visible:ring-ring/30";

function uniqueConnectionName(
  providerId: string,
  connections: readonly PublicProviderConnection[]
): string {
  const used = new Set(connections.map((connection) => connection.id));
  if (!used.has(providerId)) return providerId;
  let suffix = 2;
  while (used.has(`${providerId}-${suffix}`)) suffix += 1;
  return `${providerId}-${suffix}`;
}

function idempotencyKey(action: string): string {
  return `provider:${action}:${crypto.randomUUID()}`;
}

function safeMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.length <= 500 ? error.message : fallback;
}
