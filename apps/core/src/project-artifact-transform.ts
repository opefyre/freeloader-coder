import {
  PROJECT_ARTIFACT_CONTRACTS,
  PROJECT_ARTIFACT_KINDS,
  ProjectArtifactStore,
  validateProjectArtifactBody,
  type ProjectArtifactKind,
} from "./project-artifact-store.js";

export interface ArtifactReplacement {
  readonly from: string;
  readonly to: string;
}

export interface ArtifactTransformReceipt {
  readonly schemaVersion: 1;
  readonly mode: "dry_run" | "apply";
  readonly changed: readonly {
    readonly kind: ProjectArtifactKind;
    readonly fileName: string;
    readonly fromDigest: string;
    readonly toDigest: string;
    readonly fromRevision: number;
    readonly toRevision: number;
    readonly approvalState: "not_required" | "pending";
  }[];
  readonly unchanged: readonly ProjectArtifactKind[];
}

export class ProjectArtifactTransformService {
  readonly #store: ProjectArtifactStore;

  constructor(store = new ProjectArtifactStore()) {
    this.#store = store;
  }

  async transform(input: {
    readonly root: string;
    readonly replacements: readonly ArtifactReplacement[];
    readonly mode?: "dry_run" | "apply";
    readonly kinds?: readonly ProjectArtifactKind[];
    readonly producer?: string;
  }): Promise<ArtifactTransformReceipt> {
    const replacements = validateReplacements(input.replacements);
    const kinds = validateKinds(input.kinds ?? PROJECT_ARTIFACT_KINDS);
    const mode = input.mode ?? "dry_run";
    const producer = input.producer ?? "codkesh:artifact-transform";
    const changed: ArtifactTransformReceipt["changed"][number][] = [];
    const unchanged: ProjectArtifactKind[] = [];

    for (const kind of kinds) {
      const current = await this.#store.read(input.root, kind);
      const candidate = replacements.reduce(
        (body, replacement) => body.replaceAll(replacement.from, replacement.to),
        current.body,
      );
      if (candidate === current.body) {
        unchanged.push(kind);
        continue;
      }
      const validated = validateProjectArtifactBody(kind, candidate);
      const approvalState = PROJECT_ARTIFACT_CONTRACTS[kind].approval === "none" ? "not_required" : "pending";
      if (mode === "dry_run") {
        changed.push({
          kind,
          fileName: current.fileName,
          fromDigest: current.metadata.bodyDigest,
          toDigest: validated.bodyDigest,
          fromRevision: current.metadata.revision,
          toRevision: current.metadata.revision + 1,
          approvalState,
        });
        continue;
      }
      const written = await this.#store.write(input.root, {
        kind,
        body: validated.body,
        producer,
        expectedDigest: current.metadata.bodyDigest,
        approvedDigest: null,
      });
      if (written.metadata.approvalState === "approved") throw new Error("Changed governed content cannot retain an old approval.");
      changed.push({
        kind,
        fileName: written.fileName,
        fromDigest: current.metadata.bodyDigest,
        toDigest: written.metadata.bodyDigest,
        fromRevision: current.metadata.revision,
        toRevision: written.metadata.revision,
        approvalState: written.metadata.approvalState,
      });
    }
    return { schemaVersion: 1, mode, changed, unchanged };
  }
}

function validateReplacements(replacements: readonly ArtifactReplacement[]) {
  if (replacements.length < 1 || replacements.length > 20) throw new Error("Provide between one and twenty explicit replacements.");
  const seen = new Set<string>();
  return replacements.map((replacement) => {
    if (replacement.from.length < 1 || replacement.from.length > 200 || replacement.to.length > 200) throw new Error("Artifact replacements must be bounded.");
    if (replacement.from === replacement.to) throw new Error("Artifact replacements must change content.");
    if (seen.has(replacement.from)) throw new Error("Artifact replacement sources must be unique.");
    seen.add(replacement.from);
    return replacement;
  });
}

function validateKinds(kinds: readonly ProjectArtifactKind[]) {
  if (kinds.length < 1) throw new Error("Select at least one governed artifact.");
  const allowed = new Set<ProjectArtifactKind>(PROJECT_ARTIFACT_KINDS);
  const unique = [...new Set(kinds)];
  if (unique.some((kind) => !allowed.has(kind))) throw new Error("Unknown governed artifact kind.");
  return unique;
}
