import { createHash } from "node:crypto";

import {
  checkpointDecisionSchema,
  executionCheckpointSchema,
  type CheckpointDecision,
  type ExecutionCheckpoint
} from "./contracts.js";

export function createExecutionCheckpoint(
  input: Omit<ExecutionCheckpoint, "schemaVersion">
): ExecutionCheckpoint {
  return executionCheckpointSchema.parse({ schemaVersion: 1, ...input });
}

export function analyzeCheckpointApplication(input: {
  readonly checkpoint: unknown;
  readonly unrelatedUserPaths: readonly string[];
}): {
  readonly mode: "automatic" | "guided_conflict";
  readonly applyPaths: readonly string[];
  readonly preservedPaths: readonly string[];
  readonly conflicts: ExecutionCheckpoint["conflicts"];
  readonly options: readonly string[];
} {
  const checkpoint = executionCheckpointSchema.parse(input.checkpoint);
  if (checkpoint.conflicts.length === 0) {
    return {
      mode: "automatic",
      applyPaths: checkpoint.files,
      preservedPaths: [...input.unrelatedUserPaths].sort(),
      conflicts: [],
      options: ["Apply clean checkpoint", "Review affected features", "Restore baseline"]
    };
  }
  return {
    mode: "guided_conflict",
    applyPaths: checkpoint.files.filter(
      (path) => !checkpoint.conflicts.some((conflict) => conflict.path === path)
    ),
    preservedPaths: [...input.unrelatedUserPaths].sort(),
    conflicts: checkpoint.conflicts,
    options: [
      "Keep the current version",
      "Use the proposed version",
      "Open both versions side by side",
      "Restore the baseline"
    ]
  };
}

export function recordCheckpointDecision(input: {
  readonly checkpoint: unknown;
  readonly action: CheckpointDecision["action"];
  readonly actorId: string;
  readonly decidedAt: number;
  readonly reversible: boolean;
  readonly compensation: string;
}): CheckpointDecision {
  const checkpoint = executionCheckpointSchema.parse(input.checkpoint);
  return checkpointDecisionSchema.parse({
    schemaVersion: 1,
    id: `decision-${hash(`${checkpoint.id}:${input.action}:${input.decidedAt}`).slice(0, 16)}`,
    checkpointId: checkpoint.id,
    action: input.action,
    actorId: input.actorId,
    reversible: input.reversible,
    compensation: input.compensation,
    decidedAt: input.decidedAt,
    evidenceDigest: hash(JSON.stringify(checkpoint))
  });
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
