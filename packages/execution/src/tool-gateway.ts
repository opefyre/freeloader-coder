import { createHash } from "node:crypto";

import {
  toolInvocationSchema,
  toolReceiptSchema,
  type IsolationProfile,
  type ToolEffect,
  type ToolInvocation,
  type ToolKind,
  type ToolReceipt
} from "./contracts.js";

export const toolEffectPolicy: Readonly<Record<ToolKind, readonly ToolEffect[]>> = {
  read: ["read_project"],
  search: ["read_project"],
  patch: ["read_project", "write_project"],
  format: ["read_project", "write_project", "run_process"],
  command: ["run_process"],
  git: ["read_project", "write_git"],
  screenshot: ["start_preview", "create_artifact"],
  preview: ["run_process", "start_preview"],
  artifact: ["create_artifact"],
  checkpoint: ["read_project", "write_git", "create_checkpoint"]
};

export function authorizeToolInvocation(input: {
  readonly invocation: unknown;
  readonly isolation: IsolationProfile;
  readonly protectedPaths: readonly string[];
  readonly symlinkPaths: readonly string[];
  readonly allowedCommandIds: readonly string[];
  readonly allowedNetworkHosts: readonly string[];
}): ToolInvocation {
  const invocation = toolInvocationSchema.parse(input.invocation);
  const allowedEffects = toolEffectPolicy[invocation.tool];
  if (invocation.declaredEffects.some((effect) => !allowedEffects.includes(effect))) {
    throw new Error("Tool invocation declares an effect that the tool does not own.");
  }
  if (invocation.paths.some((path) =>
    input.protectedPaths.some((protectedPath) =>
      path === protectedPath || path.startsWith(`${protectedPath}/`)
    )
  )) {
    throw new Error("Tool invocation targets a protected path.");
  }
  if (invocation.paths.some((path) => input.symlinkPaths.includes(path))) {
    throw new Error("Tool invocation cannot follow a project symlink.");
  }
  if (
    invocation.tool === "command"
    && (invocation.commandId === null || !input.allowedCommandIds.includes(invocation.commandId))
  ) {
    throw new Error("Command is not declared by project policy.");
  }
  if (invocation.networkHosts.some((host) => !input.allowedNetworkHosts.includes(host))) {
    throw new Error("Network host is outside the declared allowlist.");
  }
  if (
    invocation.networkHosts.length > 0
    && !input.isolation.capabilities.includes("network_allowlist")
    && !input.isolation.capabilities.includes("network_unrestricted")
  ) {
    throw new Error("Isolation profile does not allow network access.");
  }
  return invocation;
}

export function recordToolResult(input: {
  readonly invocation: unknown;
  readonly output: string;
  readonly exitStatus: ToolReceipt["exitStatus"];
  readonly durationMs: number;
  readonly observedEffects: readonly ToolEffect[];
  readonly sensitive: boolean;
}): ToolReceipt {
  const invocation = toolInvocationSchema.parse(input.invocation);
  if (input.observedEffects.some((effect) => !invocation.declaredEffects.includes(effect))) {
    throw new Error("Tool produced an undeclared effect.");
  }
  const redacted = redact(input.output);
  const large = Buffer.byteLength(redacted.value, "utf8") > invocation.maxOutputBytes;
  const artifactRequired = input.sensitive || large;
  const artifactRef = artifactRequired
    ? `artifact:${hash(redacted.value).slice(0, 16)}`
    : null;
  const excerpt = artifactRequired
    ? `${redacted.value.slice(0, Math.min(240, invocation.maxOutputBytes))}\n[full output stored locally]`
    : redacted.value;
  return toolReceiptSchema.parse({
    schemaVersion: 1,
    invocationId: invocation.id,
    tool: invocation.tool,
    inputDigest: hash(JSON.stringify(invocation)),
    outputSummary: artifactRequired
      ? "Output was summarized; the full redacted result is stored as a local artifact."
      : "Tool completed with bounded inline output.",
    outputExcerpt: excerpt,
    artifactRef,
    exitStatus: input.exitStatus,
    durationMs: input.durationMs,
    observedEffects: input.observedEffects,
    redactions: redacted.count
  });
}

function redact(value: string): { readonly value: string; readonly count: number } {
  let count = 0;
  const redacted = value
    .replace(
      /(token|secret|password|api[_-]?key)\s*[=:]\s*\S+/gi,
      (_match, label: string) => {
        count += 1;
        return `${label}=[redacted]`;
      }
    )
    .replace(/sk-[a-z0-9_-]{12,}/gi, () => {
      count += 1;
      return "[redacted]";
    })
    .replace(/\/Users\/[^/\s]+/g, () => {
      count += 1;
      return "/Users/[local-user]";
    });
  return { value: redacted, count };
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
