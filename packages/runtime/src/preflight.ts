import { createHash } from "node:crypto";

import {
  preflightReportSchema,
  preflightSnapshotSchema,
  setupStateSchema,
  type PreflightReport,
  type PreflightRequirement,
  type PreflightSnapshot,
  type SetupState,
} from "./contracts.js";
import { selectSandboxMode } from "./sandbox.js";

const MINIMUM_MEMORY_GB = 7;
const MINIMUM_DISK_GB = 5;

export function runPreflight(
  input: unknown,
  options: {
    readonly now: number;
    readonly profileId: string;
    readonly projectNeedsStrongIsolation?: boolean;
  }
): PreflightReport {
  const snapshot = preflightSnapshotSchema.parse(input);
  const requirements: PreflightRequirement[] = [
    requirement(
      "node",
      "Node.js",
      snapshot.nodeMajor >= 22 ? "ready" : "unsupported",
      snapshot.nodeMajor >= 22 ? "required_now" : "needs_user",
      snapshot.nodeMajor >= 22
        ? `Node ${snapshot.nodeMajor} is supported.`
        : `Node ${snapshot.nodeMajor} is too old.`,
      snapshot.nodeMajor >= 22
        ? null
        : "Install Node.js 22 LTS or newer, then choose Resume preflight.",
      "node --version reports major version 22 or newer."
    ),
    requirement(
      "npm",
      "npm",
      snapshot.npmMajor >= 10 ? "ready" : "unsupported",
      snapshot.npmMajor >= 10 ? "required_now" : "needs_user",
      snapshot.npmMajor >= 10
        ? `npm ${snapshot.npmMajor} is supported.`
        : `npm ${snapshot.npmMajor} is too old.`,
      snapshot.npmMajor >= 10
        ? null
        : "Install npm 10 or newer through the supported Node.js installer, then Resume.",
      "npm --version reports major version 10 or newer."
    ),
    requirement(
      "git",
      "Git",
      snapshot.gitAvailable ? "ready" : "missing",
      snapshot.gitAvailable ? "required_now" : "needs_user",
      snapshot.gitAvailable ? "Git is available." : "Git is required to protect and restore work.",
      snapshot.gitAvailable
        ? null
        : "Install Git using the operating-system package, then choose Resume preflight.",
      "git --version exits successfully."
    ),
    requirement(
      "architecture",
      "Computer architecture",
      "ready",
      "required_now",
      `${snapshot.platform}/${snapshot.architecture} is in the supported setup matrix.`,
      null,
      "Platform and CPU architecture match a supported phase."
    ),
    requirement(
      "memory",
      "Memory",
      snapshot.totalMemoryGb >= MINIMUM_MEMORY_GB ? "ready" : "unsupported",
      snapshot.totalMemoryGb >= MINIMUM_MEMORY_GB ? "required_now" : "needs_user",
      snapshot.totalMemoryGb >= MINIMUM_MEMORY_GB
        ? `${snapshot.totalMemoryGb.toFixed(1)} GB is enough for Lightweight mode.`
        : `${snapshot.totalMemoryGb.toFixed(1)} GB is below the supported minimum.`,
      snapshot.totalMemoryGb >= MINIMUM_MEMORY_GB
        ? null
        : "Use a supported computer with at least 8 GB memory.",
      "Observed memory is at least 7 GB after platform reporting variance."
    ),
    requirement(
      "disk",
      "Free disk",
      snapshot.freeDiskGb >= MINIMUM_DISK_GB ? "ready" : "missing",
      snapshot.freeDiskGb >= MINIMUM_DISK_GB ? "required_now" : "needs_user",
      snapshot.freeDiskGb >= MINIMUM_DISK_GB
        ? `${snapshot.freeDiskGb.toFixed(1)} GB is available.`
        : `${snapshot.freeDiskGb.toFixed(1)} GB is not enough for safe worktrees and artifacts.`,
      snapshot.freeDiskGb >= MINIMUM_DISK_GB
        ? null
        : "Free at least 5 GB on this volume, then Resume preflight.",
      "The project volume reports at least 5 GB free."
    ),
    requirement(
      "state_directory",
      "Local state",
      snapshot.stateDirectoryWritable ? "ready" : "missing",
      snapshot.stateDirectoryWritable ? "required_now" : "needs_user",
      snapshot.stateDirectoryWritable
        ? "Private runtime state is writable outside source control."
        : "The private runtime state directory is not writable.",
      snapshot.stateDirectoryWritable
        ? null
        : "Allow this user to write the local Codkesh state directory, then Resume.",
      "A user-only probe file can be created and removed."
    ),
  ];

  const selectedPort = selectLoopbackPort(
    snapshot.preferredPort,
    snapshot.occupiedPorts
  );
  requirements.push(
    requirement(
      "loopback_port",
      "Local web address",
      selectedPort === null ? "conflict" : "ready",
      selectedPort === null ? "needs_user" : "auto_repairable",
      selectedPort === null
        ? "No safe loopback port is available in the bounded search window."
        : selectedPort === snapshot.preferredPort
          ? `Loopback port ${selectedPort} is available.`
          : `Port ${snapshot.preferredPort} is occupied; ${selectedPort} was selected safely.`,
      selectedPort === null
        ? "Stop the conflicting local application or select an Advanced port, then Resume."
        : null,
      "The selected port binds only to 127.0.0.1 or ::1 and is not occupied."
    )
  );

  const controllerConflict =
    snapshot.activeController !== null &&
    snapshot.activeController.profileId === options.profileId &&
    snapshot.activeController.expiresAt > options.now;
  requirements.push(
    requirement(
      "controller",
      "Single controller",
      controllerConflict ? "conflict" : "ready",
      controllerConflict ? "needs_user" : "required_now",
      controllerConflict
        ? "This profile already has an active controller."
        : "No competing controller owns this profile.",
      controllerConflict
        ? "Open the existing Codkesh window or stop that instance before Resume."
        : null,
      "At most one unexpired controller lease exists for this profile."
    )
  );

  const sandbox = selectSandboxMode({
    platform: snapshot.platform,
    availableContainers: snapshot.containerRuntimes,
    projectNeedsStrongIsolation: options.projectNeedsStrongIsolation ?? false,
    policyRequiresStrongIsolation: false,
  });
  requirements.push(
    requirement(
      "container",
      "Execution isolation",
      sandbox.mode === "blocked" ? "missing" : "ready",
      sandbox.mode === "blocked" ? "needs_user" : "optional",
      sandbox.summary,
      sandbox.action,
      sandbox.verification
    ),
    requirement(
      "local-model-runtime",
      "Local models",
      snapshot.localModelRuntimeAvailable ? "ready" : "missing",
      "optional",
      snapshot.localModelRuntimeAvailable
        ? "A local model runtime is available as an optional final fallback."
        : "No local model runtime is installed; external free providers and offline test data still work.",
      null,
      "Local-model availability never blocks setup."
    )
  );

  const hasUnsupported = requirements.some(
    (item) => item.state === "unsupported"
  );
  const hasRequiredAction = requirements.some(
    (item) =>
      item.state !== "ready" &&
      item.disposition !== "optional" &&
      item.disposition !== "auto_repairable"
  );
  return preflightReportSchema.parse({
    schemaVersion: 1,
    state: hasUnsupported
      ? "unsupported"
      : hasRequiredAction
        ? "needs_action"
        : "ready",
    requirements,
    selectedPort,
    selectedSandbox: sandbox.mode,
    resumeToken: `setup_${digest({
      snapshot,
      profileId: options.profileId,
    }).slice(0, 24)}`,
    generatedAt: options.now,
  });
}

