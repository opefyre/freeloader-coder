import assert from "node:assert/strict";
import test from "node:test";

import {
  reconstructWorkTimeline,
  requestSafeCancel,
  type WorkTimelineEvent
} from "../packages/conversation/src/index.js";

function event(
  sequence: number,
  overrides: Partial<WorkTimelineEvent> = {}
): WorkTimelineEvent {
  return {
    sequence,
    eventId: `event-${sequence}`,
    taskId: "PIPE-54",
    stage: "implementation",
    occurredAt: sequence,
    title: `Event ${sequence}`,
    detail: "Observed detail.",
    level: "summary",
    evidenceIds: [`evidence-${sequence}`],
    state: "working",
    leaseActive: true,
    serviceActive: true,
    ...overrides
  };
}

test("replay and reconnect reconstruct the exact same grouped timeline", () => {
  const events = [
    event(1),
    event(2, { level: "technical", title: "Tool receipt" }),
    event(3, { level: "technical", title: "Second receipt" }),
    event(4, {
      stage: "validation",
      state: "waiting",
      leaseActive: false,
      title: "Validation waiting"
    })
  ];
  const first = reconstructWorkTimeline(events);
  const restored = reconstructWorkTimeline(JSON.parse(JSON.stringify(events)));
  assert.deepEqual(restored, first);
  assert.equal(first.length, 2);
  assert.equal(first[0]?.groupedTechnicalEvents.length, 2);
  assert.deepEqual(first[0]?.evidenceIds, [
    "evidence-1",
    "evidence-2",
    "evidence-3"
  ]);
});

test("working narration becomes stalled when lease or service evidence is inactive", () => {
  const leaseInactive = reconstructWorkTimeline([
    event(1, { leaseActive: false })
  ]);
  const serviceInactive = reconstructWorkTimeline([
    event(1, { serviceActive: false })
  ]);
  assert.equal(leaseInactive[0]?.activity, "stalled");
  assert.equal(serviceInactive[0]?.activity, "stalled");
});

test("timeline rejects gaps and duplicate event identity", () => {
  assert.throws(
    () => reconstructWorkTimeline([event(2)]),
    /not contiguous/
  );
  assert.throws(
    () => reconstructWorkTimeline([
      event(1),
      event(2, { eventId: "event-1" })
    ]),
    /duplicated/
  );
});

test("cancel distinguishes request, observed safe stop, and unable-to-stop uncertainty", () => {
  assert.equal(
    requestSafeCancel("running", {
      checkpointObserved: false,
      effectOutcomeUnknown: false
    }),
    "stop_requested"
  );
  assert.equal(
    requestSafeCancel("stop_requested", {
      checkpointObserved: true,
      effectOutcomeUnknown: false
    }),
    "safely_stopped"
  );
  assert.equal(
    requestSafeCancel("running", {
      checkpointObserved: false,
      effectOutcomeUnknown: true
    }),
    "unable_to_stop"
  );
});

