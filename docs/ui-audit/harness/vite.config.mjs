// UI-audit harness: serves the real renderer with the app's own aliases and
// Tailwind config. Run from apps/desktop (Tailwind's content paths are
// relative to it): npx vite --config ../../docs/ui-audit/harness/vite.config.mjs
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../..");
const desktop = resolve(repoRoot, "apps/desktop");
// Resolved from apps/desktop: this file lives outside any package.
const require = createRequire(resolve(desktop, "package.json"));
const { default: react } = await import(pathToFileURL(require.resolve("@vitejs/plugin-react")).href);

export default {
  root: repoRoot,
  plugins: [react()],
  css: { postcss: { plugins: [require("tailwindcss")({ config: resolve(desktop, "tailwind.config.cjs") }), require("autoprefixer")()] } },
  resolve: {
    alias: {
      // React lives in apps/desktop's node_modules, not the repo root's.
      react: resolve(desktop, "node_modules/react"),
      "react-dom": resolve(desktop, "node_modules/react-dom"),
      "@dexnest/action-registry": resolve(repoRoot, "packages/action-registry/src/index.ts"),
      "@dexnest/shared-types": resolve(repoRoot, "packages/shared-types/src/index.ts"),
      "@dexnest/shared-ui/tokens.css": resolve(repoRoot, "packages/shared-ui/src/tokens.css"),
      "@dexnest/shared-ui/fonts.css": resolve(repoRoot, "packages/shared-ui/src/fonts.css"),
      "@dexnest/module-command": resolve(repoRoot, "modules/command/src/index.tsx"),
      "@dexnest/module-dev": resolve(repoRoot, "modules/dev/src/index.tsx")
    }
  },
  server: { host: "127.0.0.1", port: 5199, strictPort: true, fs: { allow: [repoRoot] } }
};
