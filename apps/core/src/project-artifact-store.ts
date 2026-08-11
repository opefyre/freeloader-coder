import { createHash, randomUUID } from "node:crypto";
import { watch as watchDirectory, type FSWatcher } from "node:fs";
import { chmod, lstat, mkdir, open, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

export const PROJECT_ARTIFACT_KINDS = [
  "context",
  "memory",
  "research",
  "product",
  "design",
  "delivery_plan",
  "ops_rules",
  "infra",
  "security",
  "decisions",
  "status",
] as const;

export type ProjectArtifactKind = (typeof PROJECT_ARTIFACT_KINDS)[number];

export interface ProjectArtifactMetadata {
  readonly schemaVersion: 1;
  readonly kind: ProjectArtifactKind;
  readonly revision: number;
  readonly updatedAt: string;
  readonly producer: string;
  readonly bodyDigest: string;
  readonly approvedDigest: string | null;
  readonly supersedesDigest: string | null;
  readonly confidence: "unknown" | "mixed" | "verified";
  readonly approvalState: "not_required" | "pending" | "approved";
}

export interface ProjectArtifact {
  readonly fileName: string;
  readonly body: string;
  readonly metadata: ProjectArtifactMetadata;
}

export interface ProjectArtifactContract {
  readonly kind: ProjectArtifactKind;
  readonly fileName: string;
  readonly owners: readonly string[];
  readonly readers: readonly string[];
  readonly dependencies: readonly ProjectArtifactKind[];
  readonly refreshTriggers: readonly string[];
  readonly approval: "none" | "owner";
  readonly sectionProfiles: readonly (readonly string[])[];
}

export type ArtifactReconciliation = "accept_manual" | "restore_recorded";
export interface ProjectArtifactChange {
  readonly kind: ProjectArtifactKind;
  readonly fileName: string;
  readonly state: "verified" | "conflict" | "missing";
}

export interface ProjectArtifactStoreOptions {
  readonly lockTimeoutMs?: number;
  readonly staleLockMs?: number;
  readonly faultAt?: "after_temp_sync" | "before_primary_rename";
}

const ARTIFACT_HEADER = "codkesh-artifact";
const MAX_ARTIFACT_BYTES = 1_000_000;
const PROJECT_LOCKS = new Map<string, Promise<void>>();

const ARTIFACT_FILES: Readonly<Record<ProjectArtifactKind, string>> = {
  context: "CONTEXT.md",
  memory: "MEMORY.md",
  research: "RESEARCH.md",
  product: "PRODUCT.md",
  design: "DESIGN.md",
  delivery_plan: "DELIVERY-PLAN.md",
  ops_rules: "OPS-RULES.md",
  infra: "INFRA.md",
  security: "SECURITY.md",
  decisions: "DECISIONS.md",
  status: "STATUS.md",
};

export const PROJECT_ARTIFACT_CONTRACTS: Readonly<Record<ProjectArtifactKind, ProjectArtifactContract>> = Object.freeze({
  context: contract("context", ["project-intake", "context-discovery", "clarification"], [], ["project-created", "resources-changed", "owner-clarified"], "none"),
  memory: contract("memory", ["memory-curator", "owner"], ["context", "decisions"], ["decision-approved", "verified-lesson"], "owner"),
  research: contract("research", ["solution-research"], ["context"], ["context-updated", "research-requested"], "none"),
  product: contract("product", ["solution-design", "owner"], ["context", "research", "decisions"], ["research-verified", "revision-requested"], "owner"),
  design: contract("design", ["solution-design", "owner"], ["context", "research", "product", "security", "decisions"], ["product-updated", "revision-requested"], "owner"),
  delivery_plan: contract("delivery_plan", ["delivery-planning"], ["context", "product", "design", "ops_rules"], ["design-approved"], "owner"),
  ops_rules: contract("ops_rules", ["project-intake", "owner"], ["context", "decisions"], ["project-created", "owner-policy-changed"], "owner"),
  infra: contract("infra", ["solution-design", "infrastructure"], ["context", "design", "security"], ["design-updated", "environment-changed"], "owner"),
  security: contract("security", ["security-review"], ["context", "design", "infra"], ["design-updated", "threat-model-requested"], "owner"),
  decisions: contract("decisions", ["owner", "solution-decision"], ["context", "product", "design", "delivery_plan"], ["owner-decision"], "owner"),
  status: contract("status", ["lifecycle", "solution-decision", "execution"], ["delivery_plan", "decisions"], ["stage-changed", "task-changed", "owner-action-changed"], "none"),
});

const ARTIFACT_TEMPLATES: Readonly<Record<ProjectArtifactKind, string>> = {
  context: "# Project context\n\n## Verified facts\n\n_No verified facts have been recorded._\n\n## Inferences\n\n_No inferences have been recorded._\n\n## Assumptions\n\n_No assumptions have been accepted._\n\n## Unknowns\n\n_Context discovery has not run._\n\n## Evidence\n\n_No evidence has been recorded._",
  memory: "# Project memory\n\n## Accepted knowledge\n\n_No durable knowledge has been accepted._\n\n## Owner preferences\n\n_No project-specific preferences have been recorded._\n\n## Lessons\n\n_No verified lessons have been recorded._\n\n## Unresolved knowledge\n\n_No unresolved knowledge has been recorded._",
  research: "# Research\n\n## Questions\n\n_Research has not started._\n\n## Evidence\n\n_No research evidence has been recorded._\n\n## Findings\n\n_No findings have been verified._\n\n## Contradictions and gaps\n\n_No contradictions or gaps have been assessed._",
  product: "# Product\n\n## Problem and audience\n\n_Product discovery has not been approved._\n\n## Value proposition\n\n_Not yet designed._\n\n## Journeys and requirements\n\n_Not yet designed._\n\n## Scope and success measures\n\n_Not yet designed._",
  design: "# Design\n\n## Experience design\n\n_Not yet designed._\n\n## System design\n\n_Not yet designed._\n\n## Data, services, APIs, and integrations\n\n_Not yet designed._\n\n## Quality and migration\n\n_Not yet designed._",
  delivery_plan: "# Delivery plan\n\n## Phases and milestones\n\n_No approved delivery plan exists._\n\n## Work graph\n\n_No delivery work has been generated._\n\n## Validation and Definition of Done\n\n_Not yet defined._",
  ops_rules: "# Operating rules\n\n## Autonomy and approvals\n\n_Project operating rules have not been approved._\n\n## Scheduling, retries, and escalation\n\n_Not yet defined._\n\n## Validation, review, and integration\n\n_Not yet defined._\n\n## Jira and evidence policy\n\n_Not yet defined._",
  infra: "# Infrastructure\n\n## Environments and topology\n\n_Infrastructure has not been designed._\n\n## Services, data, and networking\n\n_Not yet designed._\n\n## Deployment, observability, and rollback\n\n_Not yet designed._\n\n## Cost and free-tier evidence\n\n_Not yet verified._",
  security: "# Security\n\n## Data and trust boundaries\n\n_Not yet assessed._\n\n## Threats and controls\n\n_Not yet assessed._\n\n## Secrets, permissions, and egress\n\n_Not yet assessed._\n\n## Security validation\n\n_Not yet defined._",
  decisions: "# Decisions\n\n## Decision log\n\n_No owner decisions have been recorded._",
  status: "# Project status\n\n## Current milestone\n\n_Project execution has not started._\n\n## Active work\n\n_No active work._\n\n## Blockers and owner actions\n\n_No blockers or owner actions recorded._\n\n## Next action\n\n_Complete project intake._",
};

export class ProjectArtifactStore {
  readonly #options: Required<ProjectArtifactStoreOptions>;

  constructor(options: ProjectArtifactStoreOptions = {}) {
    this.#options = {
      lockTimeoutMs: options.lockTimeoutMs ?? 5_000,
      staleLockMs: options.staleLockMs ?? 30_000,
      faultAt: options.faultAt as Required<ProjectArtifactStoreOptions>["faultAt"],
    };
  }

  async initialize(root: string, producer = "codkesh:project-intake"): Promise<readonly ProjectArtifact[]> {
    return withProjectLock(root, this.#options, async () => {
      await assertSafeRoot(root);
      await cleanInterruptedWrites(root);
      const artifacts: ProjectArtifact[] = [];
      for (const kind of PROJECT_ARTIFACT_KINDS) {
        artifacts.push(await this.initializeOne(root, kind, producer));
      }
      return artifacts;
    });
  }

  async list(root: string): Promise<readonly ProjectArtifact[]> {
    await assertSafeRoot(root);
    return Promise.all(PROJECT_ARTIFACT_KINDS.map((kind) => this.read(root, kind)));
  }

  async read(root: string, kind: ProjectArtifactKind): Promise<ProjectArtifact> {
    await assertSafeRoot(root);
    const fileName = ARTIFACT_FILES[kind];
    const path = join(root, fileName);
    const content = await readSafeFile(path);
    const parsed = parseArtifact(content, kind);
    assertDigest(parsed.body, parsed.metadata.bodyDigest);
    return { fileName, ...parsed };
  }

  async write(root: string, input: {
    readonly kind: ProjectArtifactKind;
    readonly body: string;
    readonly producer: string;
    readonly expectedDigest: string;
    readonly approvedDigest?: string | null;
    readonly confidence?: ProjectArtifactMetadata["confidence"];
  }): Promise<ProjectArtifact> {
    return withProjectLock(root, this.#options, async () => {
      await assertSafeRoot(root);
      const current = await this.read(root, input.kind);
      if (current.metadata.bodyDigest !== input.expectedDigest) {
        throw new ProjectArtifactError("artifact-conflict", `${current.fileName} changed after it was read. Review the owner or pipeline change before retrying.`);
      }
      const body = normalizeBody(input.body);
      rejectSensitiveContent(body);
      validateArtifactReferences(input.kind, body);
      validateArtifactStructure(input.kind, body);
      const bodyDigest = digest(body);
      const metadata: ProjectArtifactMetadata = {
        schemaVersion: 1,
        kind: input.kind,
        revision: current.metadata.revision + 1,
        updatedAt: new Date().toISOString(),
        producer: validateProducer(input.producer),
        bodyDigest,
        approvedDigest: input.approvedDigest === undefined ? current.metadata.approvedDigest : input.approvedDigest,
        supersedesDigest: current.metadata.bodyDigest,
        confidence: input.confidence ?? current.metadata.confidence,
        approvalState: approvalState(input.kind, input.approvedDigest === undefined ? current.metadata.approvedDigest : input.approvedDigest, bodyDigest),
      };
      if (metadata.approvedDigest !== null && metadata.approvedDigest !== bodyDigest) {
        throw new ProjectArtifactError("artifact-unsafe", "Approval must identify the exact content being saved.");
      }
      await archive(root, current);
      await atomicWrite(join(root, current.fileName), serializeArtifact(metadata, body), this.#options);
      const written = { fileName: current.fileName, body, metadata };
      await archive(root, written);
      return written;
    });
  }

  async watch(root: string, listener: (change: ProjectArtifactChange) => void): Promise<FSWatcher> {
    await assertSafeRoot(root);
    const fileToKind = new Map(Object.entries(ARTIFACT_FILES).map(([kind, file]) => [file, kind as ProjectArtifactKind]));
    const pending = new Map<string, NodeJS.Timeout>();
    const watcher = watchDirectory(root, { persistent: false }, (_event, candidate) => {
      const fileName = candidate?.toString();
      const kind = fileName ? fileToKind.get(fileName) : undefined;
      if (!fileName || !kind) return;
      const prior = pending.get(fileName);
      if (prior) clearTimeout(prior);
      pending.set(fileName, setTimeout(() => {
        pending.delete(fileName);
        void this.read(root, kind).then(
          () => listener({ kind, fileName, state: "verified" }),
          (error: unknown) => listener({ kind, fileName, state: (error as NodeJS.ErrnoException).code === "ENOENT" ? "missing" : "conflict" }),
        );
      }, 25));
    });
    watcher.once("close", () => { for (const timeout of pending.values()) clearTimeout(timeout); pending.clear(); });
    return watcher;
  }

  async reconcile(root: string, kind: ProjectArtifactKind, strategy: ArtifactReconciliation, producer: string): Promise<ProjectArtifact> {
    return withProjectLock(root, this.#options, async () => {
      await assertSafeRoot(root);
      const fileName = ARTIFACT_FILES[kind];
      const current = await readUnverified(root, kind);
      const actualDigest = digest(current.body);
      if (actualDigest === current.metadata.bodyDigest) return { fileName, ...current };
      const recorded = await readHistory(root, fileName, current.metadata.revision, current.metadata.bodyDigest);
      if (strategy === "restore_recorded") {
        await archiveManual(root, fileName, current.body);
        await atomicWrite(join(root, fileName), serializeArtifact(recorded.metadata, recorded.body), this.#options);
        return { fileName, ...recorded };
      }
      rejectSensitiveContent(current.body);
      validateArtifactReferences(kind, current.body);
      validateArtifactStructure(kind, current.body);
      await archiveManual(root, fileName, current.body);
      const metadata: ProjectArtifactMetadata = {
        ...current.metadata,
        revision: current.metadata.revision + 1,
        updatedAt: new Date().toISOString(),
        producer: validateProducer(producer),
        bodyDigest: actualDigest,
        approvedDigest: null,
        supersedesDigest: current.metadata.bodyDigest,
        confidence: "unknown",
        approvalState: PROJECT_ARTIFACT_CONTRACTS[kind].approval === "none" ? "not_required" : "pending",
      };
      await atomicWrite(join(root, fileName), serializeArtifact(metadata, current.body), this.#options);
      const reconciled = { fileName, body: current.body, metadata };
      await archive(root, reconciled);
      return reconciled;
    });
  }

  private async initializeOne(root: string, kind: ProjectArtifactKind, producer: string): Promise<ProjectArtifact> {
    const fileName = ARTIFACT_FILES[kind];
    const path = join(root, fileName);
    try {
      const content = await readSafeFile(path);
      if (content.startsWith(`<!-- ${ARTIFACT_HEADER}:`)) {
        const parsed = parseArtifact(content, kind);
        assertDigest(parsed.body, parsed.metadata.bodyDigest);
        return { fileName, ...parsed };
      }
      const body = normalizeBody(content);
      rejectSensitiveContent(body);
      const metadata = initialMetadata(kind, producer, body);
      await archiveLegacy(root, fileName, body);
      await atomicWrite(path, serializeArtifact(metadata, body), this.#options);
      await archive(root, { fileName, body, metadata });
      return { fileName, body, metadata };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      const body = ARTIFACT_TEMPLATES[kind];
      const metadata = initialMetadata(kind, producer, body);
      await atomicWrite(path, serializeArtifact(metadata, body), this.#options);
      await archive(root, { fileName, body, metadata });
      return { fileName, body, metadata };
    }
  }
}

export class ProjectArtifactError extends Error {
  constructor(readonly code: "artifact-conflict" | "artifact-corrupt" | "artifact-unsafe" | "sensitive-content" | "artifact-lock-timeout", message: string) {
    super(message);
  }
}

function initialMetadata(kind: ProjectArtifactKind, producer: string, body: string): ProjectArtifactMetadata {
  return {
    schemaVersion: 1,
    kind,
    revision: 1,
    updatedAt: new Date().toISOString(),
    producer: validateProducer(producer),
    bodyDigest: digest(body),
    approvedDigest: null,
    supersedesDigest: null,
    confidence: "unknown",
    approvalState: PROJECT_ARTIFACT_CONTRACTS[kind].approval === "none" ? "not_required" : "pending",
  };
}

function serializeArtifact(metadata: ProjectArtifactMetadata, body: string) {
  return `<!-- ${ARTIFACT_HEADER}:${JSON.stringify(metadata)} -->\n${body}\n`;
}

function parseArtifact(content: string, expectedKind: ProjectArtifactKind): { metadata: ProjectArtifactMetadata; body: string } {
  const lineEnd = content.indexOf("\n");
  if (lineEnd < 0) throw new ProjectArtifactError("artifact-corrupt", "Artifact metadata is missing.");
  const header = content.slice(0, lineEnd);
  const prefix = `<!-- ${ARTIFACT_HEADER}:`;
  if (!header.startsWith(prefix) || !header.endsWith(" -->")) throw new ProjectArtifactError("artifact-corrupt", "Artifact metadata is invalid.");
  let candidate: unknown;
  try {
    candidate = JSON.parse(header.slice(prefix.length, -4));
  } catch {
    throw new ProjectArtifactError("artifact-corrupt", "Artifact metadata is not valid JSON.");
  }
  const metadata = validateMetadata(candidate, expectedKind);
  return { metadata, body: normalizeBody(content.slice(lineEnd + 1)) };
}

function validateMetadata(candidate: unknown, expectedKind: ProjectArtifactKind): ProjectArtifactMetadata {
  if (!candidate || typeof candidate !== "object") throw new ProjectArtifactError("artifact-corrupt", "Artifact metadata is invalid.");
  const value = candidate as Record<string, unknown>;
  const allowed = new Set(["schemaVersion", "kind", "revision", "updatedAt", "producer", "bodyDigest", "approvedDigest", "supersedesDigest", "confidence", "approvalState"]);
  if (Object.keys(value).some((key) => !allowed.has(key))) throw new ProjectArtifactError("artifact-corrupt", "Artifact metadata contains an unknown field.");
  const confidence = value.confidence ?? "unknown";
  const approval = value.approvalState ?? approvalState(expectedKind, value.approvedDigest as string | null, String(value.bodyDigest));
  if (
    value.schemaVersion !== 1 || value.kind !== expectedKind || !Number.isInteger(value.revision) || Number(value.revision) < 1 ||
    typeof value.updatedAt !== "string" || !Number.isFinite(Date.parse(value.updatedAt)) || typeof value.producer !== "string" ||
    typeof value.bodyDigest !== "string" || !/^[a-f0-9]{64}$/.test(value.bodyDigest) ||
    !nullableDigest(value.approvedDigest) || !nullableDigest(value.supersedesDigest) ||
    !["unknown", "mixed", "verified"].includes(String(confidence)) ||
    !["not_required", "pending", "approved"].includes(String(approval))
  ) throw new ProjectArtifactError("artifact-corrupt", "Artifact metadata failed schema validation.");
  return { ...value, confidence, approvalState: approval } as unknown as ProjectArtifactMetadata;
}

function approvalState(kind: ProjectArtifactKind, approvedDigest: string | null, bodyDigest: string): ProjectArtifactMetadata["approvalState"] {
  if (PROJECT_ARTIFACT_CONTRACTS[kind].approval === "none") return "not_required";
  return approvedDigest === bodyDigest ? "approved" : "pending";
}

function nullableDigest(value: unknown) {
  return value === null || (typeof value === "string" && /^[a-f0-9]{64}$/.test(value));
}

function normalizeBody(value: string) {
  const normalized = value.replaceAll("\r\n", "\n").replace(/\n+$/, "");
  if (!normalized.trim() || Buffer.byteLength(normalized, "utf8") > MAX_ARTIFACT_BYTES) {
    throw new ProjectArtifactError("artifact-unsafe", "Artifact content is empty or exceeds the safe size limit.");
  }
  return normalized;
}

function validateProducer(value: string) {
  const normalized = value.trim();
  if (!/^[a-z0-9][a-z0-9:._-]{2,119}$/i.test(normalized)) throw new ProjectArtifactError("artifact-unsafe", "Artifact producer identity is invalid.");
  return normalized;
}

function rejectSensitiveContent(body: string) {
  const patterns = [
    /\b(?:sk|gsk|hf|ghp|github_pat)_[a-z0-9_-]{16,}\b/i,
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
    /\b(?:api[_-]?key|access[_-]?token|client[_-]?secret|password)\s*[:=]\s*["']?[a-z0-9_./+\-=]{12,}/i,
  ];
  if (patterns.some((pattern) => pattern.test(body))) {
    throw new ProjectArtifactError("sensitive-content", "Potential credential material was detected. Remove it before saving the artifact.");
  }
}

async function assertSafeRoot(root: string) {
  const info = await lstat(root);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new ProjectArtifactError("artifact-unsafe", "Project artifact root is not a safe directory.");
}

async function readSafeFile(path: string) {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_ARTIFACT_BYTES + 8_192) {
    throw new ProjectArtifactError("artifact-unsafe", `${basename(path)} is not safely readable.`);
  }
  return readFile(path, "utf8");
}

async function archive(root: string, artifact: ProjectArtifact) {
  const history = join(root, ".codkesh", "artifacts", artifact.fileName);
  await mkdir(history, { recursive: true, mode: 0o700 });
  await atomicWrite(join(history, `${String(artifact.metadata.revision).padStart(6, "0")}-${artifact.metadata.bodyDigest}.md`), serializeArtifact(artifact.metadata, artifact.body));
}

async function archiveLegacy(root: string, fileName: string, body: string) {
  const history = join(root, ".codkesh", "artifacts", fileName);
  await mkdir(history, { recursive: true, mode: 0o700 });
  await atomicWrite(join(history, `000000-legacy-${digest(body)}.md`), body.endsWith("\n") ? body : `${body}\n`);
}

async function atomicWrite(path: string, content: string, options?: Required<ProjectArtifactStoreOptions>) {
  const temporary = `${path}.tmp-${randomUUID()}`;
  const handle = await open(temporary, "wx", 0o600);
  try {
    await handle.writeFile(content, "utf8");
    await handle.sync();
    if (options?.faultAt === "after_temp_sync") throw new Error("Injected artifact write interruption after temp sync.");
  } finally {
    await handle.close();
  }
  if (options?.faultAt === "before_primary_rename" && !path.includes(`${join(".codkesh", "artifacts")}`)) throw new Error("Injected artifact write interruption before primary rename.");
  await rename(temporary, path);
  await chmod(path, 0o600);
  const directory = await open(dirname(path), "r");
  try { await directory.sync(); } finally { await directory.close(); }
}

function digest(body: string) {
  return createHash("sha256").update(body).digest("hex");
}

function assertDigest(body: string, expected: string) {
  if (digest(body) !== expected) throw new ProjectArtifactError("artifact-conflict", "Artifact content changed outside its recorded revision. Review and reconcile the change.");
}

async function withProjectLock<T>(root: string, options: Required<ProjectArtifactStoreOptions>, operation: () => Promise<T>): Promise<T> {
  const previous = PROJECT_LOCKS.get(root) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => { release = resolve; });
  const queued = previous.then(() => current);
  PROJECT_LOCKS.set(root, queued);
  await previous;
  let releaseProcessLock: (() => Promise<void>) | null = null;
  try {
    releaseProcessLock = await acquireProcessLock(root, options);
    return await operation();
  } finally {
    if (releaseProcessLock) await releaseProcessLock();
    release();
    if (PROJECT_LOCKS.get(root) === queued) PROJECT_LOCKS.delete(root);
  }
}

function contract(kind: ProjectArtifactKind, owners: readonly string[], dependencies: readonly ProjectArtifactKind[], refreshTriggers: readonly string[], approval: "none" | "owner"): ProjectArtifactContract {
  return { kind, fileName: ARTIFACT_FILES[kind], owners, readers: ["orchestrator", "reviewer", "owner"], dependencies, refreshTriggers, approval, sectionProfiles: sectionProfiles(kind) };
}

function sectionProfiles(kind: ProjectArtifactKind): readonly (readonly string[])[] {
  const profiles: Record<ProjectArtifactKind, readonly (readonly string[])[]> = {
    context: [["Inferences", "Assumptions", "Unknowns", "Evidence"]],
    memory: [["Accepted knowledge", "Owner preferences", "Lessons", "Unresolved knowledge"]],
    research: [["Questions", "Evidence", "Findings", "Contradictions and gaps"], ["Grounding", "Product, market, and user analysis", "Technical and delivery analysis", "Evidence boundary"]],
    product: [["Problem and audience", "Value proposition", "Journeys and requirements", "Scope and success measures"], ["Product behavior", "User experience", "Rollout", "Success metrics", "Sources"]],
    design: [["Experience design", "System design", "Data, services, APIs, and integrations", "Quality and migration"], ["Architecture", "User experience", "Data", "Integrations", "Security", "Privacy", "Reliability", "Sources"]],
    delivery_plan: [["Phases and milestones", "Work graph", "Validation and Definition of Done"], ["Risks", "Assumptions", "Source index", "Independent QA"]],
    ops_rules: [["Autonomy and approvals", "Scheduling, retries, and escalation", "Validation, review, and integration", "Jira and evidence policy"]],
    infra: [["Environments and topology", "Services, data, and networking", "Deployment, observability, and rollback", "Cost and free-tier evidence"]],
    security: [["Data and trust boundaries", "Threats and controls", "Secrets, permissions, and egress", "Security validation"]],
    decisions: [["Decision log"]],
    status: [["Current milestone", "Active work", "Blockers and owner actions", "Next action"]],
  };
  return profiles[kind];
}

function validateArtifactStructure(kind: ProjectArtifactKind, body: string) {
  if (!/^#\s+\S/m.test(body)) throw new ProjectArtifactError("artifact-corrupt", `${ARTIFACT_FILES[kind]} requires a readable Markdown title.`);
  const headings = new Set([...body.matchAll(/^##\s+(.+?)\s*$/gm)].map((match) => match[1]!.trim()));
  const valid = PROJECT_ARTIFACT_CONTRACTS[kind].sectionProfiles.some((profile) => profile.every((section) => headings.has(section)));
  if (!valid) throw new ProjectArtifactError("artifact-corrupt", `${ARTIFACT_FILES[kind]} does not match a supported stable-section profile.`);
}

function validateArtifactReferences(kind: ProjectArtifactKind, body: string) {
  const fileToKind = new Map(Object.entries(ARTIFACT_FILES).map(([candidate, file]) => [file, candidate as ProjectArtifactKind]));
  for (const match of body.matchAll(/local:\/\/([A-Z][A-Z-]+\.md)\b/g)) {
    const target = fileToKind.get(match[1]!);
    if (!target) throw new ProjectArtifactError("artifact-corrupt", `Unknown governed artifact reference ${match[1]}.`);
    if (target !== kind && !PROJECT_ARTIFACT_CONTRACTS[kind].dependencies.includes(target)) {
      throw new ProjectArtifactError("artifact-corrupt", `${ARTIFACT_FILES[kind]} cannot depend on ${match[1]}.`);
    }
  }
}

async function readUnverified(root: string, kind: ProjectArtifactKind) {
  return parseArtifact(await readSafeFile(join(root, ARTIFACT_FILES[kind])), kind);
}

async function readHistory(root: string, fileName: string, revision: number, bodyDigest: string) {
  const path = join(root, ".codkesh", "artifacts", fileName, `${String(revision).padStart(6, "0")}-${bodyDigest}.md`);
  const content = await readSafeFile(path);
  const kind = (Object.entries(ARTIFACT_FILES).find(([, file]) => file === fileName)?.[0]) as ProjectArtifactKind | undefined;
  if (!kind) throw new ProjectArtifactError("artifact-corrupt", "Artifact history kind is unknown.");
  const parsed = parseArtifact(content, kind);
  assertDigest(parsed.body, parsed.metadata.bodyDigest);
  return parsed;
}

async function archiveManual(root: string, fileName: string, body: string) {
  const history = join(root, ".codkesh", "artifacts", fileName);
  await mkdir(history, { recursive: true, mode: 0o700 });
  await atomicWrite(join(history, `manual-${Date.now()}-${digest(body)}.md`), `${body}\n`);
}

async function cleanInterruptedWrites(root: string) {
  for (const directory of [root, join(root, ".codkesh", "artifacts")]) await cleanTemporaryFiles(directory, 0);
}

async function cleanTemporaryFiles(directory: string, depth: number): Promise<void> {
  if (depth > 3) return;
  let entries;
  try { entries = await readdir(directory, { withFileTypes: true }); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; throw error; }
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await cleanTemporaryFiles(path, depth + 1);
    else if (entry.isFile() && entry.name.includes(".tmp-")) await rm(path, { force: true });
  }
}

async function acquireProcessLock(root: string, options: Required<ProjectArtifactStoreOptions>): Promise<() => Promise<void>> {
  const lock = join(root, ".codkesh", "locks", "artifacts.lock");
  await mkdir(dirname(lock), { recursive: true, mode: 0o700 });
  const started = Date.now();
  while (true) {
    try {
      await mkdir(lock, { mode: 0o700 });
      await writeFile(join(lock, "owner.json"), JSON.stringify({ pid: process.pid, acquiredAt: Date.now() }), { mode: 0o600 });
      return async () => { await rm(lock, { recursive: true, force: true }); };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      try {
        const info = await stat(lock);
        if (Date.now() - info.mtimeMs > options.staleLockMs) { await rm(lock, { recursive: true, force: true }); continue; }
      } catch (statError) { if ((statError as NodeJS.ErrnoException).code === "ENOENT") continue; throw statError; }
      if (Date.now() - started >= options.lockTimeoutMs) throw new ProjectArtifactError("artifact-lock-timeout", "Another Codkesh process is updating project artifacts. Retry after it finishes.");
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }
}
