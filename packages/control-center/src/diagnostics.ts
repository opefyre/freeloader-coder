export interface DoctorCheck {
  readonly id: string;
  readonly label: string;
  readonly state: "healthy" | "warning" | "failed" | "unavailable";
  readonly detail: string;
  readonly repair: string | null;
  readonly rollback: string | null;
}

export interface DiagnosticArtifact {
  readonly id: string;
  readonly kind: "doctor" | "log" | "environment" | "reproduction";
  readonly content: string;
  readonly containsSourceCode: boolean;
}

export function buildSupportBundle(input: {
  readonly correlationId: string;
  readonly checks: readonly DoctorCheck[];
  readonly artifacts: readonly DiagnosticArtifact[];
  readonly selectedIds: readonly string[];
}): {
  readonly correlationId: string;
  readonly checks: readonly DoctorCheck[];
  readonly included: readonly { readonly id: string; readonly kind: DiagnosticArtifact["kind"]; readonly preview: string }[];
} {
  if (!/^[a-zA-Z0-9._-]{6,120}$/.test(input.correlationId)) throw new Error("Correlation ID is invalid.");
  const selected = new Set(input.selectedIds);
  const included = input.artifacts
    .filter((artifact) => selected.has(artifact.id))
    .map((artifact) => {
      if (artifact.containsSourceCode) throw new Error("Source code is excluded from support bundles by default.");
      return { id: artifact.id, kind: artifact.kind, preview: redactDiagnostic(artifact.content) };
    });
  if (included.length !== selected.size) throw new Error("Unknown diagnostic selection.");
  return { correlationId: input.correlationId, checks: input.checks, included };
}

export function redactDiagnostic(value: string): string {
  return value
    .replace(/(token|secret|password|api[_-]?key)\s*[=:]\s*\S+/gi, "$1=[redacted]")
    .replace(/sk-[a-zA-Z0-9_-]{12,}/g, "[redacted]")
    .replace(/\/Users\/[^/\s]+/g, "/Users/[user]")
    .replace(/C:\\Users\\[^\\\s]+/gi, "C:\\Users\\[user]");
}
