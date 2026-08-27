import { z } from "zod";

export const projectProgressEvidenceSchema = z.strictObject({
  source: z.enum(["jira", "execution", "lifecycle", "artifacts", "deployment"]),
  status: z.enum(["current", "stale", "unavailable"]),
  observedAt: z.number().int().nonnegative().nullable(),
  freshUntil: z.number().int().nonnegative().nullable(),
  reference: z.string().trim().min(1).max(500).nullable(),
});

export const projectProgressReconciliationSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    projectId: z.string().regex(/^project_[a-f0-9]{16}$/),
    progress: z
      .strictObject({
        completed: z.number().int().nonnegative(),
        total: z.number().int().nonnegative(),
        blocked: z.number().int().nonnegative(),
        percent: z.number().int().min(0).max(100).nullable(),
      })
      .nullable(),
    latest: z
      .strictObject({
        summary: z.string().trim().min(1).max(500),
        source: z.enum([
          "jira",
          "execution",
          "lifecycle",
          "artifacts",
          "deployment",
        ]),
        occurredAt: z.number().int().nonnegative(),
        reference: z.string().trim().min(1).max(2_048).nullable(),
      })
      .nullable(),
    confidence: z.enum(["verified", "partial", "unknown"]),
    disagreements: z
      .array(
        z.strictObject({
          code: z.enum([
            "task_state_conflict",
            "stale_source",
            "missing_jira",
            "project_mismatch",
          ]),
          issueKey: z.string().trim().min(1).max(100).nullable(),
          summary: z.string().trim().min(1).max(300),
        }),
      )
      .max(100),
    evidence: z.array(projectProgressEvidenceSchema).max(10),
    reconciledAt: z.number().int().nonnegative(),
  })
  .superRefine((value, context) => {
    if (
      value.progress &&
      (value.progress.completed > value.progress.total ||
        value.progress.blocked > value.progress.total)
    )
      context.addIssue({
        code: "custom",
        message: "Reconciled progress counts are inconsistent.",
      });
    if (value.progress?.total === 0 && value.progress.percent !== 0)
      context.addIssue({
        code: "custom",
        message: "An observed empty Jira project must report zero percent.",
      });
    if (
      value.progress &&
      value.progress.total > 0 &&
      value.progress.percent === null
    )
      context.addIssue({
        code: "custom",
        message: "Observed Jira work requires a percentage.",
      });
    if (!value.progress && value.confidence === "verified")
      context.addIssue({
        code: "custom",
        message: "Verified confidence requires observed Jira progress.",
      });
    if (value.disagreements.length > 0 && value.confidence === "verified")
      context.addIssue({
        code: "custom",
        message: "Conflicting evidence cannot be marked verified.",
      });
  });

export type ProjectProgressReconciliation = z.infer<
  typeof projectProgressReconciliationSchema
>;

export type JiraProgressObservation = {
  projectId: string;
  completed: number;
  total: number;
  blocked: number;
  observedAt: number;
  freshUntil: number;
  latest: {
    issueKey: string;
    summary: string;
    occurredAt: number;
    url: string;
  } | null;
  issues: ReadonlyMap<string, "todo" | "active" | "done" | "blocked">;
};

export type ExecutionProgressObservation = {
  projectId: string;
  observedAt: number;
  latest: { issueKey: string; summary: string; occurredAt: number } | null;
  issues: ReadonlyMap<string, "todo" | "active" | "done" | "blocked">;
};

export function reconcileProjectProgress(input: {
  projectId: string;
  jira: JiraProgressObservation | null;
  execution: ExecutionProgressObservation | null;
  lifecycle: { updatedAt: number; stage: string } | null;
  now: number;
}): ProjectProgressReconciliation {
  const mismatches = [input.jira, input.execution].filter(
    (item) => item && item.projectId !== input.projectId,
  );
  const jira = input.jira?.projectId === input.projectId ? input.jira : null;
  const execution =
    input.execution?.projectId === input.projectId ? input.execution : null;
  const verifiedTerminalCompletion =
    input.lifecycle?.stage === "complete" &&
    jira !== null &&
    jira.total > 0 &&
    jira.completed === jira.total &&
    jira.blocked === 0 &&
    jira.freshUntil >= input.now;
  const disagreements: ProjectProgressReconciliation["disagreements"] =
    mismatches.map(() => ({
      code: "project_mismatch",
      issueKey: null,
      summary: "Evidence for another project was rejected.",
    }));
  if (jira) {
    if (!verifiedTerminalCompletion) {
      for (const [issueKey, actual] of execution?.issues ?? []) {
        const reported = jira.issues.get(issueKey);
        if (reported && reported !== actual)
          disagreements.push({
            code: "task_state_conflict",
            issueKey,
            summary: `${issueKey} differs between Jira and validated execution.`,
          });
      }
    }
    if (jira.freshUntil < input.now)
      disagreements.push({
        code: "stale_source",
        issueKey: null,
        summary: "Jira progress is stale and must be refreshed.",
      });
  } else
    disagreements.push({
      code: "missing_jira",
      issueKey: null,
      summary: "Jira progress is unavailable; no percentage was inferred.",
    });

  const candidates = [
    jira?.latest
      ? {
          summary: `${jira.latest.issueKey} · ${jira.latest.summary}`,
          source: "jira" as const,
          occurredAt: jira.latest.occurredAt,
          reference: jira.latest.url,
        }
      : null,
    !verifiedTerminalCompletion && execution?.latest
      ? {
          summary: `${execution.latest.issueKey} · ${execution.latest.summary}`,
          source: "execution" as const,
          occurredAt: execution.latest.occurredAt,
          reference: null,
        }
      : null,
    input.lifecycle
      ? {
          summary: `Project entered ${input.lifecycle.stage.replaceAll("_", " ")}.`,
          source: "lifecycle" as const,
          occurredAt: input.lifecycle.updatedAt,
          reference: null,
        }
      : null,
  ]
    .filter((item): item is NonNullable<typeof item> => item !== null)
    .sort((left, right) => right.occurredAt - left.occurredAt);
  const evidence = [
    {
      source: "jira" as const,
      status: !jira
        ? ("unavailable" as const)
        : jira.freshUntil >= input.now
          ? ("current" as const)
          : ("stale" as const),
      observedAt: jira?.observedAt ?? null,
      freshUntil: jira?.freshUntil ?? null,
      reference: jira?.latest?.url ?? null,
    },
    {
      source: "execution" as const,
      status: execution ? ("current" as const) : ("unavailable" as const),
      observedAt: execution?.observedAt ?? null,
      freshUntil: execution ? input.now + 60_000 : null,
      reference: null,
    },
    {
      source: "lifecycle" as const,
      status: input.lifecycle ? ("current" as const) : ("unavailable" as const),
      observedAt: input.lifecycle?.updatedAt ?? null,
      freshUntil: input.lifecycle ? input.now + 60_000 : null,
      reference: null,
    },
  ];
  const confidence =
    jira && jira.freshUntil >= input.now && disagreements.length === 0
      ? "verified"
      : jira || execution || input.lifecycle
        ? "partial"
        : "unknown";
  return projectProgressReconciliationSchema.parse({
    schemaVersion: 1,
    projectId: input.projectId,
    progress: jira
      ? {
          completed: jira.completed,
          total: jira.total,
          blocked: jira.blocked,
          percent:
            jira.total === 0
              ? 0
              : Math.round((jira.completed / jira.total) * 100),
        }
      : null,
    latest: candidates[0] ?? null,
    confidence,
    disagreements,
    evidence,
    reconciledAt: input.now,
  });
}
