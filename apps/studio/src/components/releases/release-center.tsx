import { Archive } from "@phosphor-icons/react/Archive";
import { ArrowClockwise } from "@phosphor-icons/react/ArrowClockwise";
import { ArrowCounterClockwise } from "@phosphor-icons/react/ArrowCounterClockwise";
import { ArrowRight } from "@phosphor-icons/react/ArrowRight";
import { Check } from "@phosphor-icons/react/Check";
import { CheckCircle } from "@phosphor-icons/react/CheckCircle";
import { ClockCountdown } from "@phosphor-icons/react/ClockCountdown";
import { Copy } from "@phosphor-icons/react/Copy";
import { Desktop } from "@phosphor-icons/react/Desktop";
import { GithubLogo } from "@phosphor-icons/react/GithubLogo";
import { HardDrive } from "@phosphor-icons/react/HardDrive";
import { LinkSimple } from "@phosphor-icons/react/LinkSimple";
import { MagnifyingGlass } from "@phosphor-icons/react/MagnifyingGlass";
import { Package } from "@phosphor-icons/react/Package";
import { RocketLaunch } from "@phosphor-icons/react/RocketLaunch";
import { ShieldCheck } from "@phosphor-icons/react/ShieldCheck";
import { Siren } from "@phosphor-icons/react/Siren";
import { Warning } from "@phosphor-icons/react/Warning";
import { useMemo, useState } from "react";

import {
  buildReleaseNotes,
  evaluateCompatibility,
  evaluatePromotion,
  incidentAction,
  inspectUpdate,
  transitionUpdate,
  verifyReleaseManifest,
  type CompatibilityDimension,
  type CompatibilityEntry,
  type ReleaseArtifact,
  type ReleaseManifest,
  type UpdatePlan,
  type UpdateStage,
} from "../../../../../packages/releases/src/index.js";
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

const artifactKinds: readonly ReleaseArtifact["kind"][] = [
  "source",
  "lockfile",
  "schema",
  "sbom",
  "provenance",
  "checksums",
];
const artifactDigest = `sha256:${"a".repeat(64)}`;

const releaseManifest: ReleaseManifest = {
  schemaVersion: 1,
  releaseId: "release-0.8.0-beta.2",
  version: "0.8.0-beta.2",
  commit: "db1d6cf",
  channel: "beta",
  createdAt: "2026-07-28T20:05:00.000Z",
  sourceDateEpoch: 1_775_000_000,
  artifacts: artifactKinds.map((kind, index) => ({
    name: `${kind}-${index + 1}.json`,
    kind,
    digest: artifactDigest,
    sizeBytes: 2_048 + index * 512,
  })),
  requiredChecks: ["typecheck", "tests", "build", "security", "compatibility", "rollback"],
  passedChecks: ["typecheck", "tests", "build", "security", "compatibility", "rollback"],
  signer: "Codkesh local release owner",
  signatureVerified: true,
  previousCompatibleVersion: "0.7.3",
};

