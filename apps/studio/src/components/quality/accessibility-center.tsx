import { ArrowsOut } from "@phosphor-icons/react/ArrowsOut";
import { ChartBar } from "@phosphor-icons/react/ChartBar";
import { CheckCircle } from "@phosphor-icons/react/CheckCircle";
import { Eye } from "@phosphor-icons/react/Eye";
import { FileText } from "@phosphor-icons/react/FileText";
import { Keyboard } from "@phosphor-icons/react/Keyboard";
import { LinkSimple } from "@phosphor-icons/react/LinkSimple";
import { PersonArmsSpread } from "@phosphor-icons/react/PersonArmsSpread";
import { ShieldCheck } from "@phosphor-icons/react/ShieldCheck";
import { TextAa } from "@phosphor-icons/react/TextAa";
import { Warning } from "@phosphor-icons/react/Warning";
import { useState } from "react";

import {
  assessEvidenceLedger,
  evaluateAccessibility,
  type AccessibilityCheck,
  type AccessibilityGate,
  type EvidenceLedger,
  type EvidenceMapping,
} from "../../../../../packages/evals/src/index.js";
import { cn } from "../../lib/utils.js";
import { Badge } from "../ui/badge.js";
import { Button } from "../ui/button.js";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../ui/card.js";

type AuditView = "accessibility" | "foundation";

const baseChecks: readonly AccessibilityCheck[] = [
  accessCheck(
    "keyboard-primary",
    "Keyboard-only critical journeys",
    "keyboard",
    "manual",
    "critical",
    ["Projects", "Work", "Evidence", "Settings"],
    "Restore complete keyboard evidence before promotion."
  ),
  accessCheck(
    "focus-visible",
    "Visible focus and logical order",
    "focus",
    "automated",
    "critical",
    ["All interactive Studio surfaces"],
    "Restore visible focus and correct the focus sequence."
  ),
  accessCheck(
    "semantic-names",
    "Names, roles, states, and landmarks",
    "semantics",
    "automated",
    "critical",
    ["Studio shell", "Dialogs", "Workflows"],
    "Add the missing semantic name, role, state, or landmark."
  ),
  accessCheck(
    "contrast-aa",
    "WCAG AA text and control contrast",
    "contrast",
    "automated",
    "critical",
    ["Light theme", "Dark theme"],
    "Use an approved token pair that meets the required contrast."
  ),
  accessCheck(
    "reduced-motion",
    "Reduced-motion behavior",
    "motion",
    "manual",
    "major",
    ["Transitions", "Progress", "Notifications"],
    "Remove non-essential animation when reduced motion is requested."
  ),
  accessCheck(
    "zoom-200",
    "200% zoom without lost content",
    "zoom",
    "manual",
    "critical",
    ["Critical desktop workflows"],
    "Reflow the affected surface without clipping or hidden actions."
  ),
  accessCheck(
    "responsive-reflow",
    "Mobile and narrow-window reflow",
    "reflow",
    "automated",
    "critical",
    ["390px", "768px", "1280px"],
    "Remove horizontal overflow and preserve reachable controls."
  ),
  accessCheck(
    "chart-alternatives",
    "Charts have text or table alternatives",
    "text_alternative",
    "manual",
    "critical",
    ["Overview", "Providers", "Evidence"],
    "Restore the meaningful table or text alternative for every chart."
  ),
] as const;

const evidenceTickets = [
  {
    key: "PIPE-117",
    parent: "PIPE-29",
    label: "Repository boundary",
    note: "Workspace ownership, clean setup, isolation lint",
    artifact: "docs/evidence/PIPE-29.md",
  },
  {
    key: "PIPE-118",
    parent: "PIPE-30",
    label: "Protocol contracts",
    note: "Strict schemas, replay, safe errors",
    artifact: "docs/evidence/PIPE-30.md",
  },
  {
    key: "PIPE-119",
    parent: "PIPE-31",
    label: "Core migration",
    note: "Parity, single-machine journey, rollback",
    artifact: "docs/evidence/PIPE-31.md",
  },
  {
    key: "PIPE-120",
    parent: "PIPE-32",
    label: "Design system",
    note: "Tokens, Phosphor icons, themes, responsive gates",
    artifact: "docs/evidence/PIPE-32.md",
  },
  {
    key: "PIPE-121",
    parent: "PIPE-37",
    label: "Clone and setup",
    note: "Prerequisites, idempotency, private state",
    artifact: "docs/evidence/PIPE-37-IDEMPOTENT-SETUP.md",
  },
  {
    key: "PIPE-122",
    parent: "PIPE-38",
    label: "Runtime lifecycle",
    note: "Start, health, stop, repair, preservation",
    artifact: "docs/evidence/PIPE-38-RUNTIME-LIFECYCLE.md",
  },
  {
    key: "PIPE-123",
    parent: "PIPE-40",
    label: "Local project entry",
    note: "Read-only registration and unsupported layouts",
    artifact: "docs/evidence/PIPE-40-REPOSITORY-ENTRY.md",
  },
  {
    key: "PIPE-124",
    parent: "PIPE-41",
    label: "GitHub project entry",
    note: "Exact identity, clone safety, denied access",
    artifact: "docs/evidence/PIPE-41-GITHUB-ENTRY.md",
  },
] as const;

