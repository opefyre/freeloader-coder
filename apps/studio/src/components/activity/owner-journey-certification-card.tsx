import { CheckCircle } from "@phosphor-icons/react/CheckCircle";
import { Flask } from "@phosphor-icons/react/Flask";
import { Warning } from "@phosphor-icons/react/Warning";
import { useCallback, useEffect, useState } from "react";

import type {
  OwnerJourneyCertificationSnapshot,
  OwnerJourneyTrustSnapshot,
  OwnerPilotReview,
  OwnerPilotSession,
} from "../../../../../packages/runtime/src/owner-journey-certification.js";
import {
  advanceOwnerPilot,
  completeOwnerPilot,
  createOwnerPilot,
  getOwnerPilotReview,
  getOwnerJourneyCertification,
  getOwnerJourneyTrust,
  listOwnerPilot,
  previewOwnerJourneyCertification,
  runOwnerJourneyCertification,
  tickOwnerJourneyTrust,
  withdrawOwnerPilot,
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
  const [trust, setTrust] = useState<OwnerJourneyTrustSnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [showLearning, setShowLearning] = useState(false);
  const refresh = useCallback(async () => {
    try {
      const [certification, pilot, trustSnapshot, pilotReview] =
        await Promise.all([
          getOwnerJourneyCertification(endpoint),
          listOwnerPilot(endpoint),
          getOwnerJourneyTrust(endpoint),
          getOwnerPilotReview(endpoint),
        ]);
      setSnapshot(certification);
      setSessions(pilot.sessions);
      setTrust(trustSnapshot);
      setReview(pilotReview);
    } catch {
      setSnapshot(null);
      setTrust(null);
      setReview(null);
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
  async function refreshTrust() {
    setBusy(true);
    setNotice("Refreshing local trust evidence…");
    try {
      const result = await tickOwnerJourneyTrust(
        endpoint,
        `trust.ui.${Date.now()}`,
      );
      setTrust(result);
      await refresh();
      setNotice("Trust evidence is current.");
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "Trust evidence did not refresh.",
      );
    } finally {
      setBusy(false);
    }
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
        <Button onClick={() => void run()} disabled={busy}>
          {busy ? "Checking…" : passed ? "Run again" : "Run check"}
        </Button>
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
              value={
                trust ? readinessLabel(trust.readiness.state) : "Checking…"
              }
            />
          </div>
        )}
        {trust && (
          <section
            aria-labelledby="pilot-readiness-title"
            className="rounded-[1.5rem] bg-muted/45 p-4"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 id="pilot-readiness-title" className="font-semibold">
                  {trust.readiness.title}
                </h3>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  {trust.readiness.reason}
                </p>
              </div>
              <Badge
                tone={
                  trust.readiness.state === "review_ready"
                    ? "positive"
                    : "neutral"
                }
              >
                {readinessLabel(trust.readiness.state)}
              </Badge>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <Fact
                label="Next local check"
                value={new Date(trust.freshness.nextCheckAt).toLocaleDateString(
                  [],
                  { dateStyle: "medium" },
                )}
              />
              <Fact
                label="Median to preview"
                value={
                  trust.learning.medianTimeToPreviewSeconds === null
                    ? "Not enough data"
                    : `${Math.round(trust.learning.medianTimeToPreviewSeconds / 60)} min`
                }
              />
              <Fact
                label="Trust 4–5"
                value={
                  trust.learning.trustAtLeastFourPercent === null
                    ? "Not enough data"
                    : `${trust.learning.trustAtLeastFourPercent}%`
                }
              />
            </div>
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs text-muted-foreground">
                Anonymous aggregates only. At least 3 completed sessions are
                required.
              </p>
              <Button
                variant="secondary"
                onClick={() => void refreshTrust()}
                disabled={busy}
              >
                Refresh evidence
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
  saved,
}: {
  endpoint: string;
  sessions: readonly OwnerPilotSession[];
  review: OwnerPilotReview | null;
  saved: (message: string) => Promise<void>;
}) {
  const [projects, setProjects] = useState<
    readonly { id: string; name: string }[]
  >([]);
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
  const active = sessions.find((session) => session.status === "active");
  useEffect(() => {
    void listLocalProjects({ endpoint }).then((value) => {
      const available = value.projects.map((project) => ({
        id: project.id,
        name: project.displayName,
      }));
      setProjects(available);
      setProjectId((current) => current || available[0]?.id || "");
    });
  }, [endpoint]);
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
  async function advance() {
    if (!active) return;
    const next = (
      {
        session_started: "context_ready",
        context_ready: "solution_approved",
        solution_approved: "first_preview",
      } as const
    )[
      active.milestones.at(-1)!.name as
        "session_started" | "context_ready" | "solution_approved"
    ];
    if (!next) return;
    setBusy(true);
    setError("");
    try {
      await advanceOwnerPilot(endpoint, active.id, {
        expectedRevision: active.revision,
        milestone: next,
        at: Date.now(),
      });
      await saved(
        next === "first_preview"
          ? "First preview recorded."
          : "Pilot milestone recorded.",
      );
    } catch (value) {
      setError(
        value instanceof Error
          ? value.message
          : "Pilot milestone was not saved.",
      );
    } finally {
      setBusy(false);
    }
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
        Start a consented learning session
      </h3>
      <p className="mt-1 text-xs leading-5 text-muted-foreground">
        The participant stays anonymous. Prompts, files, names, email, and
        project content are excluded.
      </p>
      {active ? (
        <div className="mt-4 space-y-4">
          <div className="grid gap-2 sm:grid-cols-4">
            {["Started", "Context", "Approved", "Preview"].map(
              (milestone, index) => (
                <Fact
                  key={milestone}
                  label={`Step ${index + 1}`}
                  value={
                    active.milestones.length > index ? milestone : "Waiting"
                  }
                />
              ),
            )}
          </div>
          {active.previewAt === null ? (
            <Button onClick={() => void advance()} disabled={busy}>
              {busy ? "Saving…" : nextMilestoneLabel(active)}
            </Button>
          ) : (
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
          {active.previewAt === null && (
            <Button
              variant="ghost"
              onClick={() => void withdraw()}
              disabled={busy}
            >
              Withdraw consent
            </Button>
          )}
        </div>
      ) : (
        <>
          <label className="mt-4 block text-xs font-medium">
            Project
            <select
              value={projectId}
              onChange={(event) => setProjectId(event.target.value)}
              className="mt-2 h-11 w-full rounded-2xl bg-background px-3 outline-none focus-visible:ring-3 focus-visible:ring-ring/30"
            >
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </label>
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
        </div>
      )}
    </section>
  );
}

function nextMilestoneLabel(session: OwnerPilotSession) {
  return (
    {
      session_started: "Mark context ready",
      context_ready: "Mark solution approved",
      solution_approved: "Record first preview",
    } as const
  )[
    session.milestones.at(-1)!.name as
      "session_started" | "context_ready" | "solution_approved"
  ];
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
function readinessLabel(
  value: OwnerJourneyTrustSnapshot["readiness"]["state"],
) {
  return (
    {
      certification_needed: "Check needed",
      learning_needed: "Learning",
      review_ready: "Review ready",
      thresholds_not_met: "Improve",
    } as const
  )[value];
}
