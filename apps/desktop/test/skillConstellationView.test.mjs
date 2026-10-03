// Skill Constellation view, rendered.
//
// The real SkillConstellationView.tsx is bundled with the app's own Vite (SSR
// build, React left external) and rendered to markup with react-dom/server,
// once per state, from synthetic data. No Electron, no bridge to the main
// process, no data root. Effects do not run under server rendering, which is
// what lets each state be pinned with the `initial` prop.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "vite";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const desktop = fileURLToPath(new URL("..", import.meta.url));
const viewPath = join(desktop, "src/renderer/views/SkillConstellationView.tsx");
let scratch = "";
let View;

before(async () => {
  // Inside the app's own node_modules so the bundle resolves the app's React.
  const cache = join(desktop, "node_modules", ".cache");
  mkdirSync(cache, { recursive: true });
  scratch = mkdtempSync(join(cache, "skills-view-"));
  await build({
    configFile: false,
    logLevel: "silent",
    root: desktop,
    build: {
      ssr: viewPath,
      outDir: scratch,
      emptyOutDir: true,
      rollupOptions: { external: ["react", "react/jsx-runtime", "react-dom"], output: { format: "es", entryFileNames: "view.mjs" } }
    }
  });
  ({ SkillConstellationView: View } = await import(pathToFileURL(join(scratch, "view.mjs")).href));
});

after(() => {
  if (scratch) rmSync(scratch, { recursive: true, force: true });
});

const never = () => new Promise(() => {});
const bridge = {
  skillConstellationSnapshot: never,
  skillConstellationEvidence: never,
  skillConstellationHistory: never,
  skillConstellationSettings: never,
  skillConstellationUpdateSettings: never
};
const onAction = async () => ({ ok: true });

const staleness = { hasBuild: true, devChanged: false, settingsChanged: false, stale: false, devCursorSeq: 3, latestDevSeq: 3 };
const lastBuild = { id: "b1", occurrenceId: "o", trigger: "manual", status: "completed", startedAt: "2026-06-01T00:00:00.000Z", finishedAt: "2026-06-01T00:00:01.000Z", devCursorSeq: 3, settingsFingerprint: "f", skills: 2, evidence: 3, links: 1, added: 2, lost: 0, refusedPrivate: 0, othersCommits: 0, error: null };
const skill = (id, name, score, extra = {}) => ({
  id, name, category: "language", evidenceCount: 3, repositoryCount: 2, evidenceKinds: 2,
  firstEvidenceAt: "2026-01-01T00:00:00.000Z", lastEvidenceAt: "2026-05-01T00:00:00.000Z", lastActivityAt: null,
  strength: { volume: 0.14, recency: 0.8, variety: 0.45, score }, hidden: false, ...extra
});
const ready = {
  enabled: true,
  skills: [skill("typescript", "TypeScript", 0.7), skill("react", "React", 0.4, { category: "framework" }), skill("go", "Go", 0.2, { hidden: true })],
  links: [{ a: "react", b: "typescript", source: "evidence", sharedRepositoryIds: ["r1"], weight: 0.5 }],
  layout: [{ skillId: "go", x: 700, y: 700 }, { skillId: "react", x: 300, y: 200 }, { skillId: "typescript", x: 500, y: 500 }],
  lastBuild,
  staleness,
  countsAllCommits: true
};
const evidence = [
  { id: "e1", skillId: "typescript", kind: "technology.extension", repositoryId: "r1", repositoryName: "app", path: "src/main.ts", at: "2026-05-01T00:00:00.000Z", sourceRef: "tech_1", detail: "file-extension", todoText: null },
  { id: "e2", skillId: "typescript", kind: "todo.open", repositoryId: "r1", repositoryName: "app", path: "src/router.ts", at: "2026-04-02T00:00:00.000Z", sourceRef: "todo_1", detail: "TODO line 7", todoText: "TODO: tidy the router" },
  { id: "e3", skillId: "typescript", kind: "commit", repositoryId: "r2", repositoryName: "api", path: null, at: "2026-03-03T00:00:00.000Z", sourceRef: "abcdef1234567890", detail: null, todoText: null }
];

const render = (props) => renderToStaticMarkup(createElement(View, { bridge, onAction, ...props }));
const count = (html, needle) => html.split(needle).length - 1;

test("loading: announced as a status, busy, no actions yet", () => {
  const html = render({});
  assert.match(html, /role="status"[^>]*>(?:<[^>]+>)*Loading your constellation…/);
  assert.match(html, /aria-busy="true"/);
  assert.doesNotMatch(html, />Rebuild</);
});

test("error: an alert with the reason and a way to retry", () => {
  const html = render({ initial: { snapshot: null, error: "database is locked" } });
  assert.match(html, /role="alert"/);
  assert.match(html, /database is locked/);
  assert.match(html, /<button type="button" class="kit-button kit-button--ghost kit-button--sm">(?:<[^>]+>)*<\/span>Try again<\/button>/);
});

test("off: explains it reads only Developer Intelligence, and offers to turn on or build once", () => {
  const html = render({ initial: { snapshot: { ...ready, enabled: false, skills: [], layout: [], links: [], lastBuild: null } } });
  assert.match(html, /never scans your disk/);
  assert.match(html, />Turn on</);
  // While it is off, the one-off build says what it does.
  assert.match(html, />Build once</);
  assert.doesNotMatch(html, />Rebuild</);
  assert.doesNotMatch(html, /class="skill-sky"/, "no constellation drawn");
});

