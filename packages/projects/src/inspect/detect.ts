// What a folder's own files say about the project: package manager,
// framework, scripts worth offering as commands, likely dev ports. Pure:
// the inspector reads the few files and passes their text in.

import type { CommandSlot, ProjectCommand } from "../domain/project.ts";

export interface PackageJson {
  name?: unknown;
  description?: unknown;
  packageManager?: unknown;
  scripts?: unknown;
  dependencies?: unknown;
  devDependencies?: unknown;
}

export function parsePackageJson(text: string | null): { ok: true; value: PackageJson } | { ok: false; reason: string } | null {
  if (text === null) return null;
  try {
    const value = JSON.parse(text.replace(/^﻿/, "")) as unknown;
    if (typeof value !== "object" || value === null || Array.isArray(value)) return { ok: false, reason: "package.json is not an object" };
    return { ok: true, value: value as PackageJson };
  } catch {
    return { ok: false, reason: "package.json is not valid JSON" };
  }
}

function record(value: unknown): Record<string, string> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(value)) if (typeof v === "string") out[k] = v;
  return out;
}

export type PackageManager = "pnpm" | "yarn" | "npm" | "bun";

/** `packageManager` in package.json wins; otherwise the lockfile in the folder. */
export function detectPackageManager(pkg: PackageJson | null, files: ReadonlySet<string>): PackageManager | null {
  const field = typeof pkg?.packageManager === "string" ? pkg.packageManager.split("@")[0] : "";
  if (field === "pnpm" || field === "yarn" || field === "npm" || field === "bun") return field;
  if (files.has("pnpm-lock.yaml")) return "pnpm";
  if (files.has("yarn.lock")) return "yarn";
  if (files.has("bun.lockb") || files.has("bun.lock")) return "bun";
  if (files.has("package-lock.json")) return "npm";
  return pkg ? "npm" : null;
}

const JS_FRAMEWORKS: ReadonlyArray<[string, string, number | null]> = [
  // [dependency, framework, default dev port]
  ["next", "Next.js", 3000],
  ["nuxt", "Nuxt", 3000],
  ["@sveltejs/kit", "SvelteKit", 5173],
  ["@remix-run/dev", "Remix", 3000],
  ["astro", "Astro", 4321],
  ["@angular/core", "Angular", 4200],
  ["@tauri-apps/api", "Tauri", null],
  ["electron", "Electron", null],
  ["@nestjs/core", "NestJS", 3000],
  ["expo", "Expo", 8081],
  ["react-native", "React Native", 8081],
  ["vite", "Vite", 5173],
  ["express", "Express", null],
  ["fastify", "Fastify", null],
  ["react", "React", null],
  ["vue", "Vue", null],
  ["svelte", "Svelte", null]
];

export interface FrameworkGuess {
  framework: string | null;
  defaultPort: number | null;
}

export function detectFramework(pkg: PackageJson | null, files: ReadonlySet<string>): FrameworkGuess {
  if (pkg) {
    const deps = { ...record(pkg.dependencies), ...record(pkg.devDependencies) };
    for (const [dep, framework, port] of JS_FRAMEWORKS) if (dep in deps) return { framework, defaultPort: port };
    return { framework: "Node.js", defaultPort: null };
  }
  if (files.has("Cargo.toml")) return { framework: "Rust", defaultPort: null };
  if (files.has("go.mod")) return { framework: "Go", defaultPort: null };
  if (files.has("pyproject.toml") || files.has("requirements.txt") || files.has("setup.py")) return { framework: "Python", defaultPort: null };
  if ([...files].some((f) => f.endsWith(".sln") || f.endsWith(".csproj"))) return { framework: ".NET", defaultPort: null };
  if (files.has("pubspec.yaml")) return { framework: "Flutter", defaultPort: null };
  return { framework: null, defaultPort: null };
}

const RISKY_SCRIPT = /deploy|publish|release|clean|reset|nuke|drop|destroy|prune|rm\b/i;

const SLOT_SCRIPTS: ReadonlyArray<[CommandSlot, readonly string[]]> = [
  ["start", ["dev", "start", "serve"]],
  ["build", ["build"]],
  ["test", ["test"]],
  ["typecheck", ["typecheck", "type-check", "check-types", "tsc"]]
];

export interface SuggestedCommands {
  commands: Partial<Record<CommandSlot, string>>;
  commandList: ProjectCommand[];
}

export function runScript(pm: PackageManager, script: string): string {
  return `${pm} run ${script}`;
}

/** Scripts become suggested commands: well-known names fill the slots, a few others the list. */
export function suggestCommands(pkg: PackageJson | null, pm: PackageManager | null, limit = 8): SuggestedCommands {
  const scripts = record(pkg?.scripts);
  const names = Object.keys(scripts);
  const out: SuggestedCommands = { commands: {}, commandList: [] };
  if (!pm || names.length === 0) return out;
  const used = new Set<string>();
  for (const [slot, candidates] of SLOT_SCRIPTS) {
    const hit = candidates.find((c) => names.includes(c));
    if (hit) {
      out.commands[slot] = runScript(pm, hit);
      used.add(hit);
    }
  }
  for (const name of names) {
    if (out.commandList.length >= limit) break;
    if (used.has(name) || /^(pre|post)/.test(name)) continue;
    const id = name.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "script";
    if (out.commandList.some((c) => c.id === id)) continue;
    out.commandList.push({ id, label: name, command: runScript(pm, name), requiresConfirmation: RISKY_SCRIPT.test(name) || RISKY_SCRIPT.test(scripts[name]) });
  }
  return out;
}

/** Ports mentioned in scripts, a vite config or .env.example (never .env), plus the framework's default. */
export function detectPorts(sources: { scripts?: unknown; viteConfig?: string | null; envExample?: string | null; defaultPort: number | null }): number[] {
  const found: number[] = [];
  const add = (raw: string | undefined) => {
    const n = Number(raw);
    if (Number.isInteger(n) && n >= 1 && n <= 65535 && !found.includes(n)) found.push(n);
  };
  for (const script of Object.values(record(sources.scripts))) {
    for (const m of script.matchAll(/(?:--port[= ]|-p\s+|PORT=)(\d{2,5})\b/g)) add(m[1]);
  }
  for (const m of (sources.viteConfig ?? "").matchAll(/\bport\s*:\s*(\d{2,5})\b/g)) add(m[1]);
  for (const m of (sources.envExample ?? "").matchAll(/^\s*(?:[A-Z_]*PORT)\s*=\s*(\d{2,5})\s*$/gm)) add(m[1]);
  if (found.length === 0 && sources.defaultPort !== null) add(String(sources.defaultPort));
  return found.slice(0, 5);
}

export function displayNameFromPackage(name: unknown): string | null {
  if (typeof name !== "string" || !name.trim()) return null;
  const trimmed = name.trim();
  return trimmed.startsWith("@") && trimmed.includes("/") ? trimmed.slice(trimmed.indexOf("/") + 1) : trimmed;
}
