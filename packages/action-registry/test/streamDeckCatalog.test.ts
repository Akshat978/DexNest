/**
 * What ends up on the hardware.
 *
 * The catalog is generated from saved projects, so the bugs it can have are
 * about which buttons appear for which configuration rather than about any one
 * button working. A project whose test command exists but has no button is
 * indistinguishable, from the deck, from a project that has no test command.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { createStreamDeckActionCatalog, seededActions, streamDeckCatalogItems } from "../src/index.ts";

const devGroup = (projects: Parameters<typeof createStreamDeckActionCatalog>[0]) =>
  createStreamDeckActionCatalog(projects).find(group => group.id === "dev")!;

const project = (over: Record<string, unknown> = {}) => ({
  id: "p1",
  name: "DexNest",
  commands: { start: "pnpm dev" },
  ...over
});

test("every configured command becomes a button", () => {
  const items = devGroup([project({
    commands: { start: "pnpm dev", build: "pnpm build", test: "pnpm test", typecheck: "pnpm typecheck", custom: "pnpm lint" }
  })]).items;
  const ids = items.map(item => item.actionId);
  for (const key of ["start", "build", "test", "typecheck", "custom"]) {
    assert.ok(ids.includes(`dev.project.p1.run_${key}`), `${key} has no button`);
  }
});

test("an unconfigured command produces no button rather than a blank one", () => {
  // Four placeholders per project, for commands most projects never define,
  // would bury the real buttons under cards that do nothing.
  const items = devGroup([project()]).items;
  const files = items.map(item => item.file);
  assert.ok(!files.includes("build-p1"));
  assert.ok(!files.includes("test-p1"));
});

test("a missing start command still gets a placeholder", () => {
  // Start is the command a Dev project is expected to have, so its absence is
  // worth a card that says to configure it.
  const items = devGroup([project({ commands: {} })]).items;
  const start = items.find(item => item.file === "start-p1")!;
  assert.equal(start.placeholder, true);
  assert.equal(start.actionId, undefined);
});

test("every project gets a push button", () => {
  const push = devGroup([project()]).items.find(item => item.file === "push-p1")!;
  assert.equal(push.actionId, "dev.project.p1.git_push");
  // Someone pressing "Push" expects their current work to go, and what
  // actually goes is whatever was already committed. The card is the only
  // place that can say so before the press.
  assert.match(push.note ?? "", /Never commits, never forces/);
});

test("the push button carries no pre-confirmation", () => {
  // Stop pre-confirms because it is a danger-level action that would otherwise
  // be unpressable. Push must not acquire that shape by imitation: it is
  // caution-level precisely because it refuses rather than asks.
  const push = devGroup([project()]).items.find(item => item.file === "push-p1")!;
  assert.deepEqual(push.params, {});
});

test("the all-projects status button leads the group", () => {
  const items = devGroup([project()]).items;
  assert.equal(items[0]!.file, "git-status-all");
  assert.equal(items[0]!.actionId, "dev.git_status_all");
});

test("with no projects there is no status button to press", () => {
  // It would report on nothing, and a button that always says "no projects" is
  // a button that teaches you to ignore it.
  const items = devGroup([]).items;
  assert.equal(items.length, 1);
  assert.equal(items[0]!.placeholder, true);
});

test("every generated button names an action that exists or is a placeholder", () => {
  // A card pointing at an unregistered id fails at press time with nothing to
  // read. Project actions are generated per project and so are matched by
  // shape; everything else must be in the registry.
  const registry = new Set(seededActions.map(action => action.id));
  const items = streamDeckCatalogItems(createStreamDeckActionCatalog([project({
    commands: { start: "a", build: "b", test: "c", typecheck: "d", custom: "e" }
  })]));
  for (const item of items) {
    if (item.placeholder || !item.actionId) continue;
    if (/^dev\.project\.[a-z0-9-]+\./.test(item.actionId)) continue;
    assert.ok(registry.has(item.actionId), `${item.actionId} is not a registered action`);
  }
});


// --- labelled commands --------------------------------------------------------

test("each labelled command becomes its own card", () => {
  // The reason commandList exists: the five fixed slots cannot name a
  // migration, a seed or a deploy, and those are the commands most worth a
  // physical button.
  const items = devGroup([project({
    commandList: [
      { id: "c1", label: "Migrate", command: "pnpm db:migrate" },
      { id: "c2", label: "Seed", command: "pnpm db:seed" }
    ]
  })]).items;
  const migrate = items.find(item => item.file === "cmd-p1-c1")!;
  assert.equal(migrate.actionId, "dev.project.p1.run_cmd_c1");
  assert.equal(migrate.title, "DexNest: Migrate");
  assert.ok(items.some(item => item.file === "cmd-p1-c2"));
});

test("a card is addressed by id, not by position", () => {
  // Removing an entry must not silently repoint the cards below it at a
  // different command while their faces stay the same.
  const before = devGroup([project({
    commandList: [
      { id: "c1", label: "Migrate", command: "pnpm db:migrate" },
      { id: "c2", label: "Deploy", command: "pnpm deploy" }
    ]
  })]).items.find(item => item.file === "cmd-p1-c2")!;
  const after = devGroup([project({
    commandList: [{ id: "c2", label: "Deploy", command: "pnpm deploy" }]
  })]).items.find(item => item.file === "cmd-p1-c2")!;
  assert.equal(before.actionId, after.actionId);
});

test("a command needing confirmation is pre-confirmed on the card, and says so", () => {
  // An HTTP caller has no dialog to answer, so without this the button would
  // refuse every press. The note is the only warning that survives to the deck.
  const card = devGroup([project({
    commandList: [{ id: "c1", label: "Reset", command: "git reset --hard", requiresConfirmation: true }]
  })]).items.find(item => item.file === "cmd-p1-c1")!;
  assert.deepEqual(card.params, { confirmedDangerous: true });
  assert.match(card.note ?? "", /without asking/);
});

test("an incomplete entry produces no card", () => {
  const items = devGroup([project({
    commandList: [
      { id: "c1", label: "", command: "pnpm x" },
      { id: "c2", label: "No command", command: "   " }
    ]
  })]).items;
  assert.ok(!items.some(item => item.file.startsWith("cmd-p1-")));
});
