import { ArrowRight } from "@phosphor-icons/react/ArrowRight";
import { ArrowSquareOut } from "@phosphor-icons/react/ArrowSquareOut";
import { CheckCircle } from "@phosphor-icons/react/CheckCircle";
import { Eye } from "@phosphor-icons/react/Eye";
import { FileText } from "@phosphor-icons/react/FileText";
import { Fingerprint } from "@phosphor-icons/react/Fingerprint";
import { GitCommit } from "@phosphor-icons/react/GitCommit";
import { LockSimple } from "@phosphor-icons/react/LockSimple";
import { Scales } from "@phosphor-icons/react/Scales";
import { ShieldCheck } from "@phosphor-icons/react/ShieldCheck";
import { TreeStructure } from "@phosphor-icons/react/TreeStructure";
import { UsersThree } from "@phosphor-icons/react/UsersThree";
import { Warning } from "@phosphor-icons/react/Warning";
import { useMemo, useState } from "react";

import {
  assessGovernance,
  changeConsent,
  verifySupplyChain,
  type DataFlow,
  type DecisionRecord,
  type GovernancePolicy,
  type PrivacyPreferences,
  type SupplyChainCheck,
  type SupplyChainGate,
} from "../../../../../packages/governance/src/index.js";
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

type TrustView = "governance" | "supply" | "privacy";

const decisions: readonly DecisionRecord[] = [
  {
    schemaVersion: 1,
    id: "adr-0001",
    title: "Local-first canonical state",
    state: "accepted",
    decidedAt: "2026-07-27T08:00:00.000Z",
    owners: ["maintainer", "security-steward"],
    releaseIds: ["release-0.8.0-beta.2"],
    context:
      "Users need an inspectable system that does not depend on a hosted control plane.",
    decision:
      "Canonical task, consent, evidence, and recovery state remains local by default.",
    consequences: [
      "Core workflows remain available offline.",
      "External writes require an explicit connector and approval.",
    ],
    sourcePath: "docs/decisions/adr-0001-local-first.md",
  },
  {
    schemaVersion: 1,
    id: "adr-0002",
    title: "Free routes before optional paid capacity",
    state: "accepted",
    decidedAt: "2026-07-27T09:00:00.000Z",
    owners: ["maintainer", "release-owner"],
    releaseIds: ["release-0.8.0-beta.2"],
    context:
      "The product promise requires useful operation without accidental billing.",
    decision:
      "Only verified zero-cost routes are eligible by default; paid routes remain locked.",
    consequences: [
      "Work may wait for free capacity.",
      "Paid providers require a future explicit budget and approval contract.",
    ],
    sourcePath: "docs/decisions/adr-0002-free-first.md",
  },
  {
    schemaVersion: 1,
    id: "adr-0003",
    title: "Evidence before completion",
    state: "accepted",
    decidedAt: "2026-07-27T10:00:00.000Z",
    owners: ["maintainer", "release-owner"],
    releaseIds: [],
    context:
      "Model output and attempted commands do not prove that product behavior works.",
    decision:
      "Only observable validation and review evidence can advance work to completion.",
    consequences: [
      "Slow validation is not silently bypassed.",
      "Uncertain work stops in a visible review or needs-user state.",
    ],
    sourcePath: "docs/decisions/adr-0003-evidence-before-done.md",
  },
] as const;

