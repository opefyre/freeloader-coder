import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Providers mounts the interactive expanded provider mesh", async () => {
  const app = await readFile("apps/studio/src/App.tsx", "utf8");
  assert.match(app, /import\("\.\/components\/providers\/expanded-provider-mesh\.js"\)/);
  assert.match(app, /<ExpandedProviderMesh \/>/);
});

test("expanded mesh exposes interactive evidence, sources, and honest access classes", async () => {
  const component = await readFile(
    "apps/studio/src/components/providers/expanded-provider-mesh.tsx",
    "utf8"
  );
  for (const provider of ["NVIDIA NIM", "Mistral", "Zhipu GLM", "SambaNova", "Hugging Face"]) {
    assert.match(component, new RegExp(provider));
  }
  assert.doesNotMatch(component, /Cerebras/);
  assert.match(component, /Interactive demo/);
  assert.match(component, /Developer Program/);
  assert.match(component, /Explicit free model/);
  assert.match(component, /Scheduled, not retried/);
  assert.match(component, /aria-label="Provider simulation"/);
  assert.match(component, /Dashboard <ArrowSquareOut/);
  assert.match(component, /Source <ArrowSquareOut/);
  assert.match(component, /opefyre\.atlassian\.net\/browse/);
});

test("expanded mesh remains responsive and uses the shared visual system", async () => {
  const component = await readFile(
    "apps/studio/src/components/providers/expanded-provider-mesh.tsx",
    "utf8"
  );
  assert.match(component, /sm:grid-cols-2/);
  assert.match(component, /2xl:grid-cols/);
  assert.match(component, /min-w-0/);
  assert.match(component, /@phosphor-icons/);
  assert.doesNotMatch(component, /linear-gradient|radial-gradient|from-\w+|to-\w+/);
});
