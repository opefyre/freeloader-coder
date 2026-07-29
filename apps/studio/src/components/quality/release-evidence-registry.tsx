import { ArrowSquareOut } from "@phosphor-icons/react/ArrowSquareOut";
import { CheckCircle } from "@phosphor-icons/react/CheckCircle";
import { Flask } from "@phosphor-icons/react/Flask";
import { LinkSimple } from "@phosphor-icons/react/LinkSimple";
import { ShieldWarning } from "@phosphor-icons/react/ShieldWarning";
import { Warning } from "@phosphor-icons/react/Warning";
import { useMemo, useState } from "react";

import {
  evaluateReleaseEvidence,
  type ReleaseEvidenceCheck,
  type ReleaseEvidenceRegistry,
} from "../../../../../packages/evals/src/index.js";
import { cn } from "../../lib/utils.js";
import { Badge } from "../ui/badge.js";
import { Button } from "../ui/button.js";
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from "../ui/card.js";

const now = "2026-07-29T09:00:00.000Z";
const expiresAt = "2026-08-12T09:00:00.000Z";
const suites = [
  suite("PIPE-125", "PIPE-44", "Repository scan", "onboarding", "tests/onboarding-scanner.test.ts", "Detects supported layouts without changing source."),
  suite("PIPE-126", "PIPE-42", "First outcome", "onboarding", "tests/onboarding-journey.test.ts", "Proves preview, validation, evidence, and safe recovery."),
  suite("PIPE-128", "PIPE-45", "Approval policy", "vault", "tests/effect-policy.test.ts", "Denies unapproved effects and preserves an audit record."),
  suite("PIPE-130", "PIPE-48", "Provider adapter", "providers", "tests/provider-adapter-contract.test.ts", "Normalizes success, refusal, timeout, quota, and malformed output."),
  suite("PIPE-132", "PIPE-50", "Provider routing", "providers", "tests/provider-routing-parity.test.ts", "Enforces privacy, quota, cooldown, circuit, and fallback rules."),
  suite("PIPE-140", "PIPE-61", "Tool execution", "execution", "tests/execution-tools.test.ts", "Requires permissions, postconditions, idempotency, and audit."),
  suite("PIPE-141", "PIPE-60", "Execution isolation", "execution", "tests/execution-isolation.test.ts", "Protects paths, worktrees, resources, and concurrent tasks."),
  suite("PIPE-142", "PIPE-62", "Safe apply", "execution", "tests/repository-safety-parity.test.ts", "Previews patches and proves conflict, rollback, and restoration."),
  suite("PIPE-170", "PIPE-97", "Release package", "packaging", "tests/release-lifecycle.test.ts", "Verifies manifests, checksums, provenance, and required artifacts."),
  suite("PIPE-171", "PIPE-98", "Safe update", "updates", "tests/release-lifecycle.test.ts", "Checks compatibility, preservation, interruption, and rollback."),
] as const;

const baseChecks: readonly ReleaseEvidenceCheck[] = suites.flatMap((item) =>
  ["AC1", "AC2", "AC3"].map((criterionId, index) => ({
    schemaVersion: 1 as const,
    id: `${item.ticket.toLowerCase()}-${criterionId.toLowerCase()}`,
    ticketKey: item.ticket,
    parentKey: item.parent,
    criterionId,
    claim: `${item.label} criterion ${index + 1} is proven by current reproducible evidence.`,
    domain: item.domain,
    method: index === 2 ? ("manual" as const) : ("automated" as const),
    artifact: index === 2
      ? "docs/evidence/PIPE-125-171-EXECUTABLE-PROOF.md"
      : item.artifact,
    command: "npm run verify",
    owner: index === 2 ? "Release owner" : "Quality engineering",
    state: "passed" as const,
    negativeFixture: `fixture://${item.ticket.toLowerCase()}/${criterionId.toLowerCase()}-broken`,
    verifiedAt: now,
    expiresAt,
    containsSensitiveData: false as const,
  }))
);

