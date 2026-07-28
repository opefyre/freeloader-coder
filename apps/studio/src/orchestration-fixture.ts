import {
  classifyReadiness,
  type ReadinessDecision,
} from "../../../packages/orchestration/src/decision-policy.js";
import {
  createTaskPlan,
  type EditableTaskPlan,
  type PlannedTask,
} from "../../../packages/orchestration/src/task-planner.js";

export const initialReadinessDecision: ReadinessDecision = classifyReadiness({
  requestId: "request-orchestration-demo",
  unsafeReason: null,
  unsupportedReason: null,
  ambiguities: [],
  assumptions: [
    {
      id: "assumption-review-depth",
      value: "Run deterministic checks and two independent reviews before completion.",
      source: "Recommended project default",
    },
  ],
});

const tasks: readonly PlannedTask[] = [
  {
    id: "contracts",
    title: "Define orchestration contracts",
    outcome: "Stable readiness, task, and evidence schemas.",
    scope: ["Domain contracts", "Validation rules"],
    exclusions: ["Provider credentials"],
    acceptanceCriteria: ["Invalid or incomplete contracts are rejected."],
    allowedFiles: ["packages/orchestration/src/contracts.ts"],
    dependsOn: [],
    risk: "medium",
    providerCapabilities: ["architecture", "typescript"],
    checks: ["npm run typecheck", "npm test"],
    estimatedMinutes: 35,
  },
  {
    id: "docs",
    title: "Explain operator decisions",
    outcome: "Every blocked or assumed decision has a plain-language explanation.",
    scope: ["Operator copy"],
    exclusions: ["Implementation contracts"],
    acceptanceCriteria: ["Each decision exposes cause, consequence, and next action."],
    allowedFiles: ["docs/orchestration/operator-decisions.md"],
    dependsOn: [],
    risk: "low",
    providerCapabilities: ["technical_writing"],
    checks: ["npm test"],
    estimatedMinutes: 20,
  },
  {
    id: "workbench",
    title: "Build editable planning workbench",
    outcome: "The user can inspect and approve the bounded task graph.",
    scope: ["Work page", "Plan controls"],
    exclusions: ["Provider routing"],
    acceptanceCriteria: ["Plan edits preserve dependency validity."],
    allowedFiles: ["apps/studio/src/components/orchestration/workbench.tsx"],
    dependsOn: ["contracts"],
    risk: "medium",
    providerCapabilities: ["react", "interaction_design"],
    checks: ["npm run studio:build", "npm test"],
    estimatedMinutes: 55,
  },
  {
    id: "review",
    title: "Verify the integrated journey",
    outcome: "The complete orchestration journey has deterministic and browser evidence.",
    scope: ["Automated verification", "Browser verification"],
    exclusions: ["Production deployment"],
    acceptanceCriteria: ["All checks pass and review evidence is cited."],
    allowedFiles: ["tests/orchestration-workbench.test.ts"],
    dependsOn: ["workbench"],
    risk: "high",
    providerCapabilities: ["quality_assurance", "accessibility"],
    checks: ["npm run verify", "browser smoke test"],
    estimatedMinutes: 40,
  },
];

export const initialTaskPlan: EditableTaskPlan = createTaskPlan({
  planId: "plan-orchestration-demo",
  tasks,
});

export const groundingSnapshot = {
  digest: "sha256:91c0b4a8af62",
  citations: [
    {
      path: "PRODUCT_BLUEPRINT.md",
      lines: "184–209",
      label: "Orchestration and review contract",
    },
    {
      path: "apps/studio/src/routing.ts",
      lines: "1–61",
      label: "Canonical Studio routes",
    },
    {
      path: "packages/storage/src/coordination.ts",
      lines: "31–118",
      label: "Lease and idempotency primitives",
    },
  ],
  rules: [
    { scope: "Global", text: "Paid usage remains disabled", protected: true },
    { scope: "Project", text: "Use the existing visual system", protected: false },
    { scope: "Task", text: "Change only allowed files", protected: false },
  ],
  protectedPaths: [".env", "secrets/", ".git/"],
} as const;
