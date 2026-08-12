import type { LocalProjectRegistry } from "./local-project-registry.js";
import { ProjectArtifactStore } from "./project-artifact-store.js";
import type {
  OwnerAnswer,
  OwnerQuestion,
} from "../../../packages/orchestration/src/project-lifecycle.js";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { runProjectContextAnalyzers } from "./project-context-analyzers.js";
import { reconcileProjectContext } from "./project-context-reconciler.js";
import {
  buildClarificationPlan,
  type ClarificationFinding,
} from "../../../packages/orchestration/src/clarification-engine.js";

const CONTEXT_FILE = "CONTEXT.md";
const DECISION_START = "<!-- accepted-decisions:start -->";
const DECISION_END = "<!-- accepted-decisions:end -->";

export class ProjectContextService {
  constructor(
    private readonly projects: LocalProjectRegistry,
    private readonly artifacts = new ProjectArtifactStore(),
  ) {}

  async generate(projectId: string, input: unknown) {
    const outcome = parseOutcome(input);
    const [collection, planning, root] = await Promise.all([
      this.projects.list(),
      this.projects.grounding(projectId),
      this.projects.canonicalRoot(projectId),
    ]);
    const project = collection.projects.find(
      (candidate) => candidate.id === projectId,
    );
    if (!project) throw new Error("Project registration was not found.");
    const [
      manifestAnalysis,
      documentationAnalysis,
      topologyAnalysis,
      resourceAnalysis,
    ] = await Promise.all([
      Promise.resolve(analyzeManifest(planning.grounding.sources)),
      Promise.resolve(analyzeDocumentation(planning.grounding.sources)),
      Promise.resolve(analyzeTopology(planning.topology.entries)),
      Promise.resolve(analyzeResources(project.resources ?? [])),
    ]);
    const inputEvidence = await readInputEvidence(root);
    const analyzerResults = await runProjectContextAnalyzers({
      outcome,
      project,
      planning,
      attachmentSources: inputEvidence,
    });
    await this.artifacts.initialize(root);
    const current = await this.artifacts.read(root, "context");
    const acceptedDecisions = readAcceptedDecisions(current.body);
    const sourceDigests = Object.fromEntries([
      ...planning.grounding.sources.map(
        (source) => [source.path, source.sha256] as const,
      ),
      [
        `topology:${planning.topology.digest}`,
        planning.topology.digest,
      ] as const,
    ]);
    const canonical = reconcileProjectContext({
      analyzerResults,
      sourceDigests,
      seedClaims: project.facts.map((fact) => ({
        key: normalizeKey(fact.label),
        value: fact.value,
        classification: "fact" as const,
        source: fact.evidence,
        authority: 70,
        provenance: "project_observation" as const,
      })),
      ownerDecisions: acceptedDecisions
        .split("\n")
        .filter((line) => /^-\s+\S/.test(line))
        .map((line, index) => ({
          key: `accepted_decision_${index + 1}`,
          value: line
            .replace(/^-\s+/, "")
            .replace(/<!--.*?-->/g, "")
            .trim(),
          source: "owner:accepted-decisions",
        })),
    });
    const conflicts = reconcileConflicts([
      ...project.facts.map((fact) => ({
        key: normalizeKey(fact.label),
        value: fact.value,
        source: fact.evidence,
      })),
      ...manifestAnalysis.claims,
    ]);
    const citations = planning.grounding.sources.map((source, index) => ({
      number: index + 1,
      path: source.path,
      digest: source.sha256,
      classification: source.classification,
    }));
    const generatedAt = new Date().toISOString();
    const body = [
      "# Project context",
      "",
      `Generated: ${generatedAt}`,
      `Project: ${project.displayName}`,
      `Evidence digest: ${planning.grounding.digest}`,
      `Topology digest: ${planning.topology.digest}`,
      "",
      "## Requested outcome",
      "",
      outcome,
      "",
      "## Project overview",
      "",
      `- ${project.displayName} is registered as a ${project.state} local project.`,
      `- Requested outcome: ${outcome}`,
      "",
      "## Product behavior",
      "",
      ...documentationAnalysis.items,
      "",
      "## Facts",
      "",
      ...project.facts.map(
        (fact) => `- ${fact.label}: ${fact.value} — ${fact.evidence}`,
      ),
      ...(project.resources ?? []).map((resource) =>
        resource.url
          ? `- Connected ${resource.kind}: [${resource.label}](${resource.url})`
          : `- Connected ${resource.kind}: ${resource.label}`,
      ),
      `- ${planning.topology.entries.length} bounded paths were classified; topology${planning.topology.truncated ? " was truncated" : " was not truncated"}.`,
      "",
      "## Inferences",
      "",
      ...project.inferences.map((value) => `- ${value}`),
      "",
      "## Assumptions",
      "",
      "- Connected-resource metadata is current only as of its recorded observation.",
      "- Source contents outside the cited root files have not been interpreted yet.",
      "",
      "## Unknowns",
      "",
      ...project.warnings.map((value) => `- ${value}`),
      ...(planning.topology.truncated
        ? ["- The bounded topology does not contain every project path."]
        : []),
      "",
      "## Architecture and stack",
      "",
      ...manifestAnalysis.items,
      ...topologyAnalysis.items,
      "",
      "## Services and data",
      "",
      ...analyzerSection(analyzerResults, [
        "source_architecture",
        "runtime_configuration",
      ]),
      "",
      "## Integrations",
      "",
      ...resourceAnalysis.items,
      "",
      "## Infrastructure",
      "",
      ...analyzerSection(analyzerResults, ["infrastructure"]),
      "",
      "## Workflows",
      "",
      ...analyzerSection(analyzerResults, [
        "features_and_workflows",
        "tests",
        "git_history",
        "jira_history",
      ]),
      "",
      "## Owner-provided evidence",
      "",
      ...(inputEvidence.length
        ? inputEvidence.flatMap((item) => [
            `- \`${item.path}\` — ${item.mediaType}; SHA-256 \`${item.digest}\`; treated as untrusted evidence.`,
            ...item.units.map(
              (unit) =>
                `  - ${unit.locator} (${unit.confidence}): ${redactInput(unit.content)}`,
            ),
          ])
        : ["- No owner-provided attachments were imported."]),
      "",
      "## Context analyzer evidence",
      "",
      ...analyzerResults.flatMap((result) => [
        `### ${result.analyzer.replaceAll("_", " ")} — ${result.status}`,
        ...result.facts.map(
          (value) => `- Fact: ${value.statement} — ${value.source}`,
        ),
        ...result.inferences.map(
          (value) => `- Inference: ${value.statement} — ${value.source}`,
        ),
        ...result.assumptions.map(
          (value) => `- Assumption: ${value.statement} — ${value.source}`,
        ),
        ...result.unknowns.map(
          (value) => `- Unknown: ${value.statement} — ${value.source}`,
        ),
        ...result.failures.map((value) => `- Failure: ${value}`),
        "",
      ]),
      "",
      "## Conflicts",
      "",
      ...(canonical.conflicts.length > 0
        ? canonical.conflicts.map(
            (conflict) =>
              `- ${conflict.key.replaceAll("_", " ")}: selected “${conflict.selected.value}” (${conflict.selected.source}); alternatives: ${conflict.alternatives.map((value) => `“${value.value}” (${value.source})`).join(", ")}; resolution: ${conflict.resolution}.`,
          )
        : conflicts.length > 0
          ? conflicts
          : ["- None detected among bounded sources."]),
      "",
      "## Canonical evidence model",
      "",
      `- Version: ${canonical.version}`,
      `- Content digest: \`${canonical.digest}\``,
      ...canonical.claims.map(
        (claim) =>
          `- ${claim.classification}: ${claim.value} — ${claim.source}${claim.sourceDigest ? `; SHA-256 \`${claim.sourceDigest}\`` : ""}`,
      ),
      ...canonical.excluded.map(
        (claim) =>
          `- Excluded unsupported claim: ${claim.value} — ${claim.reason}`,
      ),
      "",
      "## Constraints and unknowns",
      "",
      ...planning.grounding.limitations.map((value) => `- ${value}`),
      ...planning.topology.limitations.map((value) => `- ${value}`),
      ...canonical.invalidated.map(
        (claim) =>
          `- Invalidated ${claim.key}: ${claim.reason} Source: ${claim.source}`,
      ),
      "",
      "## Accepted decisions",
      "",
      DECISION_START,
      acceptedDecisions || "- None recorded yet.",
      DECISION_END,
      "",
      "## Evidence",
      "",
      ...citations.map(
        (citation) =>
          `${citation.number}. \`${citation.path}\` — ${citation.classification}; SHA-256 \`${citation.digest}\``,
      ),
      ...(project.resources ?? []).map((resource) =>
        resource.url
          ? `- [${resource.label}](${resource.url}) — connected ${resource.kind}.`
          : `- ${resource.label} — connected ${resource.kind}; URL unavailable.`,
      ),
      "",
      "## Refresh metadata",
      "",
      `- Refreshed at: ${generatedAt}`,
      `- Previous artifact digest: \`${current.metadata.bodyDigest}\``,
      `- Grounding digest: \`${planning.grounding.digest}\``,
      `- Topology digest: \`${planning.topology.digest}\``,
      `- Canonical evidence digest: \`${canonical.digest}\``,
      "",
      "## Boundaries",
      "",
      ...planning.grounding.limitations.map((value) => `- ${value}`),
      ...planning.topology.limitations.map((value) => `- ${value}`),
      "- Secrets, excluded directories, symlinks, provider prompts, and command output are not included.",
      "",
    ].join("\n");
    const written = await this.artifacts.write(root, {
      kind: "context",
      body,
      producer: "codkesh:context-discovery",
      expectedDigest: current.metadata.bodyDigest,
      confidence: canonical.conflicts.some(
        (conflict) => conflict.resolution === "unresolved_tie",
      )
        ? "mixed"
        : "verified",
      citations: [
        ...planning.grounding.sources.map((source) => source.path),
        ...inputEvidence.map((item) => item.path),
        ...(project.resources ?? []).flatMap((resource) =>
          resource.url ? [resource.url] : [],
        ),
      ],
    });
    const clarificationPlan = buildClarificationPlan(
      contextClarificationFindings(canonical, analyzerResults),
    );
    return {
      schemaVersion: 1 as const,
      projectId,
      path: CONTEXT_FILE,
      digest: written.metadata.bodyDigest,
      groundingDigest: planning.grounding.digest,
      topologyDigest: planning.topology.digest,
      observedAt: Date.now(),
      citations: [
        ...citations.map(({ path, digest: sourceDigest }) => ({
          path,
          digest: sourceDigest,
        })),
        ...inputEvidence.map((item) => ({
          path: item.path,
          digest: item.digest,
        })),
      ],
      clarificationPlan,
    };
  }

  async applyClarifications(
    projectId: string,
    questions: readonly OwnerQuestion[],
    answers: readonly OwnerAnswer[],
  ) {
    const root = await this.projects.canonicalRoot(projectId);
    const currentArtifact = await this.artifacts.read(root, "context");
    let content = currentArtifact.body;
    const start = content.indexOf(DECISION_START);
    const end = content.indexOf(DECISION_END);
    if (start < 0 || end <= start)
      throw new Error("Project context decision section is missing.");
    const current = content.slice(start + DECISION_START.length, end).trim();
    const additions = answers.flatMap((answer) => {
      if (current.includes(`clarification:${answer.questionId}`)) return [];
      const question = questions.find(
        (candidate) => candidate.id === answer.questionId,
      );
      if (!question)
        throw new Error("Accepted clarification question was not found.");
      const value =
        answer.customAnswer ??
        question.options.find((option) => option.id === answer.optionId)?.label;
      if (!value)
        throw new Error("Accepted clarification answer was not found.");
      return [
        `- ${question.prompt} **${value}** <!-- clarification:${answer.questionId} -->`,
      ];
    });
    const decisions = [
      current === "- None recorded yet." ? "" : current,
      ...additions,
    ]
      .filter(Boolean)
      .join("\n");
    content = `${content.slice(0, start + DECISION_START.length)}\n${decisions || "- None recorded yet."}\n${content.slice(end)}`;
    const written = await this.artifacts.write(root, {
      kind: "context",
      body: content,
      producer: "codkesh:clarification",
      expectedDigest: currentArtifact.metadata.bodyDigest,
    });
    return { digest: written.metadata.bodyDigest, path: CONTEXT_FILE };
  }

  async readVerified(projectId: string) {
    const artifact = await this.artifacts.read(
      await this.projects.canonicalRoot(projectId),
      "context",
    );
    return { digest: artifact.metadata.bodyDigest, markdown: artifact.body };
  }
}

