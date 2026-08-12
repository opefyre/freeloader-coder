import { ArrowRight } from "@phosphor-icons/react/ArrowRight";
import { ArrowClockwise } from "@phosphor-icons/react/ArrowClockwise";
import { ArrowDown } from "@phosphor-icons/react/ArrowDown";
import { ArrowUp } from "@phosphor-icons/react/ArrowUp";
import { CheckCircle } from "@phosphor-icons/react/CheckCircle";
import { Fingerprint } from "@phosphor-icons/react/Fingerprint";
import { FloppyDisk } from "@phosphor-icons/react/FloppyDisk";
import { FolderOpen } from "@phosphor-icons/react/FolderOpen";
import { GitBranch } from "@phosphor-icons/react/GitBranch";
import { GithubLogo } from "@phosphor-icons/react/GithubLogo";
import { HourglassMedium } from "@phosphor-icons/react/HourglassMedium";
import { Kanban } from "@phosphor-icons/react/Kanban";
import { LockKey } from "@phosphor-icons/react/LockKey";
import { MagnifyingGlass } from "@phosphor-icons/react/MagnifyingGlass";
import { PaperclipHorizontal } from "@phosphor-icons/react/PaperclipHorizontal";
import { PaperPlaneTilt } from "@phosphor-icons/react/PaperPlaneTilt";
import { Play } from "@phosphor-icons/react/Play";
import { ShieldCheck } from "@phosphor-icons/react/ShieldCheck";
import { Stop } from "@phosphor-icons/react/Stop";
import { Trash } from "@phosphor-icons/react/Trash";
import { Warning } from "@phosphor-icons/react/Warning";
import { X } from "@phosphor-icons/react/X";
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import { prepareVoiceEvidence } from "../../../../../packages/conversation/src/voice.js";
import type {
  LocalProjectFileImportResponse,
  LocalProjectSnapshot,
} from "../../../../../packages/runtime/src/local-projects.js";
import type { ProjectLifecycleRecord } from "../../../../../packages/orchestration/src/project-lifecycle.js";
import type { EligibilityDecision } from "../../../../../packages/orchestration/src/eligibility-gate.js";
import type {
  LocalDraftPlan,
  LocalRequest,
} from "../../../../../packages/runtime/src/local-requests.js";
import {
  addLocalProjectFileContent,
  addLocalProjectFiles,
  createLocalProject,
  generateLocalProjectContext,
  getProjectLifecycle,
  getProjectEligibility,
  answerProjectClarifications,
  listLocalProjects,
  setLocalProjectResources,
} from "../../local-project-client.js";
import { listIntegrationConnections } from "../../integration-connection-client.js";
import type { PublicIntegrationConnectionCollection } from "../../../../../packages/runtime/src/integration-connections.js";
import type { ProjectIntake } from "../../../../../packages/runtime/src/project-intakes.js";
import { openNativePicker } from "../../native-picker-client.js";
import {
  archiveLocalRequest,
  approveLocalPlan,
  advanceLocalExecution,
  advanceLocalRequest,
  authorizeLocalExecution,
  advanceLocalPatch,
  advanceLocalCommit,
  advanceLocalIntegration,
  approveLocalIntegration,
  previewLocalIntegration,
  approveLocalCommit,
  approveLocalPatch,
  cancelLocalRequest,
  createLocalRequest,
  listLocalRequests,
  previewLocalPatch,
  previewLocalCommit,
  advanceLocalChangeSet,
  approveLocalChangeSet,
  previewLocalChangeSet,
  updateLocalPlan,
} from "../../local-request-client.js";
import { Badge } from "../ui/badge.js";
import { Button } from "../ui/button.js";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../ui/card.js";

const LocalProposalCard = lazy(async () => {
  const module = await import("./local-proposal-card.js");
  return { default: module.LocalProposalCard };
});
const LocalProposalControls = lazy(async () => {
  const module = await import("./local-proposal-card.js");
  return { default: module.LocalProposalControls };
});
const LocalVoiceInput = lazy(async () => {
  const module = await import("./local-voice-input.js");
  return { default: module.LocalVoiceInput };
});
type LocalVoiceDraft = import("./local-voice-input.js").LocalVoiceDraft;

const endpoint =
  import.meta.env.VITE_PIPELINE_STUDIO_CONTROL_URL ?? "http://127.0.0.1:4312";

function encodeBase64(value: ArrayBuffer): string {
  const bytes = new Uint8Array(value);
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 32_768) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 32_768));
  }
  return btoa(binary);
}