export function createSetupState(input: {
  readonly profileId: string;
  readonly report: PreflightReport;
  readonly previous?: SetupState;
  readonly configuration?: Readonly<Record<string, string>>;
  readonly now: number;
}): SetupState {
  const previous = input.previous
    ? setupStateSchema.parse(input.previous)
    : undefined;
  if (previous && previous.profileId !== input.profileId) {
    throw new Error("Setup state belongs to a different profile.");
  }
  const configuration = {
    ...(previous?.configuration ?? {}),
    ...(input.configuration ?? {}),
  };
  for (const [key, value] of Object.entries(configuration)) {
    if (/token|secret|password|api[_-]?key/i.test(key + value)) {
      throw new Error("Setup configuration cannot contain secret material.");
    }
  }
  return setupStateSchema.parse({
    schemaVersion: 1,
    profileId: input.profileId,
    state: input.report.state === "ready" ? "ready" : "needs_action",
    reportDigest: digest(input.report),
    selectedPort: input.report.selectedPort,
    selectedSandbox: input.report.selectedSandbox,
    credentialStore: "operating_system",
    configuration,
    updatedAt: input.now,
  });
}

export function resumeSetup(input: {
  readonly current: SetupState;
  readonly report: PreflightReport;
  readonly now: number;
}): SetupState {
  return createSetupState({
    profileId: input.current.profileId,
    previous: input.current,
    report: input.report,
    now: input.now,
  });
}

export function selectLoopbackPort(
  preferred: number,
  occupied: readonly number[]
): number | null {
  const occupiedSet = new Set(occupied);
  for (let candidate = preferred; candidate <= Math.min(65_535, preferred + 50); candidate += 1) {
    if (!occupiedSet.has(candidate)) return candidate;
  }
  return null;
}

function requirement(
  id: PreflightRequirement["id"],
  label: string,
  state: PreflightRequirement["state"],
  disposition: PreflightRequirement["disposition"],
  summary: string,
  action: string | null,
  verification: string
): PreflightRequirement {
  return { id, label, state, disposition, summary, action, verification };
}

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
