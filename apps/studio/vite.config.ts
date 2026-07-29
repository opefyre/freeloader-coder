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
          return id.includes("/node_modules/react") ? "react-runtime" : undefined;
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
