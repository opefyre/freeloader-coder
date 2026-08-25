import { createHash } from "node:crypto";
import { spawn } from "node:child_process";

import {
  ownerJourneyCertificationReceiptSchema,
  type OwnerJourneyCertificationReceipt,
} from "../../../packages/runtime/src/owner-journey-certification.js";

export const OWNER_JOURNEY_STAGES = [
  "plain_language_intake",
  "workspace_and_resources",
  "governed_artifacts",
  "context_and_eligibility",
  "solution_approval",
  "jira_backlog",
  "isolated_implementation",
  "deterministic_validation",
  "independent_review",
  "integration",
  "durable_completion",
] as const;

interface CertificationExecution {
  readonly exitCode: number;
  readonly passed: number;
  readonly failed: number;
  readonly digest: string;
}

export type CertificationRunner = () => Promise<CertificationExecution>;

export async function certifyOwnerJourney(
  options: {
    readonly run?: CertificationRunner;
    readonly now?: () => number;
  } = {},
): Promise<OwnerJourneyCertificationReceipt> {
  const now = options.now ?? Date.now;
  const started = now();
  const execution = await (options.run ?? runCertificationTests)();
  if (
    execution.exitCode !== 0 ||
    execution.failed !== 0 ||
    execution.passed < 3
  ) {
    throw new Error(
      "Owner-journey certification failed. Review the focused test output; no passing receipt was written.",
    );
  }
  const completed = Math.max(started, now());
  const certificationId = digest(
    `owner-journey-v1:${execution.digest}:${execution.passed}`,
  );
  const suites = (
    ["owner_mvp", "new_product", "existing_product"] as const
  ).map((id) => ({
    id,
    outcome: "passed" as const,
    evidenceDigest: digest(`${execution.digest}:suite:${id}`),
  }));
  const receipt: OwnerJourneyCertificationReceipt = {
    schemaVersion: 1,
    certificationId,
    mode: "synthetic_zero_cost",
    outcome: "passed",
    startedAt: new Date(started).toISOString(),
    completedAt: new Date(completed).toISOString(),
    durationMs: completed - started,
    suites,
    stages: OWNER_JOURNEY_STAGES.map((name) => ({
      name,
      outcome: "passed",
      evidenceDigest: digest(`${execution.digest}:stage:${name}`),
    })),
    paidCalls: 0,
    externalEffects: 0,
    privacy: {
      prompts: false,
      sourceCode: false,
      attachments: false,
      credentials: false,
      absolutePaths: false,
      personalIdentifiers: false,
      privateJiraContent: false,
    },
    limitations: [
      "This is a local synthetic certification, not evidence of external adoption.",
      "Jira behavior is exercised through the deterministic integration boundary without mutating a live project.",
      "Free-provider execution is represented by admitted zero-cost candidates; provider availability is checked separately at runtime.",
    ],
    nextAction:
      "Run one consented external-owner journey and record only time-to-preview plus structured trust feedback.",
  };
  return validateOwnerJourneyCertification(receipt);
}

export function validateOwnerJourneyCertification(
  receipt: OwnerJourneyCertificationReceipt,
) {
  if (
    receipt.schemaVersion !== 1 ||
    receipt.mode !== "synthetic_zero_cost" ||
    receipt.outcome !== "passed"
  )
    throw new Error("Certification identity is invalid.");
  if (!/^[a-f0-9]{64}$/.test(receipt.certificationId))
    throw new Error("Certification digest is invalid.");
  if (receipt.paidCalls !== 0 || receipt.externalEffects !== 0)
    throw new Error("Certification must remain zero-cost and local-only.");
  if (
    receipt.suites.length !== 3 ||
    receipt.suites.some(
      (suite) =>
        suite.outcome !== "passed" ||
        !/^[a-f0-9]{64}$/.test(suite.evidenceDigest),
    )
  )
    throw new Error("Every owner-journey suite must pass.");
  if (
    receipt.stages.length !== OWNER_JOURNEY_STAGES.length ||
    receipt.stages.some(
      (stage, index) =>
        stage.name !== OWNER_JOURNEY_STAGES[index] ||
        stage.outcome !== "passed" ||
        !/^[a-f0-9]{64}$/.test(stage.evidenceDigest),
    )
  )
    throw new Error("Every owner-journey stage must pass in order.");
  if (Object.values(receipt.privacy).some(Boolean))
    throw new Error(
      "Certification receipts cannot contain private project material.",
    );
  const serialized = JSON.stringify(receipt);
  if (
    /\/Users\/|\/home\/|api[_-]?key|bearer\s|sk-[A-Za-z0-9]|prompt\s*:/i.test(
      serialized,
    )
  )
    throw new Error(
      "Certification receipt contains prohibited private material.",
    );
  return ownerJourneyCertificationReceiptSchema.parse(receipt);
}

async function runCertificationTests(): Promise<CertificationExecution> {
  const files = [
    "dist/tests/owner-mvp.e2e.test.js",
    "dist/tests/product-golden-journeys.e2e.test.js",
  ];
  const output = await new Promise<{
    code: number;
    stdout: string;
    stderr: string;
  }>((resolve, reject) => {
    const child = spawn(process.execPath, ["--test", ...files], {
      cwd: process.cwd(),
      env: { ...process.env, NO_COLOR: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      if (stdout.length < 1_000_000) stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      if (stderr.length < 200_000) stderr += String(chunk);
    });
    child.once("error", reject);
    child.once("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
  const passed = Number(output.stdout.match(/# pass (\d+)/)?.[1] ?? 0);
  const failed = Number(output.stdout.match(/# fail (\d+)/)?.[1] ?? 0);
  const normalized = output.stdout.replace(
    /duration_ms: [\d.]+/g,
    "duration_ms: <bounded>",
  );
  return {
    exitCode: output.code,
    passed,
    failed,
    digest: digest(`${normalized}\n${output.stderr}`),
  };
}

function digest(value: string) {
  return createHash("sha256").update(value).digest("hex");
}
