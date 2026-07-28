import type { SandboxMode } from "./contracts.js";

export interface SandboxSelection {
  readonly mode: SandboxMode;
  readonly label: string;
  readonly strength: "strong" | "reduced" | "unavailable";
  readonly summary: string;
  readonly capabilities: readonly string[];
  readonly restrictions: readonly string[];
  readonly action: string | null;
  readonly verification: string;
}

export function selectSandboxMode(input: {
  readonly platform: "darwin" | "linux" | "win32";
  readonly availableContainers: readonly ("docker" | "podman")[];
  readonly projectNeedsStrongIsolation: boolean;
  readonly policyRequiresStrongIsolation: boolean;
}): SandboxSelection {
  const container = input.availableContainers[0];
  if (container) {
    return {
      mode: "strong_container",
      label: `${container === "docker" ? "Docker" : "Podman"} container`,
      strength: "strong",
      summary: `Strong container isolation is available through ${container}.`,
      capabilities: [
        "bounded_process",
        "network_allowlist",
        "workspace_mount",
        "resource_limits",
      ],
      restrictions: ["no_host_secrets", "no_unapproved_network"],
      action: null,
      verification:
        "A bounded canary starts without host secrets and cannot reach a denied host.",
    };
  }
  if (input.projectNeedsStrongIsolation || input.policyRequiresStrongIsolation) {
    return {
      mode: "blocked",
      label: "Strong isolation required",
      strength: "unavailable",
      summary:
        "This project requires container isolation, but Docker or Podman is not available.",
      capabilities: [],
      restrictions: ["execution_blocked"],
      action:
        "Install Docker Desktop or Podman using the linked platform instructions, verify it is running, then Resume.",
      verification:
        "A supported container runtime answers its version check and passes the isolation canary.",
    };
  }
  return {
    mode: "native_bounded",
    label: "Native bounded mode",
    strength: "reduced",
    summary:
      "Docker is optional for this project. Native bounded mode is available with reduced isolation.",
    capabilities: [
      "bounded_process",
      "workspace_scope",
      "command_allowlist",
      "output_limits",
    ],
    restrictions: [
      "no_unrestricted_shell",
      "no_protected_paths",
      "no_unapproved_network",
      "no_secret_injection",
    ],
    action: null,
    verification:
      "Traversal, protected-path, unknown-command, secret, and denied-network canaries are refused.",
  };
}