const compatibilityEntries: readonly CompatibilityEntry[] = [
  compatibility("macos-arm64", "operating_system", "macOS · Apple silicon", "14+", "supported", "Native runtime, vault, preview, and worker checks passed.", "https://support.apple.com/macos"),
  compatibility("macos-intel", "operating_system", "macOS · Intel", "13+", "experimental", "Core workflows pass; local-model performance remains unproven.", "https://support.apple.com/macos", "Use an external free provider for model work."),
  compatibility("windows-x64", "operating_system", "Windows · x64", "11+", "experimental", "Setup and Node workflows pass; vault parity remains in review.", "https://learn.microsoft.com/windows/"),
  compatibility("linux-x64", "operating_system", "Linux · x64", "Ubuntu 24.04+", "supported", "Core runtime, Git, validation, and secure fallback passed.", "https://ubuntu.com/"),
  compatibility("node-22", "runtime", "Node.js", "22.x", "supported", "Repository and clean-environment verification passed.", "https://nodejs.org/"),
  compatibility("node-20", "runtime", "Node.js", "20.x", "blocked", "Required permission and SQLite contracts target Node.js 22.", "https://nodejs.org/", "Install Node.js 22, then rerun setup."),
  compatibility("groq-free", "provider", "Groq", "free account", "supported", "Connection, quota, fallback, and redaction canaries passed.", "https://console.groq.com/docs/"),
  compatibility("gemini-free", "provider", "Gemini API", "free project", "supported", "Free-project evidence and paid-route denial passed.", "https://ai.google.dev/"),
  compatibility("gpt-oss-120b", "model", "GPT-OSS 120B", "coding + review", "supported", "Structured output and coding canaries passed on eligible routes.", "https://console.groq.com/docs/models"),
  compatibility("jira-cloud", "connector", "Jira Cloud", "OAuth/API token", "supported", "Selection, grounding, status, and comment contracts passed.", "https://developer.atlassian.com/cloud/jira/platform/"),
  compatibility("github-app", "connector", "GitHub", "App/PAT", "supported", "Repository selection, publishing, and idempotency passed.", "https://docs.github.com/"),
  compatibility("nextjs", "project_type", "Next.js", "14–16", "supported", "Detection, package commands, build, and preview passed.", "https://nextjs.org/docs"),
  compatibility("xcode", "project_type", "Native Xcode", "16+", "experimental", "Inspection is supported; builds require a compatible macOS worker.", "https://developer.apple.com/xcode/", "Pair a compatible macOS worker."),
] as const;

const baseUpdate: UpdatePlan = {
  schemaVersion: 1,
  updateId: "update-0.8.0-beta.2",
  fromVersion: "0.7.3",
  toVersion: "0.8.0-beta.2",
  stage: "available",
  projectCheckpointId: null,
  databaseBackupId: null,
  activeWorkCount: 0,
  compatibilityState: "supported",
  migrations: ["Schema journal v4 → v5", "Provider evidence index rebuild"],
  changedFiles: ["package-lock.json", "packages/schemas", "packages/providers"],
  requiredDiskBytes: 1_200_000_000,
  availableDiskBytes: 41_000_000_000,
  signatureVerified: true,
  rollbackVersion: "0.7.3",
  lastVerifiedStage: "available",
  interruptionObserved: false,
};

const rolloutPlan = {
  schemaVersion: 1 as const,
  releaseId: "release-0.8.0-beta.2",
  stage: "canary" as const,
  cohortPercent: 10,
  minimumCanaryHours: 24,
  observedCanaryHours: 31,
  totalUpdates: 24,
  failedUpdates: 0,
  rollbackExercisesPassed: true,
  criticalIncidents: 0,
  evidenceCurrent: true,
};

const rolloutStages = [
  { id: "draft", label: "Draft", note: "Manifest" },
  { id: "canary", label: "Canary", note: "10% · 31h" },
  { id: "beta", label: "Beta", note: "25%" },
  { id: "stable", label: "Stable", note: "100%" },
] as const;

const dimensions: readonly { id: "all" | CompatibilityDimension; label: string }[] = [
  { id: "all", label: "All" },
  { id: "operating_system", label: "Systems" },
  { id: "runtime", label: "Runtimes" },
  { id: "provider", label: "Providers" },
  { id: "model", label: "Models" },
  { id: "connector", label: "Connectors" },
  { id: "project_type", label: "Projects" },
];

