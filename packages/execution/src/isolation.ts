import { createHash } from "node:crypto";

import {
  isolatedWorkspaceSchema,
  isolationProfileSchema,
  type IsolatedWorkspace,
  type IsolationProfile
} from "./contracts.js";

export const isolationProfiles: readonly IsolationProfile[] = [
  isolationProfileSchema.parse({
    schemaVersion: 1,
    id: "container-strong",
    label: "Container workspace",
    mode: "strong_container",
    strengthLabel: "Strong isolation",
    capabilities: [
      "filesystem_read",
      "filesystem_write",
      "process_spawn",
      "network_allowlist",
      "secret_reference",
      "preview",
      "screenshot"
    ],
    limits: {
      cpuPercent: 70,
      memoryMb: 4_096,
      diskMb: 20_480,
      processCount: 128,
      timeoutMs: 3_600_000,
      network: "allowlist"
    },
    secretReferences: []
  }),
  isolationProfileSchema.parse({
    schemaVersion: 1,
    id: "native-bounded",
    label: "Constrained local workspace",
    mode: "native_constrained",
    strengthLabel: "Reduced isolation",
    capabilities: [
      "filesystem_read",
      "filesystem_write",
      "process_spawn",
      "network_allowlist",
      "preview",
      "screenshot"
    ],
    limits: {
      cpuPercent: 50,
      memoryMb: 2_048,
      diskMb: 10_240,
      processCount: 64,
      timeoutMs: 1_800_000,
      network: "allowlist"
    },
    secretReferences: []
  }),
  isolationProfileSchema.parse({
    schemaVersion: 1,
    id: "remote-paired",
    label: "Paired remote worker",
    mode: "remote_worker",
    strengthLabel: "Remote isolation",
    capabilities: [
      "filesystem_read",
      "filesystem_write",
      "process_spawn",
      "network_allowlist",
      "secret_reference",
      "preview",
      "screenshot",
      "local_model"
    ],
    limits: {
      cpuPercent: 80,
      memoryMb: 6_144,
      diskMb: 30_720,
      processCount: 160,
      timeoutMs: 7_200_000,
      network: "allowlist"
    },
    secretReferences: []
  })
];

export function createIsolatedWorkspace(input: {
  readonly taskId: string;
  readonly runId: string;
  readonly baseline: string;
  readonly profile: unknown;
  readonly createdAt: number;
}): IsolatedWorkspace {
  const profile = isolationProfileSchema.parse(input.profile);
  const suffix = hash(input.runId).slice(0, 10);
  const slug = input.taskId.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  if (!slug) throw new Error("Task ID cannot produce an isolated workspace.");
  const workspaceRef = `workspace:${hash(`${input.taskId}:${input.runId}`).slice(0, 16)}`;
  const branch = `studio/${slug}-${suffix}`;
  const body = {
    schemaVersion: 1 as const,
    taskId: input.taskId,
    runId: input.runId,
    workspaceRef,
    branch,
    baseline: input.baseline,
    profileId: profile.id,
    state: "active" as const,
    ancestryVerified: true,
    createdAt: input.createdAt,
    recoverUntil: null
  };
  return isolatedWorkspaceSchema.parse({
    ...body,
    stateDigest: hash(JSON.stringify(body))
  });
}

export function abandonWorkspace(input: {
  readonly workspace: unknown;
  readonly now: number;
  readonly recoveryWindowMs: number;
}): IsolatedWorkspace {
  const workspace = isolatedWorkspaceSchema.parse(input.workspace);
  if (input.recoveryWindowMs < 60_000) throw new Error("Recovery window is too short.");
  return updateState(workspace, "recoverable", input.now + input.recoveryWindowMs);
}

export function evaluateWorkspaceCleanup(
  workspaceInput: unknown,
  now: number
): { readonly action: "preserve" | "cleanup"; readonly workspace: IsolatedWorkspace } {
  const workspace = isolatedWorkspaceSchema.parse(workspaceInput);
  if (workspace.state !== "recoverable" || workspace.recoverUntil === null || now < workspace.recoverUntil) {
    return { action: "preserve", workspace };
  }
  return { action: "cleanup", workspace: updateState(workspace, "cleanup_ready", workspace.recoverUntil) };
}

export function pauseWorkspace(workspaceInput: unknown): IsolatedWorkspace {
  const workspace = isolatedWorkspaceSchema.parse(workspaceInput);
  return updateState(workspace, "paused", workspace.recoverUntil);
}

function updateState(
  workspace: IsolatedWorkspace,
  state: IsolatedWorkspace["state"],
  recoverUntil: number | null
): IsolatedWorkspace {
  const body = { ...workspace, state, recoverUntil };
  return isolatedWorkspaceSchema.parse({
    ...body,
    stateDigest: hash(JSON.stringify({ ...body, stateDigest: undefined }))
  });
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