export function LocalRequestPanel(props: {
  mode: "compose" | "queue";
  initialProjectId?: string | undefined;
  navigate?: (view: "work" | "projects" | "activity" | "settings") => void;
}) {
  const [projects, setProjects] = useState<readonly LocalProjectSnapshot[]>([]);
  const [requests, setRequests] = useState<readonly LocalRequest[]>([]);
  const [projectId, setProjectId] = useState(props.initialProjectId ?? "");
  const [workspacePath, setWorkspacePath] = useState("");
  const [workspaceLabel, setWorkspaceLabel] = useState("");
  const [attachments, setAttachments] = useState<
    readonly { path: string; label: string }[]
  >([]);
  const [browserAttachments, setBrowserAttachments] = useState<readonly File[]>(
    [],
  );
  const [voice, setVoice] = useState<LocalVoiceDraft | null>(null);
  const [projectPickerOpen, setProjectPickerOpen] = useState(false);
  const [resourcePickerOpen, setResourcePickerOpen] = useState(false);
  const [resourceQuery, setResourceQuery] = useState("");
  const [integrationConnections, setIntegrationConnections] =
    useState<PublicIntegrationConnectionCollection | null>(null);
  const [selectedRepositoryIds, setSelectedRepositoryIds] = useState<
    readonly string[]
  >([]);
  const [selectedJiraProjectId, setSelectedJiraProjectId] = useState("");
  const [selectedTelegramChatIds, setSelectedTelegramChatIds] = useState<
    readonly string[]
  >([]);
  const [outcome, setOutcome] = useState("");
  const [lifecycle, setLifecycle] = useState<ProjectLifecycleRecord | null>(
    null,
  );
  const [eligibility, setEligibility] = useState<EligibilityDecision | null>(
    null,
  );
  const [clarificationChoices, setClarificationChoices] = useState<
    Record<string, string>
  >({});
  const [customAnswers, setCustomAnswers] = useState<Record<string, string>>(
    {},
  );
  const [lastSubmission, setLastSubmission] = useState<{
    idea: string;
    project: string;
    created: boolean;
    imports: LocalProjectFileImportResponse["files"];
  }>();
  const [status, setStatus] = useState<
    "loading" | "ready" | "working" | "offline"
  >("loading");
  const [notice, setNotice] = useState(
    "Loading live local projects and durable request state…",
  );
  const [patchDrafts, setPatchDrafts] = useState<
    Record<string, { path: string; content: string }>
  >({});
  const [commitMessages, setCommitMessages] = useState<Record<string, string>>(
    {},
  );
  const [changeSetDrafts, setChangeSetDrafts] = useState<
    Record<
      string,
      Array<{
        type: "create" | "replace" | "delete";
        path: string;
        content: string;
      }>
    >
  >({});
  const disposed = useRef(false);
  const draftIntakeRef = useRef<ProjectIntake | null>(null);
  const draftSaveQueue = useRef<Promise<void>>(Promise.resolve());
  const restoredDraft = useRef(false);

  function rememberDraft(value: ProjectIntake | null) {
    draftIntakeRef.current = value;
  }

  const refresh = useCallback(async () => {
    try {
      const { decodeProjectIntakeReference, listProjectIntakes } =
        await import("../../project-intake-client.js");
      const [projectCollection, requestCollection, intakeCollection] =
        await Promise.all([
          listLocalProjects({ endpoint }),
          listLocalRequests({ endpoint }),
          listProjectIntakes(endpoint),
        ]);
      if (disposed.current) return;
      setProjects(projectCollection.projects);
      setRequests(requestCollection.requests);
      if (!restoredDraft.current && props.mode === "compose") {
        const resumable = intakeCollection.intakes.find((intake) =>
          ["draft", "resource_selection"].includes(intake.state),
        );
        restoredDraft.current = true;
        if (resumable) {
          rememberDraft(resumable);
          setOutcome(resumable.idea);
          if (resumable.projectMode === "new_product") {
            setProjectId("__new__");
            setWorkspacePath(
              resumable.workspaceReference?.startsWith("selection_")
                ? resumable.workspaceReference
                : "",
            );
            setWorkspaceLabel(
              resumable.workspaceLabel ?? "Choose folder again",
            );
          } else {
            setProjectId(
              decodeProjectIntakeReference(
                resumable.workspaceReference,
                "project",
              ) ?? "__new__",
            );
          }
          setNotice("Draft restored. No work started.");
        }
      }
      setProjectId((current) =>
        props.initialProjectId &&
        projectCollection.projects.some(
          (project) => project.id === props.initialProjectId,
        )
          ? props.initialProjectId
          : current === "__new__"
            ? current
            : projectCollection.projects.some(
                  (project) => project.id === current,
                )
              ? current
              : "__new__",
      );
      setStatus("ready");
      setNotice(
        "Live local state observed. No worker or provider activity is implied.",
      );
    } catch {
      if (disposed.current) return;
      setStatus("offline");
      setNotice(
        "Local runtime is offline. Last observed queue state is preserved.",
      );
    }
  }, [props.initialProjectId]);

  useEffect(() => {
    if (
      props.mode !== "compose" ||
      status !== "ready" ||
      restoredDraft.current === false
    )
      return;
    const hasDraft =
      outcome.length > 0 ||
      workspacePath ||
      attachments.length > 0 ||
      browserAttachments.length > 0;
    if (!hasDraft || !projectId) return;
    const timer = window.setTimeout(() => {
      draftSaveQueue.current = draftSaveQueue.current
        .then(async () => {
          const client = await import("../../project-intake-client.js");
          const mode =
            projectId === "__new__" ? "new_product" : "existing_product";
          const saved = await client.saveResumableProjectIntakeDraft(
            endpoint,
            draftIntakeRef.current,
            {
              mode,
              idea: outcome,
              workspaceReference:
                projectId === "__new__"
                  ? workspacePath || null
                  : client.encodeProjectIntakeReference("project", projectId),
              workspaceLabel:
                projectId === "__new__"
                  ? workspaceLabel || null
                  : (projects.find((project) => project.id === projectId)
                      ?.displayName ?? "Existing project"),
              attachments: [
                ...attachments.map((attachment) => ({
                  kind: "attachment",
                  value: attachment.path,
                })),
                ...browserAttachments.map((file) => ({
                  kind: "upload",
                  value: `${file.name}:${file.size}:${file.lastModified}`,
                })),
              ],
              idempotencyKey: `intake:draft:${crypto.randomUUID()}`,
            },
          );
          rememberDraft(saved);
        })
        .catch(() => {
          setNotice("Draft save paused. Text is safe.");
        });
    }, 650);
    return () => window.clearTimeout(timer);
  }, [
    attachments,
    browserAttachments,
    outcome,
    projectId,
    projects,
    props.mode,
    status,
    workspaceLabel,
    workspacePath,
  ]);

  useEffect(() => {
    disposed.current = false;
    void refresh();
    const timer = window.setInterval(() => void refresh(), 10_000);
    return () => {
      disposed.current = true;
      window.clearInterval(timer);
    };
  }, [refresh]);

  useEffect(() => {
    if (!projectId || projectId === "__new__") {
      setLifecycle(null);
      setEligibility(null);
      return;
    }
    let active = true;
    void getProjectLifecycle({ endpoint, projectId }).then(
      (record) => {
        if (active) setLifecycle(record);
      },
      () => {
        if (active) setLifecycle(null);
      },
    );
    void getProjectEligibility({ endpoint, projectId }).then(
      (decision) => {
        if (active) setEligibility(decision);
      },
      () => {
        if (active) setEligibility(null);
      },
    );
    return () => {
      active = false;
    };
  }, [projectId, requests]);

  async function answerClarifications() {
    if (!lifecycle || lifecycle.questions.length === 0) return;
    const answers = lifecycle.questions.map((question) => {
      const choice = clarificationChoices[question.id];
      const custom = customAnswers[question.id]?.trim() ?? "";
      if (!choice) throw new Error("Choose one answer for every question.");
      if (choice === "__custom__" && !custom)
        throw new Error("Write the custom answer before continuing.");
      return {
        questionId: question.id,
        optionId: choice === "__custom__" ? null : choice,
        customAnswer: choice === "__custom__" ? custom : null,
        answeredAt: Date.now(),
      };
    });
    setStatus("working");
    try {
      const updated = await answerProjectClarifications({
        endpoint,
        projectId: lifecycle.projectId,
        expectedRevision: lifecycle.revision,
        answers,
        idempotencyKey: `clarifications:${crypto.randomUUID()}`,
      });
      setLifecycle(updated);
      setClarificationChoices({});
      setCustomAnswers({});
      setStatus("ready");
      setNotice(
        "Answers saved. The affected context will be checked again before planning continues.",
      );
    } catch (error) {
      setStatus("ready");
      setNotice(
        error instanceof Error
          ? error.message
          : "Answers could not be saved safely.",
      );
    }
  }

  async function submit() {
    const hasAttachments =
      attachments.length > 0 || browserAttachments.length > 0;
    if (
      !projectId ||
      (outcome.trim().length < 3 &&
        (voice?.transcript.trim().length ?? 0) < 3 &&
        !hasAttachments)
    ) {
      setNotice("Describe what you want to build or change.");
      return;
    }
    if (projectId === "__new__" && !workspacePath.trim()) {
      setNotice("Choose an absolute local folder for the project.");
      return;
    }
    setStatus("working");
    try {
      const voiceEvidence = voice
        ? prepareVoiceEvidence({
            transcript: voice.transcript,
            mediaType: voice.mediaType,
            audioBytes: voice.bytes,
            durationSeconds: voice.durationSeconds,
            adapterId: "manual-local",
            corrected: voice.corrected,
          })
        : null;
      const writtenIdea =
        outcome.trim() ||
        (hasAttachments
          ? "Review the attached evidence and design the product described by it."
          : "");
      const submittedIdea = voiceEvidence
        ? `${writtenIdea}\n\n${voiceEvidence.markdown}`
        : writtenIdea;
      const {
        createProjectIntake,
        encodeProjectIntakeReference,
        saveProjectIntakeDraft,
        selectProjectIntakeResources,
        submitProjectIntake,
      } = await import("../../project-intake-client.js");
      await draftSaveQueue.current;
      const intake =
        draftIntakeRef.current ??
        (await createProjectIntake(
          endpoint,
          projectId === "__new__" ? "new_product" : "existing_product",
          `intake:create:${crypto.randomUUID()}`,
        ));
      const savedIntake = await saveProjectIntakeDraft(endpoint, intake.id, {
        schemaVersion: 1,
        expectedRevision: intake.revision,
        idea: submittedIdea,
        workspaceReference:
          projectId === "__new__"
            ? workspacePath
            : encodeProjectIntakeReference("project", projectId),
        workspaceLabel:
          projectId === "__new__"
            ? workspaceLabel
            : (projects.find((project) => project.id === projectId)
                ?.displayName ?? "Existing project"),
        attachmentReferences: [
          ...attachments.map((attachment) =>
            encodeProjectIntakeReference("attachment", attachment.path),
          ),
          ...browserAttachments.map((file) =>
            encodeProjectIntakeReference(
              "upload",
              `${file.name}:${file.size}:${file.lastModified}`,
            ),
          ),
        ],
      });
      const resourceIntake = await selectProjectIntakeResources(
        endpoint,
        intake.id,
        {
          schemaVersion: 1,
          expectedRevision: savedIntake.revision,
          selectedResources: [
            ...selectedRepositoryIds.map((id) =>
              encodeProjectIntakeReference("github", id),
            ),
            ...(selectedJiraProjectId
              ? [encodeProjectIntakeReference("jira", selectedJiraProjectId)]
              : []),
            ...selectedTelegramChatIds.map((id) =>
              encodeProjectIntakeReference("telegram", id),
            ),
          ],
        },
      );
      await submitProjectIntake(
        endpoint,
        intake.id,
        resourceIntake.revision,
        `intake:submit:${crypto.randomUUID()}`,
      );
      rememberDraft(null);
      let targetProjectId = projectId;
      let targetProjectName =
        projects.find((project) => project.id === projectId)?.displayName ??
        "New project";
      if (projectId === "__new__") {
        const created = await createLocalProject({
          endpoint,
          idea: submittedIdea,
          workspacePath: workspacePath.trim(),
          idempotencyKey: `project:${crypto.randomUUID()}`,
        });
        if (!created.project)
          throw new Error("The new project workspace was not returned.");
        targetProjectId = created.project.id;
        targetProjectName = created.project.displayName;
      }
      let importedFiles: LocalProjectFileImportResponse["files"] = [];
      if (attachments.length > 0) {
        const imported = await addLocalProjectFiles({
          endpoint,
          projectId: targetProjectId,
          paths: attachments.map((attachment) => attachment.path),
          idempotencyKey: `files:${crypto.randomUUID()}`,
        });
        importedFiles = imported.files;
      }
      if (browserAttachments.length > 0) {
        const imported = await addLocalProjectFileContent({
          endpoint,
          projectId: targetProjectId,
          files: await Promise.all(
            browserAttachments.map(async (file) => ({
              label: file.name,
              mediaType: file.type || "application/octet-stream",
              contentBase64: encodeBase64(await file.arrayBuffer()),
            })),
          ),
          idempotencyKey: `file-content:${crypto.randomUUID()}`,
        });
        importedFiles = [...importedFiles, ...imported.files];
      }
      const request = await createLocalRequest({
        endpoint,
        projectId: targetProjectId,
        outcome: submittedIdea,
        idempotencyKey: `request:${crypto.randomUUID()}`,
      });
      if (!request.request)
        throw new Error("The project intake request was not returned.");
      await generateLocalProjectContext({
        endpoint,
        projectId: targetProjectId,
        outcome: submittedIdea,
        requestId: request.request.id,
        projectKind:
          projectId === "__new__" ? "new_product" : "existing_product",
        idempotencyKey: `context:${crypto.randomUUID()}`,
      });
      setOutcome("");
      setWorkspacePath("");
      setWorkspaceLabel("");
      setAttachments([]);
      setBrowserAttachments([]);
      setVoice(null);
      setLastSubmission({
        idea: submittedIdea,
        project: targetProjectName,
        created: projectId === "__new__",
        imports: importedFiles,
      });
      await refresh();
      setNotice(
        projectId === "__new__"
          ? "Private project workspace created and discovery request saved. No model has started."
          : "Request saved locally and queued. No worker or model has started.",
      );
    } catch (error) {
      setStatus("ready");
      setNotice(
        error instanceof Error ? error.message : "Request failed safely.",
      );
    }
  }

  async function chooseFolder() {
    setStatus("working");
    try {
      const result = await openNativePicker({ endpoint, kind: "folder" });
      const selection = result.selections[0];
      if (selection) {
        setWorkspacePath(selection.path);
        setWorkspaceLabel(selection.label);
        setNotice(`${selection.label} selected.`);
      }
      setStatus("ready");
    } catch (error) {
      setStatus("ready");
      setNotice(
        error instanceof Error ? error.message : "Folder picker failed safely.",
      );
    }
  }

  async function chooseFiles() {
    setStatus("working");
    try {
      const result = await openNativePicker({ endpoint, kind: "files" });
      if (result.selections.length > 0) {
        setAttachments((current) => {
          const unique = new Map(
            [...current, ...result.selections].map((item) => [item.path, item]),
          );
          return [...unique.values()].slice(0, 20);
        });
        setNotice(
          `${result.selections.length} file${result.selections.length === 1 ? "" : "s"} attached.`,
        );
      }
      setStatus("ready");
    } catch (error) {
      setStatus("ready");
      setNotice(
        error instanceof Error ? error.message : "File picker failed safely.",
      );
    }
  }

  function acceptBrowserFiles(files: FileList | readonly File[]) {
    const incoming = [...files];
    const totalBytes = [...browserAttachments, ...incoming].reduce(
      (total, file) => total + file.size,
      0,
    );
    if (
      incoming.some((file) => file.size > 5_000_000) ||
      totalBytes > 20_000_000
    ) {
      setNotice(
        "Attachments must be 5 MB or smaller each and 20 MB or smaller together.",
      );
      return;
    }
    setBrowserAttachments((current) => {
      const unique = new Map(
        [...current, ...incoming].map((file) => [
          `${file.name}:${file.size}:${file.lastModified}`,
          file,
        ]),
      );
      return [...unique.values()].slice(0, 20);
    });
    setNotice(
      `${incoming.length} file${incoming.length === 1 ? "" : "s"} attached.`,
    );
  }

  async function openResourcePicker() {
    const project = projects.find((candidate) => candidate.id === projectId);
    if (!project) return;
    setStatus("working");
    try {
      const collection = await listIntegrationConnections({ endpoint });
      setIntegrationConnections(collection);
      setSelectedRepositoryIds(
        (project.resources ?? [])
          .filter((resource) => resource.kind === "github_repository")
          .map((resource) => resource.resourceId),
      );
      setSelectedJiraProjectId(
        (project.resources ?? []).find(
          (resource) => resource.kind === "jira_project",
        )?.resourceId ?? "",
      );
      setSelectedTelegramChatIds(
        (project.resources ?? [])
          .filter((resource) => resource.kind === "telegram_chat")
          .map((resource) => resource.resourceId),
      );
      setResourceQuery("");
      setResourcePickerOpen(true);
      setStatus("ready");
    } catch (error) {
      setStatus("ready");
      setNotice(
        error instanceof Error
          ? error.message
          : "Resources could not be loaded.",
      );
    }
  }

  async function saveProjectResources() {
    const project = projects.find((candidate) => candidate.id === projectId);
    const github = integrationConnections?.connections.find(
      (connection) =>
        connection.provider === "github" && connection.state === "ready",
    );
    const jira = integrationConnections?.connections.find(
      (connection) =>
        connection.provider === "jira" && connection.state === "ready",
    );
    const telegram = integrationConnections?.connections.find(
      (connection) =>
        connection.provider === "telegram" && connection.state === "ready",
    );
    if (!project) return;
    setStatus("working");
    try {
      const retained = (project.resources ?? [])
        .filter(
          (resource) =>
            resource.kind !== "github_repository" &&
            resource.kind !== "jira_project" &&
            resource.kind !== "telegram_chat",
        )
        .map(({ kind, connectionId, resourceId, label, url, role }) => ({
          kind,
          connectionId,
          resourceId,
          label,
          url,
          role,
        }));
      const boundRepositories = (project.resources ?? []).filter(
        (resource) => resource.kind === "github_repository",
      );
      const repositories = selectedRepositoryIds.flatMap(
        (resourceId, index) => {
          const bound = boundRepositories.find(
            (resource) => resource.resourceId === resourceId,
          );
          if (bound) {
            const { kind, connectionId, label, url } = bound;
            return [
              {
                kind,
                connectionId,
                resourceId,
                label,
                url,
                role:
                  index === 0 ? ("primary" as const) : ("additional" as const),
              },
            ];
          }
          const discovered = github?.resources.find(
            (resource) => resource.id === resourceId,
          );
          return discovered
            ? [
                {
                  kind: "github_repository" as const,
                  connectionId: `github-cli:${github?.accountLabel ?? "account"}`,
                  resourceId: discovered.id,
                  label: discovered.label,
                  url: discovered.url,
                  role:
                    index === 0
                      ? ("primary" as const)
                      : ("additional" as const),
                },
              ]
            : [];
        },
      );
      const boundJira = (project.resources ?? []).find(
        (resource) =>
          resource.kind === "jira_project" &&
          resource.resourceId === selectedJiraProjectId,
      );
      const jiraProject = jira?.resources.find(
        (resource) => resource.id === selectedJiraProjectId,
      );
      const jiraResources = boundJira
        ? [
            {
              kind: boundJira.kind,
              connectionId: boundJira.connectionId,
              resourceId: boundJira.resourceId,
              label: boundJira.label,
              url: boundJira.url,
              role: "primary" as const,
            },
          ]
        : jiraProject
          ? [
              {
                kind: "jira_project" as const,
                connectionId: `jira:${jira?.accountLabel ?? "account"}`,
                resourceId: jiraProject.id,
                label: jiraProject.label,
                url: jiraProject.url,
                role: "primary" as const,
              },
            ]
          : [];
      const boundTelegram = (project.resources ?? []).filter(
        (resource) => resource.kind === "telegram_chat",
      );
      const telegramResources = selectedTelegramChatIds.flatMap(
        (resourceId) => {
          const bound = boundTelegram.find(
            (resource) => resource.resourceId === resourceId,
          );
          if (bound)
            return [
              {
                kind: bound.kind,
                connectionId: bound.connectionId,
                resourceId: bound.resourceId,
                label: bound.label,
                url: bound.url,
                role: "notifications" as const,
              },
            ];
          const discovered = telegram?.resources.find(
            (resource) => resource.id === resourceId,
          );
          return discovered
            ? [
                {
                  kind: "telegram_chat" as const,
                  connectionId: `telegram:${telegram?.accountLabel ?? "bot"}`,
                  resourceId: discovered.id,
                  label: discovered.label,
                  url: discovered.url,
                  role: "notifications" as const,
                },
              ]
            : [];
        },
      );
      await setLocalProjectResources({
        endpoint,
        projectId: project.id,
        selection: {
          schemaVersion: 1,
          expectedRevision: project.resourceRevision ?? 0,
          resources: [
            ...retained,
            ...repositories,
            ...jiraResources,
            ...telegramResources,
          ],
        },
        idempotencyKey: `resources:${crypto.randomUUID()}`,
      });
      setResourcePickerOpen(false);
      await refresh();
      const saved =
        repositories.length + jiraResources.length + telegramResources.length;
      setNotice(
        `${saved} connected ${saved === 1 ? "resource" : "resources"} saved to this project.`,
      );
    } catch (error) {
      setStatus("ready");
      setNotice(
        error instanceof Error
          ? error.message
          : "Resources could not be saved.",
      );
    }
  }

  async function mutate(request: LocalRequest, action: "cancel" | "archive") {
    setStatus("working");
    try {
      if (action === "cancel") {
        await cancelLocalRequest({
          endpoint,
          requestId: request.id,
          idempotencyKey: `cancel:${request.id}`,
        });
      } else {
        await archiveLocalRequest({
          endpoint,
          requestId: request.id,
          idempotencyKey: `archive:${request.id}`,
        });
      }
      await refresh();
      setNotice(
        action === "cancel"
          ? "Queued request cancelled. No execution was interrupted."
          : "Cancelled request archived from the local queue.",
      );
    } catch (error) {
      setStatus("ready");
      setNotice(
        error instanceof Error ? error.message : "Queue action failed safely.",
      );
    }
  }

  async function advance(
    request: LocalRequest,
    action:
      "approve" | "ground" | "claim" | "checkpoint" | "release" | "reconcile",
  ) {
    setStatus("working");
    try {
      await advanceLocalRequest({
        endpoint,
        requestId: request.id,
        action,
        idempotencyKey: `${action}:${request.id}`,
      });
      await refresh();
      setNotice(
        {
          approve: "Zero-effect contract approved. No work has started.",
          ground:
            "Bounded local grounding and deterministic draft plan created.",
          claim:
            "Local coordinator lease claimed. No command or provider was invoked.",
          checkpoint:
            "Zero external effects observed and checkpoint evidence recorded.",
          release:
            "Lease released. The zero-effect lifecycle proof is complete.",
          reconcile:
            "Expired lease reconciled to interrupted for explicit review.",
        }[action],
      );
    } catch (error) {
      setStatus("ready");
      setNotice(
        error instanceof Error
          ? error.message
          : "Lifecycle action failed safely.",
      );
    }
  }

  async function editPlan(
    request: LocalRequest,
    edit:
      | {
          type: "edit_task";
          taskId: string;
          title: string;
          estimatedMinutes: number;
        }
      | { type: "reorder"; order: string[] },
  ) {
    if (!request.plan) return;
    setStatus("working");
    try {
      await updateLocalPlan({
        endpoint,
        requestId: request.id,
        edit: {
          schemaVersion: 1,
          expectedRevision: request.plan.revision,
          ...edit,
        },
        idempotencyKey: `plan-edit:${request.id}:${request.plan.revision}:${crypto.randomUUID()}`,
      });
      await refresh();
      setNotice(
        "Plan revision saved locally. No execution authority was granted.",
      );
    } catch (error) {
      setStatus("ready");
      setNotice(
        error instanceof Error ? error.message : "Plan edit failed safely.",
      );
    }
  }

  async function approvePlan(request: LocalRequest) {
    if (!request.plan) return;
    setStatus("working");
    try {
      await approveLocalPlan({
        endpoint,
        requestId: request.id,
        approval: {
          schemaVersion: 1,
          expectedRevision: request.plan.revision,
        },
        idempotencyKey: `plan-approve:${request.id}:${request.plan.revision}`,
      });
      await refresh();
      setNotice("Plan frozen and approved. Execution remains unauthorized.");
    } catch (error) {
      setStatus("ready");
      setNotice(
        error instanceof Error ? error.message : "Plan approval failed safely.",
      );
    }
  }

  async function authorizeExecution(request: LocalRequest) {
    if (!request.plan || request.plan.state !== "approved") return;
    setStatus("working");
    try {
      await authorizeLocalExecution({
        endpoint,
        requestId: request.id,
        authorization: {
          schemaVersion: 1,
          expectedPlanRevision: request.plan.revision,
          expectedPlanDigest: request.plan.digest,
          isolationProfile: "native_bounded_worktree",
        },
        idempotencyKey: `execution-authorize:${request.id}:${request.plan.digest}`,
      });
      await refresh();
      setNotice(
        "Clean Git baseline verified and isolated-worktree-only authority recorded. No workspace or task started.",
      );
    } catch (error) {
      setStatus("ready");
      setNotice(
        error instanceof Error
          ? error.message
          : "Execution authorization failed safely.",
      );
    }
  }

  async function mutateExecution(
    request: LocalRequest,
    action: "prepare" | "start" | "validate" | "cancel" | "reconcile",
  ) {
    setStatus("working");
    try {
      await advanceLocalExecution({
        endpoint,
        requestId: request.id,
        action,
        idempotencyKey: `execution-${action}:${request.id}:${request.execution?.authority.digest ?? "none"}`,
      });
      await refresh();
      setNotice(
        {
          prepare:
            "Private Git worktree prepared and baseline verified. No task, model, network, or arbitrary command started.",
          start:
            "Bounded run recorded. No validation command or source mutation has happened yet.",
          validate:
            "Fixed-argument Git validation and bounded change observation completed in the isolated workspace.",
          cancel:
            "Execution cancelled. The isolated workspace was preserved for explicit recovery.",
          reconcile:
            "Interrupted preparation reconciled without claiming completion.",
        }[action],
      );
    } catch (error) {
      setStatus("ready");
      setNotice(
        error instanceof Error
          ? error.message
          : "Execution action failed safely.",
      );
    }
  }

  async function previewPatch(request: LocalRequest) {
    const execution = request.execution;
    const draft = patchDrafts[request.id];
    if (!execution?.run || !draft?.path || draft.content.length > 65_536) {
      setNotice(
        "Choose one approved file and keep replacement text within 64 KiB.",
      );
      return;
    }
    setStatus("working");
    try {
      await previewLocalPatch({
        endpoint,
        requestId: request.id,
        proposal: {
          schemaVersion: 1,
          expectedAuthorityDigest: execution.authority.digest,
          expectedRunDigest: execution.run.digest,
          path: draft.path,
          expectedBeforeDigest: null,
          replacementContent: draft.content,
        },
        idempotencyKey: `patch-preview:${request.id}:${execution.run.digest}:${draft.path}`,
      });
      await refresh();
      setNotice(
        "Exact replacement preview recorded. No source file was written.",
      );
    } catch (error) {
      setStatus("ready");
      setNotice(
        error instanceof Error ? error.message : "Patch preview failed safely.",
      );
    }
  }

  async function approvePatch(request: LocalRequest) {
    const preview = request.execution?.patch?.preview;
    if (!preview) return;
    setStatus("working");
    try {
      await approveLocalPatch({
        endpoint,
        requestId: request.id,
        approval: { schemaVersion: 1, expectedPreviewDigest: preview.digest },
        idempotencyKey: `patch-approve:${request.id}:${preview.digest}`,
      });
      await refresh();
      setNotice("Exact isolated patch approved. Application has not started.");
    } catch (error) {
      setStatus("ready");
      setNotice(
        error instanceof Error
          ? error.message
          : "Patch approval failed safely.",
      );
    }
  }

  async function mutatePatch(
    request: LocalRequest,
    action: "apply" | "rollback" | "reconcile",
  ) {
    setStatus("working");
    try {
      await advanceLocalPatch({
        endpoint,
        requestId: request.id,
        action,
        idempotencyKey: `patch-${action}:${request.id}:${request.execution?.patch?.preview.digest ?? "none"}`,
      });
      await refresh();
      setNotice(
        {
          apply:
            "Approved replacement applied and verified inside the isolated worktree only.",
          rollback: "Exact pre-patch isolated bytes restored and verified.",
          reconcile: "Interrupted patch preserved for explicit inspection.",
        }[action],
      );
    } catch (error) {
      setStatus("ready");
      setNotice(
        error instanceof Error ? error.message : "Patch action failed safely.",
      );
    }
  }

  async function previewCommit(request: LocalRequest) {
    const execution = request.execution;
    const message = commitMessages[request.id]?.trim() ?? "";
    if (!execution?.run || message.length < 3) {
      setNotice("Enter a clear local commit message.");
      return;
    }
    setStatus("working");
    try {
      await previewLocalCommit({
        endpoint,
        requestId: request.id,
        proposal: {
          schemaVersion: 1,
          expectedAuthorityDigest: execution.authority.digest,
          expectedRunDigest: execution.run.digest,
          message,
        },
        idempotencyKey: `commit-preview:${request.id}:${execution.run.digest}:${message}`,
      });
      await refresh();
      setNotice("Hook-free local commit preview recorded. Nothing was staged.");
    } catch (error) {
      setStatus("ready");
      setNotice(
        error instanceof Error
          ? error.message
          : "Commit preview failed safely.",
      );
    }
  }

  async function previewChangeSet(request: LocalRequest) {
    const execution = request.execution;
    const operations = changeSetDrafts[request.id] ?? [];
    if (
      !execution?.run ||
      operations.length === 0 ||
      operations.some(
        (item) =>
          !item.path ||
          (item.type !== "delete" &&
            new TextEncoder().encode(item.content).length > 65_536),
      )
    ) {
      setNotice(
        "Add 1–12 complete file operations; each text file must remain within 64 KiB.",
      );
      return;
    }
    setStatus("working");
    try {
      await previewLocalChangeSet({
        endpoint,
        requestId: request.id,
        proposal: {
          schemaVersion: 1,
          expectedAuthorityDigest: execution.authority.digest,
          expectedRunDigest: execution.run.digest,
          operations: operations.map((item) => ({
            type: item.type,
            path: item.path,
            expectedBeforeDigest: null,
            content: item.type === "delete" ? null : item.content,
          })),
        },
        idempotencyKey: `change-set-preview:${request.id}:${execution.run.digest}:${operations.length}`,
      });
      await refresh();
      setNotice(
        "Exact multi-file change-set preview recorded. No file was written.",
      );
    } catch (error) {
      setStatus("ready");
      setNotice(
        error instanceof Error
          ? error.message
          : "Change-set preview failed safely.",
      );
    }
  }

  async function approveChangeSet(request: LocalRequest) {
    const preview = request.execution?.changeSet?.preview;
    if (!preview) return;
    setStatus("working");
    try {
      await approveLocalChangeSet({
        endpoint,
        requestId: request.id,
        approval: { schemaVersion: 1, expectedPreviewDigest: preview.digest },
        idempotencyKey: `change-set-approve:${request.id}:${preview.digest}`,
      });
      await refresh();
      setNotice(
        "Exact multi-file change set approved. Application has not started.",
      );
    } catch (error) {
      setStatus("ready");
      setNotice(
        error instanceof Error
          ? error.message
          : "Change-set approval failed safely.",
      );
    }
  }

  async function mutateChangeSet(
    request: LocalRequest,
    action: "apply" | "rollback" | "reconcile",
  ) {
    setStatus("working");
    try {
      await advanceLocalChangeSet({
        endpoint,
        requestId: request.id,
        action,
        idempotencyKey: `change-set-${action}:${request.id}:${request.execution?.changeSet?.preview.digest ?? "none"}`,
      });
      await refresh();
      setNotice(
        {
          apply:
            "All approved file operations applied and verified inside the isolated worktree.",
          rollback: "Every pre-change file state restored and verified.",
          reconcile:
            "Interrupted change set classified from filesystem truth without blind retry.",
        }[action],
      );
    } catch (error) {
      setStatus("ready");
      setNotice(
        error instanceof Error
          ? error.message
          : "Change-set action failed safely.",
      );
    }
  }

  async function approveCommit(request: LocalRequest) {
    const preview = request.execution?.commit?.preview;
    if (!preview) return;
    setStatus("working");
    try {
      await approveLocalCommit({
        endpoint,
        requestId: request.id,
        approval: { schemaVersion: 1, expectedPreviewDigest: preview.digest },
        idempotencyKey: `commit-approve:${request.id}:${preview.digest}`,
      });
      await refresh();
      setNotice("Exact isolated commit approved. It has not been created.");
    } catch (error) {
      setStatus("ready");
      setNotice(
        error instanceof Error
          ? error.message
          : "Commit approval failed safely.",
      );
    }
  }

  async function mutateCommit(
    request: LocalRequest,
    action: "create" | "undo" | "reconcile",
  ) {
    setStatus("working");
    try {
      await advanceLocalCommit({
        endpoint,
        requestId: request.id,
        action,
        idempotencyKey: `commit-${action}:${request.id}:${request.execution?.commit?.preview.digest ?? "none"}`,
      });
      await refresh();
      setNotice(
        {
          create:
            "Local isolated commit created and verified. It was not pushed or merged.",
          undo: "Isolated commit undone; validated patch remains uncommitted.",
          reconcile:
            "Interrupted commit preserved for explicit Git inspection.",
        }[action],
      );
    } catch (error) {
      setStatus("ready");
      setNotice(
        error instanceof Error ? error.message : "Commit action failed safely.",
      );
    }
  }

  async function previewIntegration(request: LocalRequest) {
    const receipt = request.execution?.commit?.receipt;
    if (!receipt) return;
    setStatus("working");
    try {
      await previewLocalIntegration({
        endpoint,
        requestId: request.id,
        proposal: {
          schemaVersion: 1,
          expectedCommitReceiptDigest: receipt.digest,
        },
        idempotencyKey: `integration-preview:${request.id}:${receipt.digest}`,
      });
      await refresh();
      setNotice(
        "Local canonical integration is conflict-free. Nothing was changed.",
      );
    } catch (error) {
      setStatus("ready");
      setNotice(
        error instanceof Error
          ? error.message
          : "Integration preview failed safely.",
      );
    }
  }

  async function approveIntegration(request: LocalRequest) {
    const preview = request.execution?.integration?.preview;
    if (!preview) return;
    setStatus("working");
    try {
      await approveLocalIntegration({
        endpoint,
        requestId: request.id,
        approval: { schemaVersion: 1, expectedPreviewDigest: preview.digest },
        idempotencyKey: `integration-approve:${request.id}:${preview.digest}`,
      });
      await refresh();
      setNotice(
        "Exact local canonical integration approved. Nothing was pushed.",
      );
    } catch (error) {
      setStatus("ready");
      setNotice(
        error instanceof Error
          ? error.message
          : "Integration approval failed safely.",
      );
    }
  }

  async function mutateIntegration(
    request: LocalRequest,
    action: "create" | "undo" | "reconcile",
  ) {
    setStatus("working");
    try {
      await advanceLocalIntegration({
        endpoint,
        requestId: request.id,
        action,
        idempotencyKey: `integration-${action}:${request.id}:${request.execution?.integration?.preview.digest ?? "none"}`,
      });
      await refresh();
      setNotice(
        {
          create:
            "Commit integrated into the canonical local branch. It was not pushed or published.",
          undo: "Canonical branch restored to its exact previous HEAD.",
          reconcile:
            "Interrupted integration preserved for exact Git inspection.",
        }[action],
      );
    } catch (error) {
      setStatus("ready");
      setNotice(
        error instanceof Error
          ? error.message
          : "Integration action failed safely.",
      );
    }
  }

  const projectNames = new Map(
    projects.map((project) => [project.id, project.displayName]),
  );
  const selectedProject = projects.find((project) => project.id === projectId);
  const selectedProjectRequests = requests.filter(
    (request) => request.projectId === projectId,
  );
  const latestProjectRequest =
    selectedProjectRequests.reduce<LocalRequest | null>(
      (latest, request) =>
        !latest || request.updatedAt > latest.updatedAt ? request : latest,
      null,
    );
  const discoveredGithubIds = new Set(
    integrationConnections?.connections
      .find((connection) => connection.provider === "github")
      ?.resources.map((resource) => resource.id) ?? [],
  );
  const discoveredJiraIds = new Set(
    integrationConnections?.connections
      .find((connection) => connection.provider === "jira")
      ?.resources.map((resource) => resource.id) ?? [],
  );
  const discoveredTelegramIds = new Set(
    integrationConnections?.connections
      .find((connection) => connection.provider === "telegram")
      ?.resources.map((resource) => resource.id) ?? [],
  );
  const normalizedResourceQuery = resourceQuery.trim().toLowerCase();
  const githubConnection = integrationConnections?.connections.find(
    (connection) => connection.provider === "github",
  );
  const jiraConnection = integrationConnections?.connections.find(
    (connection) => connection.provider === "jira",
  );
  const telegramConnection = integrationConnections?.connections.find(
    (connection) => connection.provider === "telegram",
  );
  const visibleGithubResources = [...(githubConnection?.resources ?? [])]
    .filter(
      (resource) =>
        !normalizedResourceQuery ||
        `${resource.label} ${resource.detail}`
          .toLowerCase()
          .includes(normalizedResourceQuery),
    )
    .sort(
      (left, right) =>
        Number(selectedRepositoryIds.includes(right.id)) -
          Number(selectedRepositoryIds.includes(left.id)) ||
        left.label.localeCompare(right.label),
    );
  const visibleJiraResources = [...(jiraConnection?.resources ?? [])]
    .filter(
      (resource) =>
        !normalizedResourceQuery ||
        `${resource.label} ${resource.detail}`
          .toLowerCase()
          .includes(normalizedResourceQuery),
    )
    .sort(
      (left, right) =>
        Number(selectedJiraProjectId === right.id) -
          Number(selectedJiraProjectId === left.id) ||
        left.label.localeCompare(right.label),
    );
  const visibleTelegramResources = [...(telegramConnection?.resources ?? [])]
    .filter(
      (resource) =>
        !normalizedResourceQuery ||
        `${resource.label} ${resource.detail}`
          .toLowerCase()
          .includes(normalizedResourceQuery),
    )
    .sort(
      (left, right) =>
        Number(selectedTelegramChatIds.includes(right.id)) -
          Number(selectedTelegramChatIds.includes(left.id)) ||
        left.label.localeCompare(right.label),
    );
  const unavailableRepositories = (selectedProject?.resources ?? []).filter(
    (resource) =>
      resource.kind === "github_repository" &&
      !discoveredGithubIds.has(resource.resourceId),
  );
  const unavailableJira = (selectedProject?.resources ?? []).find(
    (resource) =>
      resource.kind === "jira_project" &&
      !discoveredJiraIds.has(resource.resourceId),
  );
  const unavailableTelegram = (selectedProject?.resources ?? []).filter(
    (resource) =>
      resource.kind === "telegram_chat" &&
      !discoveredTelegramIds.has(resource.resourceId),
  );
  const discoveryNotice = (
    connection:
      PublicIntegrationConnectionCollection["connections"][number] | undefined,
    fallback: string,
  ) => {
    const message =
      connection?.discovery?.freshness === "stale"
        ? "Saved results are out of date."
        : connection?.discovery?.result === "empty" ||
            connection?.discovery?.result === "permission_required" ||
            connection?.discovery?.result === "unavailable"
          ? connection.nextAction
          : fallback;
    return (
      <div className="mt-3 flex items-center justify-between gap-3 rounded-2xl bg-background/70 p-3 text-sm text-muted-foreground">
        <span>{message}</span>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => props.navigate?.("settings")}
        >
          {connection?.discovery?.recovery.label ?? "Connect"}
        </Button>
      </div>
    );
  };
  return (
    <section
      className="space-y-4"
      aria-labelledby={`local-request-${props.mode}-title`}
    >
      {props.mode === "compose" && (
        <h2 id="local-request-compose-title" className="sr-only">
          What do you want to build?
        </h2>
      )}
      {props.mode === "compose" && selectedProject && (
        <div className="flex flex-col gap-4 rounded-3xl bg-muted/55 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <strong className="truncate text-lg">
                {selectedProject.displayName}
              </strong>
              <Badge>
                {(selectedProject.lifecycleStage ?? "intake").replaceAll(
                  "_",
                  " ",
                )}
              </Badge>
            </div>
            <p className="mt-1 line-clamp-1 text-sm text-muted-foreground">
              {latestProjectRequest?.outcome ??
                "Ready for a new product request."}
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            <Badge>
              <Kanban />
              {selectedProject.resources?.find(
                (resource) => resource.kind === "jira_project",
              )?.label ?? "No Jira"}
            </Badge>
            <Badge>
              <GithubLogo />
              {selectedProject.resources?.filter(
                (resource) => resource.kind === "github_repository",
              ).length ?? 0}{" "}
              repos
            </Badge>
            {selectedProject.progress && (
              <Badge tone="positive">{selectedProject.progress.percent}%</Badge>
            )}
          </div>
        </div>
      )}
      {props.mode === "compose" &&
        lifecycle?.stage === "clarification" &&
        lifecycle.questions.length > 0 && (
          <Card className="bg-primary/[.06]">
            <CardHeader>
              <CardTitle className="text-lg">A few choices</CardTitle>
              <CardDescription>These change the plan.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              {lifecycle.questions.map((question) => (
                <fieldset key={question.id} className="space-y-3">
                  <legend className="text-sm font-semibold">
                    {question.prompt}
                  </legend>
                  <p className="text-xs text-muted-foreground">
                    {question.whyItMatters}
                  </p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {question.options.map((option) => {
                      const selected =
                        clarificationChoices[question.id] === option.id;
                      return (
                        <button
                          key={option.id}
                          type="button"
                          aria-pressed={selected}
                          onClick={() =>
                            setClarificationChoices((current) => ({
                              ...current,
                              [question.id]: option.id,
                            }))
                          }
                          className={`rounded-2xl px-4 py-3 text-left ${selected ? "bg-primary text-primary-foreground" : "bg-muted hover:bg-muted/80"}`}
                        >
                          <strong className="block text-sm">
                            {option.label}
                          </strong>
                          <span
                            className={`mt-1 block text-xs ${selected ? "text-primary-foreground/75" : "text-muted-foreground"}`}
                          >
                            {option.consequence}
                          </span>
                        </button>
                      );
                    })}
                    {question.allowsCustomAnswer && (
                      <button
                        type="button"
                        aria-pressed={
                          clarificationChoices[question.id] === "__custom__"
                        }
                        onClick={() =>
                          setClarificationChoices((current) => ({
                            ...current,
                            [question.id]: "__custom__",
                          }))
                        }
                        className={`rounded-2xl px-4 py-3 text-left text-sm font-semibold ${clarificationChoices[question.id] === "__custom__" ? "bg-primary text-primary-foreground" : "bg-muted hover:bg-muted/80"}`}
                      >
                        Something else
                      </button>
                    )}
                  </div>
                  {clarificationChoices[question.id] === "__custom__" && (
                    <textarea
                      aria-label={`Custom answer for ${question.prompt}`}
                      value={customAnswers[question.id] ?? ""}
                      onChange={(event) =>
                        setCustomAnswers((current) => ({
                          ...current,
                          [question.id]: event.target.value,
                        }))
                      }
                      rows={2}
                      maxLength={2_000}
                      placeholder="Your answer…"
                      className="w-full resize-y rounded-2xl bg-muted px-4 py-3 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/30"
                    />
                  )}
                </fieldset>
              ))}
              <div className="flex justify-end">
                <Button
                  onClick={() => void answerClarifications()}
                  disabled={
                    status === "working" ||
                    lifecycle.questions.some(
                      (question) => !clarificationChoices[question.id],
                    )
                  }
                >
                  <CheckCircle />
                  Continue
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      {props.mode === "compose" &&
        eligibility?.assessment.classification === "small_change" && (
          <Card className="bg-muted/60">
            <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <strong className="text-sm">
                  This is better handled as a coding task
                </strong>
                <p className="mt-1 text-xs text-muted-foreground">
                  The autonomous product pipeline is reserved for new products
                  and major features.
                </p>
              </div>
              <Badge tone="neutral">Not started</Badge>
            </CardContent>
          </Card>
        )}
      {props.mode === "compose" && eligibility?.eligible && (
        <div className="flex items-center gap-2 px-1 text-xs text-muted-foreground">
          <CheckCircle className="text-primary" weight="fill" />
          <span>Product lifecycle accepted</span>
        </div>
      )}
      <Card
        className={
          props.mode === "compose" ? "bg-primary/[.025]" : "bg-primary/[.035]"
        }
      >
        {props.mode === "queue" && (
          <CardHeader className="gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              {props.mode === "queue" && (
                <div className="flex flex-wrap gap-2">
                  <Badge tone={status === "offline" ? "caution" : "positive"}>
                    {status === "offline"
                      ? "Runtime offline"
                      : "Live local state"}
                  </Badge>
                  <Badge>No AI · no source changes</Badge>
                </div>
              )}
              <CardTitle
                id={`local-request-${props.mode}-title`}
                className="mt-4 text-xl"
              >
                Work in progress
              </CardTitle>
              {props.mode === "queue" && (
                <CardDescription>Current and queued work.</CardDescription>
              )}
            </div>
            {props.mode === "queue" && (
              <Button
                variant="secondary"
                onClick={() => void refresh()}
                disabled={status === "working"}
              >
                <ArrowClockwise />
                Refresh
              </Button>
            )}
          </CardHeader>
        )}
        <CardContent className={props.mode === "compose" ? "p-4" : "mt-6"}>
          {props.mode === "compose" && (
            <div className="space-y-3">
              <label className="sr-only" htmlFor="build-request">
                What would you like to build?
              </label>
              <div
                onDragOver={(event) => {
                  event.preventDefault();
                  event.dataTransfer.dropEffect = "copy";
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  acceptBrowserFiles(event.dataTransfer.files);
                }}
                className="rounded-3xl focus-within:ring-3 focus-within:ring-ring/30"
              >
                <textarea
                  id="build-request"
                  value={outcome}
                  onChange={(event) => setOutcome(event.target.value)}
                  rows={3}
                  maxLength={20_000}
                  placeholder="Describe your idea… or drop files here"
                  className="min-h-40 w-full resize-y rounded-3xl bg-muted px-5 py-4 text-base leading-7 outline-none"
                />
              </div>
              {attachments.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {attachments.map((attachment) => (
                    <span
                      key={attachment.path}
                      className="inline-flex items-center gap-1.5 rounded-full bg-muted px-3 py-1.5 text-xs"
                    >
                      {attachment.label}
                      <button
                        type="button"
                        aria-label={`Remove ${attachment.label}`}
                        onClick={() =>
                          setAttachments((current) =>
                            current.filter(
                              (item) => item.path !== attachment.path,
                            ),
                          )
                        }
                        className="rounded-full p-0.5 text-muted-foreground hover:bg-background hover:text-foreground"
                      >
                        <X />
                      </button>
                    </span>
                  ))}
                </div>
              )}
              {browserAttachments.length > 0 && (
                <div
                  className="flex flex-wrap gap-2"
                  aria-label="Dropped attachments"
                >
                  {browserAttachments.map((attachment) => (
                    <span
                      key={`${attachment.name}:${attachment.size}:${attachment.lastModified}`}
                      className="inline-flex items-center gap-1.5 rounded-full bg-muted px-3 py-1.5 text-xs"
                    >
                      {attachment.name}
                      <button
                        type="button"
                        aria-label={`Remove ${attachment.name}`}
                        onClick={() =>
                          setBrowserAttachments((current) =>
                            current.filter((item) => item !== attachment),
                          )
                        }
                        className="rounded-full p-0.5 text-muted-foreground hover:bg-background hover:text-foreground"
                      >
                        <X />
                      </button>
                    </span>
                  ))}
                </div>
              )}
              {voice && (
                <Suspense fallback={null}>
                  <LocalVoiceInput
                    value={voice}
                    disabled={status === "working"}
                    onChange={setVoice}
                    onNotice={setNotice}
                  />
                </Suspense>
              )}
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="relative flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={() => setProjectPickerOpen((open) => !open)}
                    aria-expanded={projectPickerOpen}
                  >
                    {projectId === "__new__"
                      ? "New project"
                      : (projects.find((project) => project.id === projectId)
                          ?.displayName ?? "Project")}
                  </Button>
                  {projectPickerOpen && (
                    <div className="absolute bottom-11 left-0 z-30 min-w-64 rounded-2xl bg-popover p-2 shadow-2xl ring-1 ring-foreground/10">
                      <button
                        type="button"
                        onClick={() => {
                          setProjectId("__new__");
                          setProjectPickerOpen(false);
                        }}
                        className="w-full rounded-xl px-3 py-2 text-left text-sm hover:bg-muted"
                      >
                        New project
                      </button>
                      {projects.map((project) => (
                        <button
                          key={project.id}
                          type="button"
                          onClick={() => {
                            setProjectId(project.id);
                            setProjectPickerOpen(false);
                          }}
                          className="w-full rounded-xl px-3 py-2 text-left text-sm hover:bg-muted"
                        >
                          {project.displayName}
                        </button>
                      ))}
                    </div>
                  )}
                  {projectId === "__new__" && (
                    <Button
                      type="button"
                      size="sm"
                      variant={workspacePath ? "secondary" : "ghost"}
                      onClick={() => void chooseFolder()}
                      disabled={status === "working"}
                    >
                      <FolderOpen />
                      {workspaceLabel || "Choose folder"}
                    </Button>
                  )}
                  {projectId !== "__new__" && (
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      onClick={() => void openResourcePicker()}
                      disabled={status === "working"}
                    >
                      <GitBranch />
                      Resources
                    </Button>
                  )}
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    aria-label="Attach files"
                    onClick={() => void chooseFiles()}
                    disabled={status === "working"}
                  >
                    <PaperclipHorizontal />
                  </Button>
                  <label className="inline-flex h-8 cursor-pointer items-center rounded-xl px-3 text-xs font-semibold text-muted-foreground hover:bg-muted hover:text-foreground">
                    <input
                      type="file"
                      multiple
                      className="sr-only"
                      disabled={status === "working"}
                      onChange={(event) => {
                        if (event.target.files)
                          acceptBrowserFiles(event.target.files);
                        event.target.value = "";
                      }}
                    />
                    Upload
                  </label>
                  {!voice && (
                    <Suspense fallback={null}>
                      <LocalVoiceInput
                        value={null}
                        disabled={status === "working"}
                        onChange={setVoice}
                        onNotice={setNotice}
                      />
                    </Suspense>
                  )}
                </div>
                <Button
                  onClick={() => void submit()}
                  disabled={
                    status !== "ready" ||
                    !projectId ||
                    (outcome.trim().length < 3 &&
                      (voice?.transcript.trim().length ?? 0) < 3 &&
                      attachments.length === 0 &&
                      browserAttachments.length === 0) ||
                    (voice !== null && voice.transcript.trim().length === 0) ||
                    (projectId === "__new__" && !workspacePath.trim())
                  }
                >
                  Start
                  <ArrowRight />
                </Button>
              </div>
              {resourcePickerOpen && (
                <div
                  role="dialog"
                  aria-modal="false"
                  aria-labelledby="project-resources-title"
                  className="rounded-3xl bg-muted/55 p-4"
                >
                  <div className="flex items-center justify-between gap-3">
                    <strong id="project-resources-title">
                      Project resources
                    </strong>
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label="Close resources"
                      onClick={() => setResourcePickerOpen(false)}
                    >
                      <X />
                    </Button>
                  </div>
                  <label className="mt-4 flex h-11 items-center gap-3 rounded-2xl bg-background/75 px-4">
                    <MagnifyingGlass className="shrink-0 text-muted-foreground" />
                    <span className="sr-only">Find a project resource</span>
                    <input
                      value={resourceQuery}
                      onChange={(event) => setResourceQuery(event.target.value)}
                      placeholder="Find a repository or Jira project…"
                      className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                    />
                  </label>
                  <h4 className="mt-4 text-xs font-semibold text-muted-foreground">
                    GitHub repositories
                  </h4>
                  {githubConnection?.state !== "ready" ||
                  (githubConnection.discovery &&
                    (githubConnection.discovery.freshness === "stale" ||
                      githubConnection.discovery.result !== "available")) ? (
                    discoveryNotice(
                      githubConnection,
                      "Connect GitHub in Settings first.",
                    )
                  ) : (
                    <div className="mt-3 grid max-h-64 gap-2 overflow-auto sm:grid-cols-2">
                      {visibleGithubResources.map((repository) => {
                        const selected = selectedRepositoryIds.includes(
                          repository.id,
                        );
                        return (
                          <button
                            key={repository.id}
                            type="button"
                            aria-pressed={selected}
                            onClick={() =>
                              setSelectedRepositoryIds((current) =>
                                selected
                                  ? current.filter((id) => id !== repository.id)
                                  : [...current, repository.id],
                              )
                            }
                            className={`flex items-center gap-3 rounded-2xl p-3 text-left ${selected ? "bg-primary/10" : "bg-background/70"}`}
                          >
                            <GithubLogo className="shrink-0 text-primary" />
                            <span className="min-w-0">
                              <strong className="block truncate text-xs">
                                {repository.label}
                              </strong>
                              <span className="block truncate text-[11px] text-muted-foreground">
                                {repository.detail}
                              </span>
                            </span>
                          </button>
                        );
                      })}
                      {visibleGithubResources.length === 0 && (
                        <p className="p-3 text-sm text-muted-foreground">
                          No matching repositories.
                        </p>
                      )}
                    </div>
                  )}
                  {unavailableRepositories.map((repository) => (
                    <button
                      key={repository.id}
                      type="button"
                      aria-pressed={selectedRepositoryIds.includes(
                        repository.resourceId,
                      )}
                      onClick={() =>
                        setSelectedRepositoryIds((current) =>
                          current.includes(repository.resourceId)
                            ? current.filter(
                                (id) => id !== repository.resourceId,
                              )
                            : [...current, repository.resourceId],
                        )
                      }
                      className="mt-2 flex w-full items-center gap-3 rounded-2xl bg-background/70 p-3 text-left"
                    >
                      <GithubLogo className="shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1">
                        <strong className="block truncate text-xs">
                          {repository.label}
                        </strong>
                        <span className="block text-[11px] text-muted-foreground">
                          Previously selected · unavailable from GitHub
                        </span>
                      </span>
                      <Badge tone="caution">Keep</Badge>
                    </button>
                  ))}
                  <h4 className="mt-4 text-xs font-semibold text-muted-foreground">
                    Jira project
                  </h4>
                  {jiraConnection?.state !== "ready" ||
                  (jiraConnection.discovery &&
                    (jiraConnection.discovery.freshness === "stale" ||
                      jiraConnection.discovery.result !== "available")) ? (
                    discoveryNotice(
                      jiraConnection,
                      "Connect Jira in Settings first.",
                    )
                  ) : (
                    <div className="mt-3 grid max-h-48 gap-2 overflow-auto sm:grid-cols-2">
                      {visibleJiraResources.map((jiraProject) => {
                        const selected =
                          selectedJiraProjectId === jiraProject.id;
                        return (
                          <button
                            key={jiraProject.id}
                            type="button"
                            aria-pressed={selected}
                            onClick={() =>
                              setSelectedJiraProjectId(
                                selected ? "" : jiraProject.id,
                              )
                            }
                            className={`flex items-center gap-3 rounded-2xl p-3 text-left ${selected ? "bg-primary/10" : "bg-background/70"}`}
                          >
                            <Kanban className="shrink-0 text-primary" />
                            <span className="min-w-0">
                              <strong className="block truncate text-xs">
                                {jiraProject.label}
                              </strong>
                              <span className="block truncate text-[11px] text-muted-foreground">
                                {jiraProject.detail}
                              </span>
                            </span>
                          </button>
                        );
                      })}
                      {visibleJiraResources.length === 0 && (
                        <p className="p-3 text-sm text-muted-foreground">
                          No matching Jira projects.
                        </p>
                      )}
                    </div>
                  )}
                  {unavailableJira && (
                    <button
                      type="button"
                      aria-pressed={
                        selectedJiraProjectId === unavailableJira.resourceId
                      }
                      onClick={() =>
                        setSelectedJiraProjectId((current) =>
                          current === unavailableJira.resourceId
                            ? ""
                            : unavailableJira.resourceId,
                        )
                      }
                      className="mt-2 flex w-full items-center gap-3 rounded-2xl bg-background/70 p-3 text-left"
                    >
                      <Kanban className="shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1">
                        <strong className="block truncate text-xs">
                          {unavailableJira.label}
                        </strong>
                        <span className="block text-[11px] text-muted-foreground">
                          Previously selected · unavailable from Jira
                        </span>
                      </span>
                      <Badge tone="caution">Keep</Badge>
                    </button>
                  )}
                  <h4 className="mt-4 text-xs font-semibold text-muted-foreground">
                    Notifications
                  </h4>
                  {telegramConnection?.state !== "ready" ||
                  (telegramConnection.discovery &&
                    (telegramConnection.discovery.freshness === "stale" ||
                      telegramConnection.discovery.result !== "available")) ? (
                    discoveryNotice(
                      telegramConnection,
                      "Connect Telegram in Settings first.",
                    )
                  ) : (
                    <div className="mt-3 grid gap-2 sm:grid-cols-2">
                      {visibleTelegramResources.map((chat) => {
                        const selected = selectedTelegramChatIds.includes(
                          chat.id,
                        );
                        return (
                          <button
                            key={chat.id}
                            type="button"
                            aria-pressed={selected}
                            onClick={() =>
                              setSelectedTelegramChatIds((current) =>
                                selected
                                  ? current.filter((id) => id !== chat.id)
                                  : [...current, chat.id],
                              )
                            }
                            className={`flex items-center gap-3 rounded-2xl p-3 text-left ${selected ? "bg-primary/10" : "bg-background/70"}`}
                          >
                            <PaperPlaneTilt className="shrink-0 text-primary" />
                            <span className="min-w-0">
                              <strong className="block truncate text-xs">
                                {chat.label}
                              </strong>
                              <span className="block truncate text-[11px] text-muted-foreground">
                                {chat.detail}
                              </span>
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                  {unavailableTelegram.map((chat) => (
                    <button
                      key={chat.id}
                      type="button"
                      aria-pressed={selectedTelegramChatIds.includes(
                        chat.resourceId,
                      )}
                      onClick={() =>
                        setSelectedTelegramChatIds((current) =>
                          current.includes(chat.resourceId)
                            ? current.filter((id) => id !== chat.resourceId)
                            : [...current, chat.resourceId],
                        )
                      }
                      className="mt-2 flex w-full items-center gap-3 rounded-2xl bg-background/70 p-3 text-left"
                    >
                      <PaperPlaneTilt className="shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1">
                        <strong className="block truncate text-xs">
                          {chat.label}
                        </strong>
                        <span className="block text-[11px] text-muted-foreground">
                          Previously selected · unavailable from Telegram
                        </span>
                      </span>
                      <Badge tone="caution">Keep</Badge>
                    </button>
                  ))}
                  <div className="mt-4 flex items-center justify-between gap-3">
                    <span className="text-xs text-muted-foreground">
                      {selectedRepositoryIds.length} repos ·{" "}
                      {selectedJiraProjectId ? 1 : 0} Jira ·{" "}
                      {selectedTelegramChatIds.length} channel
                      {selectedTelegramChatIds.length === 1 ? "" : "s"}
                    </span>
                    <Button
                      size="sm"
                      onClick={() => void saveProjectResources()}
                      disabled={status === "working"}
                    >
                      Save
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
          <p
            aria-live="polite"
            className={
              props.mode === "compose"
                ? "sr-only"
                : "mt-4 rounded-2xl bg-muted/55 p-4 text-xs leading-5 text-muted-foreground"
            }
          >
            {notice}
          </p>
        </CardContent>
      </Card>

      {props.mode === "compose" && lastSubmission && (
        <div className="mx-auto max-w-3xl space-y-3" aria-live="polite">
          <div className="ml-auto max-w-[85%] rounded-3xl bg-primary px-5 py-3 text-sm leading-6 text-primary-foreground">
            {lastSubmission.idea}
          </div>
          <div className="max-w-[90%] rounded-3xl bg-muted px-5 py-4 text-sm leading-6">
            <strong className="block">
              {lastSubmission.project} is ready.
            </strong>
            <p className="mt-1 text-muted-foreground">
              {lastSubmission.created
                ? "I created a private local workspace and saved this as its first discovery request."
                : "I saved this request inside the selected project."}
            </p>
            {lastSubmission.imports.length > 0 && (
              <div
                className="mt-4 space-y-2"
                aria-label="Imported evidence summary"
              >
                {lastSubmission.imports.map((file) => (
                  <div
                    key={file.projectRelativePath}
                    className="flex flex-wrap items-center gap-2 rounded-2xl bg-background/70 px-3 py-2 text-xs"
                  >
                    <strong className="min-w-0 flex-1 truncate">
                      {file.label}
                    </strong>
                    <Badge
                      tone={
                        file.evidence.status === "extracted"
                          ? "positive"
                          : "caution"
                      }
                    >
                      {file.evidence.status}
                    </Badge>
                    <span className="text-muted-foreground">
                      {file.evidence.unitCount} evidence unit
                      {file.evidence.unitCount === 1 ? "" : "s"}
                    </span>
                    {file.evidence.warning && (
                      <span className="w-full text-muted-foreground">
                        {file.evidence.warning}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
            <div className="mt-4 flex flex-wrap gap-2">
              <Button size="sm" onClick={() => props.navigate?.("activity")}>
                Follow progress
                <ArrowRight />
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => props.navigate?.("settings")}
              >
                AI setup
              </Button>
            </div>
          </div>
        </div>
      )}

      {props.mode === "queue" && (
        <div className="grid gap-3 xl:grid-cols-2">
          {requests.map((request) => (
            <Card key={request.id}>
              <CardContent className="p-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap gap-2">
                      <Badge
                        tone={request.state === "queued" ? "active" : "neutral"}
                      >
                        {request.state === "queued" ? (
                          <HourglassMedium />
                        ) : (
                          <CheckCircle />
                        )}
                        {request.state.replaceAll("_", " ")}
                      </Badge>
                      <Badge>
                        {projectNames.get(request.projectId) ??
                          "Unregistered project"}
                      </Badge>
                    </div>
                    <strong className="mt-4 block text-sm leading-6">
                      {request.outcome}
                    </strong>
                    <p className="mt-2 text-xs leading-5 text-muted-foreground">
                      {request.workPreview?.checks.join(" · ") ??
                        "Needs user input"}
                    </p>
                    {request.run && (
                      <div className="mt-4 rounded-2xl bg-muted/50 p-3">
                        <div className="flex items-center gap-2 text-[10px] uppercase tracking-[.14em] text-muted-foreground">
                          <Fingerprint className="text-primary" />
                          Contract {request.run.contract.digest.slice(0, 12)}
                        </div>
                        <div className="mt-3 grid gap-2 sm:grid-cols-3">
                          <DecisionFact label="Effects" value="None" />
                          <DecisionFact label="Maximum cost" value="$0.00" />
                          <DecisionFact label="Undo" value="Release lease" />
                        </div>
                        <ol
                          className="mt-3 space-y-2"
                          aria-label="Durable run events"
                        >
                          {request.run.events.map((event) => (
                            <li
                              key={event.sequence}
                              className="flex gap-3 text-[11px] leading-5"
                            >
                              <span className="grid size-5 shrink-0 place-items-center rounded-full bg-primary/12 font-semibold text-primary">
                                {event.sequence}
                              </span>
                              <span>
                                <strong>
                                  {event.type.replaceAll("_", " ")}
                                </strong>
                                <span className="block text-muted-foreground">
                                  {event.detail}
                                </span>
                              </span>
                            </li>
                          ))}
                        </ol>
                      </div>
                    )}
                    {request.grounding && request.topology && request.plan && (
                      <div className="mt-4 rounded-2xl bg-primary/[.055] p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <strong className="text-xs">
                            Real topology and execution plan
                          </strong>
                          <span className="text-[10px] uppercase tracking-[.13em] text-muted-foreground">
                            revision {request.plan.revision} ·{" "}
                            {request.plan.state}
                          </span>
                        </div>
                        <div className="mt-3 grid gap-2 sm:grid-cols-3">
                          <DecisionFact
                            label="Observed paths"
                            value={`${request.topology.entries.length}${request.topology.truncated ? "+" : ""}`}
                          />
                          <DecisionFact
                            label="Plan tasks"
                            value={String(request.plan.tasks.length)}
                          />
                          <DecisionFact
                            label="Authority"
                            value="No execution"
                          />
                        </div>
                        <div className="mt-3 flex flex-wrap gap-2">
                          {request.grounding.sources.map((source) => (
                            <span
                              key={source.path}
                              className="rounded-full bg-background px-2.5 py-1 text-[10px]"
                            >
                              {source.path} · {source.classification}
                            </span>
                          ))}
                        </div>
                        <ol
                          className="mt-3 space-y-3"
                          aria-label="Dependency-aware execution plan"
                        >
                          {request.plan.order.map((taskId, index) => {
                            const task = request.plan?.tasks.find(
                              (candidate) => candidate.id === taskId,
                            );
                            if (!task) return null;
                            return (
                              <li key={`${task.id}:${request.plan?.revision}`}>
                                <PlanTaskEditor
                                  task={task}
                                  index={index}
                                  count={request.plan?.tasks.length ?? 0}
                                  locked={request.plan?.state === "approved"}
                                  working={status === "working"}
                                  onSave={(title, estimatedMinutes) =>
                                    void editPlan(request, {
                                      type: "edit_task",
                                      taskId: task.id,
                                      title,
                                      estimatedMinutes,
                                    })
                                  }
                                  onMove={(direction) => {
                                    const order = [
                                      ...(request.plan?.order ?? []),
                                    ];
                                    const target = index + direction;
                                    if (target < 0 || target >= order.length)
                                      return;
                                    [order[index], order[target]] = [
                                      order[target]!,
                                      order[index]!,
                                    ];
                                    void editPlan(request, {
                                      type: "reorder",
                                      order,
                                    });
                                  }}
                                />
                              </li>
                            );
                          })}
                        </ol>
                        {request.plan.approval && (
                          <div className="mt-3 flex items-center gap-2 rounded-2xl bg-background/70 p-3 text-[11px]">
                            <LockKey className="shrink-0 text-primary" />
                            <span>
                              Frozen approval{" "}
                              {request.plan.approval.digest.slice(0, 12)} ·
                              zero-effect · execution unauthorized
                            </span>
                          </div>
                        )}
                        {request.execution && (
                          <div className="mt-3 rounded-2xl bg-background/70 p-3">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <span className="flex items-center gap-2 text-[11px] font-semibold">
                                <ShieldCheck className="text-primary" />
                                Execution authority
                              </span>
                              <Badge
                                tone={
                                  ["validated", "review_ready"].includes(
                                    request.execution.state,
                                  )
                                    ? "positive"
                                    : request.execution.state === "failed"
                                      ? "critical"
                                      : "active"
                                }
                              >
                                {request.execution.state}
                              </Badge>
                            </div>
                            <div className="mt-3 grid gap-2 sm:grid-cols-3">
                              <DecisionFact
                                label="Baseline"
                                value={request.execution.authority.preflight.baseline.slice(
                                  0,
                                  10,
                                )}
                              />
                              <DecisionFact
                                label="Permitted files"
                                value={String(
                                  new Set(
                                    request.execution.authority.manifest.tasks.flatMap(
                                      (task) => task.allowedFiles,
                                    ),
                                  ).size,
                                )}
                              />
                              <DecisionFact
                                label="Maximum cost"
                                value="$0.00"
                              />
                            </div>
                            <p className="mt-3 text-[10px] leading-5 text-muted-foreground">
                              Allows one private Git worktree only · excludes
                              canonical writes, network, providers, credentials,
                              paid usage, publishing, and deployment
                            </p>
                            {request.execution.workspace && (
                              <p className="mt-2 text-[10px] font-medium">
                                {request.execution.workspace.branch} · workspace{" "}
                                {request.execution.workspace.state}
                              </p>
                            )}
                            {request.execution.run && (
                              <div className="mt-3 bg-primary/[.055] p-3">
                                <div className="grid gap-2 sm:grid-cols-3">
                                  <DecisionFact
                                    label="Bounded run"
                                    value={request.execution.run.id.slice(
                                      "execution_".length,
                                      12,
                                    )}
                                  />
                                  <DecisionFact
                                    label="Validation"
                                    value={
                                      request.execution.run.attempts.at(-1)
                                        ?.state ?? "Not started"
                                    }
                                  />
                                  <DecisionFact
                                    label="Observed changes"
                                    value={String(
                                      request.execution.run.changes
                                        ?.changedPaths.length ?? 0,
                                    )}
                                  />
                                </div>
                                {request.execution.run.attempts.at(-1) && (
                                  <p className="mt-2 text-[10px] text-muted-foreground">
                                    Diff check · safe commands · 10s · 64 KiB cap
                                  </p>
                                )}
                                {(request.execution.run.changes?.blockers
                                  .length ?? 0) > 0 && (
                                  <p className="mt-2 text-[10px] font-medium text-destructive">
                                    {request.execution.run.changes?.blockers[0]}
                                  </p>
                                )}
                              </div>
                            )}
                            {request.execution.run?.state === "ready" &&
                              !request.execution.patch &&
                              !request.execution.changeSet &&
                              !request.execution.proposal && (
                                <div className="mt-3 bg-primary/[.055] p-3">
                                  <div className="flex flex-wrap items-center justify-between gap-2">
                                    <div>
                                      <p className="text-[11px] font-semibold">
                                        Atomic multi-file change set
                                      </p>
                                      <p className="mt-1 text-[10px] text-muted-foreground">
                                        1–12 create, replace, or delete
                                        operations · previewed together · rolled
                                        back together
                                      </p>
                                    </div>
                                    <Button
                                      size="sm"
                                      variant="secondary"
                                      disabled={
                                        (changeSetDrafts[request.id]?.length ??
                                          0) >= 12
                                      }
                                      onClick={() =>
                                        setChangeSetDrafts((current) => ({
                                          ...current,
                                          [request.id]: [
                                            ...(current[request.id] ?? []),
                                            {
                                              type: "replace",
                                              path: "",
                                              content: "",
                                            },
                                          ],
                                        }))
                                      }
                                    >
                                      Add operation
                                    </Button>
                                  </div>
                                  <div className="mt-3 grid gap-3">
                                    {(changeSetDrafts[request.id] ?? []).map(
                                      (operation, index) => (
                                        <div
                                          key={`${request.id}-change-${index}`}
                                          className="bg-background/65 p-3"
                                        >
                                          <div className="grid gap-2 sm:grid-cols-[8rem_minmax(0,1fr)_auto]">
                                            <select
                                              aria-label={`Operation ${index + 1} type`}
                                              value={operation.type}
                                              onChange={(event) =>
                                                setChangeSetDrafts(
                                                  (current) => ({
                                                    ...current,
                                                    [request.id]: (
                                                      current[request.id] ?? []
                                                    ).map((item, itemIndex) =>
                                                      itemIndex === index
                                                        ? {
                                                            ...item,
                                                            type: event.target
                                                              .value as
                                                              | "create"
                                                              | "replace"
                                                              | "delete",
                                                          }
                                                        : item,
                                                    ),
                                                  }),
                                                )
                                              }
                                              className="h-10 rounded-xl bg-background/80 px-3 text-xs outline-none focus:ring-2 focus:ring-primary"
                                            >
                                              <option value="replace">
                                                Replace
                                              </option>
                                              <option value="create">
                                                Create
                                              </option>
                                              <option value="delete">
                                                Delete
                                              </option>
                                            </select>
                                            {operation.type === "create" ? (
                                              <input
                                                aria-label={`Operation ${index + 1} approved path`}
                                                value={operation.path}
                                                onChange={(event) =>
                                                  setChangeSetDrafts(
                                                    (current) => ({
                                                      ...current,
                                                      [request.id]: (
                                                        current[request.id] ??
                                                        []
                                                      ).map(
                                                        (item, itemIndex) =>
                                                          itemIndex === index
                                                            ? {
                                                                ...item,
                                                                path: event
                                                                  .target.value,
                                                              }
                                                            : item,
                                                      ),
                                                    }),
                                                  )
                                                }
                                                placeholder="Approved new project-relative path"
                                                className="h-10 rounded-xl bg-background/80 px-3 text-xs outline-none focus:ring-2 focus:ring-primary"
                                              />
                                            ) : (
                                              <select
                                                aria-label={`Operation ${index + 1} approved path`}
                                                value={operation.path}
                                                onChange={(event) =>
                                                  setChangeSetDrafts(
                                                    (current) => ({
                                                      ...current,
                                                      [request.id]: (
                                                        current[request.id] ??
                                                        []
                                                      ).map(
                                                        (item, itemIndex) =>
                                                          itemIndex === index
                                                            ? {
                                                                ...item,
                                                                path: event
                                                                  .target.value,
                                                              }
                                                            : item,
                                                      ),
                                                    }),
                                                  )
                                                }
                                                className="h-10 rounded-xl bg-background/80 px-3 text-xs outline-none focus:ring-2 focus:ring-primary"
                                              >
                                                <option value="">
                                                  Choose approved file
                                                </option>
                                                {[
                                                  ...new Set(
                                                    request.execution?.authority.manifest.tasks.flatMap(
                                                      (task) =>
                                                        task.allowedFiles,
                                                    ) ?? [],
                                                  ),
                                                ].map((path) => (
                                                  <option
                                                    key={path}
                                                    value={path}
                                                  >
                                                    {path}
                                                  </option>
                                                ))}
                                              </select>
                                            )}
                                            <Button
                                              size="sm"
                                              variant="secondary"
                                              aria-label={`Remove operation ${index + 1}`}
                                              onClick={() =>
                                                setChangeSetDrafts(
                                                  (current) => ({
                                                    ...current,
                                                    [request.id]: (
                                                      current[request.id] ?? []
                                                    ).filter(
                                                      (_, itemIndex) =>
                                                        itemIndex !== index,
                                                    ),
                                                  }),
                                                )
                                              }
                                            >
                                              <Trash />
                                            </Button>
                                          </div>
                                          {operation.type !== "delete" && (
                                            <textarea
                                              aria-label={`Operation ${index + 1} content`}
                                              value={operation.content}
                                              onChange={(event) =>
                                                setChangeSetDrafts(
                                                  (current) => ({
                                                    ...current,
                                                    [request.id]: (
                                                      current[request.id] ?? []
                                                    ).map((item, itemIndex) =>
                                                      itemIndex === index
                                                        ? {
                                                            ...item,
                                                            content:
                                                              event.target
                                                                .value,
                                                          }
                                                        : item,
                                                    ),
                                                  }),
                                                )
                                              }
                                              maxLength={65_536}
                                              rows={4}
                                              placeholder={
                                                operation.type === "create"
                                                  ? "Complete new UTF-8 file content…"
                                                  : "Complete replacement UTF-8 file content…"
                                              }
                                              className="mt-2 w-full resize-y rounded-xl bg-background/80 p-3 font-mono text-xs outline-none focus:ring-2 focus:ring-primary"
                                            />
                                          )}
                                        </div>
                                      ),
                                    )}
                                  </div>
                                  <Button
                                    size="sm"
                                    className="mt-3"
                                    disabled={
                                      status === "working" ||
                                      (changeSetDrafts[request.id]?.length ??
                                        0) === 0
                                    }
                                    onClick={() =>
                                      void previewChangeSet(request)
                                    }
                                  >
                                    <Fingerprint />
                                    Preview atomic change set
                                  </Button>
                                </div>
                              )}
                            {request.execution.run?.state === "ready" &&
                              !request.execution.patch &&
                              !request.execution.changeSet &&
                              !request.execution.proposal && (
                                <div className="mt-3 bg-primary/[.055] p-3">
                                  <p className="text-[11px] font-semibold">
                                    Exact isolated replacement
                                  </p>
                                  <div className="mt-3 grid gap-2">
                                    <select
                                      aria-label="Approved patch target"
                                      value={
                                        patchDrafts[request.id]?.path ?? ""
                                      }
                                      onChange={(event) =>
                                        setPatchDrafts((current) => ({
                                          ...current,
                                          [request.id]: {
                                            path: event.target.value,
                                            content:
                                              current[request.id]?.content ??
                                              "",
                                          },
                                        }))
                                      }
                                      className="h-10 rounded-xl bg-background/80 px-3 text-xs outline-none focus:ring-2 focus:ring-primary"
                                    >
                                      <option value="">
                                        Choose an approved file
                                      </option>
                                      {[
                                        ...new Set(
                                          request.execution.authority.manifest.tasks.flatMap(
                                            (task) => task.allowedFiles,
                                          ),
                                        ),
                                      ].map((path) => (
                                        <option key={path} value={path}>
                                          {path}
                                        </option>
                                      ))}
                                    </select>
                                    <textarea
                                      aria-label="Replacement text"
                                      value={
                                        patchDrafts[request.id]?.content ?? ""
                                      }
                                      onChange={(event) =>
                                        setPatchDrafts((current) => ({
                                          ...current,
                                          [request.id]: {
                                            path:
                                              current[request.id]?.path ?? "",
                                            content: event.target.value,
                                          },
                                        }))
                                      }
                                      maxLength={65_536}
                                      rows={6}
                                      placeholder="Paste the complete replacement text…"
                                      className="resize-y rounded-xl bg-background/80 p-3 font-mono text-xs outline-none focus:ring-2 focus:ring-primary"
                                    />
                                    <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                                      <span>
                                        Single existing UTF-8 file · 64 KiB
                                        maximum
                                      </span>
                                      <span>
                                        {new TextEncoder()
                                          .encode(
                                            patchDrafts[request.id]?.content ??
                                              "",
                                          )
                                          .length.toLocaleString()}{" "}
                                        bytes
                                      </span>
                                    </div>
                                    <Button
                                      size="sm"
                                      onClick={() => void previewPatch(request)}
                                      disabled={
                                        status === "working" ||
                                        !patchDrafts[request.id]?.path
                                      }
                                    >
                                      <Fingerprint />
                                      Preview exact replacement
                                    </Button>
                                  </div>
                                </div>
                              )}
                            {request.execution.patch && (
                              <div className="mt-3 bg-primary/[.055] p-3">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <strong className="text-[11px]">
                                    {request.execution.patch.preview.path}
                                  </strong>
                                  <Badge
                                    tone={
                                      request.execution.patch.state ===
                                      "applied"
                                        ? "positive"
                                        : request.execution.patch.state ===
                                            "interrupted"
                                          ? "critical"
                                          : "active"
                                    }
                                  >
                                    {request.execution.patch.state}
                                  </Badge>
                                </div>
                                <div className="mt-3 grid gap-2 sm:grid-cols-3">
                                  <DecisionFact
                                    label="Before"
                                    value={request.execution.patch.preview.beforeDigest.slice(
                                      0,
                                      10,
                                    )}
                                  />
                                  <DecisionFact
                                    label="After"
                                    value={request.execution.patch.preview.afterDigest.slice(
                                      0,
                                      10,
                                    )}
                                  />
                                  <DecisionFact
                                    label="Byte delta"
                                    value={String(
                                      request.execution.patch.preview
                                        .afterBytes -
                                        request.execution.patch.preview
                                          .beforeBytes,
                                    )}
                                  />
                                </div>
                                <p className="mt-2 text-[10px] text-muted-foreground">
                                  Applied means isolated bytes verified · never
                                  committed, merged, pushed, published, or
                                  deployed
                                </p>
                              </div>
                            )}
                            {request.execution.changeSet && (
                              <div className="mt-3 bg-primary/[.055] p-3">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <strong className="text-[11px]">
                                    Multi-file change set
                                  </strong>
                                  <Badge
                                    tone={
                                      request.execution.changeSet.state ===
                                      "applied"
                                        ? "positive"
                                        : request.execution.changeSet.state ===
                                            "interrupted"
                                          ? "critical"
                                          : "active"
                                    }
                                  >
                                    {request.execution.changeSet.state}
                                  </Badge>
                                </div>
                                <div className="mt-3 grid gap-2 sm:grid-cols-3">
                                  <DecisionFact
                                    label="Operations"
                                    value={String(
                                      request.execution.changeSet.preview
                                        .operations.length,
                                    )}
                                  />
                                  <DecisionFact
                                    label="Before"
                                    value={`${request.execution.changeSet.preview.totalBeforeBytes.toLocaleString()} bytes`}
                                  />
                                  <DecisionFact
                                    label="After"
                                    value={`${request.execution.changeSet.preview.totalAfterBytes.toLocaleString()} bytes`}
                                  />
                                </div>
                                <p className="mt-2 text-[10px] text-muted-foreground">
                                  {request.execution.changeSet.preview.operations
                                    .map((item) => `${item.type} ${item.path}`)
                                    .join(" · ")}
                                </p>
                              </div>
                            )}
                            {request.execution.proposal && (
                              <Suspense
                                fallback={
                                  <div className="mt-3 bg-primary/[.055] p-3 text-[11px] text-muted-foreground">
                                    Loading proposal evidence…
                                  </div>
                                }
                              >
                                <LocalProposalCard
                                  proposal={request.execution.proposal}
                                />
                              </Suspense>
                            )}
                            {request.execution.state === "review_ready" &&
                              !request.execution.commit && (
                                <div className="mt-3 bg-primary/[.055] p-3">
                                  <p className="text-[11px] font-semibold">
                                    Local isolated commit
                                  </p>
                                  <input
                                    aria-label="Local commit message"
                                    value={commitMessages[request.id] ?? ""}
                                    onChange={(event) =>
                                      setCommitMessages((current) => ({
                                        ...current,
                                        [request.id]: event.target.value,
                                      }))
                                    }
                                    maxLength={200}
                                    placeholder="Describe the validated change…"
                                    className="mt-3 h-10 w-full rounded-xl bg-background/80 px-3 text-xs outline-none focus:ring-2 focus:ring-primary"
                                  />
                                  <p className="mt-2 text-[10px] text-muted-foreground">
                                    Hooks and signing disabled · local identity
                                    · never pushed
                                  </p>
                                  <Button
                                    size="sm"
                                    className="mt-3"
                                    onClick={() => void previewCommit(request)}
                                    disabled={
                                      status === "working" ||
                                      (commitMessages[request.id]?.trim()
                                        .length ?? 0) < 3
                                    }
                                  >
                                    <Fingerprint />
                                    Preview local commit
                                  </Button>
                                </div>
                              )}
                            {request.execution.commit && (
                              <div className="mt-3 bg-primary/[.055] p-3">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <strong className="text-[11px]">
                                    {request.execution.commit.preview.message}
                                  </strong>
                                  <Badge
                                    tone={
                                      request.execution.commit.state ===
                                      "created"
                                        ? "positive"
                                        : request.execution.commit.state ===
                                            "interrupted"
                                          ? "critical"
                                          : "active"
                                    }
                                  >
                                    {request.execution.commit.state}
                                  </Badge>
                                </div>
                                <p className="mt-2 text-[10px] text-muted-foreground">
                                  {
                                    request.execution.commit.preview
                                      .changedPaths.length
                                  }{" "}
                                  paths · +
                                  {request.execution.commit.preview.insertions}{" "}
                                  / −
                                  {request.execution.commit.preview.deletions} ·
                                  parent{" "}
                                  {request.execution.commit.preview.parentCommit.slice(
                                    0,
                                    8,
                                  )}
                                </p>
                                {request.execution.commit.receipt && (
                                  <p className="mt-2 text-[10px] font-medium">
                                    Commit{" "}
                                    {request.execution.commit.receipt.commit.slice(
                                      0,
                                      10,
                                    )}{" "}
                                    · {request.execution.commit.receipt.branch}{" "}
                                    · not pushed
                                  </p>
                                )}
                              </div>
                            )}
                            {request.execution.integration && (
                              <div className="mt-3 bg-primary/[.055] p-3">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <strong className="text-[11px]">
                                    Local canonical integration
                                  </strong>
                                  <Badge
                                    tone={
                                      request.execution.integration.state ===
                                      "created"
                                        ? "positive"
                                        : request.execution.integration
                                              .state === "interrupted"
                                          ? "critical"
                                          : "active"
                                    }
                                  >
                                    {request.execution.integration.state}
                                  </Badge>
                                </div>
                                <p className="mt-2 text-[10px] text-muted-foreground">
                                  {
                                    request.execution.integration.preview
                                      .targetBranch
                                  }{" "}
                                  ·{" "}
                                  {request.execution.integration.preview.targetHead.slice(
                                    0,
                                    8,
                                  )}{" "}
                                  ·{" "}
                                  {
                                    request.execution.integration.preview
                                      .changedPaths.length
                                  }{" "}
                                  paths · conflict probe passed
                                </p>
                                {request.execution.integration.receipt && (
                                  <p className="mt-2 text-[10px] font-medium">
                                    Local HEAD{" "}
                                    {request.execution.integration.receipt.resultingHead.slice(
                                      0,
                                      10,
                                    )}{" "}
                                    · not pushed
                                  </p>
                                )}
                              </div>
                            )}
                          </div>
                        )}
                        <p className="mt-3 text-[10px] text-muted-foreground">
                          Citations explain why · paths define targets · no agent has run
                        </p>
                      </div>
                    )}
                  </div>
                  <span className="text-[10px] text-muted-foreground">
                    {new Date(request.createdAt).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                </div>
                <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                  <span className="text-[10px] uppercase tracking-[.15em] text-muted-foreground">
                    {request.workPreview?.provenance.replaceAll("_", " ") ??
                      request.provenance}
                  </span>
                  <div className="flex flex-wrap gap-2">
                    {request.state === "queued" && (
                      <>
                        <Button
                          size="sm"
                          onClick={() => void advance(request, "approve")}
                          disabled={status === "working"}
                        >
                          <CheckCircle />
                          Approve zero-effect contract
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => void mutate(request, "cancel")}
                          disabled={status === "working"}
                        >
                          <Stop />
                          Cancel safely
                        </Button>
                      </>
                    )}
                    {request.state === "approved" && !request.plan && (
                      <Button
                        size="sm"
                        onClick={() => void advance(request, "ground")}
                        disabled={status === "working"}
                      >
                        <Fingerprint />
                        Ground and draft plan
                      </Button>
                    )}
                    {request.state === "approved" &&
                      request.plan?.state === "draft" && (
                        <Button
                          size="sm"
                          onClick={() => void approvePlan(request)}
                          disabled={status === "working"}
                        >
                          <LockKey />
                          Approve and freeze plan
                        </Button>
                      )}
                    {request.state === "approved" &&
                      request.plan?.state === "approved" && (
                        <>
                          {!request.execution && (
                            <Button
                              size="sm"
                              onClick={() => void authorizeExecution(request)}
                              disabled={status === "working"}
                            >
                              <ShieldCheck />
                              Authorize isolated preparation
                            </Button>
                          )}
                          {request.execution?.state === "authorized" && (
                            <Button
                              size="sm"
                              onClick={() =>
                                void mutateExecution(request, "prepare")
                              }
                              disabled={status === "working"}
                            >
                              <Play />
                              Prepare isolated workspace
                            </Button>
                          )}
                          {request.execution?.state === "ready" &&
                            !request.execution.run && (
                              <Button
                                size="sm"
                                onClick={() =>
                                  void mutateExecution(request, "start")
                                }
                                disabled={status === "working"}
                              >
                                <Play />
                                Start bounded run
                              </Button>
                            )}
                          {request.execution?.state === "ready" &&
                            request.execution.run?.state === "ready" && (
                              <>
                                {!request.execution.patch &&
                                  !request.execution.changeSet && (
                                    <Suspense fallback={null}>
                                      <LocalProposalControls
                                        endpoint={endpoint}
                                        request={request}
                                        working={status === "working"}
                                        onComplete={async (message) => {
                                          await refresh();
                                          setNotice(message);
                                        }}
                                        onError={(message) => {
                                          setStatus("ready");
                                          setNotice(message);
                                        }}
                                      />
                                    </Suspense>
                                  )}
                                {request.execution.patch?.state ===
                                  "previewed" && (
                                  <Button
                                    size="sm"
                                    onClick={() => void approvePatch(request)}
                                    disabled={status === "working"}
                                  >
                                    <LockKey />
                                    Approve exact patch
                                  </Button>
                                )}
                                {request.execution.patch?.state ===
                                  "approved" && (
                                  <Button
                                    size="sm"
                                    onClick={() =>
                                      void mutatePatch(request, "apply")
                                    }
                                    disabled={status === "working"}
                                  >
                                    <FloppyDisk />
                                    Apply inside worktree
                                  </Button>
                                )}
                                {request.execution.patch?.state ===
                                  "applied" && (
                                  <>
                                    <Button
                                      size="sm"
                                      onClick={() =>
                                        void mutateExecution(
                                          request,
                                          "validate",
                                        )
                                      }
                                      disabled={status === "working"}
                                    >
                                      <CheckCircle />
                                      Validate isolated patch
                                    </Button>
                                    <Button
                                      size="sm"
                                      variant="secondary"
                                      onClick={() =>
                                        void mutatePatch(request, "rollback")
                                      }
                                      disabled={status === "working"}
                                    >
                                      <ArrowClockwise />
                                      Roll back isolated patch
                                    </Button>
                                  </>
                                )}
                                {request.execution.patch?.state ===
                                  "applying" && (
                                  <Button
                                    size="sm"
                                    variant="secondary"
                                    onClick={() =>
                                      void mutatePatch(request, "reconcile")
                                    }
                                    disabled={status === "working"}
                                  >
                                    <ArrowClockwise />
                                    Reconcile patch interruption
                                  </Button>
                                )}
                                {request.execution.changeSet?.state ===
                                  "previewed" && (
                                  <Button
                                    size="sm"
                                    onClick={() =>
                                      void approveChangeSet(request)
                                    }
                                    disabled={status === "working"}
                                  >
                                    <LockKey />
                                    Approve exact change set
                                  </Button>
                                )}
                                {request.execution.changeSet?.state ===
                                  "approved" && (
                                  <Button
                                    size="sm"
                                    onClick={() =>
                                      void mutateChangeSet(request, "apply")
                                    }
                                    disabled={status === "working"}
                                  >
                                    <FloppyDisk />
                                    Apply all files atomically
                                  </Button>
                                )}
                                {request.execution.changeSet?.state ===
                                  "applied" && (
                                  <>
                                    <Button
                                      size="sm"
                                      onClick={() =>
                                        void mutateExecution(
                                          request,
                                          "validate",
                                        )
                                      }
                                      disabled={status === "working"}
                                    >
                                      <CheckCircle />
                                      Validate complete change set
                                    </Button>
                                    <Button
                                      size="sm"
                                      variant="secondary"
                                      onClick={() =>
                                        void mutateChangeSet(
                                          request,
                                          "rollback",
                                        )
                                      }
                                      disabled={status === "working"}
                                    >
                                      <ArrowClockwise />
                                      Roll back every file
                                    </Button>
                                  </>
                                )}
                                {request.execution.changeSet?.state ===
                                  "applying" && (
                                  <Button
                                    size="sm"
                                    variant="secondary"
                                    onClick={() =>
                                      void mutateChangeSet(request, "reconcile")
                                    }
                                    disabled={status === "working"}
                                  >
                                    <ArrowClockwise />
                                    Reconcile interrupted change set
                                  </Button>
                                )}
                              </>
                            )}
                          {[
                            "authorized",
                            "preparing",
                            "ready",
                            "validating",
                            "validated",
                            "review_ready",
                            "failed",
                          ].includes(request.execution?.state ?? "") && (
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() =>
                                void mutateExecution(request, "cancel")
                              }
                              disabled={status === "working"}
                            >
                              <Stop />
                              Cancel and preserve
                            </Button>
                          )}
                          {["preparing", "validating"].includes(
                            request.execution?.state ?? "",
                          ) && (
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() =>
                                void mutateExecution(request, "reconcile")
                              }
                              disabled={status === "working"}
                            >
                              <ArrowClockwise />
                              Reconcile interruption
                            </Button>
                          )}
                        </>
                      )}
                    {request.state === "claimed" && (
                      <Button
                        size="sm"
                        onClick={() => void advance(request, "checkpoint")}
                        disabled={status === "working"}
                      >
                        <CheckCircle />
                        Record zero-effect checkpoint
                      </Button>
                    )}
                    {request.execution?.commit?.state === "previewed" && (
                      <Button
                        size="sm"
                        onClick={() => void approveCommit(request)}
                        disabled={status === "working"}
                      >
                        <LockKey />
                        Approve local commit
                      </Button>
                    )}
                    {request.execution?.commit?.state === "approved" && (
                      <Button
                        size="sm"
                        onClick={() => void mutateCommit(request, "create")}
                        disabled={status === "working"}
                      >
                        <GitBranch />
                        Create isolated commit
                      </Button>
                    )}
                    {request.execution?.commit?.state === "created" && (
                      <>
                        {!request.execution.integration && (
                          <Button
                            size="sm"
                            onClick={() => void previewIntegration(request)}
                            disabled={status === "working"}
                          >
                            <GitBranch /> Preview local integration
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => void mutateCommit(request, "undo")}
                          disabled={
                            status === "working" ||
                            Boolean(request.execution.integration)
                          }
                        >
                          <ArrowClockwise /> Undo isolated commit
                        </Button>
                      </>
                    )}
                    {request.execution?.integration?.state === "previewed" && (
                      <Button
                        size="sm"
                        onClick={() => void approveIntegration(request)}
                        disabled={status === "working"}
                      >
                        <LockKey /> Approve local integration
                      </Button>
                    )}
                    {request.execution?.integration?.state === "approved" && (
                      <Button
                        size="sm"
                        onClick={() =>
                          void mutateIntegration(request, "create")
                        }
                        disabled={status === "working"}
                      >
                        <GitBranch /> Integrate into local branch
                      </Button>
                    )}
                    {request.execution?.integration?.state === "created" && (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => void mutateIntegration(request, "undo")}
                        disabled={status === "working"}
                      >
                        <ArrowClockwise /> Undo local integration
                      </Button>
                    )}
                    {request.execution?.integration?.state === "creating" && (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() =>
                          void mutateIntegration(request, "reconcile")
                        }
                        disabled={status === "working"}
                      >
                        <ArrowClockwise /> Reconcile integration
                      </Button>
                    )}
                    {request.execution?.commit?.state === "creating" && (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => void mutateCommit(request, "reconcile")}
                        disabled={status === "working"}
                      >
                        <ArrowClockwise />
                        Reconcile commit interruption
                      </Button>
                    )}
                    {request.state === "checkpointed" && (
                      <Button
                        size="sm"
                        onClick={() => void advance(request, "release")}
                        disabled={status === "working"}
                      >
                        <CheckCircle />
                        Release proof lease
                      </Button>
                    )}
                    {["completed", "interrupted", "cancelled"].includes(
                      request.state,
                    ) && (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => void mutate(request, "archive")}
                        disabled={status === "working"}
                      >
                        <Trash />
                        Archive
                      </Button>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
          {requests.length === 0 && status !== "loading" && (
            <Card>
              <CardContent className="grid min-h-36 place-items-center p-6 text-center">
                <div>
                  <HourglassMedium size={30} className="mx-auto text-primary" />
                  <strong className="mt-3 block text-sm">
                    The real queue is empty
                  </strong>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Synthetic examples below are not active work.
                  </p>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </section>
  );
}

function DecisionFact({ label, value }: { label: string; value: string }) {
  return (
    <span>
      <span className="block text-[9px] uppercase tracking-[.13em] text-muted-foreground">
        {label}
      </span>
      <strong className="mt-1 block text-[11px]">{value}</strong>
    </span>
  );
}

function PlanTaskEditor(props: {
  task: LocalDraftPlan["tasks"][number];
  index: number;
  count: number;
  locked: boolean;
  working: boolean;
  onSave: (title: string, estimatedMinutes: number) => void;
  onMove: (direction: -1 | 1) => void;
}) {
  const [title, setTitle] = useState(props.task.title);
  const [estimatedMinutes, setEstimatedMinutes] = useState(
    props.task.estimatedMinutes,
  );
  const changed =
    title.trim() !== props.task.title ||
    estimatedMinutes !== props.task.estimatedMinutes;
  return (
    <article className="rounded-2xl bg-background/75 p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 gap-3">
          <span className="grid size-7 shrink-0 place-items-center rounded-full bg-primary/12 text-[11px] font-semibold text-primary">
            {props.index + 1}
          </span>
          <div className="min-w-0 flex-1">
            {props.locked ? (
              <strong className="text-xs leading-5">{props.task.title}</strong>
            ) : (
              <label className="block text-[10px] font-semibold uppercase tracking-[.12em] text-muted-foreground">
                Task title
                <input
                  value={title}
                  maxLength={160}
                  onChange={(event) => setTitle(event.target.value)}
                  className="mt-1 h-9 w-full rounded-xl bg-muted px-3 text-xs font-medium normal-case tracking-normal text-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/30"
                />
              </label>
            )}
            <p className="mt-2 text-[11px] leading-5 text-muted-foreground">
              Targets · {props.task.allowedFiles.join(" · ")}
            </p>
            <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
              Depends on ·{" "}
              {props.task.dependsOn.length > 0
                ? props.task.dependsOn.map((id) => id.slice(-6)).join(" · ")
                : "Nothing"}
            </p>
            <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
              Cites · {props.task.citedSources.join(" · ")}
            </p>
          </div>
        </div>
        <Badge tone={props.task.risk === "high" ? "caution" : "neutral"}>
          {props.task.risk} risk
        </Badge>
      </div>
      <div className="mt-3 flex flex-wrap items-end justify-between gap-2">
        <div className="flex items-center gap-2">
          <GitBranch className="text-primary" />
          {props.locked ? (
            <span className="text-[11px]">
              {props.task.estimatedMinutes} min
            </span>
          ) : (
            <label className="text-[10px] font-semibold uppercase tracking-[.12em] text-muted-foreground">
              Minutes
              <input
                type="number"
                min={5}
                max={480}
                step={5}
                value={estimatedMinutes}
                onChange={(event) =>
                  setEstimatedMinutes(Number(event.target.value))
                }
                className="ml-2 h-8 w-20 rounded-xl bg-muted px-2 text-xs normal-case tracking-normal text-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/30"
              />
            </label>
          )}
        </div>
        {!props.locked && (
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="ghost"
              aria-label={`Move ${props.task.title} earlier`}
              disabled={props.working || props.index === 0}
              onClick={() => props.onMove(-1)}
            >
              <ArrowUp />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              aria-label={`Move ${props.task.title} later`}
              disabled={props.working || props.index === props.count - 1}
              onClick={() => props.onMove(1)}
            >
              <ArrowDown />
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={
                props.working ||
                !changed ||
                title.trim().length === 0 ||
                estimatedMinutes < 5 ||
                estimatedMinutes > 480
              }
              onClick={() => props.onSave(title.trim(), estimatedMinutes)}
            >
              <FloppyDisk />
              Save task
            </Button>
          </div>
        )}
      </div>
    </article>
  );
}