const governancePolicy: GovernancePolicy = {
  schemaVersion: 1,
  reviewedAt: "2026-07-28T20:25:00.000Z",
  nextReviewAt: "2026-10-28T20:25:00.000Z",
  roles: [
    {
      schemaVersion: 1,
      id: "maintainer",
      title: "Maintainer",
      responsibilities: [
        "Own roadmap triage and repository health.",
        "Record material product and architecture decisions.",
      ],
      authority: ["Merge verified changes.", "Nominate successor maintainers."],
      selectedBy: "Consensus of active maintainers after a public nomination.",
      term: "No fixed term; reviewed every six months.",
      activeHolder: null,
      fallbackRoleId: "release-owner",
    },
    {
      schemaVersion: 1,
      id: "release-owner",
      title: "Release owner",
      responsibilities: [
        "Verify the release evidence package.",
        "Coordinate rollback and post-release review.",
      ],
      authority: ["Pause promotion.", "Reject incomplete release evidence."],
      selectedBy: "Named for each release in its evidence package.",
      term: "One release lifecycle.",
      activeHolder: null,
      fallbackRoleId: "maintainer",
    },
    {
      schemaVersion: 1,
      id: "security-steward",
      title: "Security steward",
      responsibilities: [
        "Privately triage security reports.",
        "Coordinate bounded disclosure and emergency response.",
      ],
      authority: [
        "Temporarily restrict vulnerable releases.",
        "Request a security-only patch window.",
      ],
      selectedBy: "Consensus of active maintainers with a documented handoff.",
      term: "Reviewed every six months.",
      activeHolder: null,
      fallbackRoleId: "maintainer",
    },
  ],
  decisions: [...decisions],
  roadmapProcessDefined: true,
  triageProcessDefined: true,
  moderationProcessDefined: true,
  successionProcessDefined: true,
  securityEmergencyProcessDefined: true,
  officialAdapterRuleDefined: true,
  conflictDisclosurePath: "docs/governance/disclosures.md",
  fundingDisclosurePath: "docs/governance/disclosures.md",
};

const baseChecks: readonly SupplyChainCheck[] = [
  supplyCheck("lockfile", "dependency", "Lockfile matches source", "Dependency graph changed outside the lockfile. Regenerate and review it."),
  supplyCheck("audit", "dependency", "Known vulnerability policy", "Resolve or explicitly document the vulnerability before release."),
  supplyCheck("secrets", "secret", "Secret scan", "Remove the detected credential and rotate it before continuing."),
  supplyCheck("reproducible", "build", "Reproducible build inputs", "Pin the missing build input and rerun verification."),
  supplyCheck("sbom", "artifact", "SBOM generated", "Generate the SBOM from the locked dependency graph."),
  supplyCheck("provenance", "provenance", "Provenance matches commit", "Rebuild provenance from the exact source commit."),
  supplyCheck("signature", "signature", "Release signature", "Sign and verify the release manifest."),
  supplyCheck("licenses", "license", "Dependency license policy", "Replace or approve the incompatible dependency before release."),
] as const;

const dataFlows: readonly DataFlow[] = [
  {
    schemaVersion: 1,
    id: "local-operations",
    category: "operational",
    data: ["task state", "validation evidence", "local preferences"],
    destination: "This device",
    purpose: "Run, recover, and explain the local pipeline.",
    defaultEnabled: true,
    requiresConsent: false,
    retention: "Until project removal or explicit deletion",
    deletionSupported: true,
    containsSecrets: false,
    containsPersonalData: false,
  },
  {
    schemaVersion: 1,
    id: "optional-product-signals",
    category: "optional_telemetry",
    data: ["feature event", "coarse outcome", "error class"],
    destination: "Configured telemetry endpoint",
    purpose: "Understand activation and reliability without collecting code or prompts.",
    defaultEnabled: false,
    requiresConsent: true,
    retention: "30 days when enabled",
    deletionSupported: true,
    containsSecrets: false,
    containsPersonalData: false,
  },
  {
    schemaVersion: 1,
    id: "training-eligible-ai",
    category: "third_party_ai",
    data: ["redacted prompt", "non-sensitive test source", "model output"],
    destination: "Eligible third-party AI provider",
    purpose: "Use broader free capacity for this test pipeline.",
    defaultEnabled: false,
    requiresConsent: true,
    retention: "Controlled by the selected provider",
    deletionSupported: false,
    containsSecrets: false,
    containsPersonalData: false,
  },
  {
    schemaVersion: 1,
    id: "support-bundle",
    category: "support_bundle",
    data: ["redacted diagnostics", "versions", "failure classes"],
    destination: "Local export until you share it",
    purpose: "Prepare a reviewable support package.",
    defaultEnabled: false,
    requiresConsent: true,
    retention: "Until the local bundle is deleted",
    deletionSupported: true,
    containsSecrets: false,
    containsPersonalData: false,
  },
] as const;

