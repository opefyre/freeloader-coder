export type PipelineWorkKind =
  | "discovery"
  | "planning"
  | "implementation"
  | "review"
  | "general";

export interface PipelineRoutingHint {
  readonly workKind: PipelineWorkKind;
  readonly role: "implementer" | "reviewer";
  readonly estimatedInputTokens: number;
  readonly requestedOutputTokens: number;
  readonly requiresTools: boolean;
}

const REVIEW_PATTERN = /\b(review|audit|critique|verify|validate|qa)\b/i;
const IMPLEMENTATION_PATTERN = /\b(build|code|implement|fix|refactor|test)\b/i;
const PLANNING_PATTERN =
  /\b(plan|architect|design|decompose|break down|backlog|story)\b/i;
const DISCOVERY_PATTERN =
  /\b(research|discover|market|competitor|analy[sz]e)\b/i;
const TOOL_PATTERN =
  /\b(file|terminal|command|repository|repo|commit|jira|github|browser)\b/i;

export function derivePipelineRoutingHint(input: {
  readonly messages: readonly {
    readonly role: string;
    readonly content: unknown;
  }[];
  readonly maxTokens?: number | undefined;
  readonly tools?: readonly unknown[] | undefined;
}): PipelineRoutingHint {
  const prompt = input.messages
    .map((message) =>
      typeof message.content === "string" ? message.content : "",
    )
    .join("\n");
  const workKind = classifyWorkKind(prompt);
  return {
    workKind,
    role: workKind === "review" ? "reviewer" : "implementer",
    estimatedInputTokens: Math.max(1, Math.ceil(prompt.length / 4)),
    requestedOutputTokens: Math.max(
      1,
      Math.min(input.maxTokens ?? 8_192, 32_768),
    ),
    requiresTools: Boolean(input.tools?.length) || TOOL_PATTERN.test(prompt),
  };
}

function classifyWorkKind(prompt: string): PipelineWorkKind {
  if (REVIEW_PATTERN.test(prompt)) return "review";
  if (IMPLEMENTATION_PATTERN.test(prompt)) return "implementation";
  if (PLANNING_PATTERN.test(prompt)) return "planning";
  if (DISCOVERY_PATTERN.test(prompt)) return "discovery";
  return "general";
}
