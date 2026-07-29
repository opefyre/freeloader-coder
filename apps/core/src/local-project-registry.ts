import { createHash, randomUUID } from "node:crypto";
import {
  chmod,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, isAbsolute, join, parse, resolve, sep } from "node:path";

import {
  localProjectRegistrationSchema,
  localProjectSnapshotSchema,
  validateLocalProjectCollection,
  type LocalProjectCollection,
  type LocalProjectSnapshot,
} from "../../../packages/runtime/src/local-projects.js";

const MAX_ENTRIES = 4_000;
const MAX_MANIFEST_BYTES = 256_000;
const SCAN_VALID_FOR_MS = 60_000;
const ignoredNames = new Set([
  ".git",
  ".env",
  ".next",
  ".nuxt",
  ".output",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "secrets",
  "target",
  "vendor",
]);
const manifestNames = new Set([
  "Cargo.toml",
  "Gemfile",
  "go.mod",
  "package.json",
  "pyproject.toml",
  "requirements.txt",
]);
const registrySchemaVersion = 1 as const;

type PrivateProjectRecord = {
  schemaVersion: 1;
  id: string;
  canonicalPath: string;
  displayName: string;
  snapshot: LocalProjectSnapshot;
};

type PrivateRegistry = {
  schemaVersion: 1;
  projects: PrivateProjectRecord[];
};

export class LocalProjectRegistry {
  readonly #registryPath: string;
  readonly #scanLocks = new Map<string, Promise<LocalProjectSnapshot>>();

  constructor(stateDirectory: string) {
    this.#registryPath = resolve(stateDirectory, "local-projects.json");
  }

  async list(): Promise<LocalProjectCollection> {
    const registry = await this.#load();
    return validateLocalProjectCollection({
      schemaVersion: 1,
      provenance: "local_observation",
      observedAt: Date.now(),
      projects: registry.projects.map((record) => record.snapshot),
    });
  }