test("labels: only the fifteen strongest stars are written, plus the selected one; every star keeps its accessible name", () => {
  const many = Array.from({ length: 30 }, (_, i) => skill(`s${i}`, `Skill ${String(i).padStart(2, "0")}`, 1 - i / 40));
  const snapshot = { ...ready, skills: many, links: [], layout: many.map((m, i) => ({ skillId: m.id, x: 30 * i + 20, y: 500 })) };
  const html = render({ initial: { snapshot, selectedId: "s29" } });
  assert.equal(count(html, 'class="skill-star__label"'), 16);
  assert.match(html, />Skill 00<\/text>/);
  assert.match(html, />Skill 14<\/text>/);
  assert.doesNotMatch(html, />Skill 15<\/text>/);
  assert.match(html, />Skill 29<\/text>/, "the selected star is labelled");
  assert.equal(count(html, 'role="button" tabindex='), 30);
});

test("empty: says why there is nothing and what to do", () => {
  const html = render({ initial: { snapshot: { ...ready, skills: [], layout: [], links: [] } } });
  assert.match(html, /No evidence yet/);
  assert.match(html, /scan your repositories in Developer Intelligence/);
  assert.doesNotMatch(html, /class="skill-sky"/, "no constellation drawn");
});

test("ready: stars are labelled buttons with one tab stop; hidden skills are not drawn", () => {
  const html = render({ initial: { snapshot: ready } });
  // The view fits the stars (300,200)-(700,700 hidden) -> visible (300,200)-(500,500), padded and widened to 16:10.
  assert.match(html, /<svg viewBox="[-\d. ]+" preserveAspectRatio="xMidYMid meet" role="group" aria-label="Skill constellation\. Use the arrow keys/);
  assert.doesNotMatch(html, /viewBox="0 0 1000 1000"/, "the sky is fitted to its stars, not the whole layout");
  // Numbers above the sky, from the visible skills.
  assert.match(html, /kit-stat__label">Skills<\/p><\/div><p class="kit-stat__value">2</);
  assert.match(html, /kit-stat__label">Strongest<\/p><\/div><p class="kit-stat__value">TypeScript</);
  // Stars glow by recency; the dust is decoration only.
  assert.match(html, /class="skill-star__glow" r="[\d.]+" fill-opacity="0.52"/);
  assert.match(html, /<g class="skill-dust" aria-hidden="true">/);
  // With nothing selected, the brightest stars are one click away.
  assert.match(html, /Brightest stars/);
  assert.match(html, /<button type="button" class="kit-row kit-row--action"[^>]*>(?:<[^>]+>)*<\/span><span class="kit-row__text"><span class="kit-row__title">TypeScript</)
  assert.equal([...html.matchAll(/<g class="skill-star[" ]/g)].length, 2, "two visible stars");
  assert.doesNotMatch(html, /aria-label="Go,/, "a hidden skill is not drawn");
  assert.equal(count(html, 'tabindex="0"'), 1, "one star in the tab order (roving)");
  assert.equal(count(html, 'tabindex="-1"'), 1);
  assert.match(html, /role="button"[^>]*aria-label="TypeScript, language, strength 70%, 3 pieces of evidence in 2 repositories"/);
  assert.match(html, /Show 1 hidden skill/);
  assert.match(html, /Every commit counts, because no commit emails are set/);
  assert.match(html, /Select a star to see why it is there/);
});

test("stale: says Developer Intelligence has something newer", () => {
  const html = render({ initial: { snapshot: { ...ready, staleness: { ...staleness, stale: true, devChanged: true } } } });
  assert.match(html, /recorded something new since this was built/);
});

test("a selected star shows why: repositories, files, dates, the numbers behind its strength, and live TODO text", () => {
  const html = render({ initial: { snapshot: ready, selectedId: "typescript", evidence } });
  assert.match(html, /aria-label="TypeScript[^"]*" aria-pressed="true"/);
  assert.match(html, /aria-label="React[^"]*" aria-pressed="false"/);
  assert.match(html, /<h3 id="skill-panel-title">TypeScript<\/h3>/);
  assert.match(html, /role="img" aria-label="TypeScript: strength 70%"/, "strength as a ring a screen reader can read");
  assert.match(html, /aria-label="Evidence in app"/);
  assert.match(html, /aria-label="Evidence in api"/);
  assert.match(html, /src\/main\.ts/);
  assert.match(html, /datetime="2026-04-02T00:00:00.000Z"/i);
  assert.match(html, /<q class="skill-evidence__todo">TODO: tidy the router<\/q>/);
  assert.match(html, /abcdef1234/, "a commit shows its sha, not a subject");
  assert.match(html, /kit-meter__label">Variety<\/span><span class="kit-meter__value">45% · 2 repositories, 2 kinds</);
  assert.match(html, /kit-meter__label">Recency<\/span><span class="kit-meter__value">80% · last 2026-05-01</);
  assert.match(html, /aria-label="Close evidence for TypeScript"/);
});

test("components use design tokens only: no literal colours, fonts from tokens", () => {
  const files = ["SkillConstellationView.tsx", "SkillConstellation.css", "skillConstellationModel.ts"].map((f) =>
    readFileSync(join(desktop, "src/renderer/views", f), "utf8")
  );
  for (const text of files) {
    assert.doesNotMatch(text, /#[0-9a-fA-F]{3,8}\b(?![\w-])/, "no hex colours");
    assert.doesNotMatch(text, /\b(rgb|rgba|hsl|hsla)\s*\(/i, "no rgb/hsl colours");
    assert.doesNotMatch(text, /\b(white|black|red|blue|green|gray|grey)\b\s*[;"'}]/i, "no named colours");
  }
  const css = files[1];
  for (const [, family] of css.matchAll(/font-family:\s*([^;]+);/g)) {
    assert.match(family.trim(), /^var\(--font-(ui|tech)\)$/, `font-family ${family} must be a token`);
  }
  assert.match(css, /var\(--accent-skills\)/, "the module uses its own accent");
});