export function ReleaseCenter() {
  const [dimension, setDimension] = useState<"all" | CompatibilityDimension>("all");
  const [query, setQuery] = useState("");
  const [selectedCompatibility, setSelectedCompatibility] = useState("macos-arm64");
  const [update, setUpdate] = useState<UpdatePlan>(baseUpdate);
  const [incidentOpen, setIncidentOpen] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const verification = verifyReleaseManifest(releaseManifest);
  const promotion = evaluatePromotion(rolloutPlan);
  const updateDecision = inspectUpdate(update);
  const filteredCompatibility = useMemo(() => {
    const term = query.trim().toLowerCase();
    return compatibilityEntries.filter(
      (entry) =>
        (dimension === "all" || entry.dimension === dimension) &&
        (!term ||
          `${entry.name} ${entry.constraint} ${entry.state} ${entry.reason}`
            .toLowerCase()
            .includes(term))
    );
  }, [dimension, query]);
  const selected =
    compatibilityEntries.find((entry) => entry.id === selectedCompatibility) ??
    compatibilityEntries[0];
  const selectedDecision = selected
    ? evaluateCompatibility(selected, "2026-07-28T20:05:00.000Z")
    : undefined;
  const incident = incidentAction({
    schemaVersion: 1,
    incidentId: "incident-canary-update",
    releaseId: releaseManifest.releaseId,
    severity: incidentOpen ? "high" : "low",
    scope: "update",
    state: incidentOpen ? "open" : "resolved",
    summary: incidentOpen
      ? "Canary update verification exceeded its safe window."
      : "Canary rollout is healthy.",
    duplicateEffects: 0,
    dataIntegrityPreserved: true,
    rollbackAvailable: true,
  });
  const notes = buildReleaseNotes({
    version: releaseManifest.version,
    highlights: [
      "Offline product-aware Help Center",
      "Expanded verified free-provider mesh",
      "Safe release and update lifecycle",
    ],
    migrations: [...baseUpdate.migrations],
    compatibilityChanges: [
      "Node.js 22 is the supported runtime.",
      "Native Xcode projects require a compatible macOS worker.",
    ],
    knownLimitations: [
      "GitHub Actions and automated deployment remain disabled.",
      "Windows vault parity is experimental.",
    ],
    rollbackVersion: baseUpdate.rollbackVersion,
  });

  function continueUpdate() {
    const sequence: readonly UpdateStage[] = [
      "preflight",
      "checkpointed",
      "migration_preview",
      "applying",
      "verifying",
      "complete",
    ];
    const next = sequence[sequence.indexOf(update.stage) + 1];
    if (!next) return;
    let current = update;
    if (next === "checkpointed") {
      current = {
        ...current,
        projectCheckpointId: "checkpoint-before-0.8.0",
        databaseBackupId: "backup-before-0.8.0",
      };
    }
    setUpdate(transitionUpdate(current, next));
  }

  function simulateInterruption() {
    setUpdate({
      ...baseUpdate,
      stage: "applying",
      projectCheckpointId: "checkpoint-before-0.8.0",
      databaseBackupId: "backup-before-0.8.0",
      interruptionObserved: true,
    });
  }

  function restoreUpdate() {
    const ready =
      update.stage === "rollback_ready"
        ? update
        : transitionUpdate({ ...update, interruptionObserved: false }, "rollback_ready");
    setUpdate(transitionUpdate(transitionUpdate(ready, "rolling_back"), "restored"));
  }

  async function copyNotes() {
    await navigator.clipboard.writeText(notes);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1_800);
  }

  return (
    <section aria-labelledby="release-center-title" className="space-y-4">
      <Card className="relative isolate bg-foreground text-background">
        <div aria-hidden="true" className="absolute -right-16 -top-24 size-72 rounded-full bg-primary/20 blur-3xl" />
        <CardContent className="relative grid gap-7 py-7 sm:py-9 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
          <div>
            <div className="flex flex-wrap gap-2">
              <Badge className="bg-background/10 text-background">
                <Package weight="fill" />
                Candidate {releaseManifest.version}
              </Badge>
              <Badge className="bg-emerald-400/15 text-emerald-300">
                <ShieldCheck weight="fill" />
                Locally verified
              </Badge>
            </div>
            <h2 id="release-center-title" className="mt-5 max-w-3xl text-3xl font-semibold tracking-[-0.045em] sm:text-4xl">
              Ship deliberately. Update without fear.
            </h2>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-background/65">
              Reproducible artifacts, compatibility truth, preservation-first updates,
              and rollout gates—without enabling deployment automation.
            </p>
          </div>
          <div className="grid grid-cols-3 gap-2 lg:w-80">
            <HeroMetric value="6/6" label="Artifacts" />
            <HeroMetric value="0%" label="Failures" />
            <HeroMetric value="0.7.3" label="Rollback" />
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(20rem,.75fr)]">
        <Card>
          <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <CardTitle>Release chain of custody</CardTitle>
              <CardDescription>
                Every artifact is digest-bound to one source commit and reproducible timestamp.
              </CardDescription>
            </div>
            <Badge tone={verification.releasable ? "positive" : "critical"}>
              {verification.releasable ? "All gates passed" : "Release blocked"}
            </Badge>
          </CardHeader>
          <CardContent className="mt-6">
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {releaseManifest.artifacts.map((artifact) => (
                <button
                  key={artifact.kind}
                  type="button"
                  className="flex items-center gap-3 rounded-3xl bg-muted/45 p-4 text-left outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/30"
                  title={artifact.digest}
                >
                  <span className="grid size-9 place-items-center rounded-2xl bg-emerald-400/10 text-emerald-400">
                    <CheckCircle size={18} weight="fill" />
                  </span>
                  <span className="min-w-0">
                    <strong className="block truncate text-sm capitalize">{artifact.kind}</strong>
                    <span className="mt-1 block truncate text-[11px] text-muted-foreground">
                      {artifact.digest.slice(7, 19)}… · {(artifact.sizeBytes / 1024).toFixed(1)} KB
                    </span>
                  </span>
                </button>
              ))}
            </div>
            <div className="mt-5 grid gap-3 rounded-3xl bg-muted/45 p-4 sm:grid-cols-3">
              <ReleaseFact label="Source commit" value={releaseManifest.commit} />
              <ReleaseFact label="Manifest digest" value={`${verification.manifestDigest.slice(7, 19)}…`} />
              <ReleaseFact label="Reproducible epoch" value={String(releaseManifest.sourceDateEpoch)} />
            </div>
            <div className="mt-5 flex flex-wrap gap-2">
              <a href="https://github.com/opefyre/freeloader-coder/commit/db1d6cf" target="_blank" rel="noreferrer" className="inline-flex h-9 items-center gap-2 rounded-full bg-secondary px-4 text-sm font-medium hover:bg-secondary/75">
                <GithubLogo weight="fill" />
                Source commit
              </a>
              <a href="https://opefyre.atlassian.net/browse/PIPE-97" target="_blank" rel="noreferrer" className="inline-flex h-9 items-center gap-2 rounded-full bg-secondary px-4 text-sm font-medium hover:bg-secondary/75">
                PIPE-97
                <LinkSimple />
              </a>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Rollout control</CardTitle>
            <CardDescription>
              Promotion is earned by observation, not a schedule alone.
            </CardDescription>
          </CardHeader>
          <CardContent className="mt-6">
            <div className="space-y-2">
              {rolloutStages.map((stage, index) => {
                const active = stage.id === rolloutPlan.stage;
                const complete = index < rolloutStages.findIndex((item) => item.id === rolloutPlan.stage);
                return (
                  <div key={stage.id} className={cn("flex items-center gap-3 rounded-3xl bg-muted/45 p-3.5", active && "bg-primary/[.1]")}>
                    <span className={cn("grid size-8 place-items-center rounded-full bg-background text-xs font-semibold", complete && "bg-emerald-500 text-white", active && "bg-primary text-primary-foreground")}>
                      {complete ? <Check weight="bold" /> : index + 1}
                    </span>
                    <span className="min-w-0 flex-1">
                      <strong className="block text-sm">{stage.label}</strong>
                      <span className="block text-xs text-muted-foreground">{stage.note}</span>
                    </span>
                    {active && <Badge tone="active">Active</Badge>}
                  </div>
                );
              })}
            </div>
            <div className="mt-4 rounded-3xl bg-emerald-400/[.07] p-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold">Promotion readiness</span>
                <strong className="text-lg">{promotion.allowed ? "Ready" : "Blocked"}</strong>
              </div>
              <p className="mt-2 text-xs leading-5 text-muted-foreground">
                31h observed · 24 updates · 0 failures · rollback exercise passed.
              </p>
            </div>
            <Button className="mt-4 w-full" disabled={!promotion.allowed || incidentOpen}>
              <RocketLaunch weight="fill" />
              Preview beta promotion
            </Button>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle>Guided update</CardTitle>
            <CardDescription>
              Project checkpoint, database backup, migration preview, verification, and rollback remain one recoverable flow.
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge tone={update.stage === "complete" ? "positive" : update.stage === "restored" ? "caution" : "active"}>
              {formatStage(update.stage)}
            </Badge>
            <a href="https://opefyre.atlassian.net/browse/PIPE-98" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-xs font-semibold text-primary hover:underline">
              PIPE-98 <LinkSimple />
            </a>
          </div>
        </CardHeader>
        <CardContent className="mt-6">
          <UpdateTimeline stage={update.stage} />
          <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,.55fr)]">
            <div className="rounded-3xl bg-muted/45 p-5">
              <div className="flex items-center gap-3">
                <span className="grid size-10 place-items-center rounded-2xl bg-primary/10 text-primary">
                  {update.stage === "restored" ? <ArrowCounterClockwise size={20} /> : <ArrowClockwise size={20} />}
                </span>
                <div>
                  <strong className="text-sm">{updateDecision.action}</strong>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {update.fromVersion} → {update.toVersion} · 41 GB free · 1.2 GB reserved
                  </p>
                </div>
              </div>
              {updateDecision.blockers.length > 0 && (
                <div className="mt-4 rounded-2xl bg-amber-400/[.08] p-3 text-xs text-muted-foreground">
                  {updateDecision.blockers.join(" ")}
                </div>
              )}
              <div className="mt-5 flex flex-wrap gap-2">
                <Button disabled={update.stage === "complete" || update.stage === "restored" || update.interruptionObserved} onClick={continueUpdate}>
                  <ArrowRight />
                  {update.stage === "available" ? "Run update preflight" : update.stage === "verifying" ? "Finish verified update" : "Continue safely"}
                </Button>
                <Button variant="secondary" disabled={["complete", "restored"].includes(update.stage)} onClick={simulateInterruption}>
                  <Warning />
                  Simulate interruption
                </Button>
                {updateDecision.nextStage === "rollback_ready" && (
                  <Button variant="destructive" onClick={restoreUpdate}>
                    <ArrowCounterClockwise />
                    Restore {update.rollbackVersion}
                  </Button>
                )}
                {(update.stage === "complete" || update.stage === "restored") && (
                  <Button variant="secondary" onClick={() => setUpdate(baseUpdate)}>
                    Reset demo
                  </Button>
                )}
              </div>
            </div>
            <div className="rounded-3xl bg-emerald-400/[.07] p-5">
              <strong className="text-sm">Preservation ledger</strong>
              <div className="mt-4 space-y-3">
                <PreservationFact icon={HardDrive} label="Projects" value={update.projectCheckpointId ?? "Checkpoint pending"} />
                <PreservationFact icon={Archive} label="Database" value={update.databaseBackupId ?? "Backup pending"} />
                <PreservationFact icon={ShieldCheck} label="Credentials" value="Vault untouched" />
                <PreservationFact icon={ArrowCounterClockwise} label="Rollback" value={update.rollbackVersion} />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle>Compatibility truth</CardTitle>
            <CardDescription>
              Search current evidence before installing, connecting, or relying on a capability.
            </CardDescription>
          </div>
          <a href="https://opefyre.atlassian.net/browse/PIPE-99" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-xs font-semibold text-primary hover:underline">
            PIPE-99 <LinkSimple />
          </a>
        </CardHeader>
        <CardContent className="mt-6">
          <div className="grid gap-3 lg:grid-cols-[minmax(18rem,.6fr)_minmax(0,1.4fr)]">
            <div>
              <label className="flex items-center gap-2 rounded-2xl bg-muted px-3.5 py-3">
                <MagnifyingGlass className="text-muted-foreground" />
                <span className="sr-only">Search compatibility</span>
                <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search systems, providers, projects…" className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground" />
              </label>
              <div className="mt-3 flex gap-2 overflow-x-auto pb-2">
                {dimensions.map((item) => (
                  <button key={item.id} type="button" aria-pressed={dimension === item.id} onClick={() => setDimension(item.id)} className={cn("shrink-0 rounded-full bg-muted px-3 py-1.5 text-xs font-semibold text-muted-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/30", dimension === item.id && "bg-primary text-primary-foreground")}>
                    {item.label}
                  </button>
                ))}
              </div>
              <div className="mt-3 max-h-96 space-y-2 overflow-auto pr-1">
                {filteredCompatibility.map((entry) => (
                  <button key={entry.id} type="button" aria-pressed={selectedCompatibility === entry.id} onClick={() => setSelectedCompatibility(entry.id)} className={cn("flex w-full items-center gap-3 rounded-3xl bg-muted/45 p-3.5 text-left outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/30", selectedCompatibility === entry.id && "bg-primary/[.09]")}>
                    <CompatibilityDot state={entry.state} />
                    <span className="min-w-0 flex-1">
                      <strong className="block truncate text-sm">{entry.name}</strong>
                      <span className="block truncate text-xs text-muted-foreground">{entry.constraint}</span>
                    </span>
                    <Badge tone={entry.state === "supported" ? "positive" : entry.state === "experimental" ? "caution" : "critical"}>{entry.state}</Badge>
                  </button>
                ))}
              </div>
            </div>
            {selected && selectedDecision && (
              <div className="rounded-4xl bg-foreground p-6 text-background">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <Badge className={selectedDecision.state === "supported" ? "bg-emerald-400/15 text-emerald-300" : "bg-amber-400/15 text-amber-300"}>
                      {selectedDecision.state}
                    </Badge>
                    <h3 className="mt-4 text-2xl font-semibold">{selected.name}</h3>
                    <p className="mt-1 text-sm text-background/55">{selected.constraint}</p>
                  </div>
                  <span className="grid size-12 place-items-center rounded-2xl bg-background/10 text-primary">
                    {selected.dimension === "operating_system" ? <Desktop size={23} /> : <ShieldCheck size={23} />}
                  </span>
                </div>
                <p className="mt-7 max-w-2xl text-sm leading-6 text-background/75">
                  {selectedDecision.explanation}
                </p>
                {selectedDecision.alternative && (
                  <div className="mt-4 rounded-3xl bg-background/10 p-4 text-xs leading-5 text-background/65">
                    <strong className="text-background">Safe alternative</strong>
                    <p className="mt-1">{selectedDecision.alternative}</p>
                  </div>
                )}
                <div className="mt-7 grid gap-3 sm:grid-cols-3">
                  <DarkFact label="Evidence owner" value={selected.owner} />
                  <DarkFact label="Verified" value={selected.verifiedAt?.slice(0, 10) ?? "Never"} />
                  <DarkFact label="Review by" value={selected.reviewAfter.slice(0, 10)} />
                </div>
                <a href={selected.sourceUrl} target="_blank" rel="noreferrer" className="mt-6 inline-flex h-9 items-center gap-2 rounded-full bg-background/10 px-4 text-sm font-medium hover:bg-background/15">
                  Official source <LinkSimple />
                </a>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-4">
            <div>
              <CardTitle>Incident rehearsal</CardTitle>
              <CardDescription>
                Contain rollout, preserve evidence, and prove rollback before a real incident.
              </CardDescription>
            </div>
            <span className={cn("grid size-11 place-items-center rounded-2xl", incidentOpen ? "bg-destructive/15 text-destructive" : "bg-emerald-400/10 text-emerald-400")}>
              <Siren size={22} weight="duotone" />
            </span>
          </CardHeader>
          <CardContent className="mt-6">
            <div className={cn("rounded-3xl p-5", incidentOpen ? "bg-destructive/[.07]" : "bg-emerald-400/[.07]")}>
              <div className="flex items-center justify-between gap-3">
                <strong>{incidentOpen ? "Canary rollout paused" : "No open release incident"}</strong>
                <Badge tone={incidentOpen ? "critical" : "positive"}>{incidentOpen ? "High" : "Healthy"}</Badge>
              </div>
              <p className="mt-2 text-xs leading-5 text-muted-foreground">{incident.action}</p>
              <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                <MiniFact value={incident.pauseRollout ? "Yes" : "No"} label="Pause" />
                <MiniFact value={incident.rollbackRecommended ? "Yes" : "No"} label="Rollback" />
                <MiniFact value={incident.releaseBlocked ? "Yes" : "No"} label="Blocked" />
              </div>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button variant={incidentOpen ? "secondary" : "destructive"} onClick={() => setIncidentOpen((value) => !value)}>
                {incidentOpen ? <CheckCircle /> : <Siren />}
                {incidentOpen ? "Resolve rehearsal" : "Run incident rehearsal"}
              </Button>
              <a href="https://opefyre.atlassian.net/browse/PIPE-101" target="_blank" rel="noreferrer" className="inline-flex h-9 items-center gap-2 rounded-full bg-secondary px-4 text-sm font-medium hover:bg-secondary/75">
                PIPE-101 <LinkSimple />
              </a>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-4">
            <div>
              <CardTitle>Release notes</CardTitle>
              <CardDescription>
                Migration, compatibility, limitations, and rollback stay attached to the version.
              </CardDescription>
            </div>
            <Button variant="secondary" size="sm" onClick={() => setNotesOpen((value) => !value)}>
              {notesOpen ? "Hide" : "Preview"}
            </Button>
          </CardHeader>
          <CardContent className="mt-6">
            {notesOpen ? (
              <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-3xl bg-muted/45 p-5 font-sans text-xs leading-6 text-muted-foreground">{notes}</pre>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2">
                <NoteFact label="Highlights" value="3" />
                <NoteFact label="Migrations" value="2" />
                <NoteFact label="Compatibility changes" value="2" />
                <NoteFact label="Known limitations" value="2" />
              </div>
            )}
            <div className="mt-4 flex flex-wrap gap-2">
              <Button disabled={!notesOpen} onClick={copyNotes}>
                {copied ? <Check /> : <Copy />}
                {copied ? "Copied" : "Copy release notes"}
              </Button>
              <a href="https://github.com/opefyre/freeloader-coder/releases" target="_blank" rel="noreferrer" className="inline-flex h-9 items-center gap-2 rounded-full bg-secondary px-4 text-sm font-medium hover:bg-secondary/75">
                <GithubLogo weight="fill" />
                GitHub releases
              </a>
            </div>
          </CardContent>
        </Card>
      </div>

      <p className="text-center text-xs text-muted-foreground">
        Interactive demo · no tag, release, update, rollout, issue, or deployment is created.
      </p>
    </section>
  );
}

