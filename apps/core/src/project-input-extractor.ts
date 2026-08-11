import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import { inflateRawSync } from "node:zlib";

export type InputEvidenceUnit = {
  kind: "text" | "table" | "visual";
  locator: string;
  content: string;
  confidence: "high" | "medium" | "low";
};

export type InputExtraction = {
  schemaVersion: 1;
  status: "extracted" | "unsupported" | "encrypted" | "corrupt" | "limit_exceeded";
  mediaType: string;
  sourceDigest: string;
  bytes: number;
  units: InputEvidenceUnit[];
  warning: string | null;
  trust: "untrusted_evidence";
};

const MAX_BYTES = 5_000_000;
const MAX_OUTPUT = 500_000;
const MAX_ARCHIVE_ENTRIES = 500;
const TEXT_EXTENSIONS = new Set([".txt", ".md", ".csv", ".tsv", ".json", ".yaml", ".yml"]);

export async function extractProjectInput(path: string): Promise<InputExtraction> {
  const buffer = await readFile(path);
  const extension = extname(path).toLowerCase();
  const base = { schemaVersion: 1 as const, sourceDigest: createHash("sha256").update(buffer).digest("hex"), bytes: buffer.length, trust: "untrusted_evidence" as const };
  if (buffer.length > MAX_BYTES) return { ...base, status: "limit_exceeded", mediaType: "application/octet-stream", units: [], warning: "The file exceeds the local extraction limit." };
  try {
    if (TEXT_EXTENSIONS.has(extension)) return extractText(buffer, extension, base);
    if (extension === ".pdf") return extractPdf(buffer, base);
    if ([".docx", ".xlsx", ".pptx"].includes(extension)) return extractOffice(buffer, extension, base);
    if ([".png", ".jpg", ".jpeg", ".webp"].includes(extension)) return extractImage(buffer, extension, base);
    return { ...base, status: "unsupported", mediaType: "application/octet-stream", units: [], warning: "This file format is not supported." };
  } catch {
    return { ...base, status: "corrupt", mediaType: mediaTypeFor(extension), units: [], warning: "The file is corrupt or could not be read safely." };
  }
}

function extractText(buffer: Buffer, extension: string, base: Omit<InputExtraction, "status" | "mediaType" | "units" | "warning">): InputExtraction {
  if (buffer.includes(0)) throw new Error("binary");
  const content = buffer.toString("utf8").slice(0, MAX_OUTPUT);
  if (extension === ".json") JSON.parse(content);
  const lines = content.split(/\r?\n/);
  const kind = extension === ".csv" || extension === ".tsv" ? "table" as const : "text" as const;
  return { ...base, status: "extracted", mediaType: mediaTypeFor(extension), units: [{ kind, locator: `lines:1-${Math.max(1, lines.length)}`, content, confidence: "high" }], warning: buffer.length > MAX_OUTPUT ? "Extraction was truncated at the safe output limit." : null };
}

function extractPdf(buffer: Buffer, base: Omit<InputExtraction, "status" | "mediaType" | "units" | "warning">): InputExtraction {
  const source = buffer.toString("latin1");
  if (!source.startsWith("%PDF-")) throw new Error("signature");
  if (/\/Encrypt\b/.test(source)) return { ...base, status: "encrypted", mediaType: "application/pdf", units: [], warning: "Encrypted PDFs must be unlocked before import." };
  if (!/%%EOF\s*$/.test(source)) throw new Error("truncated");
  const pages = source.split(/\/Type\s*\/Page\b/).slice(1);
  const units = pages.map((page, index) => ({ kind: "text" as const, locator: `page:${index + 1}`, content: [...page.matchAll(/\(([^()]*)\)\s*Tj/g)].map((match) => decodePdfLiteral(match[1] ?? "")).join(" ").slice(0, 20_000), confidence: "medium" as const })).filter((unit) => unit.content);
  return { ...base, status: "extracted", mediaType: "application/pdf", units, warning: units.length === 0 ? "No safely extractable text was found; scanned pages require a local OCR worker." : null };
}