function contextClarificationFindings(
  canonical: ReturnType<typeof reconcileProjectContext>,
  analyzerResults: Awaited<ReturnType<typeof runProjectContextAnalyzers>>,
): ClarificationFinding[] {
  const material = canonical.conflicts
    .filter((conflict) => conflict.resolution === "unresolved_tie")
    .map((conflict) => {
      const candidates = [conflict.selected, ...conflict.alternatives]
        .filter(
          (claim, index, all) =>
            all.findIndex(
              (item) =>
                item.value.toLocaleLowerCase() ===
                claim.value.toLocaleLowerCase(),
            ) === index,
        )
        .slice(0, 4);
      return {
        id: `conflict.${conflict.key}`.slice(0, 160),
        prompt: `Which ${conflict.key.replaceAll("_", " ")} should Codkesh use?`,
        whyItMatters:
          "This changes the canonical product context and every dependent design artifact.",
        material: true as const,
        priority: "critical" as const,
        options: candidates.map((claim, index) => ({
          id: `choice_${index + 1}`,
          label: claim.value.slice(0, 160),
          consequence: `Use the evidence from ${claim.source.slice(0, 240)} and revalidate dependent work.`,
        })),
        allowsCustomAnswer: true,
        recommendedDefault: null,
        affectedArtifacts: [
          "CONTEXT.md",
          "DESIGN.md",
          "PRODUCT.md",
          "INFRA.md",
        ],
      };
    })
    .filter((finding) => finding.options.length >= 2);
  const assumptions = analyzerResults.flatMap((result) =>
    result.unknowns.map((unknown, index) => ({
      id: `${result.analyzer}.unknown.${index + 1}`,
      prompt: unknown.statement,
      whyItMatters: `Evidence remains incomplete in ${result.analyzer.replaceAll("_", " ")}.`,
      material: false as const,
      priority: "normal" as const,
      options: [],
      allowsCustomAnswer: false,
      recommendedDefault:
        "Keep this as an explicit unknown until evidence becomes available.",
      affectedArtifacts: ["CONTEXT.md"],
    })),
  );
  return [...material, ...assumptions];
}

