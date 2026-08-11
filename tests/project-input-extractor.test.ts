import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { deflateRawSync } from "node:zlib";

import { extractProjectInput } from "../apps/core/src/project-input-extractor.js";

test("format corpus preserves text, table, page, sheet, slide, and visual provenance", async () => {
  const root = join(process.cwd(), `.test-input-extraction-${crypto.randomUUID()}`);
  await mkdir(root, { recursive: true });
  try {
    await writeFile(join(root, "brief.md"), "# Brief\nVerified need.\n");
    await writeFile(join(root, "data.csv"), "name,value\nalpha,1\n");
    await writeFile(join(root, "document.docx"), zip([{ name: "word/document.xml", text: "<w:document><w:t>Document evidence</w:t></w:document>" }]));
    await writeFile(join(root, "book.xlsx"), zip([{ name: "xl/worksheets/sheet1.xml", text: "<worksheet><t>Table evidence</t></worksheet>" }]));
    await writeFile(join(root, "deck.pptx"), zip([{ name: "ppt/slides/slide2.xml", text: "<p:sld><a:t>Slide evidence</a:t></p:sld>" }]));
    await writeFile(join(root, "page.pdf"), "%PDF-1.4\n1 0 obj<</Type /Page>>stream\n(Verified PDF evidence) Tj\nendstream\nendobj\n%%EOF\n", "latin1");
    const png = Buffer.alloc(24); Buffer.from("89504e470d0a1a0a", "hex").copy(png); png.writeUInt32BE(640, 16); png.writeUInt32BE(480, 20); await writeFile(join(root, "screen.png"), png);

    const results = await Promise.all(["brief.md", "data.csv", "document.docx", "book.xlsx", "deck.pptx", "page.pdf", "screen.png"].map((name) => extractProjectInput(join(root, name))));
    assert.equal(results.length, 7);
    const [brief, table, document, book, deck, pdf, image] = results as [Awaited<ReturnType<typeof extractProjectInput>>, Awaited<ReturnType<typeof extractProjectInput>>, Awaited<ReturnType<typeof extractProjectInput>>, Awaited<ReturnType<typeof extractProjectInput>>, Awaited<ReturnType<typeof extractProjectInput>>, Awaited<ReturnType<typeof extractProjectInput>>, Awaited<ReturnType<typeof extractProjectInput>>];
    assert.equal(brief.units[0]?.locator, "lines:1-3");
    assert.equal(table.units[0]?.kind, "table");
    assert.match(document.units[0]?.content ?? "", /Document evidence/);
    assert.equal(book.units[0]?.locator, "sheet:1");
    assert.equal(deck.units[0]?.locator, "slide:2");
    assert.equal(pdf.units[0]?.locator, "page:1");
    assert.equal(image.units[0]?.locator, "frame:0,0,640,480");
    assert.ok(results.every((result) => result.trust === "untrusted_evidence" && /^[a-f0-9]{64}$/.test(result.sourceDigest)));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("unsupported, corrupt, encrypted, unsafe, and expansion-limit inputs fail closed", async () => {
  const root = join(process.cwd(), `.test-input-failures-${crypto.randomUUID()}`);
  await mkdir(root, { recursive: true });
  try {
    await writeFile(join(root, "unknown.bin"), "unknown");
    await writeFile(join(root, "corrupt.pdf"), "%PDF-1.4\nmissing eof", "latin1");
    await writeFile(join(root, "encrypted.pdf"), "%PDF-1.4\n<</Encrypt 2 0 R /Type /Page>>\n%%EOF\n", "latin1");
    await writeFile(join(root, "unsafe.docx"), zip([{ name: "../word/document.xml", text: "unsafe" }]));
    await writeFile(join(root, "bomb.docx"), zip([{ name: "word/document.xml", text: `<w:t>${"a".repeat(510_000)}</w:t>` }]));
    assert.equal((await extractProjectInput(join(root, "unknown.bin"))).status, "unsupported");
    assert.equal((await extractProjectInput(join(root, "corrupt.pdf"))).status, "corrupt");
    assert.equal((await extractProjectInput(join(root, "encrypted.pdf"))).status, "encrypted");
    assert.equal((await extractProjectInput(join(root, "unsafe.docx"))).status, "corrupt");
    assert.equal((await extractProjectInput(join(root, "bomb.docx"))).status, "corrupt");
  } finally { await rm(root, { recursive: true, force: true }); }
});

function zip(entries: Array<{ name: string; text: string }>): Buffer {
  const locals: Buffer[] = []; const central: Buffer[] = []; let localOffset = 0;
  for (const { name, text } of entries) {
    const nameBuffer = Buffer.from(name); const raw = Buffer.from(text); const compressed = deflateRawSync(raw); const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(8, 6); local.writeUInt16LE(8, 8); local.writeUInt32LE(nameBuffer.length, 26);
    const descriptor = Buffer.alloc(16); descriptor.writeUInt32LE(0x08074b50, 0); descriptor.writeUInt32LE(compressed.length, 8); descriptor.writeUInt32LE(raw.length, 12);
    const localRecord = Buffer.concat([local, nameBuffer, compressed, descriptor]); locals.push(localRecord);
    const directory = Buffer.alloc(46); directory.writeUInt32LE(0x02014b50, 0); directory.writeUInt16LE(20, 4); directory.writeUInt16LE(20, 6); directory.writeUInt16LE(8, 8); directory.writeUInt16LE(8, 10); directory.writeUInt32LE(compressed.length, 20); directory.writeUInt32LE(raw.length, 24); directory.writeUInt16LE(nameBuffer.length, 28); directory.writeUInt32LE(localOffset, 42);
    central.push(Buffer.concat([directory, nameBuffer])); localOffset += localRecord.length;
  }
  const centralDirectory = Buffer.concat(central); const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(centralDirectory.length, 12); end.writeUInt32LE(localOffset, 16);
  return Buffer.concat([...locals, centralDirectory, end]);
}