const basePrivacy: PrivacyPreferences = {
  schemaVersion: 1,
  optionalTelemetry: false,
  thirdPartyTrainingEligible: true,
  supportDiagnostics: false,
  paidUsage: false,
  updatedAt: "2026-07-28T20:25:00.000Z",
};

const views: readonly {
  id: TrustView;
  label: string;
  icon: typeof Scales;
  note: string;
}[] = [
  {
    id: "governance",
    label: "Governance",
    icon: Scales,
    note: "Who decides and how",
  },
  {
    id: "supply",
    label: "Supply chain",
    icon: Fingerprint,
    note: "What blocks a release",
  },
  {
    id: "privacy",
    label: "Data & AI",
    icon: Eye,
    note: "What leaves the device",
  },
] as const;

export function TrustCenter() {
  const [view, setView] = useState<TrustView>("governance");
  const [selectedDecision, setSelectedDecision] = useState(decisions[0]?.id ?? "");
  const [checks, setChecks] = useState<readonly SupplyChainCheck[]>(baseChecks);
  const [privacy, setPrivacy] = useState<PrivacyPreferences>(basePrivacy);
  const [consentNote, setConsentNote] = useState(
    "Settings shown here are local demo state. No provider or telemetry setting is changed."
  );
  const governance = assessGovernance(
    governancePolicy,
    "2026-07-28T20:25:00.000Z"
  );
  const supplyGate: SupplyChainGate = {
    schemaVersion: 1,
    gateId: "supply-0.8.0-beta.2",
    releaseId: "release-0.8.0-beta.2",
    sourceCommit: "89f0827",
    lockfileDigest: `sha256:${"4".repeat(64)}`,
    checks: [...checks],
    allowedLicenses: ["MIT", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "ISC"],
    deniedPackages: [],
    generatedAt: "2026-07-28T20:25:00.000Z",
  };
  const supply = verifySupplyChain(supplyGate);
  const decision =
    decisions.find((entry) => entry.id === selectedDecision) ?? decisions[0];
  const enabledFlows = useMemo(
    () =>
      dataFlows.filter((flow) => {
        if (flow.category === "operational") return true;
        if (flow.category === "optional_telemetry")
          return privacy.optionalTelemetry;
        if (flow.category === "third_party_ai")
          return privacy.thirdPartyTrainingEligible;
        return privacy.supportDiagnostics;
      }),
    [privacy]
  );

  const toggleConsent = (
    action: Parameters<typeof changeConsent>[1]
  ) => {
    const result = changeConsent(
      privacy,
      action,
      "2026-07-28T20:30:00.000Z",
      dataFlows
    );
    setPrivacy(result.next);
    setConsentNote(
      `${result.effects.join(" ")} This demo is prospective only; no external setting was changed.`
    );
  };

  const breakProvenance = () => {
    setChecks((current) =>
      current.map((check) =>
        check.id === "provenance"
          ? {
              ...check,
              state: "failed",
              evidenceRef: "fixture://mismatched-provenance",
            }
          : check
      )
    );
  };

  const repairProvenance = () => {
    setChecks(baseChecks);
  };

  return (
    <div className="min-w-0 space-y-4">
      <section className="overflow-hidden rounded-[2rem] bg-zinc-950 px-5 py-6 text-white shadow-2xl shadow-black/15 dark:bg-zinc-900 sm:px-7 sm:py-7">
        <div className="grid gap-7 xl:grid-cols-[minmax(0,1.35fr)_minmax(22rem,.65fr)] xl:items-end">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge className="bg-amber-300 text-zinc-950">Open-source trust</Badge>
              <span className="text-xs font-medium text-zinc-400">
                Verified locally · No legal claim
              </span>
            </div>
            <h2 className="mt-5 max-w-3xl text-3xl font-semibold tracking-[-0.04em] sm:text-4xl">
              Know who decides, what ships, and where your data goes.
            </h2>
            <p className="mt-4 max-w-2xl text-sm leading-6 text-zinc-400">
              Governance, supply-chain proof, and data controls live in one
              inspectable place. Policies link to source; simulations never
              perform an external action.
            </p>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <HeroMetric
              label="Processes"
              value="6/6"
              tone="text-emerald-300"
            />
            <HeroMetric
              label="Checks"
              value={`${supply.passedCount}/${checks.length}`}
              tone={supply.promotable ? "text-emerald-300" : "text-amber-300"}
            />
            <HeroMetric label="Paid" value="Locked" tone="text-amber-300" />
          </div>
        </div>
      </section>

      <div
        className="grid gap-2 rounded-3xl bg-muted/55 p-2 sm:grid-cols-3"
        role="tablist"
        aria-label="Trust Center sections"
      >
        {views.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={view === item.id}
            onClick={() => setView(item.id)}
            className={cn(
              "flex min-w-0 items-center gap-3 rounded-2xl px-4 py-3 text-left outline-none transition-colors hover:bg-background/65 focus-visible:ring-3 focus-visible:ring-ring/30",
              view === item.id && "bg-background shadow-sm"
            )}
          >
            <span className="grid size-9 shrink-0 place-items-center rounded-2xl bg-amber-300/15 text-amber-700 dark:text-amber-300">
              <item.icon size={19} weight={view === item.id ? "fill" : "regular"} />
            </span>
            <span className="min-w-0">
              <strong className="block text-sm">{item.label}</strong>
              <span className="block truncate text-xs text-muted-foreground">
                {item.note}
              </span>
            </span>
          </button>
        ))}
      </div>

      {view === "governance" && (
        <GovernanceView
          assessment={governance}
          decision={decision}
          selectedDecision={selectedDecision}
          setSelectedDecision={setSelectedDecision}
        />
      )}
      {view === "supply" && (
        <SupplyView
          assessment={supply}
          checks={checks}
          breakProvenance={breakProvenance}
          repairProvenance={repairProvenance}
        />
      )}
      {view === "privacy" && (
        <PrivacyView
          privacy={privacy}
          enabledFlows={enabledFlows}
          note={consentNote}
          toggleConsent={toggleConsent}
        />
      )}

      <Card>
        <CardContent className="grid gap-4 p-5 sm:grid-cols-2 xl:grid-cols-4">
          <SourceLink
            label="Governance work"
            value="PIPE-106"
            href="https://opefyre.atlassian.net/browse/PIPE-106"
          />
          <SourceLink
            label="Supply-chain work"
            value="PIPE-107 · PIPE-172"
            href="https://opefyre.atlassian.net/browse/PIPE-107"
          />
          <SourceLink
            label="Privacy work"
            value="PIPE-108"
            href="https://opefyre.atlassian.net/browse/PIPE-108"
          />
          <SourceLink
            label="Repository"
            value="Policy source"
            href="https://github.com/opefyre/freeloader-coder"
          />
        </CardContent>
      </Card>
    </div>
  );
}

