import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const currentDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(currentDir, "../..");

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@dexnest/action-registry": resolve(repoRoot, "packages/action-registry/src/index.ts"),
      "@dexnest/shared-types": resolve(repoRoot, "packages/shared-types/src/index.ts"),
      "@dexnest/shared-ui/tokens.css": resolve(repoRoot, "packages/shared-ui/src/tokens.css"),
      "@dexnest/module-command": resolve(repoRoot, "modules/command/src/index.tsx"),
      "@dexnest/module-dev": resolve(repoRoot, "modules/dev/src/index.tsx")
    }
  },
  build: {
    outDir: "dist/renderer",
    emptyOutDir: false
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true
  }
});