  async register(input: unknown): Promise<LocalProjectSnapshot> {
    const request = localProjectRegistrationSchema.parse(input);
    const canonicalPath = await validateRepositoryRoot(request.path);
    const registry = await this.#load();
    const existing = registry.projects.find(
      (project) => project.canonicalPath === canonicalPath
    );
    if (existing) return this.rescan(existing.id);
    const id = `project_${hash(canonicalPath).slice(0, 16)}`;
    const displayName = request.displayName ?? basename(canonicalPath);
    if (
      registry.projects.some(
        (project) =>
          project.displayName.toLocaleLowerCase() === displayName.toLocaleLowerCase()
      )
    ) {
      throw new LocalProjectError(
        "duplicate_name",
        "That project name is already registered."
      );
    }
    const snapshot = await inspectRepository({ id, canonicalPath, displayName });
    await this.#save({
      schemaVersion: registrySchemaVersion,
      projects: [
        ...registry.projects,
        {
          schemaVersion: registrySchemaVersion,
          id,
          canonicalPath,
          displayName,
          snapshot,
        },
      ],
    });
    return snapshot;
  }

  async rescan(projectId: string): Promise<LocalProjectSnapshot> {
    assertProjectId(projectId);
    const active = this.#scanLocks.get(projectId);
    if (active) return active;
    const scan = this.#rescan(projectId).finally(() => {
      this.#scanLocks.delete(projectId);
    });
    this.#scanLocks.set(projectId, scan);
    return scan;
  }

  async forget(projectId: string): Promise<void> {
    assertProjectId(projectId);
    if (this.#scanLocks.has(projectId)) {
      throw new LocalProjectError(
        "scan_active",
        "Wait for the current read-only scan to finish."
      );
    }
    const registry = await this.#load();
    const projects = registry.projects.filter((project) => project.id !== projectId);
    if (projects.length === registry.projects.length) {
      throw new LocalProjectError("not_found", "Project registration was not found.");
    }
    await this.#save({ schemaVersion: registrySchemaVersion, projects });
  }

  async #rescan(projectId: string): Promise<LocalProjectSnapshot> {
    const registry = await this.#load();
    const record = registry.projects.find((project) => project.id === projectId);
    if (!record) {
      throw new LocalProjectError("not_found", "Project registration was not found.");
    }
    let snapshot: LocalProjectSnapshot;
    try {
      const canonicalPath = await validateRepositoryRoot(record.canonicalPath);
      snapshot = await inspectRepository({
        id: record.id,
        canonicalPath,
        displayName: record.displayName,
      });
    } catch (error) {
      if (error instanceof LocalProjectError) throw error;
      throw new LocalProjectError(
        "scan_failed",
        "The repository could not be rescanned. The last good observation was preserved."
      );
    }
    await this.#save({
      schemaVersion: registrySchemaVersion,
      projects: registry.projects.map((project) =>
        project.id === projectId ? { ...project, snapshot } : project
      ),
    });
    return snapshot;
  }

  async #load(): Promise<PrivateRegistry> {
    try {
      const parsed: unknown = JSON.parse(await readFile(this.#registryPath, "utf8"));
      return parsePrivateRegistry(parsed);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return { schemaVersion: registrySchemaVersion, projects: [] };
      }
      if (error instanceof SyntaxError || error instanceof LocalProjectError) {
        throw new LocalProjectError(
          "registry_invalid",
          "The local project registry is invalid. It was preserved for recovery."
        );
      }
      throw error;
    }
  }

  async #save(registry: PrivateRegistry): Promise<void> {
    const parsed = parsePrivateRegistry(registry);
    await mkdir(dirname(this.#registryPath), { recursive: true, mode: 0o700 });
    await chmod(dirname(this.#registryPath), 0o700);
    const temporary = `${this.#registryPath}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, `${JSON.stringify(parsed, null, 2)}\n`, {
        encoding: "utf8",
        mode: 0o600,
        flag: "wx",
      });
      const file = await open(temporary, "r");
      await file.sync();
      await file.close();
      await rename(temporary, this.#registryPath);
      await chmod(this.#registryPath, 0o600);
    } finally {
      await unlink(temporary).catch(() => undefined);
    }
  }
}

export class LocalProjectError extends Error {
  constructor(
    readonly code:
      | "invalid_path"
      | "protected_path"
      | "not_repository"
      | "duplicate_name"
      | "not_found"
      | "scan_active"
      | "scan_failed"
      | "registry_invalid"
      | "scan_limit",
    message: string
  ) {
    super(message);
  }
}

async function validateRepositoryRoot(inputPath: string): Promise<string> {
  if (!isAbsolute(inputPath) || inputPath.includes("\0")) {
    throw new LocalProjectError("invalid_path", "Choose an absolute local folder path.");
  }
  let canonicalPath: string;
  try {
    canonicalPath = await realpath(inputPath);
  } catch {
    throw new LocalProjectError("invalid_path", "That local folder could not be found.");
  }
  const info = await stat(canonicalPath);
  if (!info.isDirectory()) {
    throw new LocalProjectError("invalid_path", "The selected path is not a folder.");
  }
  const root = parse(canonicalPath).root;
  const segments = canonicalPath
    .slice(root.length)
    .split(sep)
    .filter(Boolean);
  if (
    canonicalPath === root ||
    segments.length < 3 ||
    [".ssh", ".aws", ".config", "Library", "System", "Volumes", "private", "etc", "var"]
      .some((name) => segments.includes(name))
  ) {
    throw new LocalProjectError(
      "protected_path",
      "That folder is inside a protected or overly broad location."
    );
  }
  try {
    if (!(await stat(join(canonicalPath, ".git"))).isDirectory()) throw new Error();
  } catch {
    throw new LocalProjectError(
      "not_repository",
      "The selected folder is not a supported Git worktree."
    );
  }
  return canonicalPath;
}

async function inspectRepository(input: {
  id: string;
  canonicalPath: string;
  displayName: string;
}): Promise<LocalProjectSnapshot> {
  const queue = [input.canonicalPath];
  const manifests: string[] = [];
  const languages = new Set<string>();
  let entries = 0;
  let hasReadme = false;
  let truncated = false;
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) break;
    const children = await readdir(current, { withFileTypes: true });
    children.sort((left, right) => left.name.localeCompare(right.name));
    for (const child of children) {
      entries += 1;
      if (entries > MAX_ENTRIES) {
        truncated = true;
        queue.length = 0;
        break;
      }
      if (ignoredNames.has(child.name) || child.name.startsWith(".env")) continue;
      const absolute = join(current, child.name);
      if (child.isSymbolicLink()) continue;
      if (child.isDirectory()) {
        queue.push(absolute);
        continue;
      }
      if (!child.isFile()) continue;
      const relative = absolute.slice(input.canonicalPath.length + 1);
      if (/^readme(?:\.[a-z0-9]+)?$/i.test(relative)) hasReadme = true;
      if (manifestNames.has(child.name)) manifests.push(relative);
      const language = languageFor(child.name);
      if (language) languages.add(language);
    }
  }

  const packageManifest = manifests.find((path) => path === "package.json");
  let packageSummary: { packageManager: string | null; scripts: string[] } = {
    packageManager: null,
    scripts: [],
  };
  if (packageManifest) {
    const manifestPath = join(input.canonicalPath, packageManifest);
    const manifestStat = await stat(manifestPath);
    if (manifestStat.size <= MAX_MANIFEST_BYTES) {
      try {
        const value = JSON.parse(await readFile(manifestPath, "utf8")) as Record<
          string,
          unknown
        >;
        packageSummary = {
          packageManager:
            typeof value.packageManager === "string"
              ? value.packageManager.split("@")[0] ?? null
              : null,
          scripts:
            value.scripts && typeof value.scripts === "object" && !Array.isArray(value.scripts)
              ? Object.keys(value.scripts).sort().slice(0, 20)
              : [],
        };
      } catch {
        // A malformed manifest is reported as a warning, never guessed.
      }
    }
  }

  const head = await readGitHead(input.canonicalPath);
  const warnings = [
    "Working-tree cleanliness was not evaluated because this read-only scanner never executes Git.",
    ...(truncated ? [`Scan stopped after ${MAX_ENTRIES.toLocaleString()} entries.`] : []),
    ...(!hasReadme ? ["No root README was observed."] : []),
  ];
  return localProjectSnapshotSchema.parse({
    schemaVersion: 1,
    id: input.id,
    displayName: input.displayName,
    state: warnings.length > 0 ? "warning" : "ready",
    observedAt: Date.now(),
    validForMs: SCAN_VALID_FOR_MS,
    facts: [
      { label: "Repository", value: "Git worktree observed", evidence: ".git directory" },
      { label: "Branch", value: head.branch ?? "Detached or unavailable", evidence: ".git/HEAD" },
      {
        label: "Languages",
        value: [...languages].sort().join(", ") || "None observed",
        evidence: `${entries.toLocaleString()} bounded entries`,
      },
      {
        label: "Manifests",
        value: manifests.sort().slice(0, 12).join(", ") || "None observed",
        evidence: "File names only",
      },
      {
        label: "Package manager",
        value: packageSummary.packageManager ?? "Not declared",
        evidence: packageManifest ?? "No package.json",
      },
      {
        label: "Validation scripts",
        value: packageSummary.scripts.join(", ") || "None declared",
        evidence: packageManifest ?? "No package.json",
      },
    ],
    inferences: [
      ...(languages.has("TypeScript") ? ["This appears to include TypeScript code."] : []),
      ...(packageSummary.scripts.includes("test")
        ? ["A repository-defined test workflow may be available."]
        : []),
    ],
    decisions: [
      "Confirm the detected project before enabling any future execution.",
      "Choose whether later scans may read additional explicitly listed manifests.",
    ],
    warnings,
  });
}

async function readGitHead(repositoryPath: string): Promise<{ branch: string | null }> {
  try {
    const value = (await readFile(join(repositoryPath, ".git", "HEAD"), "utf8")).trim();
    const prefix = "ref: refs/heads/";
    return { branch: value.startsWith(prefix) ? value.slice(prefix.length) : null };
  } catch {
    return { branch: null };
  }
}

function languageFor(name: string): string | null {
  const extension = name.slice(name.lastIndexOf(".")).toLocaleLowerCase();
  return (
    {
      ".go": "Go",
      ".js": "JavaScript",
      ".jsx": "JavaScript",
      ".py": "Python",
      ".rs": "Rust",
      ".swift": "Swift",
      ".ts": "TypeScript",
      ".tsx": "TypeScript",
      ".vue": "Vue",
    }[extension] ?? null
  );
}

function parsePrivateRegistry(input: unknown): PrivateRegistry {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new LocalProjectError("registry_invalid", "Registry root is invalid.");
  }
  const record = input as Record<string, unknown>;
  if (
    Object.keys(record).sort().join(",") !== "projects,schemaVersion" ||
    record.schemaVersion !== 1 ||
    !Array.isArray(record.projects)
  ) {
    throw new LocalProjectError("registry_invalid", "Registry version is invalid.");
  }
  const projects = record.projects.map((project) => {
    if (!project || typeof project !== "object" || Array.isArray(project)) {
      throw new LocalProjectError("registry_invalid", "Registry project is invalid.");
    }
    const value = project as Record<string, unknown>;
    if (
      Object.keys(value).sort().join(",") !==
        "canonicalPath,displayName,id,schemaVersion,snapshot" ||
      value.schemaVersion !== 1 ||
      typeof value.id !== "string" ||
      !/^project_[a-f0-9]{16}$/.test(value.id) ||
      typeof value.canonicalPath !== "string" ||
      !isAbsolute(value.canonicalPath) ||
      typeof value.displayName !== "string"
    ) {
      throw new LocalProjectError("registry_invalid", "Registry project is invalid.");
    }
    return {
      schemaVersion: registrySchemaVersion,
      id: value.id,
      canonicalPath: value.canonicalPath,
      displayName: value.displayName,
      snapshot: localProjectSnapshotSchema.parse(value.snapshot),
    };
  });
  if (
    new Set(projects.map((project) => project.id)).size !== projects.length ||
    new Set(projects.map((project) => project.canonicalPath)).size !== projects.length
  ) {
    throw new LocalProjectError("registry_invalid", "Registry contains duplicate projects.");
  }
  return { schemaVersion: registrySchemaVersion, projects };
}

function assertProjectId(value: string): void {
  if (!/^project_[a-f0-9]{16}$/.test(value)) {
    throw new LocalProjectError("not_found", "Project registration was not found.");
  }
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
