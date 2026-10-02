// Integration QA phase 3: the shared component set (components/ui). Every
// view's header, buttons, badges, tabs, fields, dialogs and its loading, empty
// and error states come from here. Built with the app's own Vite (SSR, React
// and lucide external), rendered with react-dom/server.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "vite";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// Source files are checked out with CRLF on Windows; the patterns below are written for LF.
const readSource = (path) => readFileSync(path, "utf8").replace(/\r\n/g, "\n");

const desktop = fileURLToPath(new URL("..", import.meta.url));
const ui = join(desktop, "src/renderer/components/ui");
let scratch = "";
let kit;
let chip;

before(async () => {
  const cache = join(desktop, "node_modules", ".cache");
  mkdirSync(cache, { recursive: true });
  scratch = mkdtempSync(join(cache, "shared-ui-"));
  await build({
    configFile: false,
    logLevel: "silent",
    root: desktop,
    build: {
      ssr: true,
      outDir: scratch,
      emptyOutDir: true,
      rollupOptions: {
        input: { kit: join(ui, "kit/index.tsx"), chip: join(ui, "StatusChip.tsx") },
        external: ["react", "react/jsx-runtime", "react-dom", "lucide-react"],
        output: { format: "es", entryFileNames: "[name].mjs" }
      }
    }
  });
  kit = await import(pathToFileURL(join(scratch, "kit.mjs")).href);
  chip = await import(pathToFileURL(join(scratch, "chip.mjs")).href);
});

after(() => {
  if (scratch) rmSync(scratch, { recursive: true, force: true });
});

const render = (type, props, ...children) => renderToStaticMarkup(createElement(type, props, ...children));
const noop = () => undefined;

function filesUnder(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? filesUnder(path) : [path];
  });
}

