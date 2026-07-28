import { createHash } from "node:crypto";

import { z } from "zod";

const id = z.string().trim().regex(/^[a-z][a-z0-9._-]{2,127}$/);
const version = z.string().regex(/^\d+\.\d+\.\d+$/);
const schema = z.record(z.string(), z.unknown());

export const toolOriginSchema = z.enum([
  "official",
  "verified_community",
  "local_development",
  "unverified"
]);

export const toolEffectSchema = z.enum([
  "read_project",
  "write_project",
  "run_process",
  "read_network",
  "write_network",
  "write_git",
  "create_artifact",
  "create_checkpoint"
]);

export const toolDefinitionSchema = z.strictObject({
  schemaVersion: z.literal(1),
  id,
  version,
  title: z.string().trim().min(1).max(120),
  description: z.string().trim().min(1).max(500),
  origin: toolOriginSchema,
  publisher: z.string().trim().min(1).max(120),
  sourceUrl: z.url(),
  signature: z.string().regex(/^sha256:[a-f0-9]{64}$/).nullable(),
  inputSchema: schema,
  outputSchema: schema,
  capabilities: z.array(id).max(50),
  effects: z.array(toolEffectSchema).min(1),
  reversible: z.boolean(),
  idempotent: z.boolean(),
  timeoutMs: z.number().int().min(1_000).max(3_600_000),
  retryLimit: z.number().int().min(0).max(5),
  compensation: z.string().trim().min(1).max(500),
  postcondition: z.string().trim().min(1).max(500),
  evidence: z.string().trim().min(1).max(500),
  redaction: z.string().trim().min(1).max(500),
  compatibility: z.strictObject({
    core: z.string().regex(/^\^\d+\.\d+\.\d+$/),
    platforms: z.array(z.enum(["darwin-arm64", "darwin-x64", "linux-arm64", "linux-x64"])).min(1)
  })
}).superRefine((tool, context) => {
  if (tool.origin !== "local_development" && tool.signature === null) {
    context.addIssue({ code: "custom", message: "Published tools require a signature." });
  }
  if (!tool.reversible && tool.compensation.toLowerCase().includes("undo")) {
    context.addIssue({ code: "custom", message: "Irreversible tools cannot promise undo." });
  }
});

export type ToolDefinition = z.infer<typeof toolDefinitionSchema>;
export type ToolEffect = z.infer<typeof toolEffectSchema>;
export type ToolOrigin = z.infer<typeof toolOriginSchema>;

export interface ToolGrant {
  readonly projectId: string;
  readonly toolId: string;
  readonly version: string;
  readonly capabilities: readonly string[];
  readonly effects: readonly ToolEffect[];
  readonly approvedAt: number;
  readonly expiresAt: number;
  readonly revokedAt: number | null;
}

export interface ToolInvocationPlan {
  readonly invocationId: string;
  readonly projectId: string;
  readonly tool: ToolDefinition;
  readonly input: Readonly<Record<string, unknown>>;
  readonly effects: readonly ToolEffect[];
  readonly idempotencyKey: string;
  readonly deadlineAt: number;
  readonly inputDigest: string;
}

export interface ToolInvocationRecord {
  readonly plan: ToolInvocationPlan;
  readonly state: "planned" | "running" | "succeeded" | "failed" | "timed_out" | "cancelled" | "compensated";
  readonly effects: readonly { readonly effectId: string; readonly effect: ToolEffect }[];
  readonly compensationEvidence: string | null;
  readonly updatedAt: number;
}

export class ToolRegistry {
  readonly #tools = new Map<string, ToolDefinition>();

  register(input: unknown): ToolDefinition {
    const tool = toolDefinitionSchema.parse(input);
    const current = this.#tools.get(tool.id);
    if (current && compareVersions(tool.version, current.version) <= 0) {
      throw new Error("Tool version must move forward.");
    }
    this.#tools.set(tool.id, tool);
    return tool;
  }

  get(toolId: string): ToolDefinition | null {
    return this.#tools.get(toolId) ?? null;
  }

  list(): readonly ToolDefinition[] {
    return [...this.#tools.values()].sort((left, right) => left.title.localeCompare(right.title));
  }

  plan(input: {
    readonly invocationId: string;
    readonly projectId: string;
    readonly toolId: string;
    readonly version: string;
    readonly payload: Readonly<Record<string, unknown>>;
    readonly requestedEffects: readonly ToolEffect[];
    readonly grant: ToolGrant | null;
    readonly idempotencyKey: string;
    readonly now: number;
  }): ToolInvocationPlan {
    const tool = this.#tools.get(input.toolId);
    if (!tool || tool.version !== input.version) throw new Error("Tool is unknown or incompatible.");
    const grant = input.grant;
    if (
      !grant
      || grant.projectId !== input.projectId
      || grant.toolId !== tool.id
      || grant.version !== tool.version
      || grant.revokedAt !== null
      || grant.expiresAt <= input.now
    ) {
      throw new Error("A current project grant is required.");
    }
    if (input.requestedEffects.some((effect) => !tool.effects.includes(effect))) {
      throw new Error("Invocation requests an undeclared tool effect.");
    }
    if (input.requestedEffects.some((effect) => !grant.effects.includes(effect))) {
      throw new Error("Invocation exceeds the approved effect grant.");
    }
    if (tool.capabilities.some((capability) => !grant.capabilities.includes(capability))) {
      throw new Error("Invocation exceeds the approved capability grant.");
    }
    if (!matchesObjectSchema(input.payload, tool.inputSchema)) {
      throw new Error("Tool input does not match its declared schema.");
    }
    return {
      invocationId: input.invocationId,
      projectId: input.projectId,
      tool,
      input: input.payload,
      effects: input.requestedEffects,
      idempotencyKey: input.idempotencyKey,
      deadlineAt: input.now + tool.timeoutMs,
      inputDigest: digest(JSON.stringify(input.payload))
    };
  }
}

export class ToolInvocationLedger {
  readonly #records = new Map<string, ToolInvocationRecord>();