const mappings: readonly EvidenceMapping[] = evidenceTickets.flatMap(
  (ticket) =>
    ["AC1", "AC2", "AC3"].map((criterionId, index) => ({
      schemaVersion: 1 as const,
      id: `${ticket.key.toLowerCase()}-${criterionId.toLowerCase()}`,
      ticketKey: ticket.key,
      parentKey: ticket.parent,
      criterionId,
      claim: `${ticket.label} acceptance criterion ${index + 1} has current executable or named manual evidence.`,
      method: index === 2 ? ("manual" as const) : ("automated" as const),
      artifact:
        index === 2
          ? ticket.artifact
          : index === 0
            ? "tests/foundation-evidence.test.ts"
            : "tests/accessibility-gate.test.ts",
      owner: index === 2 ? "Release evidence owner" : "Quality engineering",
      status: "passed" as const,
      negativeFixture: `fixture://${ticket.key.toLowerCase()}/${criterionId.toLowerCase()}-broken`,
      containsSensitiveData: false as const,
      reproducibleCommand: "npm run verify",
    }))
);

const ledger: EvidenceLedger = {
  schemaVersion: 1,
  ledgerId: "ledger-foundation-s18",
  generatedAt: "2026-07-29T08:00:00.000Z",
  mappings: [...mappings],
  requiredTickets: evidenceTickets.map((ticket) => ticket.key),
  requiredCriteriaPerTicket: Object.fromEntries(
    evidenceTickets.map((ticket) => [ticket.key, ["AC1", "AC2", "AC3"]])
  ),
};

const views: readonly {
  id: AuditView;
  label: string;
  note: string;
  icon: typeof PersonArmsSpread;
}[] = [
  {
    id: "accessibility",
    label: "Accessibility",
    note: "Hard release gate",
    icon: PersonArmsSpread,
  },
  {
    id: "foundation",
    label: "Foundation evidence",
    note: "Claims mapped to proof",
    icon: FileText,
  },
];

