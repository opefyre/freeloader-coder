export type WorkTimelineStage =
  | "readiness"
  | "decomposition"
  | "queue"
  | "implementation"
  | "validation"
  | "review"
  | "healing"
  | "pause"
  | "quota"
  | "completion";

export interface WorkTimelineEvent {
  readonly sequence: number;
  readonly eventId: string;
  readonly taskId: string;
  readonly stage: WorkTimelineStage;
  readonly occurredAt: number;
  readonly title: string;
  readonly detail: string;
  readonly level: "summary" | "technical";
  readonly evidenceIds: readonly string[];
  readonly state: "waiting" | "working" | "needs_user" | "verified" | "failed";
  readonly leaseActive: boolean;
  readonly serviceActive: boolean;
}

export interface WorkTimelineItem {
  readonly sequence: number;
  readonly eventId: string;
  readonly stage: WorkTimelineStage;
  readonly title: string;
  readonly detail: string;
  readonly state: WorkTimelineEvent["state"];
  readonly activity: "active" | "inactive" | "stalled";
  readonly evidenceIds: readonly string[];
  readonly groupedTechnicalEvents: readonly WorkTimelineEvent[];
}

export function reconstructWorkTimeline(
  events: readonly WorkTimelineEvent[]
): readonly WorkTimelineItem[] {
  const ordered = [...events].sort((left, right) => left.sequence - right.sequence);
  const seen = new Set<string>();
  let priorSequence = 0;
  const items: WorkTimelineItem[] = [];
  for (const event of ordered) {
    if (event.sequence !== priorSequence + 1) {
      throw new TimelineIntegrityError(
        "sequence-gap",
        "Timeline events are not contiguous."
      );
    }
    if (seen.has(event.eventId)) {
      throw new TimelineIntegrityError(
        "duplicate-event",
        "Timeline event identity is duplicated."
      );
    }
    seen.add(event.eventId);
    priorSequence = event.sequence;
    if (event.level === "technical" && items.at(-1)?.stage === event.stage) {
      const previous = items.at(-1)!;
      items[items.length - 1] = {
        ...previous,
        groupedTechnicalEvents: [...previous.groupedTechnicalEvents, event],
        evidenceIds: unique([...previous.evidenceIds, ...event.evidenceIds])
      };
      continue;
    }
    items.push({
      sequence: event.sequence,
      eventId: event.eventId,
      stage: event.stage,
      title: event.title,
      detail: event.detail,
      state: event.state,
      activity: event.state !== "working"
        ? "inactive"
        : event.leaseActive && event.serviceActive
          ? "active"
          : "stalled",
      evidenceIds: event.evidenceIds,
      groupedTechnicalEvents: []
    });
  }
  return items;
}

export type CancelState =
  | "running"
  | "stop_requested"
  | "safely_stopped"
  | "unable_to_stop";

export function requestSafeCancel(
  state: CancelState,
  input: {
    readonly checkpointObserved: boolean;
    readonly effectOutcomeUnknown: boolean;
  }
): CancelState {
  if (state === "safely_stopped" || state === "unable_to_stop") return state;
  if (input.effectOutcomeUnknown) return "unable_to_stop";
  if (input.checkpointObserved) return "safely_stopped";
  return "stop_requested";
}

export class TimelineIntegrityError extends Error {
  public constructor(
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "TimelineIntegrityError";
  }
}

function unique(values: readonly string[]): readonly string[] {
  return [...new Set(values)];
}

