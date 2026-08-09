export function completeDeliveryPlan() {
  const epic = "plan_0000000000000001";
  const story = "plan_0000000000000002";
  const task = "plan_0000000000000003";
  const subtask = "plan_0000000000000004";
  const common = { priority: "high" as const, acceptanceCriteria: ["The intended behavior is verified with deterministic evidence.", "Failure behavior is covered without losing prior work."], definitionOfDone: ["Automated validation passes in the supported environment.", "Independent review finds no unresolved blocking issue."], implementationNotes: ["Follow the approved architecture and existing repository conventions."], allowedFiles: ["src/workflow.ts", "tests/workflow.test.ts"], validationProfiles: ["typecheck" as const, "unit" as const], citations: ["local://CONTEXT.md", "local://.pipeline/SOLUTION.md"] };
  return {
    schemaVersion: 1 as const, title: "Verified delivery plan", objective: "Deliver the approved solution as independently verifiable, dependency-ordered implementation work.", contextDigest: "a".repeat(64), solutionDigest: "b".repeat(64), risks: ["Provider capacity may delay model-assisted implementation without invalidating durable work."], assumptions: [], citations: common.citations,
    items: [
      { ...common, id: epic, type: "epic" as const, parentId: null, title: "Deliver approved capability", description: "Coordinate the complete approved capability across product, implementation, quality, and release evidence.", storyPoints: null, estimatedMinutes: 960, dependencies: [] },
      { ...common, id: story, type: "story" as const, parentId: epic, title: "Provide the owner journey", description: "As an owner, I can use the complete capability and observe trustworthy progress and recovery outcomes.", storyPoints: 8 as const, estimatedMinutes: 480, dependencies: [] },
      { ...common, id: task, type: "task" as const, parentId: story, title: "Implement the bounded workflow", description: "Implement the approved workflow with typed state, durable recovery, validation, and clear owner-facing status.", storyPoints: 5 as const, estimatedMinutes: 240, dependencies: [] },
      { ...common, id: subtask, type: "subtask" as const, parentId: task, title: "Add workflow contract", description: "Add the exact workflow contract and focused tests required by the approved implementation task.", storyPoints: null, estimatedMinutes: 90, dependencies: [] },
    ],
  };
}
