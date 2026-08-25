import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { certifyOwnerJourney } from "../dist/apps/core/src/owner-journey-certification.js";

const target = join(process.cwd(), "docs", "evidence", "PIPE-622-OWNER-JOURNEY-CERTIFICATION.json");
const receipt = await certifyOwnerJourney();
await mkdir(dirname(target), { recursive: true });
try {
  const previous = JSON.parse(await readFile(target, "utf8"));
  if (previous.certificationId !== receipt.certificationId) {
    const history = join(dirname(target), "history");
    await mkdir(history, { recursive: true });
    await writeFile(join(history, `PIPE-622-${previous.certificationId}.json`), `${JSON.stringify(previous, null, 2)}\n`, { flag: "wx" }).catch((error) => {
      if (error.code !== "EEXIST") throw error;
    });
  }
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
const temporary = `${target}.tmp-${process.pid}`;
await writeFile(temporary, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });
await rename(temporary, target);
process.stdout.write(`Owner journey certified: ${receipt.certificationId.slice(0, 12)} · ${receipt.stages.length} stages · $0 automatic spend\n`);
process.stdout.write(`Receipt: docs/evidence/PIPE-622-OWNER-JOURNEY-CERTIFICATION.json\n`);
process.stdout.write(`Next: ${receipt.nextAction}\n`);
