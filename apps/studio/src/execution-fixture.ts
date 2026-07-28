export const executionProfiles = [
  {
    id: "lightweight",
    label: "Lightweight",
    eyebrow: "8 GB friendly",
    description: "One focused agent with strict memory and model limits.",
    limits: ["1 task at a time", "4 GB memory ceiling", "Local models off"],
    recommendation: "Best for laptops and background work",
  },
  {
    id: "standard",
    label: "Standard",
    eyebrow: "Recommended",
    description: "Balanced parallel work with protected capacity for review.",
    limits: ["2 tasks at a time", "8 GB memory ceiling", "1 reviewer reserved"],
    recommendation: "Best balance of speed and stability",
  },
  {
    id: "distributed",
    label: "Distributed",
    eyebrow: "Two-machine",
    description: "Controller and execution split across paired machines.",
    limits: ["3 tasks at a time", "Remote execution", "2 reviewers reserved"],
    recommendation: "Best when a spare machine is available",
  },
] as const;

export type ExecutionProfileId = (typeof executionProfiles)[number]["id"];

export const executionTools = [
  { name: "Read & search", icon: "search", state: "Allowed", effect: "Read only" },
  { name: "Patch files", icon: "code", state: "Allowed", effect: "Workspace only" },
  { name: "Safe commands", icon: "terminal", state: "Bounded", effect: "Approved recipes" },
  { name: "Git checkpoint", icon: "git", state: "Allowed", effect: "Task branch only" },
  { name: "Preview & capture", icon: "preview", state: "Allowed", effect: "Local artifact" },
] as const;

export const checkpointTimeline = [
  {
    id: "baseline",
    label: "Baseline",
    note: "Repository before work",
    state: "verified",
    files: 0,
    time: "09:12",
  },
  {
    id: "task",
    label: "Task",
    note: "Implementation complete",
    state: "verified",
    files: 7,
    time: "09:38",
  },
  {
    id: "validation",
    label: "Validation",
    note: "Tests and preview passed",
    state: "current",
    files: 7,
    time: "09:44",
  },
  {
    id: "accepted",
    label: "Accepted",
    note: "Waiting for your decision",
    state: "waiting",
    files: 7,
    time: "—",
  },
  {
    id: "published",
    label: "Published",
    note: "Not requested",
    state: "locked",
    files: 0,
    time: "—",
  },
] as const;

export type CheckpointId = (typeof checkpointTimeline)[number]["id"];

export const conflictPreview = {
  path: "apps/studio/src/App.tsx",
  current: {
    label: "Your current version",
    lines: ["const runMode = “careful”;", "preserveLocalChanges();"],
  },
  proposed: {
    label: "Pipeline proposal",
    lines: ["const runMode = “bounded”;", "createCheckpointBeforeApply();"],
  },
  options: [
    "Keep your version",
    "Use pipeline proposal",
    "Open both for editing",
    "Restore validation checkpoint",
  ],
} as const;

export const resourceSnapshot = {
  machine: "Spare Mac",
  state: "Comfortable",
  memory: 46,
  disk: 31,
  temperature: 38,
  battery: "AC power",
  activeTasks: 2,
  explanation:
    "Two tasks can run safely. A reviewer slot and 3.2 GB memory remain protected.",
} as const;

