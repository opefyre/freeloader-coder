import { createHash, randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { z } from "zod";

const opaqueReference = z.string().regex(/^[a-z][a-z0-9_-]{2,31}:[A-Za-z0-9_-]{8,160}$/);
const modeSchema = z.enum(["new_product", "existing_product"]);
const stateSchema = z.enum(["draft", "resource_selection", "submitted", "analyzing", "needs_input", "cancelled"]);
const intakeSchema = z.strictObject({
  schemaVersion: z.literal(1),
  id: z.string().regex(/^intake_[a-f0-9]{20}$/),
  projectMode: modeSchema,
  state: stateSchema,
  idea: z.string().max(20_000),
  workspaceReference: opaqueReference.nullable(),
  attachmentReferences: z.array(opaqueReference).max(100),
  selectedResources: z.array(opaqueReference).max(100),
  revision: z.number().int().positive(),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
  submittedAt: z.number().int().nonnegative().nullable(),
  cancellationReason: z.string().trim().min(3).max(500).nullable(),
});
const documentSchema = z.strictObject({
  schemaVersion: z.literal(1),
  intakes: z.array(intakeSchema).max(1_000),
  submitReceipts: z.record(z.string(), z.string().regex(/^intake_[a-f0-9]{20}$/)),
});

export type ProjectIntake = z.infer<typeof intakeSchema>;

export class ProjectIntakeStore {
  private readonly path: string;
  private mutation: Promise<void> = Promise.resolve();

  constructor(stateDirectory: string, private readonly now: () => number = Date.now) {
    this.path = resolve(stateDirectory, "project-intakes.json");
  }

  async list(): Promise<readonly ProjectIntake[]> {
    return (await this.load()).intakes.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async create(raw: unknown): Promise<ProjectIntake> {
    const input = z.strictObject({ schemaVersion: z.literal(1), projectMode: modeSchema }).parse(raw);
    return this.mutate(async (document) => {
      const now = this.now();
      const intake = intakeSchema.parse({
        schemaVersion: 1, id: `intake_${createHash("sha256").update(randomUUID()).digest("hex").slice(0, 20)}`,
        projectMode: input.projectMode, state: "draft", idea: "", workspaceReference: null,
        attachmentReferences: [], selectedResources: [], revision: 1, createdAt: now, updatedAt: now,
        submittedAt: null, cancellationReason: null,
      });
      return { document: { ...document, intakes: [...document.intakes, intake] }, result: intake };
    });
  }

  async saveDraft(id: string, raw: unknown): Promise<ProjectIntake> {
    const input = z.strictObject({
      schemaVersion: z.literal(1), expectedRevision: z.number().int().positive(), idea: z.string().max(20_000),
      workspaceReference: opaqueReference.nullable(), attachmentReferences: z.array(opaqueReference).max(100),
    }).parse(raw);
    return this.update(id, input.expectedRevision, ["draft", "resource_selection"], (current) => ({
      ...current, idea: input.idea, workspaceReference: input.workspaceReference,
      attachmentReferences: [...new Set(input.attachmentReferences)], state: "resource_selection",
    }));
  }

  async selectResources(id: string, raw: unknown): Promise<ProjectIntake> {
    const input = z.strictObject({ schemaVersion: z.literal(1), expectedRevision: z.number().int().positive(), selectedResources: z.array(opaqueReference).max(100) }).parse(raw);
    return this.update(id, input.expectedRevision, ["resource_selection"], (current) => ({ ...current, selectedResources: [...new Set(input.selectedResources)] }));
  }

  async submit(id: string, raw: unknown, idempotencyKey: string): Promise<ProjectIntake> {
    const input = z.strictObject({ schemaVersion: z.literal(1), expectedRevision: z.number().int().positive() }).parse(raw);
    assertIdempotencyKey(idempotencyKey);
    return this.mutate(async (document) => {
      const receiptKey = digest(`${id}:${idempotencyKey}`);
      const replayId = document.submitReceipts[receiptKey];
      if (replayId) return { document, result: requireIntake(document, replayId) };
      const current = requireIntake(document, id);
      assertRevision(current, input.expectedRevision);
      if (current.state !== "resource_selection" || !current.idea.trim() || !current.workspaceReference) {
        throw new ProjectIntakeStoreError("invalid_transition", "Complete the idea and choose a workspace before submitting.");
      }
      const now = this.now();
      const next = intakeSchema.parse({ ...current, state: "submitted", revision: current.revision + 1, updatedAt: now, submittedAt: now });
      return { document: { ...replace(document, next), submitReceipts: { ...document.submitReceipts, [receiptKey]: id } }, result: next };
    });
  }

  beginAnalysis(id: string, expectedRevision: number): Promise<ProjectIntake> {
    return this.update(id, expectedRevision, ["submitted"], (current) => ({ ...current, state: "analyzing" }));
  }

  requestInput(id: string, expectedRevision: number): Promise<ProjectIntake> {
    return this.update(id, expectedRevision, ["analyzing"], (current) => ({ ...current, state: "needs_input" }));
  }

  cancel(id: string, expectedRevision: number, reason: string): Promise<ProjectIntake> {
    const cancellationReason = z.string().trim().min(3).max(500).parse(reason);
    return this.update(id, expectedRevision, ["draft", "resource_selection", "submitted", "analyzing", "needs_input"], (current) => ({ ...current, state: "cancelled", cancellationReason }));
  }

  private async update(id: string, expectedRevision: number, allowed: readonly ProjectIntake["state"][], change: (current: ProjectIntake) => ProjectIntake): Promise<ProjectIntake> {
    return this.mutate(async (document) => {
      const current = requireIntake(document, id); assertRevision(current, expectedRevision);
      if (!allowed.includes(current.state)) throw new ProjectIntakeStoreError("invalid_transition", `Cannot continue intake from ${current.state}.`);
      const next = intakeSchema.parse({ ...change(current), revision: current.revision + 1, updatedAt: this.now() });
      return { document: replace(document, next), result: next };
    });
  }

  private async mutate<T>(operation: (document: z.infer<typeof documentSchema>) => Promise<{ document: z.infer<typeof documentSchema>; result: T }>): Promise<T> {
    let result!: T;
    const next = this.mutation.then(async () => { const outcome = await operation(await this.load()); await atomicWrite(this.path, JSON.stringify(documentSchema.parse(outcome.document), null, 2)); result = outcome.result; });
    this.mutation = next.catch(() => undefined); await next; return result;
  }

  private async load() {
    try { return documentSchema.parse(JSON.parse(await readFile(this.path, "utf8"))); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return documentSchema.parse({ schemaVersion: 1, intakes: [], submitReceipts: {} }); throw new ProjectIntakeStoreError("corrupt_state", "Project intake state could not be validated."); }
  }
}

export class ProjectIntakeStoreError extends Error { constructor(readonly code: "not_found" | "stale_revision" | "invalid_transition" | "corrupt_state", message: string) { super(message); } }

function requireIntake(document: z.infer<typeof documentSchema>, id: string) { const found = document.intakes.find((item) => item.id === id); if (!found) throw new ProjectIntakeStoreError("not_found", "Project intake was not found."); return found; }
function assertRevision(intake: ProjectIntake, expected: number) { if (intake.revision !== expected) throw new ProjectIntakeStoreError("stale_revision", "The intake changed. Review the latest version before continuing."); }
function replace(document: z.infer<typeof documentSchema>, intake: ProjectIntake) { return { ...document, intakes: document.intakes.map((item) => item.id === intake.id ? intake : item) }; }
function digest(value: string) { return createHash("sha256").update(value).digest("hex"); }
function assertIdempotencyKey(value: string) { if (!/^[A-Za-z0-9._:-]{8,160}$/.test(value)) throw new Error("Idempotency key is invalid."); }
async function atomicWrite(path: string, content: string) { await mkdir(dirname(path), { recursive: true, mode: 0o700 }); const temporary = `${path}.${process.pid}.tmp`; await writeFile(temporary, content, { encoding: "utf8", mode: 0o600 }); await chmod(temporary, 0o600); await rename(temporary, path); await chmod(path, 0o600); }