function extractOffice(buffer: Buffer, extension: string, base: Omit<InputExtraction, "status" | "mediaType" | "units" | "warning">): InputExtraction {
  const entries = readZipEntries(buffer);
  const patterns = extension === ".docx" ? [/^word\/document\.xml$/] : extension === ".xlsx" ? [/^xl\/sharedStrings\.xml$/, /^xl\/worksheets\/sheet\d+\.xml$/] : [/^ppt\/slides\/slide\d+\.xml$/];
  const selected = entries.filter((entry) => patterns.some((pattern) => pattern.test(entry.name)));
  if (selected.length === 0) throw new Error("missing document parts");
  const units = selected.map((entry) => {
    const xml = entry.content.toString("utf8");
    const content = [...xml.matchAll(/<(?:w:t|a:t|t)(?:\s[^>]*)?>([\s\S]*?)<\//g)].map((match) => decodeXml(match[1] ?? "")).join(" ").slice(0, 50_000);
    const locator = extension === ".docx" ? "document:body" : extension === ".xlsx" ? `sheet:${entry.name.match(/sheet(\d+)/)?.[1] ?? "shared"}` : `slide:${entry.name.match(/slide(\d+)/)?.[1] ?? "1"}`;
    return { kind: extension === ".xlsx" ? "table" as const : "text" as const, locator, content, confidence: "high" as const };
  }).filter((unit) => unit.content);
  return { ...base, status: "extracted", mediaType: mediaTypeFor(extension), units, warning: null };
}

function extractImage(buffer: Buffer, extension: string, base: Omit<InputExtraction, "status" | "mediaType" | "units" | "warning">): InputExtraction {
  const dimensions = imageDimensions(buffer, extension);
  return { ...base, status: "extracted", mediaType: mediaTypeFor(extension), units: [{ kind: "visual", locator: `frame:0,0,${dimensions.width},${dimensions.height}`, content: `Raster image, ${dimensions.width} × ${dimensions.height} pixels. Visual meaning requires an approved local or privacy-permitted vision model.`, confidence: "high" }], warning: null };
}

function readZipEntries(buffer: Buffer): Array<{ name: string; content: Buffer }> {
  if (buffer.length < 22 || buffer.readUInt32LE(0) !== 0x04034b50) throw new Error("zip signature");
  const eocdOffset = findEndOfCentralDirectory(buffer);
  const entryCount = buffer.readUInt16LE(eocdOffset + 10);
  const centralSize = buffer.readUInt32LE(eocdOffset + 12);
  const centralOffset = buffer.readUInt32LE(eocdOffset + 16);
  if (entryCount > MAX_ARCHIVE_ENTRIES || centralOffset + centralSize > eocdOffset) throw new Error("invalid central directory");
  const entries: Array<{ name: string; content: Buffer }> = [];
  let offset = centralOffset;
  let outputBytes = 0;
  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > eocdOffset || buffer.readUInt32LE(offset) !== 0x02014b50) throw new Error("central directory entry");
    const flags = buffer.readUInt16LE(offset + 8); const method = buffer.readUInt16LE(offset + 10);
    if ((flags & 1) !== 0) throw new Error("encrypted zip");
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28); const extraLength = buffer.readUInt16LE(offset + 30); const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const nameEnd = offset + 46 + nameLength;
    if (nameEnd + extraLength + commentLength > eocdOffset || localOffset + 30 > centralOffset || buffer.readUInt32LE(localOffset) !== 0x04034b50) throw new Error("invalid archive layout");
    const name = buffer.subarray(offset + 46, nameEnd).toString("utf8");
    if (name.includes("..") || name.startsWith("/") || name.includes("\\")) throw new Error("unsafe archive path");
    const localNameLength = buffer.readUInt16LE(localOffset + 26); const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength; const dataEnd = dataStart + compressedSize;
    if (dataEnd > centralOffset) throw new Error("invalid archive data");
    const compressed = buffer.subarray(dataStart, dataEnd); const content = method === 0 ? Buffer.from(compressed) : method === 8 ? inflateRawSync(compressed) : (() => { throw new Error("compression"); })();
    if (content.length !== uncompressedSize) throw new Error("archive size mismatch");
    outputBytes += content.length; if (outputBytes > MAX_OUTPUT) throw new Error("archive expansion limit");
    entries.push({ name, content }); offset = nameEnd + extraLength + commentLength;
  }
  if (offset !== centralOffset + centralSize) throw new Error("central directory size mismatch");
  return entries;
}

function findEndOfCentralDirectory(buffer: Buffer): number {
  const minimum = Math.max(0, buffer.length - 65_557);
  for (let offset = buffer.length - 22; offset >= minimum; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50 && offset + 22 + buffer.readUInt16LE(offset + 20) === buffer.length) return offset;
  }
  throw new Error("missing end of central directory");
}

function imageDimensions(buffer: Buffer, extension: string): { width: number; height: number } {
  if (extension === ".png") { if (buffer.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") throw new Error("png"); return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) }; }
  if (extension === ".webp") { if (buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WEBP") throw new Error("webp"); const chunk = buffer.toString("ascii", 12, 16); if (chunk !== "VP8X") throw new Error("webp layout"); return { width: 1 + buffer.readUIntLE(24, 3), height: 1 + buffer.readUIntLE(27, 3) }; }
  if (buffer[0] !== 0xff || buffer[1] !== 0xd8) throw new Error("jpeg");
  let offset = 2; while (offset + 9 < buffer.length) { if (buffer[offset] !== 0xff) { offset += 1; continue; } const marker = buffer[offset + 1] ?? 0; const length = buffer.readUInt16BE(offset + 2); if ([0xc0, 0xc1, 0xc2].includes(marker)) return { height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) }; offset += 2 + length; }
  throw new Error("jpeg dimensions");
}

function mediaTypeFor(extension: string): string { return ({ ".txt":"text/plain", ".md":"text/markdown", ".csv":"text/csv", ".tsv":"text/tab-separated-values", ".json":"application/json", ".yaml":"application/yaml", ".yml":"application/yaml", ".pdf":"application/pdf", ".docx":"application/vnd.openxmlformats-officedocument.wordprocessingml.document", ".xlsx":"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ".pptx":"application/vnd.openxmlformats-officedocument.presentationml.presentation", ".png":"image/png", ".jpg":"image/jpeg", ".jpeg":"image/jpeg", ".webp":"image/webp" } as Record<string,string>)[extension] ?? "application/octet-stream"; }
function decodeXml(value: string): string { return value.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/&quot;/g, "\"").replace(/&#39;/g, "'").replace(/<[^>]+>/g, "").trim(); }
function decodePdfLiteral(value: string): string { return value.replace(/\\([()\\])/g, "$1").replace(/\\n/g, " ").replace(/\\r/g, " ").trim(); }
