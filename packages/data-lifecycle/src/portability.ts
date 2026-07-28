import type { DataRecord } from "./schema.js";

export interface PortableBundle {
  readonly format: "pipeline-studio-project-v1";
  readonly projectId: string;
  readonly encrypted: boolean;
  readonly destination: string;
  readonly records: readonly DataRecord[];
  readonly credentialsIncluded: false;
  readonly checksum: string;
}

export function previewExport(input: {
  readonly projectId: string;
  readonly records: readonly DataRecord[];
  readonly destination: string;
  readonly encrypted: boolean;
  readonly includeKinds: readonly DataRecord["kind"][];
}): PortableBundle {
  if (!input.destination.trim()) throw new Error("Backup destination is required.");
  const records = input.records.filter((record) =>
    record.projectId === input.projectId && input.includeKinds.includes(record.kind) && !record.credential
  );
  const checksum = records.map((record) => record.checksum).sort().join(":");
  return { format: "pipeline-studio-project-v1", projectId: input.projectId, encrypted: input.encrypted, destination: input.destination, records, credentialsIncluded: false, checksum };
}

export function planRestore(input: {
  readonly bundle: PortableBundle;
  readonly existing: readonly DataRecord[];
  readonly conflict: "keep_existing" | "import_copy" | "replace_older";
}): { readonly create: readonly DataRecord[]; readonly replace: readonly DataRecord[]; readonly preserve: readonly DataRecord[] } {
  const existing = new Map(input.existing.map((record) => [record.id, record]));
  const create: DataRecord[] = [];
  const replace: DataRecord[] = [];
  const preserve: DataRecord[] = [];
  for (const record of input.bundle.records) {
    const current = existing.get(record.id);
    if (!current) create.push(record);
    else if (input.conflict === "replace_older" && current.checksum !== record.checksum) replace.push(record);
    else if (input.conflict === "import_copy") create.push({ ...record, id: `${record.id}.imported` });
    else preserve.push(current);
  }
  return { create, replace, preserve };
}

export function deletionDryRun(input: {
  readonly records: readonly DataRecord[];
  readonly targetIds: readonly string[];
  readonly activeTaskIds: ReadonlySet<string>;
  readonly externalGrants: readonly string[];
}): {
  readonly deletable: readonly string[];
  readonly blocked: readonly { readonly id: string; readonly reason: string }[];
  readonly sharedPreserved: readonly string[];
  readonly externalRevocations: readonly string[];
  readonly undo: "bounded_snapshot";
} {
  const targets = new Set(input.targetIds);
  const referenced = new Set(input.records.filter((record) => !targets.has(record.id)).flatMap((record) => record.references));
  const blocked = input.targetIds.flatMap((id) =>
    input.activeTaskIds.has(id) ? [{ id, reason: "Active work must be reconciled first." }] : []
  );
  const sharedPreserved = input.targetIds.filter((id) => referenced.has(id));
  const denied = new Set([...blocked.map((item) => item.id), ...sharedPreserved]);
  return {
    deletable: input.targetIds.filter((id) => !denied.has(id)),
    blocked,
    sharedPreserved,
    externalRevocations: [...input.externalGrants],
    undo: "bounded_snapshot",
  };
}
