export type DataKind =
  | "profile" | "project" | "conversation" | "task" | "dependency" | "lease"
  | "event" | "approval" | "artifact" | "provider" | "connector" | "worker"
  | "evaluation" | "setting";

export interface DataRecord {
  readonly id: string;
  readonly kind: DataKind;
  readonly ownerId: string;
  readonly projectId: string | null;
  readonly checksum: string;
  readonly references: readonly string[];
  readonly retention: "keep" | "project" | "temporary" | "audit";
  readonly sizeBytes: number;
  readonly contentAddress: string | null;
  readonly credential: boolean;
}

export function validateDataGraph(records: readonly DataRecord[]): void {
  const byId = new Map(records.map((record) => [record.id, record]));
  if (byId.size !== records.length) throw new Error("Data identities must be unique.");
  for (const record of records) {
    if (!record.id || !record.ownerId || !/^[a-f0-9]{64}$/.test(record.checksum) || record.sizeBytes < 0) {
      throw new Error("Data record is invalid.");
    }
    if (record.credential) throw new Error("Credentials must stay outside the canonical database.");
    if (record.kind === "artifact" && record.sizeBytes > 1_000_000 && !record.contentAddress) {
      throw new Error("Large artifacts must be content addressed.");
    }
    for (const reference of record.references) {
      if (!byId.has(reference)) throw new Error(`Missing data reference ${reference}.`);
    }
  }
}

export function storageBreakdown(records: readonly DataRecord[]): readonly {
  readonly projectId: string;
  readonly kind: DataKind;
  readonly bytes: number;
}[] {
  const groups = new Map<string, { projectId: string; kind: DataKind; bytes: number }>();
  for (const record of records) {
    const projectId = record.projectId ?? "profile";
    const key = `${projectId}:${record.kind}`;
    const current = groups.get(key) ?? { projectId, kind: record.kind, bytes: 0 };
    groups.set(key, { ...current, bytes: current.bytes + record.sizeBytes });
  }
  return [...groups.values()].sort((a, b) => b.bytes - a.bytes || a.projectId.localeCompare(b.projectId));
}

export function cleanupEligible(input: {
  readonly records: readonly DataRecord[];
  readonly candidateIds: readonly string[];
  readonly activeTaskIds: ReadonlySet<string>;
  readonly checkpointReferences: ReadonlySet<string>;
}): readonly string[] {
  validateDataGraph(input.records);
  const retainedReferences = new Set(
    input.records
      .filter((record) => !input.candidateIds.includes(record.id))
      .flatMap((record) => record.references),
  );
  return input.candidateIds.filter((id) => {
    const record = input.records.find((item) => item.id === id);
    return record
      && record.retention !== "keep"
      && record.retention !== "audit"
      && !input.activeTaskIds.has(id)
      && !input.checkpointReferences.has(id)
      && !retainedReferences.has(id);
  });
}
