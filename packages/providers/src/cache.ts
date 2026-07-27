import { createHash } from "node:crypto";
import type { DataClass } from "./router.js";

export interface CachedModelResult<T> {
  readonly value: T;
  readonly verified: false;
  readonly createdAt: number;
  readonly expiresAt: number;
}

interface Entry<T> extends CachedModelResult<T> {
  lastReadAt: number;
}

export class ResultCache<T> {
  readonly #entries = new Map<string, Entry<T>>();

  constructor(
    private readonly options: {
      readonly maxEntries: number;
      readonly ttlMs: number;
      readonly now: () => number;
    }
  ) {
    if (options.maxEntries < 1 || options.ttlMs < 1) throw new Error("Cache limits are invalid.");
  }

  key(input: {
    readonly providerId: string;
    readonly modelId: string;
    readonly kind: string;
    readonly requestDigest: string;
    readonly scopeDigest: string;
  }): string {
    return createHash("sha256").update(JSON.stringify(input)).digest("hex");
  }

  get(key: string): CachedModelResult<T> | null {
    const entry = this.#entries.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= this.options.now()) {
      this.#entries.delete(key);
      return null;
    }
    entry.lastReadAt = this.options.now();
    return entry;
  }

  put(key: string, dataClass: DataClass, value: T): CachedModelResult<T> {
    if (!["public_test", "non_personal_test", "source_code"].includes(dataClass)) {
      throw new Error("Sensitive model results are not cache eligible.");
    }
    const now = this.options.now();
    const entry: Entry<T> = {
      value,
      verified: false,
      createdAt: now,
      expiresAt: now + this.options.ttlMs,
      lastReadAt: now
    };
    this.#entries.set(key, entry);
    if (this.#entries.size > this.options.maxEntries) {
      const oldest = [...this.#entries.entries()]
        .sort((left, right) => left[1].lastReadAt - right[1].lastReadAt)[0];
      if (oldest) this.#entries.delete(oldest[0]);
    }
    return entry;
  }
}
