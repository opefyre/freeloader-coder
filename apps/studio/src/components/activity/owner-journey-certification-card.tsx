import { CheckCircle } from "@phosphor-icons/react/CheckCircle";
import { Flask } from "@phosphor-icons/react/Flask";
import { Warning } from "@phosphor-icons/react/Warning";
import { DownloadSimple } from "@phosphor-icons/react/DownloadSimple";
import { useCallback, useEffect, useState } from "react";

import type {
  OwnerJourneyCertificationSnapshot,
  OwnerPilotCohortReport,
  OwnerPilotReview,
  OwnerPilotSession,
  OwnerPilotSummary,
  OwnerPilotImprovementDraft,
} from "../../../../../packages/runtime/src/owner-journey-certification.js";
import {
  approveOwnerPilotImprovements,
  completeOwnerPilot,
  createOwnerPilot,
  getOwnerPilotReview,
  getOwnerPilotCohortReport,
  getOwnerJourneyCertification,
  listOwnerPilotImprovements,
  listOwnerPilot,
  previewOwnerJourneyCertification,
  previewOwnerPilotImprovements,
  runOwnerJourneyCertification,
  declineOwnerPilotImprovements,
  editOwnerPilotImprovements,
  withdrawOwnerPilot,
  getOwnerCertificationEvidence,
  getOwnerPilotReceipt,
  getOwnerPilotSummary,
  reconcileOwnerPilot,
  ownerCertificationEvidenceFilename,
  ownerPilotCohortReportFilename,
} from "../../owner-journey-certification-client.js";
import { listLocalProjects } from "../../local-project-client.js";
import { Badge } from "../ui/badge.js";
import { Button } from "../ui/button.js";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../ui/card.js";