async function readInputEvidence(root: string) {
  const directory = join(root, ".pipeline", "inputs");
  let names: string[];
  try {
    names = await readdir(directory);
  } catch {
    return [];
  }
  return (
    await Promise.all(
      names
        .filter((name) =>
          /^[a-f0-9]{64}\.[a-z0-9]+\.evidence\.json$/.test(name),
        )
        .slice(0, 20)
        .map(async (name) => {
          try {
            const parsed = JSON.parse(
              await readFile(join(directory, name), "utf8"),
            ) as Record<string, unknown>;
            const units = Array.isArray(parsed.units)
              ? parsed.units.slice(0, 100).flatMap((value) => {
                  if (!value || typeof value !== "object") return [];
                  const unit = value as Record<string, unknown>;
                  return typeof unit.locator === "string" &&
                    typeof unit.content === "string" &&
                    ["high", "medium", "low"].includes(String(unit.confidence))
                    ? [
                        {
                          locator: unit.locator.slice(0, 200),
                          content: unit.content.slice(0, 20_000),
                          confidence: String(unit.confidence),
                        },
                      ]
                    : [];
                })
              : [];
            return typeof parsed.sourceDigest === "string" &&
              /^[a-f0-9]{64}$/.test(parsed.sourceDigest) &&
              typeof parsed.mediaType === "string"
              ? {
                  path: `.pipeline/inputs/${name.replace(/\.evidence\.json$/, "")}`,
                  digest: parsed.sourceDigest,
                  mediaType: parsed.mediaType.slice(0, 200),
                  units,
                }
              : null;
          } catch {
            return null;
          }
        }),
    )
  ).filter((value): value is NonNullable<typeof value> => value !== null);
}

