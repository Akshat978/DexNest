import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const currentDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(currentDir, "../..");

export default defineConfig({
  // Relative asset base so the packaged renderer, loaded via file:// with
  // BrowserWindow.loadFile(dist/renderer/index.html), references ./assets/*.
  // With the default "/" base, file:// resolves /assets/* to the drive root
  // (/D:/assets/*) and the app white-screens. "./" works for the dev server too.
  base: "./",
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
