import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import {
  chmod,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  lstat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, parse, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";

import {
  localProjectRegistrationSchema,
  localProjectCreationSchema,
  projectResourceBindingSchema,
  projectResourceSelectionSchema,
  localProjectFileImportSchema,
  localProjectContentImportSchema,
  localProjectFileImportResponseSchema,
  localProjectSnapshotSchema,
  validateLocalProjectCollection,
  type LocalProjectCollection,
  type LocalProjectSnapshot,
  type ProjectResourceBinding,
  type LocalProjectFileImportResponse,
} from "../../../packages/runtime/src/local-projects.js";
import {
  localPlanningSnapshotSchema,
  localGroundingSchema,
  localTopologySchema,
  type LocalPlanningSnapshot,
  type LocalTopology,
} from "../../../packages/runtime/src/local-requests.js";
import { PROJECT_ARTIFACT_CONTRACTS, ProjectArtifactStore, type ProjectArtifactKind } from "./project-artifact-store.js";
import { extractProjectInput } from "./project-input-extractor.js";

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
const groundingFiles = [
  "AGENTS.md",
  "CLAUDE.md",
  "CONTRIBUTING.md",
  "README.md",
  "README",
  "package.json",
  "pyproject.toml",
  "Cargo.toml",
  "go.mod",
  "tsconfig.json",
] as const;
const MAX_TOPOLOGY_ENTRIES = 800;
const MAX_TOPOLOGY_DEPTH = 8;
const execFileAsync = promisify(execFile);

type PrivateProjectRecord = {
  schemaVersion: 1;
  id: string;
  canonicalPath: string;
  displayName: string;
  resourceRevision: number;
  resources: ProjectResourceBinding[];
  snapshot: LocalProjectSnapshot;
};

type PrivateRegistry = {
  schemaVersion: 1;
  projects: PrivateProjectRecord[];
};

export class LocalProjectRegistry {
  readonly #registryPath: string;
  readonly #scanLocks = new Map<string, Promise<LocalProjectSnapshot>>();
  readonly #artifacts: ProjectArtifactStore;
  readonly #openArtifactFile: (path: string) => Promise<void>;

  constructor(
    stateDirectory: string,
    artifacts = new ProjectArtifactStore(),
    openArtifactFile = defaultOpenArtifactFile,
  ) {
    this.#registryPath = resolve(stateDirectory, "local-projects.json");
    this.#artifacts = artifacts;
    this.#openArtifactFile = openArtifactFile;
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

  async has(projectId: string): Promise<boolean> {
    assertProjectId(projectId);
    const registry = await this.#load();
    return registry.projects.some((project) => project.id === projectId);
  }

  async canonicalRoot(projectId: string): Promise<string> {
    assertProjectId(projectId);
    const registry = await this.#load();
    const record = registry.projects.find((project) => project.id === projectId);
    if (!record) {
      throw new LocalProjectError("not_found", "Project registration was not found.");
    }
    return validateRepositoryRoot(record.canonicalPath);
  }

  async artifacts(projectId: string) {
    return this.#artifacts.inspect(await this.canonicalRoot(projectId));
  }

  async openArtifact(projectId: string, kind: ProjectArtifactKind) {
    const root = await this.canonicalRoot(projectId);
    await this.#artifacts.read(root, kind);
    const fileName = PROJECT_ARTIFACT_CONTRACTS[kind].fileName;
    const target = join(root, fileName);
    await this.#openArtifactFile(target);
    return { schemaVersion: 1 as const, outcome: "opened" as const, kind, fileName };
  }

  async grounding(projectId: string): Promise<LocalPlanningSnapshot> {
    assertProjectId(projectId);
    const registry = await this.#load();
    const record = registry.projects.find((project) => project.id === projectId);
    if (!record) {
      throw new LocalProjectError("not_found", "Project registration was not found.");
    }
    const canonicalPath = await validateRepositoryRoot(record.canonicalPath);
    const sources: LocalPlanningSnapshot["grounding"]["sources"][number][] = [];
    let totalBytes = 0;
    for (const name of groundingFiles) {
      const absolute = join(canonicalPath, name);
      try {
        const info = await lstat(absolute);
        if (!info.isFile() || info.isSymbolicLink() || info.size > 65_536) continue;
        totalBytes += info.size;
        if (totalBytes > 196_608) {
          throw new LocalProjectError("scan_limit", "Grounding exceeded the safe byte limit.");
        }
        const content = await readFile(absolute, "utf8");
        if (looksSensitive(content)) continue;
        sources.push({
          path: name,
          sha256: hash(content),
          bytes: info.size,
          classification:
            name === "AGENTS.md" || name === "CLAUDE.md" || name === "CONTRIBUTING.md"
              ? "guidance"
              : name.startsWith("README")
                ? "documentation"
                : "manifest",
          excerpt: content.slice(0, 2_000),
        });
      } catch (error) {
        if (error instanceof LocalProjectError) throw error;
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
          throw new LocalProjectError("scan_failed", `Could not read bounded grounding source ${name}.`);
        }
      }
    }
    if (sources.length === 0) {
      throw new LocalProjectError(
        "scan_failed",
        "No safe root guidance, documentation, or manifest was available for grounding."
      );
    }
    const body = { projectId, sources };
    const grounding = localGroundingSchema.parse({
      schemaVersion: 1,
      projectId,
      provenance: "bounded_local_files",
      digest: hash(JSON.stringify(body)),
      observedAt: Date.now(),
      sources,
      limitations: [
        "Only explicitly allowlisted root files were read.",
        "Symlinks, sensitive-shaped content, source directories, and command output were excluded.",
      ],
    });
    const topology = await inventoryTopology(canonicalPath, projectId);
    return localPlanningSnapshotSchema.parse({
      schemaVersion: 1,
      grounding,
      topology,
    });
  }

  async register(input: unknown): Promise<LocalProjectSnapshot> {
    const request = localProjectRegistrationSchema.parse(input);
    const canonicalPath = await validateRepositoryRoot(request.path);
    const registry = await this.#load();
    const existing = registry.projects.find(
      (project) => project.canonicalPath === canonicalPath
    );
    if (existing) {
      await this.#artifacts.initialize(canonicalPath);
      return this.rescan(existing.id);
    }
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
    await this.#artifacts.initialize(canonicalPath);
    const snapshot = await inspectRepository({ id, canonicalPath, displayName, resources: [] });
    await this.#save({
      schemaVersion: registrySchemaVersion,
      projects: [
        ...registry.projects,
        {
          schemaVersion: registrySchemaVersion,
          id,
          canonicalPath,
          displayName,
          resourceRevision: 0,
          resources: [],
          snapshot,
        },
      ],
    });
    return snapshot;
  }

  async create(input: unknown, idempotencyKey: string): Promise<LocalProjectSnapshot> {
    const request = localProjectCreationSchema.parse(input);
    const registry = await this.#load();
    const requestedName = request.displayName ?? projectNameFromIdea(request.idea);
    const displayName = uniqueProjectName(
      requestedName,
      registry.projects.map((project) => project.displayName)
    );
    const workspace = resolve(request.workspacePath);
    await assertSafeWorkspaceDestination(workspace);
    try {
      const existing = await stat(workspace);
      if (!existing.isDirectory()) throw new Error();
      const children = await readdir(workspace);
      if (children.includes(".git")) {
        return this.register({ schemaVersion: 1, path: workspace, displayName });
      }
      if (children.length > 0) {
        throw new LocalProjectError(
          "invalid_path",
          "Choose an empty folder or an existing Git project."
        );
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        if (error instanceof LocalProjectError) throw error;
        throw new LocalProjectError(
          "scan_failed",
          "The previous project creation attempt needs recovery before retrying."
        );
      }
    }
    await mkdir(workspace, { recursive: true, mode: 0o700 });
    await writeFile(
      resolve(workspace, "README.md"),
      `# ${displayName}\n\n## Product idea\n\n${request.idea}\n`,
      { encoding: "utf8", mode: 0o600, flag: "wx" }
    );
    try {
      await execFileAsync("git", ["init", "--initial-branch=main", workspace], {
        timeout: 15_000,
        maxBuffer: 64_000,
        windowsHide: true,
      });
    } catch {
      throw new LocalProjectError(
        "scan_failed",
        "The private project workspace was created, but Git could not initialize it."
      );
    }
    return this.register({
      schemaVersion: 1,
      path: workspace,
      displayName,
    });
  }

  async setResources(projectId: string, input: unknown): Promise<LocalProjectSnapshot> {
    assertProjectId(projectId);
    const request = projectResourceSelectionSchema.parse(input);
    const registry = await this.#load();
    const record = registry.projects.find((project) => project.id === projectId);
    if (!record) throw new LocalProjectError("not_found", "Project registration was not found.");
    const currentRevision = record.resourceRevision ?? 0;
    if (request.expectedRevision !== currentRevision) {
      throw new LocalProjectError("conflict", "Project resources changed. Refresh the project and try again.");
    }
    const now = Date.now();
    const resources = request.resources.map((resource) => ({
      ...resource,
      id: `binding_${hash(`${projectId}:${resource.kind}:${resource.connectionId}:${resource.resourceId}`).slice(0, 16)}`,
      selectedAt: now,
    }));
    const previousIds = new Set(record.resources.map((resource) => resource.id));
    const nextIds = new Set(resources.map((resource) => resource.id));
    const resourceChange = {
      addedBindingIds: resources.filter((resource) => !previousIds.has(resource.id)).map((resource) => resource.id),
      removedBindingIds: record.resources.filter((resource) => !nextIds.has(resource.id)).map((resource) => resource.id),
      changedAt: now,
    };
    const snapshot = localProjectSnapshotSchema.parse({ ...record.snapshot, resourceRevision: currentRevision + 1, resourceChange, resources });
    await this.#save({
      schemaVersion: registrySchemaVersion,
      projects: registry.projects.map((project) =>
        project.id === projectId ? { ...project, resources, resourceRevision: currentRevision + 1, snapshot } : project
      ),
    });
    return snapshot;
  }

  async addFiles(projectId: string, input: unknown): Promise<LocalProjectFileImportResponse> {
    assertProjectId(projectId);
    const request = localProjectFileImportSchema.parse(input);
    const projectRoot = await this.canonicalRoot(projectId);
    const destination = resolve(projectRoot, ".pipeline", "inputs");
    const staging = resolve(destination, ".staging");
    await mkdir(destination, { recursive: true, mode: 0o700 });
    await chmod(resolve(projectRoot, ".pipeline"), 0o700);
    await chmod(destination, 0o700);
    await rm(staging, { recursive: true, force: true });
    await mkdir(staging, { recursive: true, mode: 0o700 });
    await cleanupInterruptedInputImports(destination);
    const imported: Array<{ label: string; projectRelativePath: string; bytes: number; evidence: { status: "extracted" | "unsupported" | "encrypted" | "corrupt" | "limit_exceeded"; mediaType: string; sourceDigest: string; unitCount: number; warning: string | null } }> = [];
    let totalBytes = 0;
    const importedDigests = new Set<string>();
    for (const requestedPath of request.paths) {
      if (!isAbsolute(requestedPath) || requestedPath.includes("\0")) {
        throw new LocalProjectError("invalid_path", "Choose regular local files.");
      }
      const requestedInfo = await lstat(requestedPath);
      if (!requestedInfo.isFile() || requestedInfo.isSymbolicLink()) {
        throw new LocalProjectError("invalid_path", "Folders and symbolic links cannot be attached.");
      }
      const source = await realpath(requestedPath);
      const info = await lstat(source);
      totalBytes += info.size;
      if (info.size > 5_000_000 || totalBytes > 20_000_000) {
        throw new LocalProjectError("scan_limit", "Selected files exceed the 5 MB per-file or 20 MB total limit.");
      }
      const label = basename(source).replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 180) || "attachment";
      const extension = extname(label);
      const content = await readFile(source);
      if (content.length > 5_000_000 || totalBytes - info.size + content.length > 20_000_000) {
        throw new LocalProjectError("scan_limit", "Selected files exceed the 5 MB per-file or 20 MB total limit.");
      }
      assertInputSignature(extension, content);
      const digest = createHash("sha256").update(content).digest("hex");
      if (importedDigests.has(digest)) continue;
      importedDigests.add(digest);
      const storedName = `${digest}${extension}`;
      const storedPath = resolve(destination, storedName);
      const stagedPath = resolve(staging, `${randomUUID()}${extension}`);
      await writeFile(stagedPath, content, { mode: 0o600, flag: "wx" });
      const extraction = await extractProjectInput(stagedPath);
      if (extraction.status === "corrupt") {
        await rm(stagedPath, { force: true });
        throw new LocalProjectError("invalid_path", `The selected ${extension || "file"} does not match its format or is corrupt.`);
      }
      const stagedEvidence = `${stagedPath}.evidence.json`;
      await writeFile(stagedEvidence, `${JSON.stringify(extraction)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
      await rename(stagedPath, storedPath).catch(async (error) => {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        await rm(stagedPath, { force: true });
      });
      await rename(stagedEvidence, `${storedPath}.evidence.json`).catch(async (error) => {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        await rm(stagedEvidence, { force: true });
      });
      imported.push({ label: basename(source), projectRelativePath: `.pipeline/inputs/${storedName}`, bytes: info.size, evidence: { status: extraction.status, mediaType: extraction.mediaType, sourceDigest: extraction.sourceDigest, unitCount: extraction.units.length, warning: extraction.warning } });
    }
    await rm(staging, { recursive: true, force: true });
    return localProjectFileImportResponseSchema.parse({ schemaVersion: 1, outcome: "imported", files: imported });
  }

  async addFileContent(projectId: string, input: unknown): Promise<LocalProjectFileImportResponse> {
    assertProjectId(projectId);
    const request = localProjectContentImportSchema.parse(input);
    const projectRoot = await this.canonicalRoot(projectId);
    await mkdir(resolve(projectRoot, ".pipeline"), { recursive: true, mode: 0o700 });
    const uploadRoot = resolve(projectRoot, ".pipeline", `.content-upload-${randomUUID()}`);
    await mkdir(uploadRoot, { recursive: false, mode: 0o700 });
    const paths: string[] = [];
    try {
      let totalBytes = 0;
      for (const [index, file] of request.files.entries()) {
        const content = Buffer.from(file.contentBase64, "base64");
        totalBytes += content.length;
        if (content.length < 1 || content.length > 5_000_000 || totalBytes > 20_000_000) {
          throw new LocalProjectError("scan_limit", "Selected files exceed the 5 MB per-file or 20 MB total limit.");
        }
        const label = basename(file.label).replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 180) || `attachment-${index + 1}`;
        const itemRoot = resolve(uploadRoot, String(index));
        await mkdir(itemRoot, { mode: 0o700 });
        const path = resolve(itemRoot, label);
        await writeFile(path, content, { mode: 0o600, flag: "wx" });
        paths.push(path);
      }
      return await this.addFiles(projectId, { schemaVersion: 1, paths });
    } finally {
      await rm(uploadRoot, { recursive: true, force: true });
    }
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
        resources: record.resources,
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

async function cleanupInterruptedInputImports(destination: string): Promise<void> {
  const names = await readdir(destination);
  const dataNames = new Set(names.filter((name) => /^[a-f0-9]{64}\.[a-zA-Z0-9]+$/.test(name)));
  for (const name of dataNames) {
    if (!names.includes(`${name}.evidence.json`)) await rm(resolve(destination, name), { force: true });
  }
  for (const name of names.filter((candidate) => /^[a-f0-9]{64}\.[a-zA-Z0-9]+\.evidence\.json$/.test(candidate))) {
    if (!dataNames.has(name.slice(0, -".evidence.json".length))) await rm(resolve(destination, name), { force: true });
  }
}

function assertInputSignature(extension: string, content: Buffer): void {
  const required = content.subarray(0, 5).toString("latin1") === "%PDF-" ? ".pdf"
    : content.subarray(0, 4).toString("hex") === "504b0304" ? ".office"
      : content.subarray(0, 8).toString("hex") === "89504e470d0a1a0a" ? ".png"
        : content[0] === 0xff && content[1] === 0xd8 ? ".jpeg"
          : content.subarray(0, 4).toString("ascii") === "RIFF" && content.subarray(8, 12).toString("ascii") === "WEBP" ? ".webp"
            : null;
  const matches = required === ".office" ? [".docx", ".xlsx", ".pptx"].includes(extension) : required === ".jpeg" ? [".jpg", ".jpeg"].includes(extension) : required === null || extension === required;
  if (!matches) throw new LocalProjectError("invalid_path", "The selected file extension does not match its verified content type.");
}

async function defaultOpenArtifactFile(path: string) {
  const command = process.platform === "darwin" ? "open" : process.platform === "win32" ? "explorer.exe" : "xdg-open";
  await execFileAsync(command, [path], { timeout: 5_000, windowsHide: true });
}

function projectNameFromIdea(idea: string): string {
  const words = idea
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 6);
  const candidate = words.join(" ").trim();
  return candidate.length >= 3 ? candidate.slice(0, 80) : "New project";
}

function uniqueProjectName(requested: string, existing: readonly string[]): string {
  const names = new Set(existing.map((name) => name.toLocaleLowerCase()));
  if (!names.has(requested.toLocaleLowerCase())) return requested;
  for (let index = 2; index <= 999; index += 1) {
    const suffix = ` ${index}`;
    const candidate = `${requested.slice(0, 160 - suffix.length)}${suffix}`;
    if (!names.has(candidate.toLocaleLowerCase())) return candidate;
  }
  return `${requested.slice(0, 151)} ${randomUUID().slice(0, 8)}`;
}

async function assertSafeWorkspaceDestination(workspace: string): Promise<void> {
  if (!isAbsolute(workspace) || workspace.includes("\0")) {
    throw new LocalProjectError("invalid_path", "Choose an absolute local folder path.");
  }
  const root = parse(workspace).root;
  const segments = workspace.slice(root.length).split(sep).filter(Boolean);
  if (
    workspace === root ||
    segments.length < 3 ||
    [".ssh", ".aws", ".config", "Library", "System", "Volumes", "private", "etc", "var"]
      .some((name) => segments.includes(name))
  ) {
    throw new LocalProjectError(
      "protected_path",
      "That folder is inside a protected or overly broad location."
    );
  }
  const parent = dirname(workspace);
  try {
    const canonicalParent = await realpath(parent);
    const parentInfo = await stat(canonicalParent);
    if (!parentInfo.isDirectory()) throw new Error();
  } catch {
    throw new LocalProjectError(
      "invalid_path",
      "The parent folder must already exist so the destination can be verified."
    );
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
      | "scan_limit"
      | "conflict",
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
  resources: readonly ProjectResourceBinding[];
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
    workspaceLabel: basename(input.canonicalPath),
    lifecycleStage: "intake",
    resources: input.resources,
    latestUpdate: null,
    progress: null,
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

async function inventoryTopology(
  canonicalPath: string,
  projectId: string
): Promise<LocalTopology> {
  const entries: LocalTopology["entries"][number][] = [];
  let truncated = false;
  const directories: { directory: string; depth: number }[] = [
    { directory: canonicalPath, depth: 0 },
  ];
  while (directories.length > 0 && !truncated) {
    const current = directories.shift();
    if (!current) break;
    if (current.depth > MAX_TOPOLOGY_DEPTH) {
      truncated = true;
      break;
    }
    const { directory, depth } = current;
    const children = (await readdir(directory, { withFileTypes: true }))
      .sort((left, right) => left.name.localeCompare(right.name));
    for (const child of children) {
      if (truncated) break;
      if (
        ignoredNames.has(child.name) ||
        child.name.startsWith(".") ||
        sensitivePathName(child.name)
      ) {
        continue;
      }
      const absolute = join(directory, child.name);
      const info = await lstat(absolute);
      if (info.isSymbolicLink()) continue;
      if (info.isDirectory()) {
        directories.push({ directory: absolute, depth: depth + 1 });
        continue;
      }
      if (!info.isFile() || info.size > 2_000_000) continue;
      const projectPath = relative(canonicalPath, absolute).split(sep).join("/");
      if (!projectPath || projectPath.startsWith("../") || isAbsolute(projectPath)) {
        throw new LocalProjectError("scan_failed", "Topology escaped the registered repository.");
      }
      entries.push({
        path: projectPath,
        kind: topologyKind(projectPath),
        extension: extname(child.name) || null,
        bytes: info.size,
      });
      if (entries.length >= MAX_TOPOLOGY_ENTRIES) truncated = true;
    }
  }
  if (entries.length === 0) {
    throw new LocalProjectError("scan_failed", "No safe repository topology was observed.");
  }
  const canonicalEntries = [...entries].sort((left, right) => left.path.localeCompare(right.path));
  return localTopologySchema.parse({
    schemaVersion: 1,
    projectId,
    provenance: "bounded_path_inventory",
    digest: hash(JSON.stringify({ projectId, entries: canonicalEntries, truncated })),
    observedAt: Date.now(),
    entries: canonicalEntries,
    truncated,
    excludedDirectories: [...ignoredNames].sort(),
    limitations: [
      "Topology contains project-relative file metadata only; file contents were not read.",
      `Inventory is limited to ${MAX_TOPOLOGY_ENTRIES} files and ${MAX_TOPOLOGY_DEPTH} directory levels.`,
      "Hidden, generated, dependency, secret-like, oversized, and symlinked paths were excluded.",
    ],
  });
}

function topologyKind(path: string): LocalTopology["entries"][number]["kind"] {
  const normalized = path.toLocaleLowerCase();
  if (/(^|\/)(test|tests|__tests__|spec|specs)\//.test(normalized) || /\.(test|spec)\./.test(normalized)) {
    return "test";
  }
  if (/(^|\/)(docs?|documentation)\//.test(normalized) || /\.(md|mdx|txt)$/.test(normalized)) {
    return "documentation";
  }
  if (/(^|\/)(public|assets?|images?)\//.test(normalized) || /\.(png|jpe?g|gif|svg|webp|ico)$/.test(normalized)) {
    return "asset";
  }
  if (
    /(^|\/)(config|configs)\//.test(normalized) ||
    /(^|\/)(package\.json|tsconfig.*\.json|vite\.config\.|pyproject\.toml|cargo\.toml|go\.mod)/.test(normalized)
  ) {
    return "config";
  }
  if (/\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|swift|vue|svelte|css|scss|html)$/.test(normalized)) {
    return "source";
  }
  return "other";
}

function sensitivePathName(name: string): boolean {
  return /(^|[._-])(secret|secrets|token|tokens|credential|credentials|password|private[_-]?key)([._-]|$)/i.test(name);
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
    const keys = Object.keys(value).sort().join(",");
    if (
      ![
        "canonicalPath,displayName,id,schemaVersion,snapshot",
        "canonicalPath,displayName,id,resources,schemaVersion,snapshot",
        "canonicalPath,displayName,id,resourceRevision,resources,schemaVersion,snapshot",
      ].includes(keys) ||
      value.schemaVersion !== 1 ||
      typeof value.id !== "string" ||
      !/^project_[a-f0-9]{16}$/.test(value.id) ||
      typeof value.canonicalPath !== "string" ||
      !isAbsolute(value.canonicalPath) ||
      typeof value.displayName !== "string"
    ) {
      throw new LocalProjectError("registry_invalid", "Registry project is invalid.");
    }
    const resources = Array.isArray(value.resources)
      ? value.resources.map((resource) => projectResourceBindingSchema.parse(resource))
      : [];
    const resourceRevision = typeof value.resourceRevision === "number" && Number.isInteger(value.resourceRevision) && value.resourceRevision >= 0
      ? value.resourceRevision
      : 0;
    return {
      schemaVersion: registrySchemaVersion,
      id: value.id,
      canonicalPath: value.canonicalPath,
      displayName: value.displayName,
      resourceRevision,
      resources,
      snapshot: localProjectSnapshotSchema.parse({
        ...(value.snapshot as Record<string, unknown>),
        workspaceLabel: basename(value.canonicalPath),
        resourceRevision,
        resources,
      }),
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

function looksSensitive(value: string): boolean {
  return /(api[_-]?key|password|private[_-]?key|access[_-]?token)\s*[:=]\s*[^\s"',}]+/i.test(
    value
  );
}
