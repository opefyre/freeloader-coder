import { createHash } from "node:crypto";

export type ValidationTier = "fast" | "full";

export interface ValidatorResult {
  readonly id: string;
  readonly passed: boolean;
  readonly durationMs: number;
  readonly outputExcerpt: string;
}

export interface Validator {
  readonly id: string;
  readonly tier: ValidationTier;
  run(signal: AbortSignal): Promise<{ readonly exitCode: number; readonly output: string }>;
}

export interface ValidationEvidence {
  readonly tier: ValidationTier;
  readonly sourceDigest: string;
  readonly inputDigest: string;
  readonly passed: boolean;
  readonly results: readonly ValidatorResult[];
}

export async function runValidation(input: {
  readonly tier: ValidationTier;
  readonly sourceDigest: string;
  readonly validators: readonly Validator[];
  readonly timeoutMs: number;
  readonly maxOutputBytes: number;
}): Promise<ValidationEvidence> {
  if (!/^[a-f0-9]{64}$/.test(input.sourceDigest)) throw new Error("Source digest is invalid.");
  if (input.timeoutMs < 1 || input.maxOutputBytes < 1) throw new Error("Validation limits are invalid.");
  const selected = input.validators
    .filter((validator) => input.tier === "full" || validator.tier === "fast")
    .sort((left, right) => left.id.localeCompare(right.id));
  if (selected.length === 0) throw new Error("No validators are registered for this tier.");
  if (new Set(selected.map((validator) => validator.id)).size !== selected.length) {
    throw new Error("Validator IDs must be unique.");
  }

  const inputDigest = digest(JSON.stringify({
    tier: input.tier,
    sourceDigest: input.sourceDigest,
    validators: selected.map(({ id, tier }) => ({ id, tier }))
  }));
  const results: ValidatorResult[] = [];

  for (const validator of selected) {
    const startedAt = performance.now();
    const signal = AbortSignal.timeout(input.timeoutMs);
    try {
      const result = await validator.run(signal);
      results.push({
        id: validator.id,
        passed: result.exitCode === 0,
        durationMs: Math.max(0, performance.now() - startedAt),
        outputExcerpt: safeExcerpt(result.output, input.maxOutputBytes)
      });
    } catch (error) {
      results.push({
        id: validator.id,
        passed: false,
        durationMs: Math.max(0, performance.now() - startedAt),
        outputExcerpt: signal.aborted
          ? "Validator timed out."
          : safeExcerpt(error instanceof Error ? error.message : "Validator failed.", input.maxOutputBytes)
      });
    }
  }

  return {
    tier: input.tier,
    sourceDigest: input.sourceDigest,
    inputDigest,
    passed: results.every((result) => result.passed),
    results
  };
}

function safeExcerpt(value: string, maxBytes: number): string {
  const redacted = value
    .replace(/(token|secret|password|api[_-]?key)\s*[=:]\s*\S+/gi, "$1=[redacted]")
    .replace(/sk-[a-z0-9_-]{12,}/gi, "[redacted]");
  const buffer = Buffer.from(redacted, "utf8");
  return buffer.byteLength <= maxBytes
    ? redacted
    : `${buffer.subarray(0, maxBytes).toString("utf8")}\n[truncated]`;
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