function compatibility(
  id: string,
  dimension: CompatibilityDimension,
  name: string,
  constraint: string,
  state: CompatibilityEntry["state"],
  reason: string,
  sourceUrl: string,
  alternative: string | null = null
): CompatibilityEntry {
  return {
    schemaVersion: 1,
    id,
    dimension,
    name,
    constraint,
    state,
    reason,
    alternative,
    verifiedAt: "2026-07-28T19:30:00.000Z",
    reviewAfter: "2026-08-28T19:30:00.000Z",
    sourceUrl,
    owner: "Release Engineering",
  };
}

function HeroMetric({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-3xl bg-background/10 p-4 text-center">
      <strong className="block text-xl font-semibold text-primary">{value}</strong>
      <span className="mt-1 block text-[10px] font-semibold uppercase tracking-[0.14em] text-background/50">{label}</span>
    </div>
  );
}

function ReleaseFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <span className="block text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{label}</span>
      <strong className="mt-1 block truncate text-sm">{value}</strong>
    </div>
  );
}

function UpdateTimeline({ stage }: { stage: UpdateStage }) {
  const visibleStages = [
    { id: "preflight", label: "Preflight" },
    { id: "checkpointed", label: "Preserve" },
    { id: "migration_preview", label: "Preview" },
    { id: "applying", label: "Apply" },
    { id: "verifying", label: "Verify" },
    { id: "complete", label: "Complete" },
  ] as const;
  const activeIndex = stage === "available" ? -1 : visibleStages.findIndex((item) => item.id === stage);
  const recovery = ["rollback_ready", "rolling_back", "restored", "needs_user"].includes(stage);
  return (
    <ol className="grid gap-2 sm:grid-cols-3 xl:grid-cols-6" aria-label="Update progress">
      {visibleStages.map((item, index) => (
        <li key={item.id} className={cn("rounded-3xl bg-muted/45 p-3", index < activeIndex && "bg-emerald-400/[.07]", index === activeIndex && !recovery && "bg-primary/[.1]", recovery && index >= Math.max(0, activeIndex) && "bg-amber-400/[.07]")}>
          <span className={cn("grid size-7 place-items-center rounded-full bg-background text-xs font-semibold", index < activeIndex && "bg-emerald-500 text-white", index === activeIndex && !recovery && "bg-primary text-primary-foreground")}>
            {index < activeIndex ? <Check weight="bold" /> : index + 1}
          </span>
          <strong className="mt-3 block text-xs">{item.label}</strong>
        </li>
      ))}
    </ol>
  );
}

