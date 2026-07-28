import type {
  ApprovalContent,
  ChangeSummaryContent,
  ErrorContent,
  PlanContent,
  StandardContentPattern
} from "../../schemas/src/index.js";

export const standardCopyRules = {
  forbiddenBlame: [
    /\byou (?:did|entered|configured|caused)\b/i,
    /\buser error\b/i,
    /\byour fault\b/i
  ],
  forbiddenFalseCertainty: [
    /\bdefinitely (?:fixed|complete|safe)\b/i,
    /\bguaranteed\b/i,
    /\b100% (?:fixed|safe|complete)\b/i
  ],
  diagnosticLeak: [
    /\bat [A-Za-z0-9_$./-]+\([^)]*:\d+:\d+\)/,
    /\b(?:ERR|E|HTTP)_?[A-Z0-9_]{3,}\b/,
    /\/Users\/|[A-Z]:\\Users\\/
  ]
} as const;

export interface CopyFinding {
  rule: "blame" | "false_certainty" | "diagnostic_leak" | "missing_action";
  message: string;
}

export function inspectStandardCopy(pattern: StandardContentPattern): CopyFinding[] {
  const visibleCopy = standardVisibleCopy(pattern);
  const findings: CopyFinding[] = [];
  if (standardCopyRules.forbiddenBlame.some((rule) => rule.test(visibleCopy))) {
    findings.push({
      rule: "blame",
      message: "Standard copy must describe the condition without blaming the builder."
    });
  }
  if (standardCopyRules.forbiddenFalseCertainty.some((rule) => rule.test(visibleCopy))) {
    findings.push({
      rule: "false_certainty",
      message: "Completion and safety language must be evidence-scoped."
    });
  }
  if (standardCopyRules.diagnosticLeak.some((rule) => rule.test(visibleCopy))) {
    findings.push({
      rule: "diagnostic_leak",
      message: "Codes, stack traces, and full paths belong in Advanced details."
    });
  }
  if (
    pattern.kind === "error" &&
    (!pattern.preservedWork.trim() || !pattern.recommendedAction.trim())
  ) {
    findings.push({
      rule: "missing_action",
      message: "Errors must identify preserved work and one recommended next action."
    });
  }
  return findings;
}

export function approvalFacts(pattern: ApprovalContent): readonly {
  label: string;
  value: string;
}[] {
  return [
    { label: "Effect", value: pattern.whatChanges.join("; ") },
    { label: "Target", value: pattern.where.join("; ") },
    {
      label: "Cost",
      value:
        pattern.cost.mode === "paid" && pattern.cost.maximum
          ? `${pattern.cost.explanation} Maximum ${pattern.cost.maximum}.`
          : pattern.cost.explanation
    },
    { label: "Evidence", value: pattern.evidenceRequirement },
    { label: "Undo or compensation", value: pattern.undo.explanation }
  ];
}

export function primaryAction(pattern: StandardContentPattern): string {
  switch (pattern.kind) {
    case "plan":
      return pattern.questions.length > 0 ? "Answer questions" : "Review plan";
    case "approval":
      return pattern.recommendedAction;
    case "error":
      return pattern.recommendedAction;
    case "change_summary":
      return "Review evidence";
  }
}

export function standardVisibleCopy(pattern: StandardContentPattern): string {
  switch (pattern.kind) {
    case "plan":
      return [
        pattern.title,
        pattern.outcome,
        ...pattern.steps.flatMap((step) => [step.label, step.outcome]),
        ...pattern.assumptions,
        ...pattern.questions,
        pattern.whatThisMeans
      ].join(" ");
    case "approval":
      return [
        pattern.title,
        ...approvalFacts(pattern).flatMap((fact) => [fact.label, fact.value]),
        ...pattern.externalEffects,
        pattern.recommendedAction,
        pattern.alternativeAction
      ].join(" ");
    case "error":
      return [
        pattern.title,
        pattern.whatHappened,
        pattern.preservedWork,
        pattern.recommendedAction,
        pattern.alternativeAction
      ].join(" ");
    case "change_summary":
      return [
        pattern.title,
        pattern.before,
        pattern.after,
        pattern.whatThisMeans,
        ...pattern.evidence
      ].join(" ");
  }
}

export const contentPatternExamples: {
  plan: PlanContent;
  approval: ApprovalContent;
  error: ErrorContent;
  change: ChangeSummaryContent;
} = {
  plan: {
    schemaVersion: 1,
    kind: "plan",
    title: "Add a project activity timeline",
    outcome: "A builder can see what happened, what is running, and what needs attention.",
    steps: [
      {
        id: "ground",
        label: "Confirm the source events",
        outcome: "Every displayed state maps to canonical pipeline evidence.",
        effect: "read",
        status: "verified"
      },
      {
        id: "build",
        label: "Build the timeline surface",
        outcome: "The workspace explains work in chronological order.",
        effect: "local_change",
        status: "ready"
      },
      {
        id: "verify",
        label: "Validate behavior and language",
        outcome: "Automated checks and responsive review prove the result.",
        effect: "read",
        status: "proposed"
      }
    ],
    assumptions: ["The existing event journal remains canonical."],
    questions: [],
    whatThisMeans: "This changes local Studio code only and does not deploy anything."
  },
  approval: {
    schemaVersion: 1,
    kind: "approval",
    title: "Ready to apply the approved plan",
    whatChanges: ["Add the activity timeline UI", "Add contract tests and evidence"],
    where: ["Pipeline Studio repository", "Local feature branch"],
    externalEffects: [],
    evidenceRequirement:
      "Show the changed files, validation results, and the resulting local commit before completion.",
    cost: {
      mode: "free",
      explanation: "No paid provider or billable infrastructure will be used.",
      maximum: null
    },
    undo: {
      reversible: true,
      explanation: "Discard the local commit or restore the saved checkpoint."
    },
    recommendedAction: "Approve local changes",
    alternativeAction: "Edit the plan"
  },
  error: {
    schemaVersion: 1,
    kind: "error",
    title: "The validation step could not finish",
    whatHappened: "The selected free provider stopped accepting requests.",
    preservedWork: "Your plan, local changes, and last verified checkpoint are preserved.",
    recommendedAction: "Retry with the next free provider",
    alternativeAction: "Pause the task and review provider settings",
    retry: {
      automatic: true,
      attempted: 1,
      remaining: 2,
      nextAttemptAt: null
    },
    technicalCode: "PROVIDER_CAPACITY",
    technicalDetails: "Capacity response received before model execution."
  },
  change: {
    schemaVersion: 1,
    kind: "change_summary",
    title: "Workspace navigation is now interactive",
    before: "Navigation labels opened static anchors.",
    after: "Every primary destination opens a dedicated, URL-persisted surface.",
    whatThisMeans: "Builders can move through the Studio without losing context.",
    evidence: ["88 automated checks passed", "390px mobile overflow check passed"]
  }
};
