export type Fault =
  | "provider_429" | "provider_5xx" | "timeout" | "invalid_response" | "process_crash"
  | "disk_pressure" | "network_loss" | "database_lock" | "worker_loss" | "stale_lease"
  | "duplicate_event" | "preview_failure" | "oauth_expiry";

export interface ChaosResult {
  readonly fault: Fault;
  readonly recovered: boolean;
  readonly dataIntegrity: boolean;
  readonly duplicateEffects: number;
  readonly safeState: boolean;
  readonly evidenceRef: string;
}

export function releaseGate(results: readonly ChaosResult[]): {
  readonly allowed: boolean;
  readonly blockers: readonly string[];
} {
  const blockers = results.flatMap((result) => {
    const issues: string[] = [];
    if (!result.dataIntegrity) issues.push(`${result.fault}:data-integrity`);
    if (result.duplicateEffects > 0) issues.push(`${result.fault}:duplicate-effect`);
    if (!result.recovered && !result.safeState) issues.push(`${result.fault}:unsafe-terminal-state`);
    if (!result.evidenceRef.trim()) issues.push(`${result.fault}:missing-evidence`);
    return issues;
  });
  return { allowed: blockers.length === 0, blockers };
}