export function AccessibilityCenter() {
  const [view, setView] = useState<AuditView>("accessibility");
  const [checks, setChecks] =
    useState<readonly AccessibilityCheck[]>(baseChecks);
  const [selectedTicket, setSelectedTicket] = useState("PIPE-117");
  const gate: AccessibilityGate = {
    schemaVersion: 1,
    candidateId: "candidate-0.8.0-beta.3",
    standard: "WCAG 2.2 AA",
    checks: [...checks],
    criticalWorkflows: [
      "Add a project",
      "Approve a plan",
      "Review evidence",
      "Restore work",
      "Change consent",
    ],
    supportedZoomPercent: 200,
    generatedAt: "2026-07-29T08:00:00.000Z",
  };
  const audit = evaluateAccessibility(gate, "2026-07-29T08:00:00.000Z");
  const foundation = assessEvidenceLedger(ledger);
  const selected =
    evidenceTickets.find((ticket) => ticket.key === selectedTicket) ??
    evidenceTickets[0];
  const selectedMappings = mappings.filter(
    (mapping) => mapping.ticketKey === selected?.key
  );

  const injectFailure = () => {
    setChecks((current) =>
      current.map((check) =>
        check.id === "chart-alternatives"
          ? {
              ...check,
              state: "failed",
              evidenceRef: "fixture://chart-without-alternative",
            }
          : check
      )
    );
  };

  const restoreEvidence = () => {
    setChecks(baseChecks);
  };

  return (
    <div className="min-w-0 space-y-4">
      <section className="overflow-hidden rounded-[2rem] bg-zinc-950 p-6 text-white shadow-2xl shadow-black/15 dark:bg-zinc-900 sm:p-8">
        <div className="grid gap-7 xl:grid-cols-[minmax(0,1.25fr)_minmax(23rem,.75fr)] xl:items-end">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge className="bg-amber-300 text-zinc-950">
                WCAG 2.2 AA
              </Badge>
              <span className="text-xs text-zinc-400">
                Candidate 0.8.0-beta.3 · Local evidence
              </span>
            </div>
            <h2 className="mt-5 max-w-3xl text-3xl font-semibold tracking-[-0.04em] sm:text-4xl">
              Accessibility can stop the release.
            </h2>
            <p className="mt-4 max-w-2xl text-sm leading-6 text-zinc-400">
              Critical journeys require automated checks and named manual
              evidence. Missing alternatives, focus, semantics, contrast, zoom,
              or reflow fail closed.
            </p>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <HeroMetric
              label="Required"
              value={String(audit.required)}
              tone="text-white"
            />
            <HeroMetric
              label="Passed"
              value={String(audit.passed)}
              tone="text-emerald-300"
            />
            <HeroMetric
              label="Release"
              value={audit.releasable ? "Eligible" : "Blocked"}
              tone={audit.releasable ? "text-emerald-300" : "text-rose-300"}
            />
          </div>
        </div>
      </section>

      <div
        className="grid gap-2 rounded-3xl bg-muted/55 p-2 sm:grid-cols-2"
        role="tablist"
        aria-label="Accessibility and evidence views"
      >
        {views.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={view === item.id}
            onClick={() => setView(item.id)}
            className={cn(
              "flex items-center gap-3 rounded-2xl px-4 py-3 text-left outline-none hover:bg-background/65 focus-visible:ring-3 focus-visible:ring-ring/30",
              view === item.id && "bg-background shadow-sm"
            )}
          >
            <span className="grid size-9 place-items-center rounded-2xl bg-amber-300/15 text-amber-700 dark:text-amber-300">
              <item.icon size={19} weight={view === item.id ? "fill" : "regular"} />
            </span>
            <span>
              <strong className="block text-sm">{item.label}</strong>
              <span className="text-xs text-muted-foreground">{item.note}</span>
            </span>
          </button>
        ))}
      </div>

      {view === "accessibility" ? (
        <AccessibilityAudit
          checks={checks}
          audit={audit}
          injectFailure={injectFailure}
          restoreEvidence={restoreEvidence}
        />
      ) : (
        <FoundationEvidence
          assessment={foundation}
          selected={selected}
          selectedTicket={selectedTicket}
          setSelectedTicket={setSelectedTicket}
          mappings={selectedMappings}
        />
      )}

      <Card>
        <CardContent className="grid gap-3 p-5 sm:grid-cols-3">
          <SourceLink
            label="Accessibility gate"
            value="PIPE-35"
            href="https://opefyre.atlassian.net/browse/PIPE-35"
          />
          <SourceLink
            label="Design evidence"
            value="PIPE-120"
            href="https://opefyre.atlassian.net/browse/PIPE-120"
          />
          <SourceLink
            label="Evidence record"
            value="Sprint 18 source"
            href="https://github.com/opefyre/freeloader-coder/blob/main/docs/evidence/PIPE-35-117-124-ACCESSIBILITY-FOUNDATION.md"
          />
        </CardContent>
      </Card>
    </div>
  );
}

