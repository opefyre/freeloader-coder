import { ownerQuestionSchema, type OwnerQuestion } from "./project-lifecycle.js";

export type ClarificationFinding = {
  id: string;
  prompt: string;
  whyItMatters: string;
  material: boolean;
  priority: "critical" | "high" | "normal";
  options: readonly { id: string; label: string; consequence: string }[];
  allowsCustomAnswer: boolean;
  recommendedDefault: string | null;
};

export type ClarificationPlan = {
  schemaVersion: 1;
  questions: readonly OwnerQuestion[];
  assumptions: readonly { sourceFindingIds: readonly string[]; value: string }[];
};

export function buildClarificationPlan(rawFindings: readonly ClarificationFinding[]): ClarificationPlan {
  const groups = new Map<string, ClarificationFinding[]>();
  for (const raw of rawFindings) {
    const finding = validateFinding(raw);
    const key = normalize(finding.prompt);
    groups.set(key, [...(groups.get(key) ?? []), finding]);
  }
  const questions: OwnerQuestion[] = [];
  const assumptions: { sourceFindingIds: string[]; value: string }[] = [];
  for (const [key, findings] of groups) {
    const ordered = [...findings].sort(compareFinding);
    const primary = ordered[0];
    if (!primary) continue;
    const sourceFindingIds = [...new Set(ordered.map((finding) => finding.id))].sort();
    if (ordered.some((finding) => finding.material)) {
      questions.push(ownerQuestionSchema.parse({
        id: `question_${stableHex(key)}`,
        prompt: primary.prompt,
        whyItMatters: primary.whyItMatters,
        options: primary.options,
        allowsCustomAnswer: primary.allowsCustomAnswer,
        sourceFindingIds,
      }));
    } else {
      const value = ordered.find((finding) => finding.recommendedDefault)?.recommendedDefault;
      if (!value) throw new Error("Non-blocking uncertainty requires a visible recommended default.");
      assumptions.push({ sourceFindingIds, value });
    }
  }
  questions.sort((left, right) => {
    const leftFinding = rawFindings.find((finding) => left.sourceFindingIds.includes(finding.id));
    const rightFinding = rawFindings.find((finding) => right.sourceFindingIds.includes(finding.id));
    return priorityOf(leftFinding?.priority) - priorityOf(rightFinding?.priority) || left.id.localeCompare(right.id);
  });
  assumptions.sort((left, right) => left.sourceFindingIds[0]!.localeCompare(right.sourceFindingIds[0]!));
  return { schemaVersion: 1, questions: questions.slice(0, 3), assumptions };
}

function validateFinding(finding: ClarificationFinding): ClarificationFinding {
  if (!/^[a-zA-Z0-9._-]{1,160}$/.test(finding.id)) throw new Error("Clarification finding identity is invalid.");
  if (finding.prompt.trim().length < 3 || finding.whyItMatters.trim().length < 3) {
    throw new Error("Clarification findings require a question and consequence.");
  }
  if (finding.material && finding.options.length < 2) throw new Error("Blocking findings require selectable options.");
  if (!finding.material && !finding.recommendedDefault?.trim()) throw new Error("Non-blocking uncertainty requires a visible recommended default.");
  return {
    ...finding,
    prompt: finding.prompt.trim(),
    whyItMatters: finding.whyItMatters.trim(),
    recommendedDefault: finding.recommendedDefault?.trim() || null,
  };
}

function compareFinding(left: ClarificationFinding, right: ClarificationFinding) {
  return Number(right.material) - Number(left.material)
    || priorityOf(left.priority) - priorityOf(right.priority)
    || left.id.localeCompare(right.id);
}

function priorityOf(priority: ClarificationFinding["priority"] | undefined) {
  return priority === "critical" ? 0 : priority === "high" ? 1 : 2;
}

function normalize(value: string) {
  return value.trim().toLocaleLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

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
