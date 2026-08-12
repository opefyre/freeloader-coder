import type { ProjectContextService } from "./project-context-service.js";
import type { ProjectLifecycleService } from "./project-lifecycle-service.js";
import type { LocalProjectRegistry } from "./local-project-registry.js";
import type { LocalProjectSnapshot } from "../../../packages/runtime/src/local-projects.js";

export type ProjectKindClassification = {
  readonly kind: "new_product" | "existing_product" | "unknown";
  readonly confidence: number;
  readonly evidence: readonly string[];
};

export interface ProjectKindAssistant {
  classify(input: {
    readonly outcome: string;
    readonly ownerSelection: "new_product" | "existing_product";
    readonly deterministic: ProjectKindClassification;
  }): Promise<ProjectKindClassification>;
}

export class ProjectIntakeCoordinator {
  constructor(
    private readonly contexts: ProjectContextService,
    private readonly lifecycles: ProjectLifecycleService,
    private readonly projects?: LocalProjectRegistry,
    private readonly assistant?: ProjectKindAssistant,
  ) {}

  async generate(projectId: string, input: unknown) {
    const intake = parseProjectIntake(input);
    const context = await this.contexts.generate(projectId, input);
    const begun = await this.lifecycles.begin({
      projectId,
      mission: intake.outcome,
    });
    let lifecycle = begun;
    if (
      !begun.artifacts.some(
        (artifact) =>
          artifact.kind === "context" && artifact.digest === context.digest,
      )
    ) {
      const verified = await this.contexts.readVerified(projectId);
      if (verified.digest !== context.digest)
        throw new Error("Generated context could not be verified.");
      lifecycle = await this.lifecycles.publishQuestions({
        projectId,
        artifact: {
          kind: "context",
          projectRelativePath: "CONTEXT.md",
          digest: context.digest,
          revision:
            begun.artifacts.filter((artifact) => artifact.kind === "context")
              .length + 1,
          createdAt: context.observedAt,
          citations: context.citations.map(
            (citation) => `local://${citation.path}`,
          ),
          reviewerIds: ["context-grounding", "context-integrity"],
          qaPassed: true,
        },
        questions: context.clarificationPlan.questions,
      });
    }
    if (lifecycle.stage === "context_review" && !lifecycle.assessment) {
      const snapshot = this.projects
        ? (await this.projects.list()).projects.find(
            (project) => project.id === projectId,
          )
        : undefined;
      const deterministic = classifyProjectKind(snapshot, intake.projectKind);
      const classification =
        deterministic.kind === "unknown" && this.assistant
          ? await assistProjectKind(this.assistant, {
              outcome: intake.outcome,
              ownerSelection: intake.projectKind,
              deterministic,
            })
          : deterministic;
      await this.lifecycles.assess(
        projectId,
        {
          schemaVersion: 1,
          expectedRevision: lifecycle.revision,
          requestId: intake.requestId,
          projectKind: classification.kind,
          ...deriveScopeEvidence(
            intake.outcome,
            classification.kind,
            classification.evidence,
            classification.confidence,
          ),
        },
        `context-scope:${context.digest}`,
      );
    }
    return context;
  }
}

export async function assistProjectKind(
  assistant: ProjectKindAssistant,
  input: Parameters<ProjectKindAssistant["classify"]>[0],
): Promise<ProjectKindClassification> {
  try {
    return constrainAssistedClassification(
      input.deterministic,
      await assistant.classify(input),
    );
  } catch {
    return {
      ...input.deterministic,
      evidence: [
        ...input.deterministic.evidence,
        "Model assistance was unavailable; deterministic ambiguity was preserved for owner clarification.",
      ],
      confidence: Math.min(input.deterministic.confidence, 0.4),
    };
  }
}

export function constrainAssistedClassification(
  deterministic: ProjectKindClassification,
  assisted: ProjectKindClassification,
): ProjectKindClassification {
  if (deterministic.kind !== "unknown") return deterministic;
  const strongConflict = deterministic.evidence.some((item) =>
    item.includes("conflicts with the owner's"),
  );
  if (
    strongConflict ||
    assisted.kind === "unknown" ||
    assisted.confidence < 0.8
  ) {
    return {
      ...deterministic,
      evidence: [...deterministic.evidence, ...assisted.evidence],
      confidence: Math.min(deterministic.confidence, assisted.confidence),
    };
  }
  return {
    kind: assisted.kind,
    confidence: Math.min(0.9, assisted.confidence),
    evidence: [...deterministic.evidence, ...assisted.evidence],
  };
}

export function parseProjectIntake(input: unknown): {
  outcome: string;
  requestId: string;
  projectKind: "new_product" | "existing_product";
} {
  if (!input || typeof input !== "object")
    throw new Error("Project intake is invalid.");
  const candidate = input as Record<string, unknown>;
  const outcome =
    typeof candidate.outcome === "string" ? candidate.outcome.trim() : "";
  if (outcome.length < 3 || outcome.length > 20_000)
    throw new Error("Project outcome is invalid.");
  if (
    typeof candidate.requestId !== "string" ||
    !/^request_[a-f0-9]{20}$/.test(candidate.requestId)
  )
    throw new Error("Project request identity is invalid.");
  if (
    candidate.projectKind !== "new_product" &&
    candidate.projectKind !== "existing_product"
  )
    throw new Error("Project kind is invalid.");
  return {
    outcome,
    requestId: candidate.requestId,
    projectKind: candidate.projectKind,
  };
}

