import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const currentDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(currentDir, "../..");

export default defineConfig({
  resolve: {
    alias: {
      "@dexnest/action-registry": resolve(repoRoot, "packages/action-registry/src/index.ts"),
      "@dexnest/autopilot-runtime": resolve(repoRoot, "packages/autopilot-runtime/src/index.ts"),
      "@dexnest/local-db": resolve(repoRoot, "packages/local-db/src/index.ts"),
      "@dexnest/module-deck": resolve(repoRoot, "modules/deck/src/index.ts"),
      "@dexnest/shared-types": resolve(repoRoot, "packages/shared-types/src/index.ts")
    }
  },
  build: {
    emptyOutDir: false,
    outDir: "dist/main",
    ssr: true,
    rollupOptions: {
      input: {
        main: resolve(currentDir, "src/main/main.ts"),
        preload: resolve(currentDir, "src/main/preload.ts")
      },
      // heic-decode (and libheif-js under it) stays a separate module: it is
      // several megabytes loaded only when a HEIC photo is opened, and its
      // LGPL licence asks that it can be swapped without rebuilding DexNest.
      external: ["electron", "better-sqlite3", "heic-decode"],
      output: {
        entryFileNames: "[name].cjs",
        format: "cjs"
      }
    },
    target: "node22"
  }
});