function GovernanceView({
  assessment,
  decision,
  selectedDecision,
  setSelectedDecision,
}: {
  assessment: ReturnType<typeof assessGovernance>;
  decision: DecisionRecord | undefined;
  selectedDecision: string;
  setSelectedDecision: (id: string) => void;
}) {
  return (
    <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(20rem,.8fr)]">
      <Card className="min-w-0">
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div>
            <CardTitle>Decision trail</CardTitle>
            <CardDescription>
              Material choices stay discoverable and link forward to releases.
            </CardDescription>
          </div>
          <Badge tone={assessment.ready ? "positive" : "caution"}>
            {assessment.ready ? "Ready" : "Review needed"}
          </Badge>
        </CardHeader>
        <CardContent className="mt-6 grid gap-5 lg:grid-cols-[17rem_minmax(0,1fr)]">
          <div className="space-y-2">
            {decisions.map((entry) => (
              <button
                key={entry.id}
                type="button"
                aria-pressed={selectedDecision === entry.id}
                onClick={() => setSelectedDecision(entry.id)}
                className={cn(
                  "w-full rounded-2xl bg-muted/45 p-4 text-left outline-none transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/30",
                  selectedDecision === entry.id && "bg-amber-300/12"
                )}
              >
                <span className="text-[11px] font-semibold uppercase tracking-[.14em] text-muted-foreground">
                  {entry.id} · {entry.state}
                </span>
                <strong className="mt-2 block text-sm leading-5">
                  {entry.title}
                </strong>
              </button>
            ))}
          </div>
          {decision && (
            <div className="min-w-0 rounded-3xl bg-muted/35 p-5">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone="positive">{decision.state}</Badge>
                <span className="text-xs text-muted-foreground">
                  {decision.releaseIds.length > 0
                    ? `${decision.releaseIds.length} linked release`
                    : "Release link pending"}
                </span>
              </div>
              <h3 className="mt-4 text-xl font-semibold">{decision.title}</h3>
              <p className="mt-3 text-sm leading-6 text-muted-foreground">
                {decision.decision}
              </p>
              <div className="mt-5 space-y-2">
                {decision.consequences.map((consequence) => (
                  <div
                    key={consequence}
                    className="flex gap-3 text-sm leading-5"
                  >
                    <CheckCircle
                      className="mt-0.5 shrink-0 text-emerald-600 dark:text-emerald-300"
                      weight="fill"
                    />
                    <span>{consequence}</span>
                  </div>
                ))}
              </div>
              <a
                href={`https://github.com/opefyre/freeloader-coder/blob/main/${decision.sourcePath}`}
                target="_blank"
                rel="noreferrer"
                className="mt-6 inline-flex items-center gap-2 text-sm font-semibold hover:text-primary"
              >
                Read source decision <ArrowSquareOut />
              </a>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>Continuity map</CardTitle>
            <CardDescription>
              No release depends on one undocumented account.
            </CardDescription>
          </CardHeader>
          <CardContent className="mt-5 space-y-3">
            {governancePolicy.roles.map((role) => (
              <div key={role.id} className="rounded-2xl bg-muted/45 p-4">
                <div className="flex items-center justify-between gap-3">
                  <strong className="text-sm">{role.title}</strong>
                  <Badge>{role.activeHolder ?? "Vacant by declaration"}</Badge>
                </div>
                <p className="mt-2 text-xs leading-5 text-muted-foreground">
                  Fallback:{" "}
                  {governancePolicy.roles.find(
                    (candidate) => candidate.id === role.fallbackRoleId
                  )?.title ?? "Documented emergency process"}
                </p>
              </div>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="grid grid-cols-2 gap-3 p-5">
            <MiniMetric
              icon={GitCommit}
              label="Release-linked"
              value={`${assessment.releaseLinkedDecisions}/${decisions.length}`}
            />
            <MiniMetric
              icon={UsersThree}
              label="Fallbacks"
              value={String(assessment.documentedFallbacks)}
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function SupplyView({
  assessment,
  checks,
  breakProvenance,
  repairProvenance,
}: {
  assessment: ReturnType<typeof verifySupplyChain>;
  checks: readonly SupplyChainCheck[];
  breakProvenance: () => void;
  repairProvenance: () => void;
}) {
  return (
    <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(20rem,.75fr)]">
      <Card className="min-w-0">
        <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle>Release firewall</CardTitle>
            <CardDescription>
              Required evidence fails closed when a protected fact is missing,
              stale, or mismatched.
            </CardDescription>
          </div>
          <Badge tone={assessment.promotable ? "positive" : "critical"}>
            {assessment.promotable ? "Promotion eligible" : "Promotion blocked"}
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
                <span className="grid size-9 place-items-center rounded-2xl bg-background/65">
                  {check.state === "passed" ? (
                    <ShieldCheck className="text-emerald-600 dark:text-emerald-300" weight="fill" />
                  ) : (
                    <Warning className="text-rose-600 dark:text-rose-300" weight="fill" />
                  )}
                </span>
                <Badge tone={check.state === "passed" ? "positive" : "critical"}>
                  {check.state}
                </Badge>
              </div>
              <strong className="mt-5 block text-sm">{check.label}</strong>
              <p className="mt-2 text-xs leading-5 text-muted-foreground">
                {check.state === "passed"
                  ? check.evidenceRef
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
              {assessment.promotable ? "Evidence intact" : "Release stopped"}
            </CardTitle>
            <CardDescription>
              Deliberately break provenance to prove the gate reacts.
            </CardDescription>
          </CardHeader>
          <CardContent className="mt-5">
            <div
              className={cn(
                "rounded-3xl p-5",
                assessment.promotable
                  ? "bg-emerald-400/[.07]"
                  : "bg-rose-400/[.09]"
              )}
              aria-live="polite"
            >
              <strong className="text-sm">{assessment.action}</strong>
              <p className="mt-2 text-xs leading-5 text-muted-foreground">
                {assessment.promotable
                  ? "All required checks have current evidence."
                  : "The candidate remains local and cannot advance."}
              </p>
            </div>
            <Button
              className="mt-4 w-full"
              variant={assessment.promotable ? "secondary" : "default"}
              onClick={
                assessment.promotable ? breakProvenance : repairProvenance
              }
            >
              {assessment.promotable
                ? "Simulate provenance mismatch"
                : "Restore verified fixture"}
            </Button>
            <p className="mt-3 text-center text-[11px] leading-4 text-muted-foreground">
              Simulation only. No package, release, CI run, or deployment is
              created.
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="space-y-4 p-5">
            <SourceFact label="Source commit" value="89f0827" />
            <SourceFact label="Lockfile" value="sha256:4444…4444" />
            <SourceFact label="Evidence task" value="PIPE-172" />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function PrivacyView({
  privacy,
  enabledFlows,
  note,
  toggleConsent,
}: {
  privacy: PrivacyPreferences;
  enabledFlows: readonly DataFlow[];
  note: string;
  toggleConsent: (action: Parameters<typeof changeConsent>[1]) => void;
}) {
  return (
    <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(21rem,.85fr)]">
      <Card className="min-w-0">
        <CardHeader>
          <CardTitle>Data journey</CardTitle>
          <CardDescription>
            Every declared flow names its data, destination, purpose, retention,
            and deletion behavior.
          </CardDescription>
        </CardHeader>
        <CardContent className="mt-6 space-y-3">
          {dataFlows.map((flow, index) => {
            const enabled = enabledFlows.some((entry) => entry.id === flow.id);
            return (
              <div
                key={flow.id}
                className="grid gap-4 rounded-3xl bg-muted/40 p-5 md:grid-cols-[2.5rem_minmax(0,1fr)_auto] md:items-center"
              >
                <span className="grid size-10 place-items-center rounded-2xl bg-background">
                  {index === 0 ? (
                    <LockSimple />
                  ) : index === 1 ? (
                    <Eye />
                  ) : index === 2 ? (
                    <TreeStructure />
                  ) : (
                    <FileText />
                  )}
                </span>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <strong className="text-sm">
                      {flow.category.replaceAll("_", " ")}
                    </strong>
                    <Badge tone={enabled ? "positive" : "neutral"}>
                      {enabled ? "Allowed" : "Off"}
                    </Badge>
                  </div>
                  <p className="mt-2 text-xs leading-5 text-muted-foreground">
                    {flow.data.join(", ")} → {flow.destination}
                  </p>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    {flow.retention} ·{" "}
                    {flow.deletionSupported
                      ? "deletion supported"
                      : "provider retention applies"}
                  </p>
                </div>
                <span className="text-xs font-semibold text-muted-foreground">
                  {flow.containsSecrets ? "Secrets possible" : "No secrets"}
                </span>
              </div>
            );
          })}
        </CardContent>
      </Card>

      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>Your test-pipeline consent</CardTitle>
            <CardDescription>
              Clear, reversible choices. No option is visually pressured.
            </CardDescription>
          </CardHeader>
          <CardContent className="mt-5 space-y-3">
            <ConsentToggle
              label="Optional product telemetry"
              note="Anonymous feature, outcome, and error-class signals."
              enabled={privacy.optionalTelemetry}
              onToggle={() =>
                toggleConsent(
                  privacy.optionalTelemetry
                    ? "disable_telemetry"
                    : "enable_telemetry"
                )
              }
            />
            <ConsentToggle
              label="Training-eligible free AI"
              note="Non-sensitive test data may use eligible free routes."
              enabled={privacy.thirdPartyTrainingEligible}
              onToggle={() =>
                toggleConsent(
                  privacy.thirdPartyTrainingEligible
                    ? "deny_training"
                    : "allow_training"
                )
              }
            />
            <ConsentToggle
              label="Support diagnostics"
              note="Prepare a redacted local bundle only when requested."
              enabled={privacy.supportDiagnostics}
              onToggle={() =>
                toggleConsent(
                  privacy.supportDiagnostics
                    ? "disable_support"
                    : "enable_support"
                )
              }
            />
            <div className="flex items-center justify-between rounded-2xl bg-amber-300/12 p-4">
              <div>
                <strong className="text-sm">Paid usage</strong>
                <p className="mt-1 text-xs text-muted-foreground">
                  Cannot be enabled from this demo.
                </p>
              </div>
              <Badge tone="caution">Locked off</Badge>
            </div>
          </CardContent>
        </Card>
        <div
          className="rounded-3xl bg-amber-300/12 p-5 text-sm leading-6"
          aria-live="polite"
        >
          {note}
        </div>
      </div>
    </div>
  );
}

function supplyCheck(
  id: string,
  category: SupplyChainCheck["category"],
  label: string,
  remediation: string
): SupplyChainCheck {
  return {
    schemaVersion: 1,
    id,
    category,
    label,
    required: true,
    state: "passed",
    observedAt: "2026-07-28T20:25:00.000Z",
    evidenceRef: `evidence://${id}/verified`,
    remediation,
  };
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

function MiniMetric({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof GitCommit;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-2xl bg-muted/45 p-4">
      <Icon className="text-amber-700 dark:text-amber-300" />
      <strong className="mt-4 block text-xl">{value}</strong>
      <span className="mt-1 block text-xs text-muted-foreground">{label}</span>
    </div>
  );
}

function SourceFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <strong className="text-right">{value}</strong>
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
      className="group flex items-center justify-between gap-4 rounded-2xl bg-muted/45 p-4 outline-none transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/30"
    >
      <span>
        <span className="block text-[10px] font-semibold uppercase tracking-[.14em] text-muted-foreground">
          {label}
        </span>
        <strong className="mt-2 block text-sm">{value}</strong>
      </span>
      <ArrowRight className="shrink-0 transition-transform group-hover:translate-x-0.5" />
    </a>
  );
}

function ConsentToggle({
  label,
  note,
  enabled,
  onToggle,
}: {
  label: string;
  note: string;
  enabled: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      onClick={onToggle}
      className="flex w-full items-center justify-between gap-4 rounded-2xl bg-muted/45 p-4 text-left outline-none transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/30"
    >
      <span>
        <strong className="block text-sm">{label}</strong>
        <span className="mt-1 block text-xs leading-5 text-muted-foreground">
          {note}
        </span>
      </span>
      <span
        className={cn(
          "relative h-7 w-12 shrink-0 rounded-full p-1 transition-colors",
          enabled ? "bg-amber-400" : "bg-foreground/15"
        )}
      >
        <span
          className={cn(
            "block size-5 rounded-full bg-background shadow-sm transition-transform",
            enabled && "translate-x-5"
          )}
        />
      </span>
    </button>
  );
}
