import { createHash } from "node:crypto";

import {
  canonicalProjectRecordSchema,
  projectEntryRequestSchema,
  repositoryInspectionSchema,
  type CanonicalProjectRecord,
  type ProjectEntryRequest,
  type RepositoryInspection
} from "./contracts.js";

export interface RepositoryIntakeAdapter {
  inspectLocal(path: string): Promise<RepositoryInspection>;
  inspectRemote(url: string): Promise<RepositoryInspection>;
  inspectDestination(path: string): Promise<"unused" | "empty" | "occupied">;
  clone(input: {
    readonly url: string;
    readonly destination: string;
    readonly resumeToken: string;
  }): Promise<RepositoryInspection>;
}

export type ProjectIntakeResult =
  | {
      readonly status: "ready";
      readonly entryMethod: ProjectEntryRequest["kind"];
      readonly record: CanonicalProjectRecord;
      readonly resumeToken: null;
      readonly options: readonly string[];
    }
  | {
      readonly status: "needs_user" | "unsupported" | "failed";
      readonly entryMethod: ProjectEntryRequest["kind"];
      readonly record: null;
      readonly resumeToken: string;
      readonly code:
        | "path_missing"
        | "not_directory"
        | "destination_conflict"
        | "authentication_required"
        | "authentication_denied"
        | "unsupported_layout"
        | "clone_failed";
      readonly message: string;
      readonly options: readonly string[];
    };

export async function registerProject(input: {
  readonly request: unknown;
  readonly adapter: RepositoryIntakeAdapter;
}): Promise<ProjectIntakeResult> {
  const request = projectEntryRequestSchema.parse(input.request);
  if (request.kind === "local") {
    const inspection = repositoryInspectionSchema.parse(
      await input.adapter.inspectLocal(request.path)
    );
    return evaluateInspection(request.kind, inspection);
  }

  assertGitHubCloneUrl(request.url);
  const destination = await input.adapter.inspectDestination(request.destination);
  if (destination === "occupied") {
    return problem(
      request,
      "needs_user",
      "destination_conflict",
      "The destination already contains files. Nothing was changed.",
      [
        "Choose an empty folder",
        "Register the existing folder instead",
        "Cancel and keep the destination unchanged"
      ]
    );
  }

  const remote = repositoryInspectionSchema.parse(
    await input.adapter.inspectRemote(request.url)
  );
  if (remote.authentication === "required") {
    return problem(
      request,
      "needs_user",
      "authentication_required",
      "This repository needs GitHub access before it can be cloned.",
      ["Connect GitHub and Resume verification", "Use a local clone instead", "Cancel"]
    );
  }
  if (remote.authentication === "denied") {
    return problem(
      request,
      "needs_user",
      "authentication_denied",
      "GitHub denied access to this repository. No files were created.",
      ["Review repository permission and Resume verification", "Choose another repository", "Cancel"]
    );
  }

  try {
    const cloned = repositoryInspectionSchema.parse(await input.adapter.clone({
      url: request.url,
      destination: request.destination,
      resumeToken: resumeToken(request)
    }));
    return evaluateInspection(request.kind, cloned);
  } catch {
    return problem(
      request,
      "failed",
      "clone_failed",
      "The clone did not finish. Existing destination files remain unchanged.",
      ["Retry the clone", "Review GitHub access", "Register a local clone"]
    );
  }
}

function evaluateInspection(
  entryMethod: ProjectEntryRequest["kind"],
  inspection: RepositoryInspection
): ProjectIntakeResult {
  if (!inspection.exists) {
    return {
      status: "needs_user",
      entryMethod,
      record: null,
      resumeToken: resumeToken({ kind: entryMethod, repositoryId: inspection.repositoryId }),
      code: "path_missing",
      message: "The selected repository could not be found.",
      options: ["Choose the repository again", "Check drive access and Resume verification", "Cancel"]
    };
  }
  if (!inspection.directory) {
    return {
      status: "needs_user",
      entryMethod,
      record: null,
      resumeToken: resumeToken({ kind: entryMethod, repositoryId: inspection.repositoryId }),
      code: "not_directory",
      message: "The selected location is not a repository folder.",
      options: ["Choose a folder", "Open setup help", "Cancel"]
    };
  }
  if (inspection.unsupportedReasons.length > 0) {
    return {
      status: "unsupported",
      entryMethod,
      record: null,
      resumeToken: resumeToken({ kind: entryMethod, repositoryId: inspection.repositoryId }),
      code: "unsupported_layout",
      message: `This layout needs attention: ${inspection.unsupportedReasons.join("; ")}.`,
      options: ["Review compatibility details", "Choose a supported repository", "Resume after fixing the layout"]
    };
  }

  const record = canonicalProjectRecordSchema.parse({
    schemaVersion: 1,
    id: `project_${hash(inspection.repositoryId).slice(0, 12)}`,
    repositoryId: inspection.repositoryId,
    displayName: inspection.displayName,
    repositoryRefDigest: hash(inspection.canonicalPath),
    state: inspection.missingDependencies.length > 0 ? "needs_setup" : "ready",
    summary: {
      sizeBytes: inspection.sizeBytes,
      fileCount: inspection.fileCount,
      hasGit: inspection.git.present,
      hasSubmodules: inspection.submodules.length > 0,
      usesLfs: inspection.lfs,
      detectedCommands: inspection.detectedCommands,
      risks: inspection.risks,
      missingDependencies: inspection.missingDependencies
    },
    recommendedFirstAction:
      inspection.missingDependencies.length > 0
        ? `Install ${inspection.missingDependencies[0]} and Resume verification.`
        : "Review the detected project plan."
  });
  return { status: "ready", entryMethod, record, resumeToken: null, options: [] };
}

function problem(
  request: ProjectEntryRequest,
  status: "needs_user" | "unsupported" | "failed",
  code: Extract<ProjectIntakeResult, { record: null }>["code"],
  message: string,
  options: readonly string[]
): ProjectIntakeResult {
  return {
    status,
    entryMethod: request.kind,
    record: null,
    resumeToken: resumeToken(request),
    code,
    message,
    options
  };
}

function assertGitHubCloneUrl(value: string): void {
  const url = new URL(value);
  if (
    url.hostname !== "github.com"
    || !/^\/[^/]+\/[^/]+(?:\.git)?$/.test(url.pathname)
    || url.username
    || url.password
    || url.search
    || url.hash
  ) {
    throw new Error("Only canonical HTTPS GitHub repository URLs are accepted.");
  }
}

function resumeToken(value: unknown): string {
  return `resume_${hash(JSON.stringify(value)).slice(0, 20)}`;
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