test("the kit, the status chip and the inline loader use design tokens only", () => {
  const files = [...filesUnder(join(ui, "kit")), join(ui, "StatusChip.tsx"), join(ui, "ModuleLoading.tsx"), join(desktop, "src/renderer/components/ViewErrorBoundary.tsx")];
  for (const file of files) {
    const text = readSource(file);
    assert.doesNotMatch(text, /#[0-9a-fA-F]{3,8}\b(?![\w-])/, `${file}: hex colour`);
    assert.doesNotMatch(text, /\b(rgb|rgba|hsl|hsla)\s*\(/i, `${file}: rgb/hsl colour`);
    for (const [, family] of text.matchAll(/font-family:\s*([^;]+);/g)) assert.match(family.trim(), /^var\(--font-(ui|tech)\)$/, `${file}: ${family}`);
  }
});

test("accent: set once at the root and inherited, so a view's accent reaches every kit component inside it", () => {
  const css = readSource(join(ui, "kit/kit.css"));
  const declarations = [...css.matchAll(/--kit-accent:\s*[^;]+;/g)];
  assert.equal(declarations.length, 1, "only the :root default may set --kit-accent");
  assert.match(css, /:root \{\n  --kit-accent: var\(--accent-dev\);\n\}/);
  assert.deepEqual(kit.accentStyle("search"), { "--kit-accent": "var(--accent-search)" });
  assert.deepEqual(kit.accentStyle("not a token!"), { "--kit-accent": "var(--accent-dev)" });
  // A header without an accent inherits one; with one it sets it.
  assert.match(render(kit.PageHeader, { title: "X" }), /^<header class="kit-header">/);
  assert.match(render(kit.PageHeader, { title: "X", accent: "loop" }), /^<header class="kit-header" style="--kit-accent:var\(--accent-loop\)">/);
});

test("ErrorState: an alert named by its title, with the message, the raw detail and Try again only when it can retry", () => {
  const html = render(kit.ErrorState, { title: "Could not load this module", message: "Could not load local data for Clipboard.", detail: "database is locked", onRetry: noop });
  assert.match(html, /^<section class="kit-error" role="alert" aria-labelledby="([^"]+)">[\s\S]*<h2 id="\1" class="kit-error__title">Could not load this module<\/h2>/);
  assert.match(html, /<p class="kit-error__message">Could not load local data for Clipboard\.<\/p>/);
  assert.match(html, /<p class="kit-error__detail">database is locked<\/p>/);
  assert.match(html, /<button type="button" class="kit-button kit-button--ghost kit-button--sm">[\s\S]*Try again<\/button>/);
  assert.doesNotMatch(render(kit.ErrorState, { message: "x" }), /Try again|kit-error__actions/);
});

test("LoadingState: a busy status with a visible label and skeleton blocks; with a delay, nothing at first", () => {
  const html = render(kit.LoadingState, { label: "Loading GhostOS", rows: 4 });
  assert.match(html, /^<div class="kit-loading" role="status" aria-live="polite" aria-busy="true">/);
  assert.match(html, /<p class="kit-loading__label">Loading GhostOS…<\/p>/);
  assert.equal((html.match(/class="kit-skeleton"/g) ?? []).length, 4);
  assert.doesNotMatch(html, /kit-loading__header/);
  assert.match(render(kit.LoadingState, { header: true }), /kit-loading__header/);
  assert.equal(render(kit.LoadingState, { delayMs: 150 }), "");
});

test("ConfirmDialog: an alert dialog with the question, what happens, Cancel and the action; a refusal shows inside it", () => {
  const html = render(kit.ConfirmDialog, { title: "Forget this entry?", confirmLabel: "Forget", onConfirm: noop, onCancel: noop, error: "Forget in GhostOS requires confirmation.", accent: "search" }, "Its 3 connections go too.");
  assert.match(html, /<div class="kit-backdrop" style="--kit-accent:var\(--accent-search\)">/);
  assert.match(html, /role="alertdialog" aria-modal="true" aria-labelledby="([^"]+)" aria-describedby="([^"]+)">[\s\S]*<h2 id="\1" class="kit-dialog__title">Forget this entry\?<\/h2><p id="\2" class="kit-dialog__description">Its 3 connections go too\.<\/p>/);
  assert.match(html, /<p class="kit-inline-error" role="alert">Forget in GhostOS requires confirmation\.<\/p>/);
  assert.match(html, /class="kit-button kit-button--ghost kit-button--md kit-confirm__cancel">Cancel<\/button>/);
  assert.match(html, /class="kit-button kit-button--danger kit-button--md kit-confirm__ok">Forget<\/button>/);
  assert.doesNotMatch(html, /kit-dialog__body/);
  // Busy: the action stays focusable but says why it can't be pressed.
  assert.match(render(kit.ConfirmDialog, { title: "t", confirmLabel: "Go", destructive: false, busy: true, onConfirm: noop, onCancel: noop }), /class="kit-button kit-button--primary kit-button--md kit-button--unavailable kit-confirm__ok" aria-disabled="true" title="Working…">Go<\/button>/);
});

test("form controls: one input style; selects draw a token chevron; a field labels its control", () => {
  assert.equal(render(kit.TextInput, { type: "date", value: "2026-10-02", onChange: noop }), '<input class="kit-input" type="date" value="2026-10-02"/>');
  assert.match(render(kit.Select, { value: "a", onChange: noop }, createElement("option", { value: "a" }, "A")), /^<select class="kit-input kit-select">/);
  assert.match(render(kit.TextArea, {}), /^<textarea class="kit-input kit-textarea">/);
  assert.equal(render(kit.Field, { label: "Name", hint: "Required" }, createElement(kit.TextInput, {})), '<label class="kit-field"><span class="kit-field__label">Name</span><input class="kit-input"/><span class="kit-field__hint">Required</span></label>');
  assert.equal(render(kit.Field, { label: "Tags", hint: "Separate with commas.", htmlFor: "f-tags" }, createElement(kit.TextInput, { id: "f-tags", "aria-describedby": "f-tags-hint" })), '<div class="kit-field"><label for="f-tags" class="kit-field__label">Tags</label><input class="kit-input" id="f-tags" aria-describedby="f-tags-hint"/><span class="kit-field__hint" id="f-tags-hint">Separate with commas.</span></div>');
  const css = readSource(join(ui, "kit/kit.css"));
  assert.match(css, /\.kit-select \{\n  appearance: none;/);
});

test("StatusChip is the kit badge: the old tone names map to token tones, no inline colour", () => {
  const cases = { ready: "success", running: "info", paused: "warning", locked: "error", unlocked: "success", error: "error", offline: "neutral", warn: "warning", ok: "success", info: "info" };
  for (const [tone, kitTone] of Object.entries(cases)) {
    const html = render(chip.StatusChip, { tone });
    assert.match(html, new RegExp(`^<span data-testid="status-chip-${tone}" class="kit-badge kit-badge--${kitTone}">`), tone);
    assert.doesNotMatch(html, /style=/, tone);
  }
  assert.match(render(chip.StatusChip, { tone: "running", pulse: true }, "Multi-copy active"), /class="kit-badge kit-badge--info kit-badge--pulse"><span class="kit-badge__dot" aria-hidden="true"><\/span>Multi-copy active<\/span>/);
  assert.doesNotMatch(render(chip.StatusChip, { dot: false }), /kit-badge__dot/);
});

test("views take tabs and view switchers from the kit: no hand-made tablist outside it (Autopilot is listed for local review)", () => {
  const renderer = join(desktop, "src/renderer");
  // Compared with forward slashes, so the exclusions hold on Windows paths too.
  const files = filesUnder(renderer).filter((f) => {
    const path = f.split("\\").join("/");
    return /\.tsx$/.test(path) && !path.includes("/components/ui/kit/") && !/\/views\/Autopilot[A-Za-z]*\.tsx$/.test(path);
  });
  for (const file of files) {
    assert.doesNotMatch(readSource(file), /role="tablist"/, file);
  }
  const main = readSource(join(renderer, "main.tsx"));
  assert.match(main, /<Segmented label="Utilities section" value=\{tab\} onChange=\{setTab\} options=\{UTILITIES_TABS\} \/>/);
  assert.match(main, /<Segmented\s+label="Timetable view"\s+value=\{mode\}\s+options=\{TIMETABLE_MODES\}/);
  assert.match(main, /<Segmented label="Calendar view" value=\{viewMode\} onChange=\{setViewMode\} options=\{CALENDAR_VIEW_MODES\} \/>/);
});

test("tabs can wrap onto a second row; without wrap they stay one scrolling row", () => {
  const tabs = [{ id: "a", label: "A" }, { id: "b", label: "B" }];
  assert.match(render(kit.Tabs, { label: "T", idPrefix: "t", value: "a", onChange: noop, tabs, wrap: true }), /^<div class="kit-tabs kit-tabs--wrap" role="tablist"/);
  assert.match(render(kit.Tabs, { label: "T", idPrefix: "t", value: "a", onChange: noop, tabs }), /^<div class="kit-tabs" role="tablist"/);
  assert.match(readSource(join(ui, "kit/kit.css")), /\.kit-tabs--wrap \{\n  flex-wrap: wrap;\n  overflow-x: visible;\n\}/);
});
