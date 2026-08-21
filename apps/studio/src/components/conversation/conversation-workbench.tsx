import { ArrowRight } from "@phosphor-icons/react/ArrowRight";
import { CheckCircle } from "@phosphor-icons/react/CheckCircle";
import { DownloadSimple } from "@phosphor-icons/react/DownloadSimple";
import { FileText } from "@phosphor-icons/react/FileText";
import { ImageSquare } from "@phosphor-icons/react/ImageSquare";
import { LinkSimple } from "@phosphor-icons/react/LinkSimple";
import { MagnifyingGlass } from "@phosphor-icons/react/MagnifyingGlass";
import { PaperPlaneTilt } from "@phosphor-icons/react/PaperPlaneTilt";
import { Pause } from "@phosphor-icons/react/Pause";
import { PushPin } from "@phosphor-icons/react/PushPin";
import { Sparkle } from "@phosphor-icons/react/Sparkle";
import { Stop } from "@phosphor-icons/react/Stop";
import { Trash } from "@phosphor-icons/react/Trash";
import { Warning } from "@phosphor-icons/react/Warning";
import { X } from "@phosphor-icons/react/X";
import { useMemo, useState } from "react";

import {
  activeAssertions,
  deleteAssertion,
  exportConversationBundle,
  prepareComposerRequest,
  reconstructWorkTimeline,
  requestSafeCancel,
  searchConversations,
  type CancelState,
  type ComposerAttachment,
  type RememberedAssertion
} from "../../../../../packages/conversation/src/index.js";
import {
  composerAttachmentOptions,
  conversationHistory,
  conversationTimelineEvents,
  rememberedAssertions
} from "../../conversation-fixture.js";
import { cn } from "../../lib/utils.js";
import { Badge } from "../ui/badge.js";
import { Button } from "../ui/button.js";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "../ui/card.js";

const templates = [
  "Build a feature",
  "Fix a problem",
  "Explain current work",
  "Plan the next sprint"
] as const;

