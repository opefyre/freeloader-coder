export interface Migration {
  readonly id: string;
  readonly from: number;
  readonly to: number;
  readonly prerequisite: (state: Readonly<Record<string, unknown>>) => boolean;
  readonly apply: (state: Readonly<Record<string, unknown>>) => Readonly<Record<string, unknown>>;
  readonly verify: (state: Readonly<Record<string, unknown>>) => boolean;
}

export function runMigration(input: {
  readonly currentVersion: number;
  readonly targetVersion: number;
  readonly state: Readonly<Record<string, unknown>>;
  readonly migrations: readonly Migration[];
}): {
  readonly version: number;
  readonly state: Readonly<Record<string, unknown>>;
  readonly backup: Readonly<Record<string, unknown>>;
  readonly status: "current" | "migrated" | "read_only_recovery";
  readonly rollbackVersion: number;
} {
  if (input.currentVersion > input.targetVersion) {
    return { version: input.currentVersion, state: input.state, backup: input.state, status: "read_only_recovery", rollbackVersion: input.currentVersion };
  }
  if (input.currentVersion === input.targetVersion) {
    return { version: input.currentVersion, state: input.state, backup: input.state, status: "current", rollbackVersion: input.currentVersion };
  }
  const backup = structuredClone(input.state);
  let state = structuredClone(input.state);
  let version = input.currentVersion;
  try {
    while (version < input.targetVersion) {
      const migration = input.migrations.find((item) => item.from === version);
      if (!migration || migration.to <= version || !migration.prerequisite(state)) throw new Error("Migration prerequisite failed.");
      const candidate = migration.apply(state);
      if (!migration.verify(candidate)) throw new Error("Migration verification failed.");
      state = candidate;
      version = migration.to;
    }
    if (version !== input.targetVersion) throw new Error("Migration chain is incomplete.");
    return { version, state, backup, status: "migrated", rollbackVersion: input.currentVersion };
  } catch {
    return { version: input.currentVersion, state: backup, backup, status: "read_only_recovery", rollbackVersion: input.currentVersion };
  }
}