export function classifyProjectKind(
  snapshot: LocalProjectSnapshot | undefined,
  ownerSelection: "new_product" | "existing_product",
) {
  if (!snapshot)
    return {
      kind: ownerSelection,
      confidence: 0.75,
      evidence: [
        "Workspace classification used the owner's explicit project selection because no current scan was available.",
      ],
    } as const;
  const fact = (label: string) =>
    snapshot.facts.find((item) => item.label === label)?.value ?? "";
  const languages = fact("Languages");
  const manifests = fact("Manifests");
  const branch = fact("Branch");
  const hasCode =
    Boolean(languages && languages !== "None observed") ||
    Boolean(manifests && manifests !== "None observed");
  const hasExternalHistory = (snapshot.resources ?? []).some(
    (resource) =>
      resource.kind === "jira_project" || resource.kind === "github_repository",
  );
  const meaningfulExistingEvidence =
    hasCode ||
    hasExternalHistory ||
    (branch !== "" &&
      !["main", "master", "Detached or unavailable"].includes(branch));
  const evidence = [
    hasCode
      ? `Workspace scan found implementation evidence: languages=${languages || "none"}; manifests=${manifests || "none"}.`
      : "Workspace scan found no implementation language or manifest.",
    hasExternalHistory
      ? "A Jira project or GitHub repository is already bound to this workspace."
      : "No Jira or GitHub project history is bound.",
    `Owner selected ${ownerSelection === "new_product" ? "new product" : "existing product"}.`,
  ];
  if (meaningfulExistingEvidence && ownerSelection === "new_product")
    return {
      kind: "unknown" as const,
      confidence: 0.45,
      evidence: [
        ...evidence,
        "Existing-project evidence conflicts with the owner's new-product selection.",
      ],
    };
  if (meaningfulExistingEvidence)
    return { kind: "existing_product" as const, confidence: 0.96, evidence };
  if (ownerSelection === "existing_product")
    return {
      kind: "unknown" as const,
      confidence: 0.5,
      evidence: [
        ...evidence,
        "The selected existing project has no meaningful implementation or connected history yet.",
      ],
    };
  return { kind: "new_product" as const, confidence: 0.96, evidence };
}

export function deriveScopeEvidence(
  outcome: string,
  projectKind: "new_product" | "existing_product" | "unknown",
  classificationEvidence: readonly string[] = [],
  classificationConfidence?: number,
) {
  if (projectKind === "unknown")
    return {
      affectedDomains: [] as const,
      deliveryStages: [] as const,
      estimatedDeveloperHours: 0,
      requiresArchitectureDecision: false,
      evidence: [
        ...classificationEvidence,
        "Project type is ambiguous; the owner must select an explicit option.",
      ],
      confidence: Math.min(classificationConfidence ?? 0.5, 0.6),
    };
  if (projectKind === "new_product") {
    return {
      affectedDomains: ["product", "frontend", "backend", "qa"],
      deliveryStages: [
        "research",
        "product",
        "design",
        "frontend",
        "backend",
        "qa",
      ] as const,
      estimatedDeveloperHours: 80,
      requiresArchitectureDecision: true,
      evidence: [
        ...classificationEvidence,
        "The workspace preflight and owner intent support a new product lifecycle.",
      ],
      confidence: classificationConfidence ?? 0.9,
    };
  }
  const normalized = outcome.toLowerCase();
  const domainSignals: ReadonlyArray<readonly [string, RegExp]> = [
    ["frontend", /\b(ui|ux|page|screen|frontend|responsive|mobile)\b/],
    ["backend", /\b(api|backend|service|workflow|authentication|database)\b/],
    ["data", /\b(data|database|migration|analytics|reporting)\b/],
    ["infrastructure", /\b(infra|deploy|cloud|worker|queue|scheduler)\b/],
    ["qa", /\b(qa|test|validation|audit|review)\b/],
  ];
  const affectedDomains = domainSignals.flatMap(([domain, pattern]) =>
    pattern.test(normalized) ? [domain] : [],
  );
  const majorLanguage =
    /\b(feature|product|platform|system|workflow|integration|redesign|architecture|end[- ]to[- ]end|from scratch)\b/.test(
      normalized,
    );
  const clear =
    outcome.length >= 40 && (majorLanguage || affectedDomains.length >= 2);
  return {
    affectedDomains,
    deliveryStages: clear
      ? (["product", "design", "frontend", "backend", "qa"] as const)
      : ([] as const),
    estimatedDeveloperHours: clear ? 16 : 0,
    requiresArchitectureDecision:
      clear &&
      /\b(architecture|system|workflow|integration|database|infra)\b/.test(
        normalized,
      ),
    evidence: [
      ...classificationEvidence,
      clear
        ? "The requested outcome names a multi-stage feature or multiple implementation domains."
        : "The requested outcome does not yet establish major-feature scope.",
    ],
    confidence: Math.min(classificationConfidence ?? 1, clear ? 0.85 : 0.5),
  };
}
