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

// --- The visual layer (docs/DESIGN_LANGUAGE.md) -----------------------------------------------

test("visual layer: fractions are clamped and never NaN; a sparkline spans its box", () => {
  assert.equal(kit.fraction(5, 10), 0.5);
  assert.equal(kit.fraction(15, 10), 1);
  assert.equal(kit.fraction(-3, 10), 0);
  assert.equal(kit.fraction(Number.NaN, 10), 0);
  assert.equal(kit.fraction(3, 0), 0);
  assert.equal(kit.sparkPath([], 100, 20), "");
  assert.equal(kit.sparkPath([4], 100, 20), "M0 10 L100 10", "one point is a flat line");
  const path = kit.sparkPath([0, 5, 10], 100, 20);
  assert.equal(path, "M0.0 20.0 L50.0 10.0 L100.0 0.0", "lowest at the bottom, highest at the top");
  assert.doesNotMatch(kit.sparkPath([1, Number.NaN, 3], 60, 10), /NaN/);
});

test("StatTile: a quiet label, the value in mono, a delta coloured by meaning, a tone through a token", () => {
  const html = render(kit.StatTile, { label: "Active today", value: "2h 57m", delta: { label: "+12%", good: true }, hint: "vs yesterday", tone: "success" });
  assert.match(html, /class="kit-stat"/);
  assert.match(html, /--kit-tone:var\(--success\)/);
  assert.match(html, /kit-stat__label">Active today</);
  assert.match(html, /kit-stat__value">2h 57m</);
  assert.match(html, /kit-stat__delta--good">\+12%</);
  const bad = render(kit.StatTile, { label: "Spent", value: "CA$10", delta: { label: "+40%", good: false } });
  assert.match(bad, /kit-stat__delta--bad/, "more spending is bad news even though the number went up");
  assert.match(render(kit.StatGrid, { columns: 3 }, "x"), /kit-stat-grid--3/);
});

test("Meter and Ring: real progress semantics for assistive tech, clamped fills", () => {
  const meter = render(kit.Meter, { label: "Deep work", value: 3, max: 20, display: "3h of 20h" });
  assert.match(meter, /role="progressbar"/);
  assert.match(meter, /aria-valuenow="15"/);
  assert.match(meter, /aria-label="Deep work"/);
  assert.match(meter, /width:15%/);
  assert.match(meter, /3h of 20h/);
  assert.match(render(kit.Meter, { label: "Over", value: 50, max: 20 }), /width:100%/, "never past the end");
  const ring = render(kit.Ring, { value: 220, max: 300, label: "Level 2, 220 of 300 XP", center: "2", caption: "level" });
  assert.match(ring, /role="img"[^>]*aria-label="Level 2, 220 of 300 XP"/);
  assert.match(ring, /kit-ring__value">2<\/span><span class="kit-ring__caption">level</);
  assert.match(ring, /stroke-dashoffset="[\d.]+"/);
});

test("BarChart and Sparkline carry a text version for screen readers", () => {
  const bars = render(kit.BarChart, { data: [{ label: "0", value: 0 }, { label: "1", value: 30 }, { label: "2", value: 60 }], label: "Hourly activity", labelEvery: 2 });
  assert.match(bars, /aria-label="Hourly activity"/);
  assert.match(bars, /kit-visually-hidden">Hourly activity: 0 0, 1 30, 2 60/);
  assert.match(bars, /height:100%/, "the tallest bar fills the plot");
  assert.match(bars, /height:2%/, "an empty bar is still a sliver, not invisible");
  assert.match(render(kit.Sparkline, { values: [1, 2, 3], label: "Last 7 days" }), /role="img" aria-label="Last 7 days"/);
  const filled = render(kit.Sparkline, { values: [1, 2, 3], label: "Trend", fill: true, height: 40 });
  assert.match(filled, /class="kit-spark kit-spark--fill"/);
  assert.match(filled, /preserveAspectRatio="none"/);
  assert.doesNotMatch(filled, /<svg[^>]* width=/, "fills its container instead of a fixed width");
  assert.match(filled, /vector-effect="non-scaling-stroke"/, "the line keeps its weight when stretched");
});

test("ListRow: a button when it opens something, pressed when selected; a plain row otherwise", () => {
  const action = render(kit.ListRow, { title: "Workshop 3D printer", meta: "Replace nozzle", trailing: "overdue", onClick: noop, selected: true, tone: "error" });
  assert.match(action, /^<button type="button" class="kit-row kit-row--action kit-row--selected"/);
  assert.match(action, /aria-pressed="true"/);
  assert.match(action, /--kit-tone:var\(--error\)/);
  const plain = render(kit.ListRow, { title: "Read only" });
  assert.match(plain, /^<div class="kit-row"/);
  assert.doesNotMatch(plain, /<button/);
});

test("Hero, DashboardGrid and Reveal: one big moment, a 2:1 layout, a staggered entrance that reduced motion turns off", () => {
  const hero = render(kit.Hero, { eyebrow: "Level 7", title: "Builder", visual: "ring", actions: "act" }, "220 XP");
  assert.match(hero, /<section class="kit-hero">/);
  assert.match(hero, /<h2 class="kit-hero__title">Builder<\/h2>/);
  assert.match(hero, /kit-hero__glow" aria-hidden="true"/);
  const dash = render(kit.DashboardGrid, { main: "m", side: "s" });
  assert.match(dash, /kit-dash__main">m<\/div><aside class="kit-dash__side">s<\/aside>/);
  const reveal = render(kit.Reveal, {}, createElement("p", { key: "a" }, "a"), createElement("p", { key: "b" }, "b"));
  assert.match(reveal, /--kit-i:0[\s\S]*--kit-i:1/);
  const css = readSource(join(ui, "kit/kit.css"));
  const reduced = css.slice(css.lastIndexOf("@media (prefers-reduced-motion: reduce)"));
  for (const cls of [".kit-reveal__item", ".kit-meter__fill", ".kit-ring__fill"]) assert.ok(reduced.includes(cls), `${cls} stops under reduced motion`);
  const entrance = css.match(/\.kit-reveal__item \{[^}]*\}/)?.[0] ?? "";
  assert.match(entrance, /animation: kit-rise/);
  assert.doesNotMatch(entrance, /infinite/, "the entrance plays once; nothing loops while idle");
});

test("every module accent is a token, and the newer modules have their own", () => {
  const tokens = readSource(join(desktop, "../../packages/shared-ui/src/tokens.css"));
  for (const name of ["autopilot", "skills", "rpg", "ghost", "object"]) assert.match(tokens, new RegExp(`--accent-${name}: #`), name);
  const meta = readSource(join(desktop, "src/renderer/lib/moduleMeta.ts"));
  for (const [id, token] of [["autopilot", "autopilot"], ["skills", "skills"], ["rpg", "rpg"], ["ghost", "ghost"], ["object", "object"]]) {
    assert.match(meta, new RegExp(`${id}: \\{ icon: \\w+, accent: "var\\(--accent-${token}\\)" \\}`), id);
  }
});
