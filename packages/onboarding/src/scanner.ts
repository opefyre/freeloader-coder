import { createHash } from "node:crypto";
import { extname } from "node:path";

import {
  projectFileSchema,
  projectProfileSchema,
  type GroundingStatement,
  type ProjectFile,
  type ProjectProfile
} from "./contracts.js";

const languageByExtension: Readonly<Record<string, string>> = {
  ".css": "CSS",
  ".go": "Go",
  ".html": "HTML",
  ".java": "Java",
  ".js": "JavaScript",
  ".jsx": "JavaScript",
  ".py": "Python",
  ".rb": "Ruby",
  ".rs": "Rust",
  ".swift": "Swift",
  ".ts": "TypeScript",
  ".tsx": "TypeScript",
  ".vue": "Vue"
};

const secretPathPattern =
  /(^|\/)(\.env(?:\..+)?|.*\.(?:pem|key|p12|pfx)|id_(?:rsa|ed25519)|credentials?\.json|secrets?)(\/|$)/i;
const secretValuePattern =
  /(api[_-]?key|token|password|secret|private[_-]?key)\s*[:=]\s*["']?[^\s"',}]+/gi;

export function scanProject(input: {
  readonly projectId: string;
  readonly files: readonly unknown[];
  readonly maxFiles: number;
  readonly maxFileBytes: number;
  readonly maxTotalBytes: number;
}): ProjectProfile {
  if (input.maxFiles < 1 || input.maxFileBytes < 1 || input.maxTotalBytes < 1) {
    throw new Error("Project scan limits are invalid.");
  }
  if (input.files.length > input.maxFiles) throw new Error("Project scan exceeds the file limit.");

  const files = input.files
    .map((file) => projectFileSchema.parse(file))
    .sort((left, right) => left.path.localeCompare(right.path));
  if (new Set(files.map((file) => file.path)).size !== files.length) {
    throw new Error("Project scan paths must be unique.");
  }
  if (files.some((file) => file.bytes > input.maxFileBytes)) {
    throw new Error("Project scan contains an oversized file.");
  }
  if (files.reduce((total, file) => total + file.bytes, 0) > input.maxTotalBytes) {
    throw new Error("Project scan exceeds the total byte limit.");
  }

  const protectedPaths = files
    .filter((file) => secretPathPattern.test(file.path))
    .map((file) => file.path);
  const safeFiles = files.filter((file) => !protectedPaths.includes(file.path));
  const citations = files.map((file) => ({
    path: file.path,
    sha256: hash(file.content)
  }));
  const safeContent = new Map(
    safeFiles.map((file) => [file.path, redactSecretValues(file.content)])
  );

  const languages = unique(
    safeFiles.map((file) => languageByExtension[extname(file.path).toLowerCase()]).filter(isString)
  );
  const packageJson = safeFiles.find((file) => file.path === "package.json");
  const packageData = parsePackageJson(packageJson ? safeContent.get(packageJson.path) ?? "" : "");
  const dependencyNames = new Set([
    ...Object.keys(packageData.dependencies),
    ...Object.keys(packageData.devDependencies)
  ]);
  const frameworks = unique([
    ...(dependencyNames.has("next") ? ["Next.js"] : []),
    ...(dependencyNames.has("react") ? ["React"] : []),
    ...(dependencyNames.has("vite") ? ["Vite"] : []),
    ...(dependencyNames.has("vue") ? ["Vue"] : []),
    ...(dependencyNames.has("svelte") ? ["Svelte"] : []),
    ...(dependencyNames.has("@angular/core") ? ["Angular"] : []),
    ...(safeFiles.some((file) => file.path === "Cargo.toml") ? ["Cargo"] : []),
    ...(safeFiles.some((file) => file.path === "go.mod") ? ["Go modules"] : [])
  ]);
  const packageManagers = unique([
    ...(safeFiles.some((file) => file.path === "pnpm-lock.yaml") ? ["pnpm"] : []),
    ...(safeFiles.some((file) => file.path === "yarn.lock") ? ["Yarn"] : []),
    ...(safeFiles.some((file) => file.path === "package-lock.json") ? ["npm"] : []),
    ...(safeFiles.some((file) => file.path === "bun.lockb" || file.path === "bun.lock") ? ["Bun"] : []),
    ...(safeFiles.some((file) => file.path === "uv.lock") ? ["uv"] : []),
    ...(safeFiles.some((file) => file.path === "poetry.lock") ? ["Poetry"] : [])
  ]);
  const commands = Object.entries(packageData.scripts)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, command]) => ({ name, command, citation: "package.json" }));
  const ports = uniqueNumbers(
    safeFiles.flatMap((file) => [
      ...[...(safeContent.get(file.path) ?? "").matchAll(
        /(?:port|PORT)\s*[:=]\s*["']?(\d{2,5})/g
      )].map((match) => Number(match[1]))
    ]).filter((port) => port > 0 && port <= 65_535)
  );
  const conventions = unique([
    ...(safeFiles.some((file) => /(^|\/)AGENTS\.md$/i.test(file.path)) ? ["Repository agent instructions"] : []),
    ...(safeFiles.some((file) => /(^|\/)CONTRIBUTING\.md$/i.test(file.path)) ? ["Contributor guide"] : []),
    ...(safeFiles.some((file) => /(^|\/)(eslint|biome|prettier)/i.test(file.path)) ? ["Automated code style"] : []),
    ...(safeFiles.some((file) => /(^|\/)tsconfig.*\.json$/i.test(file.path)) ? ["TypeScript project configuration"] : [])
  ]);
  const designTokens = unique(
    safeFiles.flatMap((file) =>
      [...(safeContent.get(file.path) ?? "").matchAll(/--([a-z0-9-]+)\s*:/gi)]
        .map((match) => `--${match[1]}`)
    )
  ).slice(0, 100);
  const tests = safeFiles
    .filter((file) => /(^|\/)(__tests__|tests?|spec)(\/|\.|-)|\.(?:test|spec)\.[^.]+$/i.test(file.path))
    .map((file) => file.path);

  const missingDependencies = unique([
    ...(packageData.packageManager === null && packageManagers.length > 1
      ? ["Choose the intended JavaScript package manager"]
      : []),
    ...(commands.length === 0 && packageJson ? ["Add or identify a validation command"] : [])
  ]);
  const unsupportedFeatures = unique([
    ...(safeFiles.some((file) => file.path.endsWith(".xcodeproj/project.pbxproj"))
      ? ["Native Xcode project automation requires a compatible macOS worker"]
      : [])
  ]);
  const readiness =
    unsupportedFeatures.length > 0
      ? "partial"
      : missingDependencies.length > 0
        ? "partial"
        : commands.length > 0 || languages.length > 0
          ? "ready"
          : "blocked";
  const resourceRequirements = unique([
    ...(frameworks.includes("Next.js") || frameworks.includes("Vite")
      ? ["Node.js 22 or the repository-declared compatible runtime"]
      : []),
    ...(frameworks.includes("Cargo") ? ["Rust toolchain"] : []),
    ...(frameworks.includes("Go modules") ? ["Go toolchain"] : [])
  ]);

  const statements: GroundingStatement[] = [
    ...languages.map((language) => ({
      classification: "fact" as const,
      text: `${language} source files were detected.`,
      citations: safeFiles.filter((file) => languageByExtension[extname(file.path)] === language)
        .slice(0, 5)
        .map((file) => file.path)
    })),
    ...frameworks.map((framework) => ({
      classification: "fact" as const,
      text: `${framework} is declared by the repository.`,
      citations: framework === "Cargo" ? ["Cargo.toml"] : framework === "Go modules" ? ["go.mod"] : ["package.json"]
    })),
    ...(packageManagers.length === 0
      ? [{
          classification: "assumption" as const,
          text: "The package manager still needs confirmation.",
          citations: packageJson ? ["package.json"] : []
        }]
      : []),
    ...(ports.length > 0
      ? [{
          classification: "inference" as const,
          text: `The preview is likely to use port ${ports[0]}.`,
          citations: safeFiles.filter((file) => /port/i.test(safeContent.get(file.path) ?? ""))
            .slice(0, 5)
            .map((file) => file.path)
        }]
      : []),
    ...protectedPaths.map((path) => ({
      classification: "fact" as const,
      text: "A likely secret-bearing file was excluded from grounding.",
      citations: [path]
    })),
    {
      classification: "user_decision" as const,
      text: "The user decides whether to proceed with the recommended starter task.",
      citations: []
    }
  ];

  const sourceDigest = hash(JSON.stringify(citations));
  const body = {
    schemaVersion: 1 as const,
    projectId: input.projectId,
    sourceDigest,
    languages,
    frameworks,
    packageManagers,
    commands,
    ports,
    conventions,
    designTokens,
    protectedPaths: unique([".git", ...protectedPaths]),
    tests,
    readiness,
    unsupportedFeatures,
    missingDependencies,
    resourceRequirements,
    citations,
    statements
  };
  return projectProfileSchema.parse({
    ...body,
    groundingDigest: hash(JSON.stringify(body))
  });
}