function redactInput(value: string) {
  return value
    .replace(
      /\b(?:api[_-]?key|token|secret|password)\s*[:=]\s*\S+/gi,
      "[redacted credential]",
    )
    .replace(
      /\b(?:sk|gsk|ghp|github_pat)_[A-Za-z0-9_-]{8,}\b/g,
      "[redacted credential]",
    )
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 2_000);
}

function parseOutcome(input: unknown) {
  if (!input || typeof input !== "object")
    throw new Error("Context request is invalid.");
  const value = (input as Record<string, unknown>).outcome;
  if (
    typeof value !== "string" ||
    value.trim().length < 3 ||
    value.length > 20_000
  )
    throw new Error("Context outcome is invalid.");
  return value.trim();
}

function readAcceptedDecisions(content: string) {
  const start = content.indexOf(DECISION_START);
  const end = content.indexOf(DECISION_END);
  if (start < 0 || end <= start) return "";
  return content
    .slice(start + DECISION_START.length, end)
    .trim()
    .slice(0, 32_000);
}

type GroundingSource = Awaited<
  ReturnType<LocalProjectRegistry["grounding"]>
>["grounding"]["sources"][number];
type TopologyEntry = Awaited<
  ReturnType<LocalProjectRegistry["grounding"]>
>["topology"]["entries"][number];

