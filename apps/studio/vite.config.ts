import { resolve } from "node:path";

import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig({
  root: resolve(import.meta.dirname),
  plugins: [react(), tailwindcss()],
  build: {
    outDir: resolve(import.meta.dirname, "../../dist/studio"),
    emptyOutDir: true,
    manifest: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (/\/node_modules\/(?:react|react-dom|scheduler)\//.test(id)) return "react-runtime";
          if (/\/node_modules\/(?:react-markdown|remark-|unified|vfile|mdast-|micromark|hast-|unist-|property-information|space-separated-tokens|comma-separated-tokens|decode-named-character-reference|devlop|trough|bail|is-plain-obj|longest-streak|markdown-table|zwitch)(?:\/|-)/.test(id)) return "markdown-runtime";
          return undefined;
        }
      }
    }
  },
  server: {
    host: "127.0.0.1",
    port: 4310,
    strictPort: true
  }
});
