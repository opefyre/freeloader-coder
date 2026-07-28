import { validateTaskGraph } from "./readiness.js";

export interface PlannedTask {
  readonly id: string;
  readonly title: string;
  readonly outcome: string;
  readonly scope: readonly string[];
  readonly exclusions: readonly string[];
  readonly acceptanceCriteria: readonly string[];
  readonly allowedFiles: readonly string[];
  readonly dependsOn: readonly string[];
  readonly risk: "low" | "medium" | "high";
  readonly providerCapabilities: readonly string[];
  readonly checks: readonly string[];
  readonly estimatedMinutes: number;
}

export interface EditableTaskPlan {
  readonly schemaVersion: 1;
  readonly planId: string;
  readonly revision: number;
  readonly state: "draft" | "approved";
  readonly tasks: readonly PlannedTask[];
  readonly order: readonly string[];
}

export type TaskPlanEdit =
  | { readonly type: "edit"; readonly taskId: string; readonly patch: Partial<Pick<PlannedTask, "title" | "outcome" | "scope" | "exclusions" | "acceptanceCriteria" | "risk" | "providerCapabilities" | "checks" | "estimatedMinutes">> }
  | { readonly type: "remove"; readonly taskId: string }
  | { readonly type: "reorder"; readonly order: readonly string[] }
  | { readonly type: "split"; readonly taskId: string; readonly first: PlannedTask; readonly second: PlannedTask }
  | { readonly type: "merge"; readonly taskIds: readonly string[]; readonly merged: PlannedTask };

export function createTaskPlan(input: {
  readonly planId: string;
  readonly tasks: readonly PlannedTask[];
}): EditableTaskPlan {
  const tasks = input.tasks.map(validatePlannedTask).sort((left, right) =>
    left.id.localeCompare(right.id)
  );
  validatePlanGraph(tasks);
  return {
    schemaVersion: 1,
    planId: input.planId,
    revision: 1,
    state: "draft",
    tasks,
    order: topologicalOrder(tasks)
  };
}

export function editTaskPlan(
  plan: EditableTaskPlan,
  edit: TaskPlanEdit
): EditableTaskPlan {
  if (plan.state !== "draft") throw new Error("Approved task plans are immutable.");
  let tasks = [...plan.tasks];
  let order = [...plan.order];

  if (edit.type === "edit") {
    assertTaskExists(tasks, edit.taskId);
    tasks = tasks.map((task) =>
      task.id === edit.taskId ? validatePlannedTask({ ...task, ...edit.patch }) : task
    );
  } else if (edit.type === "remove") {
    assertTaskExists(tasks, edit.taskId);
    if (tasks.some((task) => task.dependsOn.includes(edit.taskId))) {
      throw new Error("Remove dependent tasks or their dependency before this task.");
    }
    tasks = tasks.filter((task) => task.id !== edit.taskId);
    order = order.filter((id) => id !== edit.taskId);
  } else if (edit.type === "reorder") {
    if (
      edit.order.length !== tasks.length ||
      new Set(edit.order).size !== tasks.length ||
      edit.order.some((id) => !tasks.some((task) => task.id === id))
    ) {
      throw new Error("Reorder must contain every task exactly once.");
    }
    assertDependencyOrder(tasks, edit.order);
    order = [...edit.order];
  } else if (edit.type === "split") {
    const original = tasks.find((task) => task.id === edit.taskId);
    if (!original) throw new Error("Task does not exist.");
    const first = validatePlannedTask(edit.first);
    const second = validatePlannedTask(edit.second);
    if (first.id === second.id || tasks.some((task) =>
      task.id !== original.id && [first.id, second.id].includes(task.id)
    )) {
      throw new Error("Split task identities must be new and unique.");
    }
    if (first.dependsOn.join("\0") !== original.dependsOn.join("\0")) {
      throw new Error("The first split task must preserve original dependencies.");
    }
    if (!second.dependsOn.includes(first.id)) {
      throw new Error("The second split task must depend on the first.");
    }
    tasks = tasks
      .filter((task) => task.id !== original.id)
      .map((task) => ({
        ...task,
        dependsOn: task.dependsOn.map((dependency) =>
          dependency === original.id ? second.id : dependency
        )
      }));
    tasks.push(first, second);
    const position = order.indexOf(original.id);
    order.splice(position, 1, first.id, second.id);
  } else {
    if (edit.taskIds.length < 2 || new Set(edit.taskIds).size !== edit.taskIds.length) {
      throw new Error("Merge requires at least two unique tasks.");
    }
    edit.taskIds.forEach((id) => assertTaskExists(tasks, id));
    const merged = validatePlannedTask(edit.merged);
    if (tasks.some((task) => !edit.taskIds.includes(task.id) && task.id === merged.id)) {
      throw new Error("Merged task identity already exists.");
    }
    const selected = new Set(edit.taskIds);
    const requiredDependencies = new Set(
      tasks
        .filter((task) => selected.has(task.id))
        .flatMap((task) => task.dependsOn)
        .filter((dependency) => !selected.has(dependency))
    );
    if ([...requiredDependencies].some((id) => !merged.dependsOn.includes(id))) {
      throw new Error("Merged task must preserve external dependencies.");
    }
    tasks = tasks
      .filter((task) => !selected.has(task.id))
      .map((task) => ({
        ...task,
        dependsOn: [...new Set(task.dependsOn.map((dependency) =>
          selected.has(dependency) ? merged.id : dependency
        ))]
      }));
    tasks.push(merged);
    const position = Math.min(...edit.taskIds.map((id) => order.indexOf(id)));
    order = order.filter((id) => !selected.has(id));
    order.splice(position, 0, merged.id);
  }

  validatePlanGraph(tasks);
  assertDependencyOrder(tasks, order);
  return { ...plan, revision: plan.revision + 1, tasks, order };
}

