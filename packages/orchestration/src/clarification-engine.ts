import {
  ownerQuestionSchema,
  type OwnerQuestion,
} from "./project-lifecycle.js";

export type ClarificationFinding = {
  id: string;
  prompt: string;
  whyItMatters: string;
  material: boolean;
  priority: "critical" | "high" | "normal";
  options: readonly { id: string; label: string; consequence: string }[];
  allowsCustomAnswer: boolean;
  recommendedDefault: string | null;
  affectedArtifacts?: readonly string[];
  dependsOnFindingIds?: readonly string[];
};

export type ClarificationPlan = {
  schemaVersion: 1;
  questions: readonly OwnerQuestion[];
  assumptions: readonly {
    sourceFindingIds: readonly string[];
    value: string;
  }[];
};

export function buildClarificationPlan(
  rawFindings: readonly ClarificationFinding[],
): ClarificationPlan {
  const groups: ClarificationFinding[][] = [];
  for (const raw of rawFindings) {
    const finding = validateFinding(raw);
    const group = groups.find((candidate) =>
      semanticallyEquivalent(candidate[0]!.prompt, finding.prompt),
    );
    if (group) group.push(finding);
    else groups.push([finding]);
  }
  const questions: OwnerQuestion[] = [];
  const assumptions: { sourceFindingIds: string[]; value: string }[] = [];
  for (const findings of groups) {
    const ordered = [...findings].sort(compareFinding);
    const primary = ordered[0];
    if (!primary) continue;
    const key = normalize(primary.prompt);
    const sourceFindingIds = [
      ...new Set(ordered.map((finding) => finding.id)),
    ].sort();
    if (ordered.some((finding) => finding.material)) {
      const recommendation =
        ordered.find((finding) => finding.recommendedDefault)
          ?.recommendedDefault ?? null;
      const recommendedOptionId = recommendation
        ? (primary.options.find(
            (option) =>
              option.id === recommendation ||
              normalize(option.label) === normalize(recommendation),
          )?.id ?? null)
        : null;
      questions.push(
        ownerQuestionSchema.parse({
          id: `question_${stableHex(key)}`,
          prompt: primary.prompt,
          whyItMatters: primary.whyItMatters,
          options: primary.options,
          allowsCustomAnswer: primary.allowsCustomAnswer,
          sourceFindingIds,
          recommendedOptionId,
          affectedArtifacts: [
            ...new Set(
              ordered.flatMap((finding) => finding.affectedArtifacts ?? []),
            ),
          ].sort(),
          dependsOnFindingIds: [
            ...new Set(
              ordered.flatMap((finding) => finding.dependsOnFindingIds ?? []),
            ),
          ].sort(),
        }),
      );
    } else {
      const value = ordered.find(
        (finding) => finding.recommendedDefault,
      )?.recommendedDefault;
      if (!value)
        throw new Error(
          "Non-blocking uncertainty requires a visible recommended default.",
        );
      assumptions.push({ sourceFindingIds, value });
    }
  }
  questions.sort((left, right) => {
    const leftFinding = rawFindings.find((finding) =>
      left.sourceFindingIds.includes(finding.id),
    );
    const rightFinding = rawFindings.find((finding) =>
      right.sourceFindingIds.includes(finding.id),
    );
    const leftDependency = questions.some((candidate) =>
      candidate.sourceFindingIds.some((id) =>
        left.dependsOnFindingIds?.includes(id),
      ),
    )
      ? 1
      : 0;
    const rightDependency = questions.some((candidate) =>
      candidate.sourceFindingIds.some((id) =>
        right.dependsOnFindingIds?.includes(id),
      ),
    )
      ? 1
      : 0;
    return (
      leftDependency - rightDependency ||
      priorityOf(leftFinding?.priority) - priorityOf(rightFinding?.priority) ||
      left.id.localeCompare(right.id)
    );
  });
  assumptions.sort((left, right) =>
    left.sourceFindingIds[0]!.localeCompare(right.sourceFindingIds[0]!),
  );
  return { schemaVersion: 1, questions: questions.slice(0, 3), assumptions };
}

function validateFinding(finding: ClarificationFinding): ClarificationFinding {
  if (!/^[a-zA-Z0-9._-]{1,160}$/.test(finding.id))
    throw new Error("Clarification finding identity is invalid.");
  if (
    finding.prompt.trim().length < 3 ||
    finding.whyItMatters.trim().length < 3
  ) {
    throw new Error(
      "Clarification findings require a question and consequence.",
    );
  }
  if (
    finding.material &&
    (finding.options.length < 2 || finding.options.length > 4)
  )
    throw new Error("Blocking findings require 2–4 selectable options.");
  if (
    new Set(finding.options.map((option) => option.id)).size !==
      finding.options.length ||
    new Set(finding.options.map((option) => normalize(option.label))).size !==
      finding.options.length
  )
    throw new Error("Clarification options must be mutually distinguishable.");
  if (
    finding.material &&
    finding.recommendedDefault &&
    !finding.options.some(
      (option) =>
        option.id === finding.recommendedDefault ||
        normalize(option.label) === normalize(finding.recommendedDefault!),
    )
  )
    throw new Error(
      "A blocking recommendation must identify one offered option.",
    );
  if (!finding.material && !finding.recommendedDefault?.trim())
    throw new Error(
      "Non-blocking uncertainty requires a visible recommended default.",
    );
  return {
    ...finding,
    prompt: finding.prompt.trim(),
    whyItMatters: finding.whyItMatters.trim(),
    recommendedDefault: finding.recommendedDefault?.trim() || null,
  };
}

function compareFinding(
  left: ClarificationFinding,
  right: ClarificationFinding,
) {
  return (
    Number(right.material) - Number(left.material) ||
    priorityOf(left.priority) - priorityOf(right.priority) ||
    left.id.localeCompare(right.id)
  );
}

function priorityOf(priority: ClarificationFinding["priority"] | undefined) {
  return priority === "critical" ? 0 : priority === "high" ? 1 : 2;
}

function normalize(value: string) {
  return value
    .trim()
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function semanticallyEquivalent(left: string, right: string) {
  const tokens = (value: string) =>
    normalize(value)
      .split(" ")
      .filter((token) => token.length > 2 && !STOP_WORDS.has(token))
      .map((token) =>
        token.endsWith("s") && token.length > 4 ? token.slice(0, -1) : token,
      );
  const a = new Set(tokens(left));
  const b = new Set(tokens(right));
  if (normalize(left) === normalize(right)) return true;
  const intersection = [...a].filter((token) => b.has(token)).length;
  const union = new Set([...a, ...b]).size;
  return intersection >= 2 && union > 0 && intersection / union >= 0.5;
}

const STOP_WORDS = new Set([
  "what",
  "which",
  "who",
  "where",
  "when",
  "how",
  "does",
  "should",
  "the",
  "this",
  "that",
  "for",
  "can",
]);

function stableHex(value: string) {
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193) >>> 0;
    second = Math.imul(second ^ (code + index), 0x85ebca6b) >>> 0;
  }
  return `${first.toString(16).padStart(8, "0")}${second.toString(16).padStart(8, "0")}`;
}