function AccessibilityAudit({
  checks,
  audit,
  injectFailure,
  restoreEvidence,
}: {
  checks: readonly AccessibilityCheck[];
  audit: ReturnType<typeof evaluateAccessibility>;
  injectFailure: () => void;
  restoreEvidence: () => void;
}) {
  return (
    <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(20rem,.75fr)]">
      <Card className="min-w-0">
        <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle>Required release evidence</CardTitle>
            <CardDescription>
              Automated coverage and named manual review share one fail-closed
              decision.
            </CardDescription>
          </div>
          <Badge tone={audit.releasable ? "positive" : "critical"}>
            {audit.releasable ? "Release eligible" : "Release blocked"}
          </Badge>
        </CardHeader>
        <CardContent className="mt-6 grid gap-3 sm:grid-cols-2">
          {checks.map((check) => (
            <div
              key={check.id}
              className={cn(
                "rounded-3xl p-5",
                check.state === "passed"
                  ? "bg-emerald-400/[.07]"
                  : "bg-rose-400/[.09]"
              )}
            >
              <div className="flex items-center justify-between gap-3">
                <span className="grid size-9 place-items-center rounded-2xl bg-background/70">
                  <DimensionIcon dimension={check.dimension} />
                </span>
                <div className="flex gap-2">
                  <Badge>{check.method}</Badge>
                  <Badge
                    tone={check.state === "passed" ? "positive" : "critical"}
                  >
                    {check.state}
                  </Badge>
                </div>
              </div>
              <strong className="mt-5 block text-sm">{check.label}</strong>
              <p className="mt-2 text-xs leading-5 text-muted-foreground">
                {check.state === "passed"
                  ? `${check.owner} · ${check.surfaces.join(", ")}`
                  : check.remediation}
              </p>
            </div>
          ))}
        </CardContent>
      </Card>

      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>
              {audit.releasable ? "Gate is intact" : "Release stopped"}
            </CardTitle>
            <CardDescription>
              Remove the chart alternative to prove one critical failure blocks
              promotion.
            </CardDescription>
          </CardHeader>
          <CardContent className="mt-5">
            <div
              className={cn(
                "rounded-3xl p-5",
                audit.releasable
                  ? "bg-emerald-400/[.07]"
                  : "bg-rose-400/[.09]"
              )}
              aria-live="polite"
            >
              {audit.releasable ? (
                <CheckCircle
                  className="text-emerald-600 dark:text-emerald-300"
                  size={24}
                  weight="fill"
                />
              ) : (
                <Warning
                  className="text-rose-600 dark:text-rose-300"
                  size={24}
                  weight="fill"
                />
              )}
              <strong className="mt-4 block text-sm">{audit.action}</strong>
              <p className="mt-2 text-xs leading-5 text-muted-foreground">
                {audit.releasable
                  ? "All eight required dimensions have current evidence."
                  : `${audit.criticalFailures.length} critical failure prevents release.`}
              </p>
            </div>
            <Button
              className="mt-4 w-full"
              variant={audit.releasable ? "secondary" : "default"}
              onClick={audit.releasable ? injectFailure : restoreEvidence}
            >
              {audit.releasable
                ? "Remove chart alternative"
                : "Restore accessible evidence"}
            </Button>
            <p className="mt-3 text-center text-[11px] leading-4 text-muted-foreground">
              Fixture only. No release, issue, workflow, or deployment is
              created.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Chart alternative</CardTitle>
            <CardDescription>
              The numeric view remains understandable without color or graphics.
            </CardDescription>
          </CardHeader>
          <CardContent className="mt-5">
            <div
              className="grid grid-cols-8 items-end gap-1"
              aria-hidden="true"
            >
              {[7, 8, 8, 8, 7, 8, 8, audit.releasable ? 8 : 0].map(
                (value, index) => (
                  <span
                    key={`${index}-${value}`}
                    className={cn(
                      "rounded-t-lg bg-emerald-400/65",
                      value === 0 && "bg-rose-400/70"
                    )}
                    style={{ height: `${Math.max(value, 1) * 7}px` }}
                  />
                )
              )}
            </div>
            {audit.releasable ? (
              <table className="mt-5 w-full text-left text-xs">
                <caption className="mb-3 text-left font-semibold">
                  Accessibility check summary
                </caption>
                <tbody>
                  <tr>
                    <th className="py-1 font-medium text-muted-foreground">
                      Passed
                    </th>
                    <td className="py-1 text-right font-semibold">
                      {audit.passed} of {audit.required}
                    </td>
                  </tr>
                  <tr>
                    <th className="py-1 font-medium text-muted-foreground">
                      Critical failures
                    </th>
                    <td className="py-1 text-right font-semibold">
                      {audit.criticalFailures.length}
                    </td>
                  </tr>
                </tbody>
              </table>
            ) : (
              <div className="mt-5 rounded-2xl bg-rose-400/[.09] p-4 text-xs leading-5">
                The table alternative is deliberately absent. This critical
                fixture blocks release.
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function FoundationEvidence({
  assessment,
  selected,
  selectedTicket,
  setSelectedTicket,
  mappings,
}: {
  assessment: ReturnType<typeof assessEvidenceLedger>;
  selected: (typeof evidenceTickets)[number] | undefined;
  selectedTicket: string;
  setSelectedTicket: (ticket: string) => void;
  mappings: readonly EvidenceMapping[];
}) {
  return (
    <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(21rem,.8fr)]">
      <Card className="min-w-0">
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div>
            <CardTitle>Foundation evidence ledger</CardTitle>
            <CardDescription>
              Every criterion maps to executable or named manual proof and a
              negative fixture.
            </CardDescription>
          </div>
          <Badge tone={assessment.ready ? "positive" : "critical"}>
            {assessment.passedMappings}/{assessment.totalMappings} mapped
          </Badge>
        </CardHeader>
        <CardContent className="mt-6 grid gap-3 sm:grid-cols-2">
          {evidenceTickets.map((ticket) => (
            <button
              key={ticket.key}
              type="button"
              aria-pressed={selectedTicket === ticket.key}
              onClick={() => setSelectedTicket(ticket.key)}
              className={cn(
                "rounded-3xl bg-muted/45 p-5 text-left outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/30",
                selectedTicket === ticket.key && "bg-amber-300/12"
              )}
            >
              <div className="flex items-center justify-between gap-3">
                <Badge>{ticket.key}</Badge>
                <Badge tone="positive">3/3</Badge>
              </div>
              <strong className="mt-5 block text-sm">{ticket.label}</strong>
              <p className="mt-2 text-xs leading-5 text-muted-foreground">
                {ticket.note}
              </p>
            </button>
          ))}
        </CardContent>
      </Card>

      <Card className="min-w-0">
        <CardHeader>
          <Badge tone="positive" className="w-fit">
            {selected?.key} → {selected?.parent}
          </Badge>
          <CardTitle className="mt-4">{selected?.label}</CardTitle>
          <CardDescription>{selected?.artifact}</CardDescription>
        </CardHeader>
        <CardContent className="mt-6 space-y-3">
          {mappings.map((mapping) => (
            <div key={mapping.id} className="rounded-2xl bg-muted/45 p-4">
              <div className="flex items-center justify-between gap-3">
                <strong className="text-sm">{mapping.criterionId}</strong>
                <Badge tone="positive">{mapping.method}</Badge>
              </div>
              <p className="mt-2 text-xs leading-5 text-muted-foreground">
                {mapping.claim}
              </p>
              <code className="mt-3 block truncate text-[10px] text-muted-foreground">
                {mapping.negativeFixture}
              </code>
            </div>
          ))}
          <a
            href={`https://github.com/opefyre/freeloader-coder/blob/main/${selected?.artifact}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 text-sm font-semibold hover:text-primary"
          >
            Open evidence source <LinkSimple />
          </a>
        </CardContent>
      </Card>
    </div>
  );
}

function accessCheck(
  id: string,
  label: string,
  dimension: AccessibilityCheck["dimension"],
  method: AccessibilityCheck["method"],
  severity: AccessibilityCheck["severity"],
  surfaces: readonly string[],
  remediation: string
): AccessibilityCheck {
  return {
    schemaVersion: 1,
    id,
    label,
    dimension,
    method,
    severity,
    required: true,
    state: "passed",
    surfaces: [...surfaces],
    owner: method === "manual" ? "Accessibility reviewer" : "Quality engineering",
    observedAt: "2026-07-29T08:00:00.000Z",
    reviewAfter: "2026-10-29T08:00:00.000Z",
    evidenceRef: `evidence://${id}/verified`,
    remediation,
  };
}

function DimensionIcon({
  dimension,
}: {
  dimension: AccessibilityCheck["dimension"];
}) {
  if (dimension === "keyboard" || dimension === "focus") return <Keyboard />;
  if (dimension === "contrast") return <Eye />;
  if (dimension === "zoom" || dimension === "reflow") return <ArrowsOut />;
  if (dimension === "text_alternative") return <ChartBar />;
  if (dimension === "semantics") return <TextAa />;
  return <PersonArmsSpread />;
}

function HeroMetric({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: string;
}) {
  return (
    <div className="rounded-3xl bg-white/[.06] p-4">
      <span className="text-[10px] font-semibold uppercase tracking-[.16em] text-zinc-500">
        {label}
      </span>
      <strong className={cn("mt-3 block text-xl", tone)}>{value}</strong>
    </div>
  );
}

function SourceLink({
  label,
  value,
  href,
}: {
  label: string;
  value: string;
  href: string;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="flex items-center justify-between gap-4 rounded-2xl bg-muted/45 p-4 outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/30"
    >
      <span>
        <span className="block text-[10px] font-semibold uppercase tracking-[.14em] text-muted-foreground">
          {label}
        </span>
        <strong className="mt-2 block text-sm">{value}</strong>
      </span>
      <ShieldCheck className="shrink-0 text-amber-700 dark:text-amber-300" />
    </a>
  );
}
