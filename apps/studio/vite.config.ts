import { resolve } from "node:path";

import { defineConfig } from "vite";

export default defineConfig({
  root: resolve(import.meta.dirname),
  build: {
    outDir: resolve(import.meta.dirname, "../../dist/studio"),
    emptyOutDir: true
  },
  server: {
    host: "127.0.0.1",
    port: 4310,
    strictPort: true
  }
});