  begin(plan: ToolInvocationPlan, now: number): {
    readonly record: ToolInvocationRecord;
    readonly replayed: boolean;
  } {
    const current = this.#records.get(plan.idempotencyKey);
    if (current) {
      if (
        current.plan.tool.id !== plan.tool.id
        || current.plan.tool.version !== plan.tool.version
        || current.plan.inputDigest !== plan.inputDigest
        || current.plan.effects.join(",") !== plan.effects.join(",")
      ) {
        throw new Error("Idempotency key was reused for different work.");
      }
      return { record: current, replayed: true };
    }
    if (now >= plan.deadlineAt) throw new Error("Invocation deadline already expired.");
    const record: ToolInvocationRecord = {
      plan,
      state: "planned",
      effects: [],
      compensationEvidence: null,
      updatedAt: now
    };
    this.#records.set(plan.idempotencyKey, record);
    return { record, replayed: false };
  }

  start(idempotencyKey: string, now: number): ToolInvocationRecord {
    const current = this.#require(idempotencyKey);
    if (current.state !== "planned") throw new Error("Only planned work can start.");
    if (now >= current.plan.deadlineAt) return this.timeout(idempotencyKey, now);
    return this.#replace(current, { ...current, state: "running", updatedAt: now });
  }

  recordEffect(input: {
    readonly idempotencyKey: string;
    readonly effectId: string;
    readonly effect: ToolEffect;
    readonly now: number;
  }): ToolInvocationRecord {
    const current = this.#require(input.idempotencyKey);
    if (current.state !== "running") throw new Error("Effects require a running invocation.");
    if (!current.plan.effects.includes(input.effect)) throw new Error("Effect was not declared.");
    if (current.effects.some((effect) => effect.effectId === input.effectId)) {
      throw new Error("Duplicate effect was rejected.");
    }
    return this.#replace(current, {
      ...current,
      effects: [...current.effects, { effectId: input.effectId, effect: input.effect }],
      updatedAt: input.now
    });
  }

  cancel(idempotencyKey: string, now: number): ToolInvocationRecord {
    const current = this.#require(idempotencyKey);
    if (!["planned", "running"].includes(current.state)) {
      throw new Error("Completed invocation cannot be cancelled.");
    }
    if (current.effects.length > 0 && !current.plan.tool.reversible) {
      throw new Error("Irreversible effects require user reconciliation.");
    }
    return this.#replace(current, { ...current, state: "cancelled", updatedAt: now });
  }

  timeout(idempotencyKey: string, now: number): ToolInvocationRecord {
    const current = this.#require(idempotencyKey);
    if (now < current.plan.deadlineAt) throw new Error("Invocation deadline has not expired.");
    if (!["planned", "running"].includes(current.state)) {
      throw new Error("Terminal invocation cannot time out.");
    }
    return this.#replace(current, { ...current, state: "timed_out", updatedAt: now });
  }

  compensate(input: {
    readonly idempotencyKey: string;
    readonly evidence: string;
    readonly now: number;
  }): ToolInvocationRecord {
    const current = this.#require(input.idempotencyKey);
    if (!current.plan.tool.reversible || current.effects.length === 0) {
      throw new Error("Invocation has no compensable effect.");
    }
    if (!["cancelled", "failed", "timed_out"].includes(current.state)) {
      throw new Error("Only interrupted or failed work can be compensated.");
    }
    if (input.evidence.trim().length === 0) throw new Error("Compensation requires observed evidence.");
    return this.#replace(current, {
      ...current,
      state: "compensated",
      compensationEvidence: input.evidence,
      updatedAt: input.now
    });
  }

  #require(idempotencyKey: string): ToolInvocationRecord {
    const current = this.#records.get(idempotencyKey);
    if (!current) throw new Error("Invocation is unknown.");
    return current;
  }

  #replace(
    current: ToolInvocationRecord,
    next: ToolInvocationRecord
  ): ToolInvocationRecord {
    this.#records.set(current.plan.idempotencyKey, next);
    return next;
  }
}

export function validateToolResult(input: {
  readonly plan: ToolInvocationPlan;
  readonly output: Readonly<Record<string, unknown>>;
  readonly observedEffects: readonly ToolEffect[];
  readonly postconditionObserved: boolean;
}): { readonly outputDigest: string; readonly verified: true } {
  if (input.observedEffects.some((effect) => !input.plan.effects.includes(effect))) {
    throw new Error("Tool produced an undeclared effect.");
  }
  if (!matchesObjectSchema(input.output, input.plan.tool.outputSchema)) {
    throw new Error("Tool output does not match its declared schema.");
  }
  if (!input.postconditionObserved) throw new Error("Tool postcondition was not observed.");
  return { outputDigest: digest(JSON.stringify(input.output)), verified: true };
}

function matchesObjectSchema(
  value: Readonly<Record<string, unknown>>,
  declared: Readonly<Record<string, unknown>>
): boolean {
  const required = Array.isArray(declared.required)
    ? declared.required.filter((item): item is string => typeof item === "string")
    : [];
  return required.every((field) => Object.hasOwn(value, field));
}

function compareVersions(left: string, right: string): number {
  const a = left.split(".").map(Number);
  const b = right.split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
