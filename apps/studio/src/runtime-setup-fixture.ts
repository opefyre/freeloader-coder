export const runtimeSetupStages = [
  { id: "repository", label: "Repository", note: "Cloned", state: "done" },
  { id: "preflight", label: "Preflight", note: "10 checks", state: "done" },
  { id: "core", label: "Local core", note: "Loopback only", state: "done" },
  { id: "sandbox", label: "Sandbox", note: "Reduced", state: "current" },
  { id: "ready", label: "Ready", note: "Start building", state: "next" },
] as const;

export const runtimeChecks = [
  { id: "node", label: "Node.js", value: "22.23.1", state: "Ready", required: true },
  { id: "git", label: "Git", value: "2.50.1", state: "Ready", required: true },
  { id: "memory", label: "Memory", value: "24 GB", state: "Ready", required: true },
  { id: "disk", label: "Free disk", value: "184 GB", state: "Ready", required: true },
  { id: "port", label: "Local address", value: "127.0.0.1:4311", state: "Selected", required: true },
  {
    id: "local-model-runtime",
    label: "Local models",
    value: "Not needed",
    state: "Optional",
    required: false
  },
] as const;

export const runtimeServices = [
  { id: "core", label: "Local core", state: "Healthy", note: "Canonical state" },
  { id: "worker", label: "Worker", state: "Healthy", note: "Bounded process" },
  { id: "validator", label: "Validator", state: "Healthy", note: "Checks reserved" },
  { id: "preview", label: "Preview", state: "Ready", note: "Loopback only" },
] as const;

export const sandboxChoices = [
  {
    id: "native",
    label: "Native bounded",
    strength: "Reduced isolation",
    recommendation: "Selected automatically",
    description: "Runs lightweight work without Docker under strict tool and path limits.",
    capabilities: ["Workspace scoped", "Commands allowlisted", "Network approved"],
    restrictions: ["No protected paths", "No secrets", "No unrestricted shell"],
  },
  {
    id: "container",
    label: "Container",
    strength: "Strong isolation",
    recommendation: "Optional",
    description: "Use Docker or Podman when a project or policy requires stronger isolation.",
    capabilities: ["Resource limits", "Isolated network", "Bounded mounts"],
    restrictions: ["Runtime installation required", "Never automatic"],
  },
] as const;

export type SandboxChoiceId = (typeof sandboxChoices)[number]["id"];

export const repairActions = [
  "Release only the expired controller lock",
  "Select a free loopback port",
  "Rebuild derived views from the journal",
  "Restart the stopped local services",
] as const;
