import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import {
  providerConnectionSchema,
  providerConnectionStoreSchema,
  type ProviderConnection,
  type ProviderConnectionStore
} from "../../schemas/src/index.js";

const emptyStore: ProviderConnectionStore = {
  schemaVersion: 1,
  connections: []
};

export class JsonProviderConnectionRepository {
  public constructor(private readonly path: string) {
    if (!path) throw new Error("Provider connection repository path is required.");
  }

  public async read(id: string): Promise<ProviderConnection | null> {
    const document = await this.load();
    return document.connections.find((connection) => connection.id === id) ?? null;
  }

  public async list(): Promise<readonly ProviderConnection[]> {
    return (await this.load()).connections;
  }

  public async write(connection: ProviderConnection): Promise<void> {
    const parsed = providerConnectionSchema.parse(connection);
    const document = await this.load();
    const connections = document.connections.filter((entry) => entry.id !== parsed.id);
    connections.push(parsed);
    connections.sort((left, right) => left.id.localeCompare(right.id));
    await this.save({ schemaVersion: 1, connections });
  }

  public async delete(id: string): Promise<void> {
    const document = await this.load();
    await this.save({
      schemaVersion: 1,
      connections: document.connections.filter((connection) => connection.id !== id)
    });
  }

  private async load(): Promise<ProviderConnectionStore> {
    try {
      const input: unknown = JSON.parse(await readFile(this.path, "utf8"));
      return providerConnectionStoreSchema.parse(input);
    } catch (error) {
      if (hasCode(error, "ENOENT")) return emptyStore;
      throw error;
    }
  }

  private async save(document: ProviderConnectionStore): Promise<void> {
    const parsed = providerConnectionStoreSchema.parse(document);
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
    const temporaryPath = `${this.path}.${randomUUID()}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(parsed, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx"
    });
    await rename(temporaryPath, this.path);
  }
}

function hasCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}
