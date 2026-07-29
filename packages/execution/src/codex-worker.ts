import { z } from "zod";

const version = z.literal(1);

export const codexWorkerConnectionSchema = z.strictObject({
  schemaVersion: version,
  connectionId: z.string().regex(/^[a-z0-9][a-z0-9._-]+$/),
  state: z.enum(["unconfigured", "disabled", "ready"]),
  interface: z.enum(["sdk", "app_server"]),
  authentication: z.literal("codex_login"),
  copiedBrowserSession: z.literal(false),
  copiedUndocumentedCredential: z.literal(false),
});
export type CodexWorkerConnection = z.infer<typeof codexWorkerConnectionSchema>;

export const codexWorkPlanSchema = z.strictObject({
  schemaVersion: version,
  workId: z.string().regex(/^[a-z0-9][a-z0-9._-]+$/),
  connectionId: z.string().min(3).max(120),
  interface: z.enum(["sdk", "app_server"]),
  threadLifecycle: z.enum(["new", "resume"]),
  sandbox: z.enum(["read_only", "workspace_write"]),
  approvalPolicy: z.enum(["untrusted", "on_request"]),
  allowedTools: z.array(z.string().min(1).max(120)).max(100),
  requiredValidations: z.array(z.string().min(1).max(120)).min(1).max(50),
  requiredReviews: z.array(z.enum(["functional", "design", "security"])).min(2),
  localEvidenceRequired: z.literal(true),
  completionIsUnverified: z.literal(true),
});
export type CodexWorkPlan = z.infer<typeof codexWorkPlanSchema>;

export type CodexWorkerDecision =
  | { readonly allowed: true; readonly plan: CodexWorkPlan }
  | { readonly allowed: false; readonly reason: string; readonly detail: string };

export function planCodexWork(input: {
  readonly connection: CodexWorkerConnection;
  readonly workId: string;
  readonly sandbox: CodexWorkPlan["sandbox"];
  readonly allowedTools: readonly string[];
  readonly requiredValidations: readonly string[];
  readonly requiredReviews: readonly CodexWorkPlan["requiredReviews"][number][];
}): CodexWorkerDecision {
  const connection = codexWorkerConnectionSchema.parse(input.connection);
  if (connection.state !== "ready") {
    return {
      allowed: false,
      reason: "codex-not-connected",
      detail: "Codex login is not connected or the worker is disabled.",
    };
  }
  return {
    allowed: true,
    plan: codexWorkPlanSchema.parse({
      schemaVersion: 1,
      workId: input.workId,
      connectionId: connection.connectionId,
      interface: connection.interface,
      threadLifecycle: "new",
      sandbox: input.sandbox,
      approvalPolicy: "on_request",
      allowedTools: [...input.allowedTools],
      requiredValidations: [...input.requiredValidations],
      requiredReviews: [...input.requiredReviews],
      localEvidenceRequired: true,
      completionIsUnverified: true,
    }),
  };
}

export const disconnectedCodexWorker: CodexWorkerConnection = {
  schemaVersion: 1,
  connectionId: "codex-worker",
  state: "unconfigured",
  interface: "app_server",
  authentication: "codex_login",
  copiedBrowserSession: false,
  copiedUndocumentedCredential: false,
};