export function approveTaskPlan(plan: EditableTaskPlan): EditableTaskPlan {
  validatePlanGraph(plan.tasks);
  assertDependencyOrder(plan.tasks, plan.order);
  return { ...plan, revision: plan.revision + 1, state: "approved" };
}

export function chooseTaskAssignments(
  tasks: readonly PlannedTask[]
): readonly {
  readonly taskId: string;
  readonly strategy: "single_model" | "specialist";
  readonly capability: string;
}[] {
  return tasks.map((task) => ({
    taskId: task.id,
    strategy:
      task.risk === "high" || task.providerCapabilities.length > 1
        ? "specialist"
        : "single_model",
    capability: task.providerCapabilities[0] ?? "general_coding"
  }));
}

function validatePlanGraph(tasks: readonly PlannedTask[]): void {
  validateTaskGraph({
    units: tasks.map((task) => ({
      id: task.id,
      title: task.title,
      files: task.allowedFiles,
      dependsOn: task.dependsOn
    }))
  }, { maxUnits: 24, maxFilesPerUnit: 40 });
}

function validatePlannedTask(task: PlannedTask): PlannedTask {
  if (!/^[a-zA-Z0-9._-]{1,120}$/.test(task.id)) throw new Error("Task ID is invalid.");
  if (
    !task.title.trim() ||
    !task.outcome.trim() ||
    task.scope.length === 0 ||
    task.acceptanceCriteria.length === 0 ||
    task.allowedFiles.length === 0 ||
    task.checks.length === 0
  ) {
    throw new Error("Task contract is incomplete.");
  }
  if (!Number.isInteger(task.estimatedMinutes) || task.estimatedMinutes < 1 || task.estimatedMinutes > 480) {
    throw new Error("Task estimate must be between 1 and 480 minutes.");
  }
  return {
    ...task,
    title: task.title.trim(),
    outcome: task.outcome.trim(),
    scope: uniqueText(task.scope, "Task scope"),
    exclusions: uniqueText(task.exclusions, "Task exclusions"),
    acceptanceCriteria: uniqueText(task.acceptanceCriteria, "Acceptance criteria"),
    allowedFiles: [...task.allowedFiles],
    dependsOn: [...new Set(task.dependsOn)],
    providerCapabilities: uniqueText(task.providerCapabilities, "Provider capabilities"),
    checks: uniqueText(task.checks, "Task checks")
  };
}

function topologicalOrder(tasks: readonly PlannedTask[]): string[] {
  const result: string[] = [];
  const remaining = new Map(tasks.map((task) => [task.id, task]));
  while (remaining.size > 0) {
    const ready = [...remaining.values()]
      .filter((task) => task.dependsOn.every((dependency) => result.includes(dependency)))
      .sort((left, right) => left.id.localeCompare(right.id));
    if (ready.length === 0) throw new Error("Task graph contains a cycle.");
    for (const task of ready) {
      result.push(task.id);
      remaining.delete(task.id);
    }
  }
  return result;
}

function assertDependencyOrder(tasks: readonly PlannedTask[], order: readonly string[]): void {
  const position = new Map(order.map((id, index) => [id, index]));
  for (const task of tasks) {
    for (const dependency of task.dependsOn) {
      if ((position.get(dependency) ?? Infinity) >= (position.get(task.id) ?? -1)) {
        throw new Error("Dependent work cannot be ordered before its prerequisite.");
      }
    }
  }
}

function assertTaskExists(tasks: readonly PlannedTask[], id: string): void {
  if (!tasks.some((task) => task.id === id)) throw new Error("Task does not exist.");
}

function uniqueText(values: readonly string[], label: string): string[] {
  const normalized = values.map((value) => value.trim()).filter(Boolean);
  if (new Set(normalized).size !== normalized.length) {
    throw new Error(`${label} must be unique.`);
  }
  return normalized;
}