function PreservationFact({ icon: Icon, label, value }: { icon: typeof HardDrive; label: string; value: string }) {
  return (
    <div className="flex items-center gap-3">
      <Icon className="shrink-0 text-emerald-400" size={18} />
      <span className="min-w-0">
        <span className="block text-[10px] uppercase tracking-[0.12em] text-muted-foreground">{label}</span>
        <strong className="block truncate text-xs">{value}</strong>
      </span>
    </div>
  );
}

function CompatibilityDot({ state }: { state: CompatibilityEntry["state"] }) {
  return <span className={cn("size-2.5 shrink-0 rounded-full", state === "supported" ? "bg-emerald-400" : state === "experimental" ? "bg-amber-400" : "bg-red-400")} />;
}

function DarkFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-background/10 p-3">
      <span className="block text-[10px] uppercase tracking-[0.12em] text-background/45">{label}</span>
      <strong className="mt-1 block truncate text-xs">{value}</strong>
    </div>
  );
}

function MiniFact({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-2xl bg-background/60 p-3">
      <strong className="block text-sm">{value}</strong>
      <span className="mt-1 block text-[10px] uppercase tracking-[0.12em] text-muted-foreground">{label}</span>
    </div>
  );
}

function NoteFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-3xl bg-muted/45 p-4">
      <strong className="text-2xl text-primary">{value}</strong>
      <span className="mt-1 block text-xs text-muted-foreground">{label}</span>
    </div>
  );
}

function formatStage(stage: UpdateStage): string {
  return stage.replaceAll("_", " ");
}
