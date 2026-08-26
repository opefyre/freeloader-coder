import { createHash } from "node:crypto";

import type { LocalProjectRegistry } from "./local-project-registry.js";
import { ProjectArtifactStore } from "./project-artifact-store.js";
import type { ProjectLifecycleRecord } from "../../../packages/orchestration/src/project-lifecycle.js";
import type { ProjectExecutionRecord } from "../../../packages/orchestration/src/project-execution.js";

type Lifecycles = { list(): Promise<readonly ProjectLifecycleRecord[]> };
type Executions = { get(projectId: string): Promise<ProjectExecutionRecord | null> };

export class OwnerPilotObserver {
  constructor(
    private readonly projects: Pick<LocalProjectRegistry, "canonicalRoot">,
    private readonly lifecycles: Lifecycles,
    private readonly executions: Executions,
    private readonly artifacts = new ProjectArtifactStore(),
    private readonly now: () => number = Date.now,
  ) {}

  async observe(projectId: string) {
    const [root, lifecycles, execution] = await Promise.all([
      this.projects.canonicalRoot(projectId),
      this.lifecycles.list(),
      this.executions.get(projectId).catch(() => null),
    ]);
    const inspected = await this.artifacts.inspect(root);
    const byKind = new Map(inspected.map((artifact) => [artifact.kind, artifact]));
    const context = byKind.get("context");
    const design = byKind.get("design");
    const lifecycle = lifecycles.find((record) => record.projectId === projectId);
    const preview = execution?.tasks.flatMap((task) => task.liveJourneyEvidence?.passed ? [task.liveJourneyEvidence] : []).sort((a, b) => b.observedAt - a.observedAt)[0] ?? null;
    const timestamps = [
      context?.state === "ready" && context.revision > 1 ? Date.parse(context.updatedAt) : 0,
      design?.approvalState === "approved" ? Date.parse(design.updatedAt) : 0,
      preview?.observedAt ?? 0,
      lifecycle?.updatedAt ?? 0,
    ].filter((value) => Number.isFinite(value) && value > 0);
    return {
      schemaVersion: 1 as const,
      projectId,
      observedAt: this.now(),
      activityAt: timestamps.length ? Math.max(...timestamps) : 0,
      contextDigest: context?.state === "ready" && context.revision > 1 ? context.bodyDigest : null,
      approvedDesignDigest: design?.state === "ready" && design.approvalState === "approved" ? design.bodyDigest : null,
      previewEvidenceDigest: preview ? createHash("sha256").update(JSON.stringify({ reference: preview.reference, revisionDigest: preview.revisionDigest, observedAt: preview.observedAt })).digest("hex") : null,
    };
  }
}
