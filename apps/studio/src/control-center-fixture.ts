export const controlTasks = [
  { id: "PIPE-68", title: "Source-backed metrics", stage: "Validation", outcome: "working", risk: "High", progress: 72, source: "https://opefyre.atlassian.net/browse/PIPE-68" },
  { id: "PIPE-69", title: "Visual command center", stage: "Implementation", outcome: "working", risk: "Standard", progress: 48, source: "https://opefyre.atlassian.net/browse/PIPE-69" },
  { id: "PIPE-70", title: "Safe operator actions", stage: "Ready", outcome: "queued", risk: "High", progress: 12, source: "https://opefyre.atlassian.net/browse/PIPE-70" },
  { id: "PIPE-71", title: "Redacted support bundles", stage: "Ready", outcome: "queued", risk: "Standard", progress: 8, source: "https://opefyre.atlassian.net/browse/PIPE-71" },
] as const;

export const providerShare = [
  { id: "groq", calls: 12, share: 38, locality: "External", dashboard: "https://console.groq.com" },
  { id: "cloudflare", calls: 8, share: 25, locality: "External", dashboard: "https://dash.cloudflare.com" },
  { id: "gemini", calls: 6, share: 19, locality: "External", dashboard: "https://aistudio.google.com" },
  { id: "local-engine", calls: 4, share: 12, locality: "Local", dashboard: "http://127.0.0.1:11434" },
  { id: "openrouter", calls: 2, share: 6, locality: "External", dashboard: "https://openrouter.ai/activity" },
] as const;

export const throughputPoints = [2, 4, 3, 7, 5, 9, 8, 12, 10, 14, 13, 16] as const;

export const doctorChecks = [
  { id: "database", label: "Database", state: "Healthy", note: "Integrity and migrations verified" },
  { id: "services", label: "Services", state: "Healthy", note: "One controller · no duplicates" },
  { id: "providers", label: "Providers", state: "Warning", note: "One quota source unavailable" },
  { id: "validators", label: "Validators", state: "Healthy", note: "Image and commands ready" },
] as const;
