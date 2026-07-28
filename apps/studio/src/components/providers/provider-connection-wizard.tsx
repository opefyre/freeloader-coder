import { ArrowSquareOut } from "@phosphor-icons/react/ArrowSquareOut";
import { CheckCircle } from "@phosphor-icons/react/CheckCircle";
import { Key } from "@phosphor-icons/react/Key";
import { LockKey } from "@phosphor-icons/react/LockKey";
import { ShieldCheck } from "@phosphor-icons/react/ShieldCheck";
import { Warning } from "@phosphor-icons/react/Warning";
import { useEffect, useMemo, useState } from "react";

import {
  providerConnectionGuides,
  providerGuide,
  recordProviderValidation,
  requestSecureEntry,
  revokeWizardConnection,
  startProviderWizard,
  type ProviderValidationFailure,
  type ProviderWizardId
} from "../../../../../packages/providers/src/wizard.js";
import { Badge } from "../ui/badge.js";
import { Button, buttonVariants } from "../ui/button.js";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "../ui/card.js";
import { cn } from "../../lib/utils.js";

const demoFingerprint = "31d7c4e9a2bf";

export function ProviderConnectionWizard() {
  const [providerId, setProviderId] = useState<ProviderWizardId>("groq");
  const [session, setSession] = useState(() => startProviderWizard(providerId));
  const guide = useMemo(() => providerGuide(providerId), [providerId]);

  useEffect(() => {
    setSession(startProviderWizard(providerId));
  }, [providerId]);

  const connected = session.stage === "connected";
  const repairing = session.stage === "repair";

  const validate = (outcome: "passed" | ProviderValidationFailure) => {
    setSession(recordProviderValidation({
      session: requestSecureEntry(session),
      outcome,
      ...(outcome === "passed" && providerId !== "local-model-runtime"
        ? { credentialFingerprint: demoFingerprint }
        : {})
    }));
  };

  return (
    <Card aria-label="Guided provider connection">
      <CardHeader className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="active">Secure connection studio</Badge>
            <Badge tone="positive">Automatic spend $0.00</Badge>
          </div>
          <CardTitle className="mt-4 text-xl">Connect a provider without editing files</CardTitle>
          <CardDescription className="max-w-2xl">
            Pipeline Studio opens the exact provider page, requests the minimum access, stores
            credentials in the operating-system vault, and returns only masked evidence.
          </CardDescription>
        </div>
        <div className="flex items-center gap-2 rounded-full bg-emerald-400/10 px-4 py-2 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
          <ShieldCheck size={17} weight="fill" />
          Local vault boundary
        </div>
      </CardHeader>
      <CardContent className="mt-6 grid min-w-0 gap-5 xl:grid-cols-[15rem_minmax(0,1fr)_20rem]">
        <div className="space-y-2" role="list" aria-label="Supported provider connections">
          {providerConnectionGuides.map((provider) => (
            <div key={provider.id} role="listitem">
              <button
                type="button"
                aria-pressed={provider.id === providerId}
                onClick={() => setProviderId(provider.id)}
                className={cn(
                  "flex w-full items-center gap-3 rounded-2xl bg-muted/45 p-3 text-left outline-none transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/30",
                  provider.id === providerId && "bg-primary/12 text-foreground"
                )}
              >
                <span className="grid size-9 place-items-center rounded-xl bg-background text-primary">
                  {provider.authMode === "local_discovery"
                    ? <ShieldCheck size={18} weight="duotone" />
                    : <Key size={18} weight="duotone" />}
                </span>
                <span className="min-w-0">
                  <strong className="block truncate text-sm">{provider.label}</strong>
                  <span className="block truncate text-[11px] text-muted-foreground">
                    {authLabel(provider.authMode)}
                  </span>
                </span>
              </button>
            </div>
          ))}
        </div>

        <div className="min-w-0 rounded-4xl bg-muted/40 p-5 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                {guide.label} setup
              </span>
              <h3 className="mt-2 text-lg font-semibold tracking-tight">
                {connected
                  ? "Connection verified"
                  : repairing
                    ? "Specific repair available"
                    : "Four guided steps"}
              </h3>
            </div>
            <Badge tone={connected ? "positive" : repairing ? "caution" : "neutral"}>
              {stageLabel(session.stage)}
            </Badge>
          </div>

          {connected ? (
            <div className="mt-6 rounded-3xl bg-emerald-400/10 p-5">
              <CheckCircle size={28} weight="fill" className="text-emerald-600 dark:text-emerald-300" />
              <strong className="mt-4 block">Ready for free-only routing</strong>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">{session.message}</p>
              <dl className="mt-5 grid gap-3 text-xs sm:grid-cols-2">
                <ConnectionFact label="Credential" value={session.maskedCredential ?? "No key required"} />
                <ConnectionFact label="Storage" value="Operating-system vault" />
                <ConnectionFact label="Scope" value={guide.minimumPermission} />
                <ConnectionFact label="Route" value="Verified free only" />
              </dl>
            </div>
          ) : repairing ? (
            <div className="mt-6 rounded-3xl bg-amber-400/10 p-5">
              <Warning size={26} weight="fill" className="text-amber-600 dark:text-amber-300" />
              <strong className="mt-4 block">
                {failureLabel(session.validationFailure)}
              </strong>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">{session.message}</p>
            </div>
          ) : (
            <ol className="mt-6 grid gap-3">
              {guide.steps.map((step, index) => (
                <li key={step} className="flex gap-3 rounded-2xl bg-background/70 p-4">
                  <span className="grid size-7 shrink-0 place-items-center rounded-full bg-primary/14 text-xs font-semibold text-primary">
                    {index + 1}
                  </span>
                  <span className="text-sm leading-6 text-muted-foreground">{step}</span>
                </li>
              ))}
            </ol>
          )}

          <div className="mt-5 flex flex-wrap gap-2">
            {!connected && (
              <a
                href={guide.dashboardUrl}
                target="_blank"
                rel="noreferrer"
                className={buttonVariants({ variant: "secondary", size: "sm" })}
              >
                Open {guide.label}
                <ArrowSquareOut />
              </a>
            )}
            {!connected && (
              <Button size="sm" onClick={() => validate("passed")}>
                <LockKey />
                {guide.authMode === "local_discovery"
                  ? "Discover and verify"
                  : "Use secure entry and verify"}
              </Button>
            )}
            {repairing && (
              <Button variant="secondary" size="sm" onClick={() => setSession(startProviderWizard(providerId))}>
                Start repair
              </Button>
            )}
            {connected && (
              <Button variant="destructive" size="sm" onClick={() => setSession(revokeWizardConnection(session))}>
                Revoke local access
              </Button>
            )}
          </div>
          <p
            role="status"
            aria-live="polite"
            className="mt-4 rounded-2xl bg-background/65 p-3 text-xs leading-5 text-muted-foreground"
          >
            {session.message}
          </p>
        </div>

        <div className="space-y-4">
          <div className="rounded-3xl bg-muted/45 p-5">
            <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              Trust summary
            </span>
            <dl className="mt-4 space-y-4">
              <ConnectionFact label="Free status" value={guide.freeStatus} />
              <ConnectionFact label="Data use" value={guide.dataUse} />
              <ConnectionFact label="Minimum access" value={guide.minimumPermission} />
              <ConnectionFact label="Revocation" value={guide.revocation} />
            </dl>
          </div>
          <details className="rounded-3xl bg-muted/45 p-5">
            <summary className="cursor-pointer text-xs font-semibold outline-none focus-visible:ring-3 focus-visible:ring-ring/30">
              Preview a repair path
            </summary>
            <div className="mt-4 grid gap-2">
              {(["invalid", "wrong_project", "paid_only", "insufficient_permission"] as const)
                .map((failure) => (
                  <button
                    key={failure}
                    type="button"
                    onClick={() => validate(failure)}
                    className="rounded-xl bg-background/70 px-3 py-2 text-left text-xs outline-none hover:bg-background focus-visible:ring-3 focus-visible:ring-ring/30"
                  >
                    {failureLabel(failure)}
                  </button>
                ))}
            </div>
          </details>
        </div>
      </CardContent>
    </Card>
  );
}

function ConnectionFact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-1 text-xs leading-5">{value}</dd>
    </div>
  );
}

function authLabel(mode: string): string {
  return {
    guided_key: "Guided key",
    pkce: "Secure authorization",
    github_authorization: "GitHub authorization",
    local_discovery: "Local discovery"
  }[mode] ?? mode;
}

function stageLabel(stage: string): string {
  return {
    instructions: "Not connected",
    secure_entry: "Secure entry",
    validating: "Validating",
    connected: "Verified",
    repair: "Needs repair"
  }[stage] ?? stage;
}

function failureLabel(failure: ProviderValidationFailure | null): string {
  if (!failure) return "Connection needs attention";
  return {
    invalid: "Invalid credential",
    expired: "Expired credential",
    wrong_project: "Wrong account or project",
    paid_only: "Paid-only route",
    insufficient_permission: "Missing required permission",
    offline: "Provider unavailable"
  }[failure];
}