function analyzeManifest(sources: readonly GroundingSource[]) {
  const manifest = sources.find((source) => source.path === "package.json");
  if (!manifest)
    return {
      items: ["- No supported root package manifest was observed."],
      claims: [],
    };
  const citation = sources.indexOf(manifest) + 1;
  try {
    const parsed = JSON.parse(manifest.excerpt) as Record<string, unknown>;
    const scripts =
      parsed.scripts && typeof parsed.scripts === "object"
        ? Object.keys(parsed.scripts as object).slice(0, 20)
        : [];
    const dependencies = [parsed.dependencies, parsed.devDependencies]
      .flatMap((value) =>
        value && typeof value === "object" ? Object.keys(value as object) : [],
      )
      .filter((value, index, all) => all.indexOf(value) === index)
      .slice(0, 24);
    const packageManager =
      typeof parsed.packageManager === "string"
        ? parsed.packageManager
        : "Not declared";
    return {
      items: [
        `- Package manager: ${packageManager} [${citation}]`,
        `- Validation and automation scripts: ${scripts.length > 0 ? scripts.join(", ") : "none observed"} [${citation}]`,
        `- Root dependencies observed: ${dependencies.length > 0 ? dependencies.join(", ") : "none in bounded excerpt"} [${citation}]`,
      ],
      claims: [
        {
          key: "package_manager",
          value: packageManager,
          source: "package.json",
        },
      ],
    };
  } catch {
    return {
      items: [
        "- package.json exists, but its bounded excerpt was incomplete and was not interpreted.",
      ],
      claims: [],
    };
  }
}

function analyzeDocumentation(sources: readonly GroundingSource[]) {
  const headings = sources
    .filter((source) => source.classification === "documentation")
    .flatMap((source) =>
      source.excerpt
        .split("\n")
        .filter((line) => /^#{1,3}\s+\S/.test(line))
        .map(
          (line) => `${line.replace(/^#{1,3}\s+/, "")} — \`${source.path}\``,
        ),
    )
    .slice(0, 20);
  return {
    items:
      headings.length > 0
        ? headings.map((heading) => `- ${heading}`)
        : [
            "- No feature or workflow headings were observed in bounded root documentation.",
          ],
  };
}

function analyzeTopology(entries: readonly TopologyEntry[]) {
  const counts = new Map<string, number>();
  for (const entry of entries)
    counts.set(entry.kind, (counts.get(entry.kind) ?? 0) + 1);
  const roots = [
    ...new Set(
      entries.map((entry) => entry.path.split("/")[0]).filter(Boolean),
    ),
  ]
    .sort()
    .slice(0, 20);
  return {
    items: [
      `- Bounded topology: ${[...counts].map(([kind, count]) => `${count} ${kind}`).join(", ")}.`,
      `- Root areas: ${roots.join(", ")}.`,
    ],
  };
}

function analyzeResources(
  resources: readonly { kind: string; label: string; url: string | null }[],
) {
  return {
    items:
      resources.length > 0
        ? resources.map((resource) =>
            resource.url
              ? `- ${resource.kind}: [${resource.label}](${resource.url})`
              : `- ${resource.kind}: ${resource.label}`,
          )
        : ["- No external project resources are connected."],
  };
}

function reconcileConflicts(
  claims: readonly { key: string; value: string; source: string }[],
) {
  const grouped = new Map<string, { value: string; source: string }[]>();
  for (const claim of claims)
    grouped.set(claim.key, [
      ...(grouped.get(claim.key) ?? []),
      { value: claim.value, source: claim.source },
    ]);
  return [...grouped].flatMap(([key, values]) => {
    const distinct = [
      ...new Set(values.map((value) => value.value.trim().toLocaleLowerCase())),
    ];
    return distinct.length > 1
      ? [
          `- ${key.replaceAll("_", " ")}: ${values.map((value) => `“${value.value}” (${value.source})`).join(" versus ")}. Owner review required.`,
        ]
      : [];
  });
}

function normalizeKey(value: string) {
  return value
    .trim()
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

function analyzerSection(
  results: Awaited<ReturnType<typeof runProjectContextAnalyzers>>,
  ids: readonly string[],
) {
  const items = results
    .filter((result) => ids.includes(result.analyzer))
    .flatMap((result) => [
      ...result.facts.map(
        (finding) => `- ${finding.statement} — ${finding.source}`,
      ),
      ...result.inferences.map(
        (finding) => `- Inference: ${finding.statement} — ${finding.source}`,
      ),
      ...result.unknowns.map(
        (finding) => `- Unknown: ${finding.statement} — ${finding.source}`,
      ),
    ]);
  return items.length
    ? items
    : ["- Unknown: no bounded evidence was available for this section."];
}
