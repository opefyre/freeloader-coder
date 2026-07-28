export type OnboardingStage =
  | "select"
  | "analyze"
  | "plan"
  | "preview"
  | "decision";

export const onboardingStages: readonly {
  readonly id: OnboardingStage;
  readonly label: string;
  readonly note: string;
}[] = [
  { id: "select", label: "Add project", note: "Local folder or GitHub" },
  { id: "analyze", label: "Understand", note: "Stack, commands, and risks" },
  { id: "plan", label: "Review plan", note: "Time, effects, and undo" },
  { id: "preview", label: "Validate", note: "Working preview and evidence" },
  { id: "decision", label: "Keep or restore", note: "You stay in control" }
];

export const detectedProject = {
  name: "Pipeline Studio",
  state: "Ready",
  summary: "TypeScript workspace · React interface · local-first controller",
  languages: ["TypeScript", "CSS"],
  frameworks: ["React", "Vite"],
  commands: ["Validate project", "Build preview"],
  risks: ["Existing local changes remain outside the product checkpoint"],
  missingDependencies: [] as readonly string[],
  protectedPaths: [".env", "secrets/", ".git/"],
  facts: [
    "React and Vite are declared by the repository.",
    "Automated validation and build commands are available.",
    "Likely secret-bearing files are excluded from grounding."
  ],
  inferences: ["The preview is likely to use the existing local development port."],
  assumptions: ["The current design system remains the visual source of truth."],
  userDecisions: ["You decide whether to keep or restore the validated change."]
} as const;

export const starterPlan = {
  title: "Improve one visible heading and preview it",
  reason: "A small visible change teaches the complete safe workflow.",
  expectedMinutes: 8,
  providerPosture: "Free models are selected automatically. Work stops before any paid route.",
  localResources: "Low-impact local profile; pauses when your computer is busy.",
  effects: [
    "Create an isolated checkpoint",
    "Change only the approved interface file",
    "Start a temporary local preview"
  ],
  evidence: [
    "Changed-file summary",
    "Automated checks",
    "Preview observation",
    "Restorable checkpoint"
  ],
  undo: "Restore the exact pre-run checkpoint without touching unrelated work.",
  advancedOperations: [
    "Create an isolated worktree from the observed baseline commit",
    "Apply only the declared file change inside the worktree",
    "Run the detected validation and build commands",
    "Record a local checkpoint for the approved file set"
  ],
  limitations: [
    "Nested repositories stay outside the checkpoint.",
    "Ignored and likely-secret files are never staged.",
    "A changed baseline pauses the journey for review."
  ]
} as const;

export const previewEvidence = [
  { label: "Project scan", value: "Deterministic · fresh" },
  { label: "Automated checks", value: "Passed · evidence attached" },
  { label: "Production build", value: "Passed" },
  { label: "Checkpoint", value: "Ready to restore" }
] as const;

export function onboardingProgress(stage: OnboardingStage): number {
  const index = onboardingStages.findIndex((item) => item.id === stage);
  return Math.round(((index + 1) / onboardingStages.length) * 100);
}

export function nextOnboardingStage(stage: OnboardingStage): OnboardingStage {
  const order: Record<OnboardingStage, OnboardingStage> = {
    select: "analyze",
    analyze: "plan",
    plan: "preview",
    preview: "decision",
    decision: "decision"
  };
  return order[stage];
}

export function safeOnboardingEvent(input: {
  readonly stage: OnboardingStage;
  readonly outcome: "started" | "completed" | "abandoned" | "failed";
  readonly failureClass?: string;
}) {
  return {
    schemaVersion: 1 as const,
    stage: input.stage,
    outcome: input.outcome,
    failureClass: input.failureClass ?? null
  };
}
