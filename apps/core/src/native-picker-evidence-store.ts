import { randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { z } from "zod";

export const nativePickerEvidenceSchema = z.strictObject({
  schemaVersion: z.literal(1),
  kind: z.enum(["folder", "files"]),
  outcome: z.enum(["selected", "cancelled", "denied", "invalid", "unavailable"]),
  selectionCount: z.number().int().min(0).max(20),
  platform: z.enum(["darwin", "linux", "win32", "other"]),
  observedAt: z.number().int().nonnegative(),
});
export type NativePickerEvidence = z.infer<typeof nativePickerEvidenceSchema>;

const collectionSchema = z.strictObject({
  schemaVersion: z.literal(1),
  evidence: z.array(nativePickerEvidenceSchema).max(100),
});

export class NativePickerEvidenceStore {
  readonly #path: string;
  #write: Promise<unknown> = Promise.resolve();

  constructor(stateDirectory: string) {
    this.#path = resolve(stateDirectory, "native-picker-evidence.json");
  }

  async record(input: NativePickerEvidence): Promise<void> {
    const evidence = nativePickerEvidenceSchema.parse(input);
    const next = this.#write.then(async () => {
      const collection = await this.#load();
      await atomicWrite(this.#path, `${JSON.stringify(collectionSchema.parse({ schemaVersion: 1, evidence: [...collection.evidence, evidence].slice(-100) }), null, 2)}\n`);
    });
    this.#write = next.catch(() => undefined);
    await next;
  }

  async list(): Promise<readonly NativePickerEvidence[]> {
    return (await this.#load()).evidence;
  }

  async #load() {
    try { return collectionSchema.parse(JSON.parse(await readFile(this.#path, "utf8"))); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return collectionSchema.parse({ schemaVersion: 1, evidence: [] });
      throw new Error("Native picker evidence is corrupt; new picker evidence is unavailable.");
    }
  }
}

async function atomicWrite(path: string, content: string) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${randomBytes(8).toString("hex")}.tmp`;
  await writeFile(temporary, content, { encoding: "utf8", mode: 0o600 });
  await chmod(temporary, 0o600);
  await rename(temporary, path);
  await chmod(path, 0o600);
}
