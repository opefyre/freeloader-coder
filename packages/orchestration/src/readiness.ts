export interface WorkUnit {
  readonly id: string;
  readonly title: string;
  readonly files: readonly string[];
  readonly dependsOn: readonly string[];
}

export interface TaskGraph {
  readonly units: readonly WorkUnit[];
}

export function validateTaskGraph(
  graph: TaskGraph,
  options: { readonly maxUnits: number; readonly maxFilesPerUnit: number }
): TaskGraph {
  if (graph.units.length < 1 || graph.units.length > options.maxUnits) {
    throw new Error("Task graph has an invalid number of work units.");
  }
  const byId = new Map(graph.units.map((unit) => [unit.id, unit]));
  if (byId.size !== graph.units.length) throw new Error("Work unit IDs must be unique.");

  for (const unit of graph.units) {
    if (!unit.id || !unit.title) throw new Error("Work unit identity is incomplete.");
    if (unit.files.length < 1 || unit.files.length > options.maxFilesPerUnit) {
      throw new Error("Work unit file scope is invalid.");
    }
    if (new Set(unit.files).size !== unit.files.length) throw new Error("Work unit files must be unique.");
    for (const file of unit.files) assertRelativeProjectPath(file);
    for (const dependency of unit.dependsOn) {
      if (dependency === unit.id) throw new Error("Work unit cannot depend on itself.");
      if (!byId.has(dependency)) throw new Error("Work unit dependency does not exist.");
    }
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string): void => {
    if (visiting.has(id)) throw new Error("Task graph contains a cycle.");
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dependency of byId.get(id)?.dependsOn ?? []) visit(dependency);
    visiting.delete(id);
    visited.add(id);
  };
  for (const id of byId.keys()) visit(id);

  for (let left = 0; left < graph.units.length; left += 1) {
    for (let right = left + 1; right < graph.units.length; right += 1) {
      const a = graph.units[left];
      const b = graph.units[right];
      if (!a || !b) continue;
      const overlaps = a.files.some((file) => b.files.includes(file));
      if (overlaps && !dependsTransitively(a.id, b.id, byId) && !dependsTransitively(b.id, a.id, byId)) {
        throw new Error("Overlapping work units must be ordered by dependency.");
      }
    }
  }
  return graph;
}

function dependsTransitively(
  from: string,
  target: string,
  byId: ReadonlyMap<string, WorkUnit>,
  seen = new Set<string>()
): boolean {
  if (seen.has(from)) return false;
  seen.add(from);
  const dependencies = byId.get(from)?.dependsOn ?? [];
  return dependencies.includes(target)
    || dependencies.some((dependency) => dependsTransitively(dependency, target, byId, seen));
}

function assertRelativeProjectPath(path: string): void {
  if (
    path.length === 0
    || path.startsWith("/")
    || path.startsWith("\\")
    || path.split(/[\\/]/).includes("..")
    || /^[a-zA-Z]:/.test(path)
  ) {
    throw new Error("Work unit path must stay within the project.");
  }
}
