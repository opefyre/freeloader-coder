import { z } from "zod";

import { externalLearningScenarioSchema } from "./owner-journey-certification.js";

export const ownerPilotRunbookSchema = z.strictObject({
  schemaVersion: z.literal(1),
  provenance: z.literal("canonical_owner_pilot_runbook"),
  title: z.string().trim().min(1).max(80),
  scenario: externalLearningScenarioSchema,
  steps: z.tuple([
    z.strictObject({ id: z.literal("open_project"), label: z.string(), detail: z.string() }),
    z.strictObject({ id: z.literal("follow_action"), label: z.string(), detail: z.string() }),
    z.strictObject({ id: z.literal("record_result"), label: z.string(), detail: z.string() }),
  ]),
  privacyBoundary: z.string().trim().min(1).max(220),
  automaticSpendLimitUsd: z.literal(0),
});

export type OwnerPilotRunbook = z.infer<typeof ownerPilotRunbookSchema>;

export function ownerPilotRunbook(scenario: z.infer<typeof externalLearningScenarioSchema>): OwnerPilotRunbook {
  return ownerPilotRunbookSchema.parse({
    schemaVersion: 1,
    provenance: "canonical_owner_pilot_runbook",
    title: "Run the next real owner session",
    scenario,
    steps: [
      { id: "open_project", label: "Open the test project", detail: "Use the exact project selected for this session." },
      { id: "follow_action", label: "Follow its main action", detail: "Proceed naturally; do not search for hidden test controls." },
      { id: "record_result", label: "Return and rate the journey", detail: "Record trust and any friction only after a verified preview appears." },
    ],
    privacyBoundary: "Only milestones, timing, trust, and selected friction are stored locally. Prompts, files, names, and project content are excluded.",
    automaticSpendLimitUsd: 0,
  });
}
