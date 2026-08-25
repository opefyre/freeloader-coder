import { CheckCircle } from "@phosphor-icons/react/CheckCircle";
import { Flask } from "@phosphor-icons/react/Flask";
import { Warning } from "@phosphor-icons/react/Warning";
import { useCallback, useEffect, useMemo, useState } from "react";

import type {
  ExternalLearningSession,
  OwnerJourneyCertificationSnapshot,
} from "../../../../../packages/runtime/src/owner-journey-certification.js";
import {
  completeExternalOwnerLearning,
  createExternalOwnerLearning,
  getOwnerJourneyCertification,
  listExternalOwnerLearning,
  previewOwnerJourneyCertification,
  runOwnerJourneyCertification,
  withdrawExternalOwnerLearning,
} from "../../owner-journey-certification-client.js";
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
  const [sessions, setSessions] = useState<readonly ExternalLearningSession[]>(
    [],
  );
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [showLearning, setShowLearning] = useState(false);
  const refresh = useCallback(async () => {
    try {
      const [certification, learning] = await Promise.all([
        getOwnerJourneyCertification(endpoint),
        listExternalOwnerLearning(endpoint),
      ]);
      setSnapshot(certification);
      setSessions(learning.sessions);
    } catch {
      setSnapshot(null);
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
          <div className="grid gap-3 sm:grid-cols-3">
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
          </div>
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
          <LearningCapture
            endpoint={endpoint}
            sessions={sessions}
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
function LearningCapture({
  endpoint,
  sessions,
  saved,
}: {
  endpoint: string;
  sessions: readonly ExternalLearningSession[];
  saved: (message: string) => Promise<void>;
}) {
  const alias = useMemo(
    () => `participant-${crypto.randomUUID().slice(0, 8)}`,
    [],
  );
  const [scenario, setScenario] = useState<
    "new_product" | "existing_product" | "major_feature"
  >("new_product");
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [rating, setRating] = useState(4);
  const [timeToPreview, setTimeToPreview] = useState(10);
  const [note, setNote] = useState("");
  const draft = sessions.find((session) => session.status === "draft");
  async function create() {
    setBusy(true);
    setError("");
    try {
      await createExternalOwnerLearning(
        endpoint,
        { participantAlias: alias, scenario, consent, startedAt: Date.now() },
        `learning.ui.${Date.now()}`,
      );
      await saved("Consented learning draft stored locally.");
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
  async function complete() {
    if (!draft) return;
    setBusy(true);
    setError("");
    try {
      await completeExternalOwnerLearning(endpoint, draft.id, {
        expectedRevision: draft.revision,
        completedAt: Date.now(),
        timeToPreviewSeconds: timeToPreview * 60,
        trustRating: rating,
        frictions: ["none"],
        note,
      });
      await saved("Consented learning session completed locally.");
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
    if (!draft) return;
    setBusy(true);
    setError("");
    try {
      await withdrawExternalOwnerLearning(endpoint, draft.id, draft.revision);
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
      {draft ? (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="text-xs font-medium">
            Minutes to preview
            <input
              type="number"
              min={1}
              max={1440}
              value={timeToPreview}
              onChange={(event) => setTimeToPreview(Number(event.target.value))}
              className="mt-2 h-11 w-full rounded-2xl bg-background px-3 outline-none focus-visible:ring-3 focus-visible:ring-ring/30"
            />
          </label>
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
      ) : (
        <>
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
            disabled={!consent || busy}
          >
            {busy ? "Starting…" : "Start session"}
          </Button>
        </>
      )}
    </section>
  );
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