export function ConversationWorkbench({
  navigate
}: {
  navigate: (view: "work" | "evidence") => void;
}) {
  const [outcome, setOutcome] = useState(
    "Add a trustworthy project conversation timeline with safe controls."
  );
  const [attachments, setAttachments] = useState<readonly ComposerAttachment[]>([
    composerAttachmentOptions.image!,
    composerAttachmentOptions.project!
  ]);
  const [requestNotice, setRequestNotice] = useState(
    "Draft is local. Review safety before creating work."
  );
  const [search, setSearch] = useState("");
  const [memories, setMemories] = useState<readonly RememberedAssertion[]>(
    rememberedAssertions
  );
  const [cancelState, setCancelState] = useState<CancelState>("running");
  const [workerActive, setWorkerActive] = useState(true);
  const [exportNotice, setExportNotice] = useState("");

  const prepared = useMemo(
    () => prepareComposerRequest({
      outcome,
      targetProjectId: "project-main",
      attachments,
      implementationPreference: null
    }),
    [attachments, outcome]
  );
  const timeline = useMemo(
    () => reconstructWorkTimeline(
      conversationTimelineEvents.map((event) =>
        event.stage === "implementation"
          ? { ...event, leaseActive: workerActive, serviceActive: workerActive }
          : event
      )
    ),
    [workerActive]
  );
  const histories = useMemo(
    () => searchConversations({
      records: conversationHistory,
      query: search,
      allowedProjectIds: new Set(["project-main"])
    }),
    [search]
  );
  const visibleMemories = activeAssertions(memories, "project-main", 1_800_000_000_000);
  const blocked = prepared.providerPayload === null;

  const addAttachment = (id: keyof typeof composerAttachmentOptions) => {
    const attachment = composerAttachmentOptions[id];
    if (!attachment || attachments.some((item) => item.id === attachment.id)) return;
    setAttachments((current) => [...current, attachment]);
    setRequestNotice(`${attachment.label} added locally and will be checked before sending.`);
  };

  const removeAttachment = (id: string) => {
    setAttachments((current) => current.filter((attachment) => attachment.id !== id));
    setRequestNotice("Removed content is excluded from citations and provider context.");
  };

  const reviewRequest = () => {
    setRequestNotice(
      blocked
        ? `${prepared.findings.filter((finding) => finding.severity === "blocking").length} blocking safety question requires attention. Nothing was sent.`
        : `Ready to plan with ${prepared.citations.length} cited context items and ${prepared.findings.filter((finding) => finding.severity === "assumption").length} editable assumption.`
    );
  };

  const stopSafely = () => {
    const next = requestSafeCancel(cancelState, {
      checkpointObserved: cancelState === "stop_requested",
      effectOutcomeUnknown: false
    });
    setCancelState(next);
    if (next === "safely_stopped") setWorkerActive(false);
  };

  const exportSelected = () => {
    const bundle = exportConversationBundle({
      projectId: "project-main",
      conversationId: histories[0]?.conversationId ?? "conversation-current",
      exportedAt: "2026-07-28T15:30:00.000Z",
      conversation: [outcome],
      plan: ["Create a reversible work plan."],
      evidence: ["233 repository checks passed before this conversation sprint."],
      result: ["No result is claimed until observed validation completes."]
    });
    setExportNotice(
      `Export prepared with ${Object.values(bundle.sections).flat().length} selected items. Hidden prompts and credentials are excluded.`
    );
  };

  return (
    <div className="grid min-w-0 gap-4 xl:grid-cols-[17rem_minmax(0,1fr)_22rem]">
      <Card className="min-w-0">
        <CardHeader>
          <CardTitle>Project conversations</CardTitle>
          <CardDescription>Local search within your current project access.</CardDescription>
        </CardHeader>
        <CardContent className="mt-5">
          <label className="flex items-center gap-2 rounded-2xl bg-muted/60 px-3 py-2">
            <MagnifyingGlass className="text-muted-foreground" />
            <span className="sr-only">Search project conversations</span>
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search decisions…"
              className="min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground"
            />
          </label>
          <div className="mt-4 space-y-2" aria-live="polite">
            {histories.map((conversation, index) => (
              <button
                key={conversation.conversationId}
                type="button"
                aria-pressed={index === 0}
                className={cn(
                  "w-full rounded-2xl bg-muted/45 p-4 text-left outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/30",
                  index === 0 && "bg-primary/10"
                )}
              >
                <strong className="block text-xs">{conversation.title}</strong>
                <span className="mt-1 block text-[11px] leading-5 text-muted-foreground">
                  {conversation.taskIds.join(" · ")}
                </span>
              </button>
            ))}
          </div>
          <Button variant="secondary" size="sm" className="mt-4 w-full" onClick={exportSelected}>
            <DownloadSimple />
            Export selected
          </Button>
          {exportNotice && (
            <p role="status" className="mt-3 text-[11px] leading-5 text-muted-foreground">
              {exportNotice}
            </p>
          )}
          <p className="mt-4 text-[10px] leading-4 text-muted-foreground">
            Conversation history is not canonical project truth.
          </p>
        </CardContent>
      </Card>

      <div className="min-w-0 space-y-4">
        <Card>
          <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <div className="flex flex-wrap gap-2">
                <Badge tone="active">Intent workspace</Badge>
                <Badge tone={blocked ? "caution" : "positive"}>
                  {blocked ? "Needs attention" : "Safe to review"}
                </Badge>
              </div>
              <CardTitle className="mt-4 text-xl">What should Codkesh build?</CardTitle>
              <CardDescription>
                Describe the outcome. Context is previewed, removable, cited, and checked locally first.
              </CardDescription>
            </div>
            <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-primary/12 text-primary">
              <Sparkle size={21} weight="fill" />
            </span>
          </CardHeader>
          <CardContent className="mt-6">
            <div className="flex flex-wrap gap-2" aria-label="Outcome templates">
              {templates.map((template) => (
                <button
                  key={template}
                  type="button"
                  onClick={() => setOutcome(`${template}: ${outcome.replace(/^[^:]+:\s*/, "")}`)}
                  className="rounded-full bg-muted/55 px-3 py-2 text-[11px] font-semibold outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/30"
                >
                  {template}
                </button>
              ))}
            </div>
            <label className="mt-4 block">
              <span className="sr-only">Describe the project outcome</span>
              <textarea
                value={outcome}
                onChange={(event) => setOutcome(event.target.value)}
                rows={4}
                className="w-full resize-none rounded-3xl bg-muted/55 p-4 text-sm leading-6 outline-none focus-visible:ring-3 focus-visible:ring-ring/30"
              />
            </label>
            <div className="mt-4 flex flex-wrap gap-2">
              <AttachmentButton label="Image" icon={ImageSquare} onClick={() => addAttachment("image")} />
              <AttachmentButton label="Selected file" icon={FileText} onClick={() => addAttachment("file")} />
              <AttachmentButton label="HTTPS link" icon={LinkSimple} onClick={() => addAttachment("url")} />
              <AttachmentButton label="Project reference" icon={PushPin} onClick={() => addAttachment("project")} />
              <AttachmentButton label="Test safety check" icon={Warning} onClick={() => addAttachment("unsafe")} />
            </div>
            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              {attachments.map((attachment) => {
                const rejected = prepared.rejectedAttachmentIds.includes(attachment.id);
                return (
                  <div
                    key={attachment.id}
                    className={cn(
                      "rounded-2xl bg-muted/45 p-3",
                      rejected && "bg-amber-400/10"
                    )}
                  >
                    <div className="flex items-start gap-3">
                      <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-background text-primary">
                        {attachment.kind === "image" ? <ImageSquare /> : <FileText />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <strong className="block truncate text-xs">{attachment.label}</strong>
                        <span className="mt-1 block truncate text-[10px] text-muted-foreground">
                          {rejected ? "Blocked locally · not sent" : `Cited · ${attachment.kind.replace("_", " ")}`}
                        </span>
                      </span>
                      <button
                        type="button"
                        aria-label={`Remove ${attachment.label}`}
                        onClick={() => removeAttachment(attachment.id)}
                        className="grid size-7 place-items-center rounded-full outline-none hover:bg-background focus-visible:ring-3 focus-visible:ring-ring/30"
                      >
                        <X />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="mt-4 rounded-2xl bg-primary/[.07] p-4">
              <div className="flex items-start gap-3">
                {blocked
                  ? <Warning className="mt-0.5 shrink-0 text-amber-600 dark:text-amber-300" weight="fill" />
                  : <CheckCircle className="mt-0.5 shrink-0 text-emerald-600 dark:text-emerald-300" weight="fill" />}
                <div>
                  <strong className="text-xs">
                    {blocked ? "Focused safety question" : "Editable assumption"}
                  </strong>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    {blocked
                      ? prepared.findings.find((finding) => finding.severity === "blocking")?.detail
                      : prepared.findings.find((finding) => finding.severity === "assumption")?.detail}
                  </p>
                </div>
              </div>
            </div>
            <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p role="status" aria-live="polite" className="text-xs text-muted-foreground">
                {requestNotice}
              </p>
              <Button onClick={reviewRequest}>
                <PaperPlaneTilt weight="fill" />
                Review request
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card aria-label="Truthful work timeline">
          <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <CardTitle>One truthful timeline</CardTitle>
              <CardDescription>
                Reconstructed from durable events—not model narration.
              </CardDescription>
            </div>
            <Badge tone={
              cancelState === "safely_stopped"
                ? "neutral"
                : workerActive
                  ? "active"
                  : "caution"
            }>
              {cancelLabel(cancelState, workerActive)}
            </Badge>
          </CardHeader>
          <CardContent className="mt-6">
            <ol className="space-y-3">
              {timeline.map((item) => (
                <li key={item.eventId} className="rounded-3xl bg-muted/45 p-4">
                  <div className="flex items-start gap-3">
                    <span className={cn(
                      "mt-1 size-2.5 shrink-0 rounded-full",
                      item.activity === "active"
                        ? "bg-emerald-400 shadow-[0_0_0.75rem] shadow-emerald-400/40"
                        : item.activity === "stalled"
                          ? "bg-amber-400"
                          : "bg-muted-foreground/40"
                    )} />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center justify-between gap-2">
                        <strong className="text-sm">{item.title}</strong>
                        <Badge tone={timelineTone(item.state, item.activity)}>
                          {item.activity === "stalled" ? "Inactive · not progressing" : item.state.replace("_", " ")}
                        </Badge>
                      </span>
                      <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                        {item.detail}
                      </span>
                      {item.groupedTechnicalEvents.length > 0 && (
                        <details className="mt-3 rounded-2xl bg-background/60 p-3">
                          <summary className="cursor-pointer text-[11px] font-semibold outline-none focus-visible:ring-3 focus-visible:ring-ring/30">
                            Technical details · {item.groupedTechnicalEvents.length} events
                          </summary>
                          <ul className="mt-3 space-y-2 text-[11px] text-muted-foreground">
                            {item.groupedTechnicalEvents.map((event) => (
                              <li key={event.eventId}>{event.title} · {event.detail}</li>
                            ))}
                          </ul>
                        </details>
                      )}
                    </span>
                  </div>
                </li>
              ))}
            </ol>
            <div className="mt-5 flex flex-wrap gap-2">
              <Button variant="secondary" size="sm">
                <Pause />
                Pause after step
              </Button>
              <Button variant="secondary" size="sm" onClick={stopSafely}>
                <Stop />
                {cancelState === "stop_requested" ? "Observe safe stop" : "Stop safely"}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setWorkerActive((current) => !current)}>
                {workerActive ? "Simulate inactive worker" : "Restore worker evidence"}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => navigate("work")}>
                Steer current work
                <ArrowRight />
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="min-w-0 space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>Remembered for this project</CardTitle>
            <CardDescription>
              Inspectable assertions—not hidden memory or canonical truth.
            </CardDescription>
          </CardHeader>
          <CardContent className="mt-5 space-y-3">
            {visibleMemories.map((memory) => (
              <div key={memory.id} className="rounded-2xl bg-muted/45 p-4">
                <div className="flex items-start gap-3">
                  <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-primary/12 text-primary">
                    <PushPin />
                  </span>
                  <span className="min-w-0 flex-1">
                    <strong className="block text-xs leading-5">{memory.statement}</strong>
                    <span className="mt-2 block text-[10px] leading-4 text-muted-foreground">
                      {memory.source} · {memory.confidence} confidence · {memory.scope}
                    </span>
                  </span>
                  <button
                    type="button"
                    aria-label={`Delete remembered assertion: ${memory.statement}`}
                    onClick={() => setMemories((current) =>
                      current.map((item) => item.id === memory.id ? deleteAssertion(item) : item)
                    )}
                    className="grid size-7 place-items-center rounded-full outline-none hover:bg-background focus-visible:ring-3 focus-visible:ring-ring/30"
                  >
                    <Trash />
                  </button>
                </div>
              </div>
            ))}
            {visibleMemories.length === 0 && (
              <p className="rounded-2xl bg-muted/45 p-4 text-xs text-muted-foreground">
                No active remembered assertions for this project.
              </p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Evidence boundary</CardTitle>
            <CardDescription>
              Chat can explain work. Only observed events prove progress.
            </CardDescription>
          </CardHeader>
          <CardContent className="mt-5 grid gap-2">
            <Button variant="secondary" onClick={() => navigate("evidence")}>
              Inspect cited evidence
            </Button>
            <Button variant="secondary" onClick={() => navigate("work")}>
              Review canonical work
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function AttachmentButton({
  label,
  icon: Icon,
  onClick
}: {
  label: string;
  icon: typeof FileText;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-2 rounded-full bg-muted/55 px-3 py-2 text-[11px] font-semibold outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/30"
    >
      <Icon />
      {label}
    </button>
  );
}

function timelineTone(
  state: string,
  activity: string
): "neutral" | "positive" | "active" | "caution" | "critical" {
  if (activity === "stalled") return "caution";
  if (state === "verified") return "positive";
  if (state === "working") return "active";
  if (state === "failed") return "critical";
  return "neutral";
}

function cancelLabel(state: CancelState, workerActive: boolean): string {
  if (state === "stop_requested") return "Stop requested";
  if (state === "safely_stopped") return "Safely stopped";
  if (state === "unable_to_stop") return "Unable to stop";
  return workerActive ? "Lease active" : "Lease inactive";
}