export function OwnerJourneyCertificationCard({
  endpoint,
}: {
  endpoint: string;
}) {
  const [snapshot, setSnapshot] =
    useState<OwnerJourneyCertificationSnapshot | null>(null);
  const [sessions, setSessions] = useState<readonly OwnerPilotSession[]>([]);
  const [review, setReview] = useState<OwnerPilotReview | null>(null);
  const [cohort, setCohort] = useState<OwnerPilotCohortReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [showLearning, setShowLearning] = useState(false);
  const refresh = useCallback(async () => {
    try {
      const [certification, pilot, pilotReview, cohortReport] =
        await Promise.all([
          getOwnerJourneyCertification(endpoint),
          listOwnerPilot(endpoint),
          getOwnerPilotReview(endpoint),
          getOwnerPilotCohortReport(endpoint),
        ]);
      setSnapshot(certification);
      setSessions(pilot.sessions);
      setReview(pilotReview);
      setCohort(cohortReport);
    } catch {
      setSnapshot(null);
      setReview(null);
      setCohort(null);
    }
  }, [endpoint]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  async function run() {
    setBusy(true);
    setNotice("Running the local journey…");
    try {
      await previewOwnerJourneyCertification(endpoint);
      const result = await runOwnerJourneyCertification(
        endpoint,
        `certification.ui.${Date.now()}`,
      );
      setSnapshot(result.snapshot);
      setNotice("Certification passed. Evidence is stored locally.");
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "Certification did not pass.",
      );
      await refresh();
    } finally {
      setBusy(false);
    }
  }
  async function downloadEvidence() {
    setBusy(true);
    setNotice("Preparing privacy-safe evidence…");
    try {
      const packet = await getOwnerCertificationEvidence(endpoint);
      const url = URL.createObjectURL(new Blob([`${JSON.stringify(packet, null, 2)}\n`], { type: "application/json" }));
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = ownerCertificationEvidenceFilename(packet);
      anchor.click();
      URL.revokeObjectURL(url);
      setNotice("Evidence downloaded. It contains only safe aggregates, digests, states, and receipts.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Evidence could not be prepared. Your current work is unchanged.");
    } finally {
      setBusy(false);
    }
  }
  function downloadCohortReport() {
    if (!cohort) return;
    const url = URL.createObjectURL(
      new Blob([`${JSON.stringify(cohort, null, 2)}\n`], {
        type: "application/json",
      }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = ownerPilotCohortReportFilename(cohort);
    anchor.click();
    URL.revokeObjectURL(url);
    setNotice("Privacy-safe real-pilot cohort report downloaded.");
  }
  const passed = snapshot?.state === "passed";
  const stages = snapshot?.lastPassedReceipt?.stages ?? [];
  const completedLearning = sessions.filter(
    (session) => session.status === "completed",
  ).length;
  return (
    <Card className="overflow-hidden">
      <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex gap-3">
          <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-primary/10 text-primary">
            {passed ? (
              <CheckCircle size={22} weight="duotone" />
            ) : (
              <Flask size={22} weight="duotone" />
            )}
          </span>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle>Owner-journey check</CardTitle>
              <Badge
                tone={
                  passed
                    ? "positive"
                    : snapshot?.state === "failed"
                      ? "caution"
                      : "neutral"
                }
              >
                {snapshot?.state.replace("_", " ") ?? "unavailable"}
              </Badge>
            </div>
            <CardDescription className="mt-1">
              Local, synthetic, and always $0. It never sends project content.
            </CardDescription>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => void downloadEvidence()} disabled={busy} aria-label="Download privacy-safe certification evidence">
            <DownloadSimple aria-hidden="true" /> Evidence
          </Button>
          <Button onClick={() => void run()} disabled={busy}>
            {busy ? "Working…" : passed ? "Run again" : "Run check"}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {notice && (
          <p role="status" className="rounded-2xl bg-muted px-4 py-3 text-sm">
            {notice}
          </p>
        )}
        {snapshot && (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Fact label="Stages" value={`${stages.length}/11`} />
            <Fact
              label="Last verified"
              value={
                snapshot.lastPassedReceipt
                  ? new Date(
                      snapshot.lastPassedReceipt.completedAt,
                    ).toLocaleString([], {
                      dateStyle: "medium",
                      timeStyle: "short",
                    })
                  : "Not yet"
              }
            />
            <Fact label="Real sessions" value={String(completedLearning)} />
            <Fact
              label="Pilot readiness"
              value={cohort ? label(cohort.decision) : "Checking…"}
            />
          </div>
        )}
        {cohort && (
          <section
            aria-labelledby="pilot-decision-title"
            className="rounded-[1.5rem] bg-muted/45 p-4"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 id="pilot-decision-title" className="font-semibold">
                  {cohort.title}
                </h3>
                <p className="mt-1 max-w-3xl text-xs leading-5 text-muted-foreground">
                  {cohort.reason}
                </p>
              </div>
              <Badge tone={cohort.decision === "proceed" ? "positive" : cohort.decision === "pause" ? "caution" : "neutral"}>
                {label(cohort.decision)}
              </Badge>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5" aria-label="Pilot decision thresholds">
              {cohort.thresholds.map((threshold) => (
                <Fact
                  key={threshold.metric}
                  label={thresholdLabel(threshold.metric)}
                  value={`${threshold.observed === null ? "—" : `${threshold.observed}${thresholdSuffix(threshold.metric)}`} · ${threshold.state === "passed" ? "Pass" : "Needs work"}`}
                />
              ))}
            </div>
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium">Next: {cohort.nextAction}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Coverage: {cohort.distinctProjects} projects · {cohort.distinctScenarios} scenarios (2 of each required)
                </p>
              </div>
              <Button variant="secondary" onClick={downloadCohortReport}>
                <DownloadSimple aria-hidden="true" /> Cohort report
              </Button>
            </div>
          </section>
        )}
        {stages.length > 0 && (
          <ol
            aria-label="Certification stages"
            className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3"
          >
            {stages.map((stage, index) => (
              <li
                key={stage.name}
                className="flex items-center gap-2 rounded-2xl bg-muted/55 px-3 py-2 text-xs"
              >
                <CheckCircle className="text-emerald-600" weight="fill" />
                <span>
                  {index + 1}. {label(stage.name)}
                </span>
              </li>
            ))}
          </ol>
        )}
        {snapshot?.state === "failed" && (
          <div className="flex items-start gap-2 rounded-2xl bg-amber-400/10 p-4 text-sm">
            <Warning className="mt-0.5 shrink-0" />
            <span>
              {snapshot.message} Retry when ready; the last passing receipt
              remains available.
            </span>
          </div>
        )}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            A passing synthetic check proves the workflow—not external adoption.
          </p>
          <Button
            variant="secondary"
            onClick={() => setShowLearning((value) => !value)}
          >
            {showLearning ? "Close" : "Record a real session"}
          </Button>
        </div>
        {showLearning && (
          <PilotCapture
            endpoint={endpoint}
            sessions={sessions}
            review={review}
            cohort={cohort}
            saved={async (message) => {
              await refresh();
              setNotice(message);
            }}
          />
        )}
      </CardContent>
    </Card>
  );
}
function PilotCapture({
  endpoint,
  sessions,
  review,
  cohort,
  saved,
}: {
  endpoint: string;
  sessions: readonly OwnerPilotSession[];
  review: OwnerPilotReview | null;
  cohort: OwnerPilotCohortReport | null;
  saved: (message: string) => Promise<void>;
}) {
  const [projects, setProjects] = useState<
    readonly { id: string; name: string }[]
  >([]);
  const [projectsState, setProjectsState] = useState<"loading" | "ready" | "failed">("loading");
  const [projectId, setProjectId] = useState("");
  const [scenario, setScenario] = useState<
    "new_product" | "existing_product" | "major_feature"
  >("new_product");
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [rating, setRating] = useState(4);
  const [note, setNote] = useState("");
  const [frictions, setFrictions] = useState<OwnerPilotSession["frictions"]>([
    "none",
  ]);
  const [drafts, setDrafts] = useState<readonly OwnerPilotImprovementDraft[]>([]);
  const [summary, setSummary] = useState<OwnerPilotSummary | null>(null);
  const [observedSession, setObservedSession] = useState<OwnerPilotSession | null>(null);
  const storedSession = sessions.find((session) => ["active", "interrupted"].includes(session.status));
  const active = storedSession && observedSession?.id === storedSession.id ? observedSession : storedSession;
  useEffect(() => {
    void Promise.all([listLocalProjects({ endpoint }), listOwnerPilotImprovements(endpoint)])
      .then(([value, handoffs]) => {
        const available = value.projects.map((project) => ({ id: project.id, name: project.displayName }));
        setProjects(available);
        setProjectId((current) => current || available[0]?.id || "");
        setDrafts(handoffs.drafts);
        setProjectsState("ready");
      })
      .catch((value) => {
        setProjectsState("failed");
        setError(value instanceof Error ? value.message : "Projects could not be loaded.");
      });
  }, [endpoint]);
  useEffect(() => {
    if (active || projects.length === 0 || !cohort) return;
    if (cohort.nextSession.action === "add_project") {
      const completedProjects = new Set(sessions.filter((session) => session.status === "completed").map((session) => session.projectId));
      const untested = projects.find((project) => !completedProjects.has(project.id));
      if (untested) setProjectId(untested.id);
    }
    if (cohort.nextSession.scenario) setScenario(cohort.nextSession.scenario);
  }, [active, cohort?.evidenceDigest, projects, sessions]);
  useEffect(() => {
    if (!active) { setSummary(null); setObservedSession(null); return; }
    let stopped = false;
    const reconcile = async () => {
      try {
        const reconciled = await reconcileOwnerPilot(endpoint, active.id);
        const next = await getOwnerPilotSummary(endpoint, active.id);
        if (!stopped) { setObservedSession(reconciled); setSummary(next); }
      } catch (value) {
        if (!stopped) setError(value instanceof Error ? value.message : "Pilot evidence could not be refreshed.");
      }
    };
    void reconcile();
    const interval = window.setInterval(() => void reconcile(), 15_000);
    return () => { stopped = true; window.clearInterval(interval); };
  }, [active?.id, active?.revision, endpoint]);
  async function reloadDrafts() {
    setDrafts((await listOwnerPilotImprovements(endpoint)).drafts);
  }
  async function create() {
    setBusy(true);
    setError("");
    try {
      await createOwnerPilot(
        endpoint,
        { projectId, scenario, consent, startedAt: Date.now() },
        `pilot.ui.${Date.now()}`,
      );
      await saved("Consented pilot session started locally.");
    } catch (value) {
      setError(
        value instanceof Error
          ? value.message
          : "Learning session was not saved.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function downloadSessionReceipt(id = active?.id) {
    if (!id) return;
    setBusy(true); setError("");
    try {
      const receipt = await getOwnerPilotReceipt(endpoint, id);
      const url = URL.createObjectURL(new Blob([`${JSON.stringify(receipt, null, 2)}\n`], { type: "application/json" }));
      const anchor = document.createElement("a"); anchor.href = url; anchor.download = `${receipt.receiptId}.json`; anchor.click(); URL.revokeObjectURL(url);
    } catch (value) { setError(value instanceof Error ? value.message : "The session receipt could not be prepared."); }
    finally { setBusy(false); }
  }
  async function complete() {
    if (!active) return;
    setBusy(true);
    setError("");
    try {
      await completeOwnerPilot(endpoint, active.id, {
        expectedRevision: active.revision,
        completedAt: Date.now(),
        trustRating: rating,
        frictions,
        note,
      });
      await saved("Consented pilot session completed locally.");
    } catch (value) {
      setError(
        value instanceof Error
          ? value.message
          : "Learning session was not completed.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function withdraw() {
    if (!active) return;
    setBusy(true);
    setError("");
    try {
      await withdrawOwnerPilot(endpoint, active.id, active.revision);
      await saved("Consent withdrawn. The local session is no longer active.");
    } catch (value) {
      setError(
        value instanceof Error
          ? value.message
          : "Learning session was not withdrawn.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      aria-labelledby="learning-title"
      className="rounded-[1.5rem] bg-muted/45 p-4"
    >
      <h3 id="learning-title" className="font-semibold">
        {active ? "Pilot session in progress" : "Start a consented learning session"}
      </h3>
      <p className="mt-1 text-xs leading-5 text-muted-foreground">
        The participant stays anonymous. Prompts, files, names, email, and
        project content are excluded.
      </p>
      {active ? (
        <div className="mt-4 space-y-4">
          <div className="grid gap-2 sm:grid-cols-3">
            <Fact label="Verified progress" value={summary ? `${summary.provenMilestones}/5` : "Checking…"} />
            <Fact label="Elapsed" value={summary ? duration(summary.elapsedSeconds) : "Checking…"} />
            <Fact label="First preview" value={summary?.timeToPreviewSeconds ? duration(summary.timeToPreviewSeconds) : "Waiting"} />
          </div>
          {summary && <p role="status" className="rounded-2xl bg-background px-4 py-3 text-xs">{summary.nextAction}</p>}
          {active.previewAt !== null && active.status === "active" && (
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-xs font-medium">
                Trust rating
                <select
                  value={rating}
                  onChange={(event) => setRating(Number(event.target.value))}
                  className="mt-2 h-11 w-full rounded-2xl bg-background px-3 outline-none focus-visible:ring-3 focus-visible:ring-ring/30"
                >
                  {[1, 2, 3, 4, 5].map((value) => (
                    <option key={value} value={value}>
                      {value} of 5
                    </option>
                  ))}
                </select>
              </label>
              <fieldset className="text-xs font-medium">
                <legend>Friction</legend>
                <div className="mt-2 flex flex-wrap gap-2">
                  {(
                    [
                      "setup",
                      "navigation",
                      "trust",
                      "clarity",
                      "speed",
                      "approval",
                      "none",
                    ] as const
                  ).map((value) => (
                    <label
                      key={value}
                      className="flex items-center gap-2 rounded-2xl bg-background px-3 py-2"
                    >
                      <input
                        type="checkbox"
                        checked={frictions.includes(value)}
                        onChange={() =>
                          setFrictions((current) =>
                            toggleFriction(current, value),
                          )
                        }
                      />
                      {label(value)}
                    </label>
                  ))}
                </div>
              </fieldset>
              <label className="sm:col-span-2 text-xs font-medium">
                Optional sanitized note
                <textarea
                  value={note}
                  maxLength={400}
                  onChange={(event) => setNote(event.target.value)}
                  className="mt-2 min-h-20 w-full resize-y rounded-2xl bg-background p-3 outline-none focus-visible:ring-3 focus-visible:ring-ring/30"
                />
              </label>
              <div className="sm:col-span-2 flex gap-2">
                <Button onClick={() => void complete()} disabled={busy}>
                  Complete session
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => void withdraw()}
                  disabled={busy}
                >
                  Withdraw consent
                </Button>
              </div>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => void downloadSessionReceipt()} disabled={busy}>Session receipt</Button>
            <Button variant="ghost" onClick={() => void withdraw()} disabled={busy}>Withdraw consent</Button>
          </div>
        </div>
      ) : (
        <>
          {cohort && (
            <p role="status" className="mt-4 rounded-2xl bg-background px-4 py-3 text-xs">
              Recommended next test: {cohort.nextSession.instruction}
            </p>
          )}
          <label className="mt-4 block text-xs font-medium">
            Project
            <select
              value={projectId}
              onChange={(event) => setProjectId(event.target.value)}
              className="mt-2 h-11 w-full rounded-2xl bg-background px-3 outline-none focus-visible:ring-3 focus-visible:ring-ring/30"
            >
              {projects.length === 0 && <option value="">No local project available</option>}
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </label>
          {projectsState === "loading" && <p role="status" className="mt-2 text-xs text-muted-foreground">Loading local projects…</p>}
          {projectsState === "ready" && projects.length === 0 && <p role="alert" className="mt-2 text-xs text-destructive">Create or open a local project before starting a pilot session.</p>}
          <label className="mt-4 block text-xs font-medium">
            Scenario
            <select
              value={scenario}
              onChange={(event) =>
                setScenario(event.target.value as typeof scenario)
              }
              className="mt-2 h-11 w-full rounded-2xl bg-background px-3 outline-none focus-visible:ring-3 focus-visible:ring-ring/30"
            >
              <option value="new_product">New product</option>
              <option value="existing_product">Existing product</option>
              <option value="major_feature">Major feature</option>
            </select>
          </label>
          <label className="mt-4 flex items-start gap-3 text-xs leading-5">
            <input
              type="checkbox"
              checked={consent}
              onChange={(event) => setConsent(event.target.checked)}
              className="mt-1"
            />
            The participant explicitly consented to this anonymous, local
            learning record.
          </label>
          {error && (
            <p role="alert" className="mt-3 text-xs text-destructive">
              {error}
            </p>
          )}
          <Button
            className="mt-4"
            onClick={() => void create()}
            disabled={!consent || !projectId || busy}
          >
            {busy ? "Starting…" : "Start session"}
          </Button>
        </>
      )}
      {error && (
        <p role="alert" className="mt-3 text-xs text-destructive">
          {error}
        </p>
      )}
      {review && (
        <div className="mt-5 rounded-2xl bg-background p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <strong className="text-sm">{review.title}</strong>
            <Badge
              tone={review.state === "review_ready" ? "positive" : "neutral"}
            >
              {label(review.state)}
            </Badge>
          </div>
          <p className="mt-2 text-xs leading-5 text-muted-foreground">
            {review.reason}
          </p>
          {review.improvements.length > 0 && (
            <ul
              className="mt-3 space-y-2"
              aria-label="Evidence-backed improvements"
            >
              {review.improvements.map((improvement) => (
                <li
                  key={improvement.id}
                  className="rounded-2xl bg-muted/55 px-3 py-3 text-xs"
                >
                  <strong>{improvement.title}</strong>
                  <span className="ml-2 text-muted-foreground">
                    {improvement.evidenceCount} sessions ·{" "}
                    {improvement.priority}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {cohort?.decision === "improve" && review.state === "improvements_needed" && projectId && !drafts.some((draft) => draft.projectId === projectId && ["pending", "partially_applied"].includes(draft.state)) && (
            <Button
              className="mt-3"
              variant="secondary"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                setError("");
                void previewOwnerPilotImprovements(endpoint, { projectId, expectedReviewDigest: review.evidenceDigest }, `pilot.improvements.ui.${Date.now()}`)
                  .then(() => reloadDrafts())
                  .catch((value) => setError(value instanceof Error ? value.message : "The Jira preview could not be prepared."))
                  .finally(() => setBusy(false));
              }}
            >
              Review Jira handoff
            </Button>
          )}
        </div>
      )}
      {sessions.some((session) => session.status !== "active") && (
        <section className="mt-5" aria-labelledby="pilot-history-title">
          <h3 id="pilot-history-title" className="text-sm font-semibold">Recent private sessions</h3>
          <ul className="mt-3 grid gap-2 sm:grid-cols-2" aria-label="Privacy-safe pilot session history">
            {sessions.filter((session) => session.status !== "active").slice(-6).reverse().map((session) => (
              <li key={session.id} className="rounded-2xl bg-background p-3 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <strong>Session {session.id.slice(-6)}</strong>
                  <Badge tone={session.status === "completed" ? "positive" : "neutral"}>{label(session.status)}</Badge>
                </div>
                <p className="mt-2 text-muted-foreground">{label(session.scenario)} · {session.milestones.length}/5 verified steps</p>
                <Button className="mt-2" variant="ghost" onClick={() => void downloadSessionReceipt(session.id)} disabled={busy} aria-label={`Download receipt for session ${session.id.slice(-6)}`}>Receipt</Button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {drafts.filter((draft) => draft.projectId === projectId).slice(-1).map((draft) => (
        <ImprovementDecision key={`${draft.id}:${draft.revision}`} endpoint={endpoint} draft={draft} busy={busy} setBusy={setBusy} failed={setError} saved={async (message) => { await reloadDrafts(); await saved(message); }} />
      ))}
    </section>
  );
}

function ImprovementDecision({ endpoint, draft, busy, setBusy, failed, saved }: {
  endpoint: string;
  draft: OwnerPilotImprovementDraft;
  busy: boolean;
  setBusy: (value: boolean) => void;
  failed: (value: string) => void;
  saved: (message: string) => Promise<void>;
}) {
  const [items, setItems] = useState(draft.improvements);
  const actionable = draft.state === "pending" || draft.state === "partially_applied";
  async function act(action: "save" | "approve" | "decline") {
    setBusy(true);
    failed("");
    try {
      if (action === "save") {
        await editOwnerPilotImprovements(endpoint, draft.id, { expectedRevision: draft.revision, improvements: items });
        await saved("Edited preview saved. Review the new revision before approving.");
      } else if (action === "approve") {
        const next = await approveOwnerPilotImprovements(endpoint, draft.id, { expectedRevision: draft.revision, expectedPreviewDigest: draft.previewDigest });
        await saved(next.state === "completed" ? "Approved improvements were created in Jira." : "Jira applied part of the handoff. The remaining items are safe to retry.");
      } else {
        await declineOwnerPilotImprovements(endpoint, draft.id, { expectedRevision: draft.revision, expectedPreviewDigest: draft.previewDigest });
        await saved("Jira handoff declined. No Jira item was created.");
      }
    } catch (value) {
      failed(value instanceof Error ? value.message : "The improvement decision failed safely.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section aria-labelledby={`${draft.id}-title`} className="mt-5 rounded-[1.5rem] bg-background p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 id={`${draft.id}-title`} className="font-semibold">Jira improvement preview</h3>
          <p className="mt-1 text-xs text-muted-foreground">{draft.jiraProjectKey} · revision {draft.revision} · exactly {draft.improvements.length} task{draft.improvements.length === 1 ? "" : "s"}</p>
        </div>
        <Badge tone={draft.state === "completed" ? "positive" : draft.state === "partially_applied" ? "caution" : "neutral"}>{label(draft.state)}</Badge>
      </div>
      <div className="mt-4 space-y-3">
        {items.map((item, index) => (
          <div key={item.id} className="rounded-2xl bg-muted/55 p-3">
            <label className="block text-xs font-medium">Title
              <input className="mt-2 h-10 w-full rounded-xl bg-background px-3 outline-none focus-visible:ring-3 focus-visible:ring-ring/30" disabled={!actionable || draft.state === "partially_applied"} value={item.title} onChange={(event) => setItems((current) => current.map((candidate, position) => position === index ? { ...candidate, title: event.target.value } : candidate))} />
            </label>
            <label className="mt-3 block text-xs font-medium">Recommendation
              <textarea className="mt-2 min-h-20 w-full resize-y rounded-xl bg-background p-3 outline-none focus-visible:ring-3 focus-visible:ring-ring/30" disabled={!actionable || draft.state === "partially_applied"} value={item.recommendation} onChange={(event) => setItems((current) => current.map((candidate, position) => position === index ? { ...candidate, recommendation: event.target.value } : candidate))} />
            </label>
            <p className="mt-2 text-xs text-muted-foreground">{item.evidenceCount} sessions · {item.acceptanceCriteria.length} acceptance checks · $0</p>
          </div>
        ))}
      </div>
      {draft.lastError && <p role="alert" className="mt-3 rounded-2xl bg-amber-400/10 p-3 text-xs">{draft.lastError}</p>}
      {draft.receipts.length > 0 && <ul aria-label="Jira receipts" className="mt-3 space-y-2">{draft.receipts.map((receipt) => <li key={receipt.issueKey}><a className="text-xs font-medium text-primary underline-offset-4 hover:underline" href={receipt.url} target="_blank" rel="noreferrer">{receipt.issueKey} · evidence receipt</a></li>)}</ul>}
      {actionable && <div className="mt-4 flex flex-wrap gap-2">
        {draft.state === "pending" && <Button variant="secondary" disabled={busy} onClick={() => void act("save")}>Save edits</Button>}
        <Button disabled={busy} onClick={() => void act("approve")}>{draft.state === "partially_applied" ? "Retry remaining" : "Approve and create"}</Button>
        {draft.state === "pending" && <Button variant="ghost" disabled={busy} onClick={() => void act("decline")}>Decline</Button>}
      </div>}
    </section>
  );
}

function duration(seconds: number) { return seconds < 60 ? `${seconds}s` : `${Math.round(seconds / 60)}m`; }

function thresholdLabel(metric: OwnerPilotCohortReport["thresholds"][number]["metric"]): string {
  return {
    completed_sessions: "Completed sessions",
    distinct_projects: "Project coverage",
    distinct_scenarios: "Scenario coverage",
    completion_rate_percent: "Completion rate",
    trust_at_least_four_percent: "Trust 4–5",
    median_time_to_preview_seconds: "Median to preview",
    repeated_friction_count: "Repeated friction",
  }[metric];
}

function thresholdSuffix(metric: OwnerPilotCohortReport["thresholds"][number]["metric"]): string {
  return metric.endsWith("_percent") ? "%" : metric.endsWith("_seconds") ? "s" : "";
}

function toggleFriction(
  current: OwnerPilotSession["frictions"],
  value: OwnerPilotSession["frictions"][number],
): OwnerPilotSession["frictions"] {
  if (value === "none") return ["none"];
  const withoutNone = current.filter((item) => item !== "none");
  return withoutNone.includes(value)
    ? withoutNone.filter((item) => item !== value)
    : [...withoutNone, value];
}
function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-muted/55 px-4 py-3">
      <span className="block text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <strong className="mt-1 block text-sm">{value}</strong>
    </div>
  );
}
function label(value: string) {
  return value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}