export function modelGroundingProjection(profile: unknown): {
  readonly groundingDigest: string;
  readonly statements: readonly GroundingStatement[];
  readonly citations: ProjectProfile["citations"];
} {
  const parsed = projectProfileSchema.parse(profile);
  return {
    groundingDigest: parsed.groundingDigest,
    statements: parsed.statements,
    citations: parsed.citations
  };
}

function redactSecretValues(value: string): string {
  return value.replace(secretValuePattern, "$1=[redacted]");
}

function parsePackageJson(content: string): {
  readonly dependencies: Readonly<Record<string, string>>;
  readonly devDependencies: Readonly<Record<string, string>>;
  readonly scripts: Readonly<Record<string, string>>;
  readonly packageManager: string | null;
} {
  try {
    const parsed = JSON.parse(content) as Record<string, unknown>;
    return {
      dependencies: stringRecord(parsed.dependencies),
      devDependencies: stringRecord(parsed.devDependencies),
      scripts: stringRecord(parsed.scripts),
      packageManager: typeof parsed.packageManager === "string" ? parsed.packageManager : null
    };
  } catch {
    return { dependencies: {}, devDependencies: {}, scripts: {}, packageManager: null };
  }
}

function stringRecord(value: unknown): Readonly<Record<string, string>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string")
  );
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function uniqueNumbers(values: readonly number[]): number[] {
  return [...new Set(values)].sort((left, right) => left - right);
}

function isString(value: string | undefined): value is string {
  return typeof value === "string";
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