export function ReleaseEvidenceRegistry() {
  const [checks, setChecks] = useState<readonly ReleaseEvidenceCheck[]>(baseChecks);
  const [selectedKey, setSelectedKey] = useState("PIPE-125");
  const registry = useMemo<ReleaseEvidenceRegistry>(
    () => ({
      schemaVersion: 1,
      registryId: "registry-s19-executable-proof",
      candidateId: "candidate-0.8.0-beta.4",
      generatedAt: now,
      requiredCriteria: Object.fromEntries(
        suites.map((item) => [item.ticket, ["AC1", "AC2", "AC3"]])
      ),
      checks: [...checks],
    }),
    [checks]
  );
  const decision = evaluateReleaseEvidence(registry, now);
  const selected = suites.find((item) => item.ticket === selectedKey) ?? suites[0];
  const selectedChecks = checks.filter((check) => check.ticketKey === selected.ticket);

  const injectFailure = () => {
    setChecks((current) =>
      current.map((check) =>
        check.id === "pipe-132-ac2"
          ? { ...check, state: "failed" as const }
          : check
      )
    );
    setSelectedKey("PIPE-132");
  };

  return (
    <section aria-labelledby="registry-title" className="space-y-4">
      <div className="overflow-hidden rounded-[2rem] bg-zinc-950 p-6 text-white shadow-2xl shadow-black/15 dark:bg-zinc-900 sm:p-8">
        <div className="grid gap-7 xl:grid-cols-[minmax(0,1.25fr)_minmax(22rem,.75fr)] xl:items-end">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge className={decision.ready ? "bg-emerald-300 text-zinc-950" : "bg-rose-300 text-zinc-950"}>
                {decision.ready ? "Release evidence ready" : "Release blocked"}
              </Badge>
              <span className="text-xs text-zinc-400">Candidate 0.8.0-beta.4 · Local registry</span>
            </div>
            <h2 id="registry-title" className="mt-5 max-w-3xl text-3xl font-semibold tracking-[-0.04em] sm:text-4xl">
              Every claim has to survive being broken.
            </h2>
            <p className="mt-4 max-w-2xl text-sm leading-6 text-zinc-400">
              Acceptance criteria are bound to executable artifacts, named owners,
              commands, expiry, and negative fixtures. Missing, stale, failed,
              unsafe, future-dated, or waived evidence blocks readiness.
            </p>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <Metric label="Checks" value={`${decision.passed}/${decision.required}`} />
            <Metric label="Tickets" value={String(decision.ticketCount)} />
            <Metric label="Domains" value={String(decision.domainCount)} />
          </div>
        </div>
      </div>

      <Card>
        <CardHeader className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <CardTitle>Executable coverage map</CardTitle>
            <CardDescription>Select a capability to inspect its criterion-level evidence and source.</CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" onClick={injectFailure}>
              <Flask /> Break routing proof
            </Button>
            <Button size="sm" onClick={() => setChecks(baseChecks)}>
              <CheckCircle /> Restore passing registry
            </Button>
          </div>
        </CardHeader>
        <CardContent className="mt-6">
          <div className="mb-5 flex h-3 overflow-hidden rounded-full bg-muted" aria-hidden="true">
            {suites.map((item) => (
              <span
                key={item.ticket}
                className={cn(
                  "h-full flex-1",
                  checks.some((check) => check.ticketKey === item.ticket && check.state !== "passed")
                    ? "bg-rose-400" : "bg-amber-400"
                )}
              />
            ))}
          </div>
          <p className="sr-only" aria-live="polite">
            {decision.ready
              ? `All ${decision.required} required evidence checks pass.`
              : `${decision.blocked.length} evidence check blocks release. ${decision.action}`}
          </p>
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
            {suites.map((item) => {
              const blocked = checks.some(
                (check) => check.ticketKey === item.ticket && check.state !== "passed"
              );
              return (
                <button
                  key={item.ticket}
                  type="button"
                  onClick={() => setSelectedKey(item.ticket)}
                  aria-pressed={selected.ticket === item.ticket}
                  className={cn(
                    "rounded-3xl bg-muted/50 p-4 text-left outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/30",
                    selected.ticket === item.ticket && "bg-primary/[.10]"
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <Badge tone={blocked ? "critical" : "positive"}>
                      {blocked ? <Warning weight="fill" /> : <CheckCircle weight="fill" />}
                      {blocked ? "Blocked" : "3 / 3"}
                    </Badge>
                    <span className="text-[10px] text-muted-foreground">{item.ticket}</span>
                  </div>
                  <strong className="mt-4 block text-sm">{item.label}</strong>
                  <span className="mt-1 block text-xs capitalize text-muted-foreground">{item.domain}</span>
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(20rem,.8fr)]">
        <Card className="min-w-0">
          <CardHeader>
            <div className="flex flex-wrap items-center gap-2">
              <Badge>{selected.ticket}</Badge>
              <a
                href={`https://opefyre.atlassian.net/browse/${selected.ticket}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
              >
                Open work item <ArrowSquareOut />
              </a>
            </div>
            <CardTitle className="mt-4">{selected.label}</CardTitle>
            <CardDescription>{selected.note}</CardDescription>
          </CardHeader>
          <CardContent className="mt-5 grid gap-2 md:grid-cols-3">
            {selectedChecks.map((check) => (
              <article key={check.id} className="rounded-3xl bg-muted/50 p-4">
                <div className="flex items-center justify-between gap-2">
                  <Badge tone={check.state === "passed" ? "positive" : "critical"}>{check.state}</Badge>
                  <span className="text-xs font-semibold">{check.criterionId}</span>
                </div>
                <p className="mt-4 text-xs leading-5 text-muted-foreground">{check.claim}</p>
                <code className="mt-4 block break-all text-[10px]">{check.artifact}</code>
                <span className="mt-2 block text-[10px] text-muted-foreground">{check.method} · {check.owner}</span>
              </article>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <Badge tone={decision.ready ? "positive" : "critical"} className="w-fit">
              {decision.ready ? <CheckCircle weight="fill" /> : <ShieldWarning weight="fill" />}
              {decision.ready ? "Fail-closed gate passed" : "Promotion stopped"}
            </Badge>
            <CardTitle className="mt-4">Current decision</CardTitle>
            <CardDescription>{decision.action}</CardDescription>
          </CardHeader>
          <CardContent className="mt-6">
            <div className="rounded-3xl bg-muted/50 p-4">
              <span className="text-[10px] uppercase tracking-[.14em] text-muted-foreground">Reproduce locally</span>
              <code className="mt-2 block text-xs">npm run verify</code>
              <p className="mt-3 text-xs leading-5 text-muted-foreground">
                Negative fixtures are synthetic. Credentials, personal data,
                private source, and user paths are prohibited by schema.
              </p>
            </div>
            <a
              href="https://github.com/opefyre/freeloader-coder/blob/main/docs/evidence/PIPE-125-171-EXECUTABLE-PROOF.md"
              target="_blank"
              rel="noreferrer"
              className="mt-4 inline-flex items-center gap-2 text-xs font-semibold text-primary hover:underline"
            >
              <LinkSimple /> Open evidence record
            </a>
          </CardContent>
        </Card>
      </div>
    </section>
  );
}

function suite(
  ticket: string,
  parent: string,
  label: string,
  domain: ReleaseEvidenceCheck["domain"],
  artifact: ReleaseEvidenceCheck["artifact"],
  note: string
) {
  return { ticket, parent, label, domain, artifact, note } as const;
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-white/[.06] px-4 py-3">
      <strong className="block text-xl">{value}</strong>
      <span className="mt-1 block text-[10px] uppercase tracking-[.14em] text-zinc-500">{label}</span>
    </div>
  );
}
