// Seed realistic, synthetic data into a running DexNest (real Electron) through
// its own bridge and actions - exactly what the UI would call. Every record is
// made up. Repositories come from make-repos.sh (a temp folder).
//
// seed(win, { codeDir }) -> a summary of what was created (and anything refused).

export async function seed(win, { codeDir }) {
  return win.evaluate(async ({ codeDir }) => {
    const d = window.dexNest;
    const log = [];
    const run = async (actionId, params = {}) => {
      const r = await d.runAction({ actionId, source: "module_ui", params });
      if (!r || r.ok === false) log.push(`REFUSED ${actionId}: ${r?.error ?? r?.message ?? JSON.stringify(r).slice(0, 200)}`);
      return r;
    };
    const id = (r) => r?.value?.id ?? r?.data?.id ?? null;
    const daysAgo = (n, h = 10) => new Date(Date.now() - n * 86_400_000 + (h - 12) * 3_600_000).toISOString();

    // --- the app's own demo seed (older modules) --------------------------------
    await run("demo.seed", { replaceExisting: true, clipboard: true, vault: true, finance: true, journalCalendar: true, captureFinder: true, timetable: true, news: true, devDeck: true, secureVault: false });

    // --- Projects: six real (synthetic) git repositories ---------------------------
    const names = { "shop-web": "Shop web", "api-server": "API server", "ml-notebooks": "ML notebooks", "infra-scripts": "Infra scripts", "legacy-blog": "Legacy blog", "rust-cli": "Rust CLI" };
    await d.projectsSaveGroup({ id: "work", name: "Work", position: 0 });
    await d.projectsSaveGroup({ id: "side", name: "Side projects", position: 1 });
    for (const [folder, name] of Object.entries(names)) {
      const path = `${codeDir}/${folder}`;
      const inspected = await d.projectsInspect(path);
      const draft = inspected.kind === "ok" ? inspected.draft ?? {} : {};
      const group = ["shop-web", "api-server", "infra-scripts"].includes(folder) ? "work" : "side";
      const saved = await d.projectsAdd({ ...draft, name, path, groupId: group, favourite: folder === "shop-web", tags: folder === "shop-web" ? ["react", "client"] : folder === "api-server" ? ["node", "client"] : [] }, "wizard");
      if (!saved.ok) log.push(`REFUSED project ${folder}: ${saved.reason}`);
    }

    // --- Developer Intelligence -> Skill Constellation -----------------------------
    try {
      await d.devIntelligenceUpdateSettings({ schemaVersion: 1, enabled: true, roots: [{ path: codeDir, domain: "wsl" }], manualRepositories: [], excludedRoots: [], scanIntervalMinutes: 30, runHealthChecks: false });
    } catch (e) { log.push(`REFUSED DI settings: ${e.message}`); }
    await run("dev.scan_repositories");
    const current = await d.skillConstellationSettings();
    await d.skillConstellationUpdateSettings({ ...current, myEmails: ["sam@example.com"] });
    await run("skill_constellation.enable");
    await run("skill_constellation.rebuild");

    // --- GhostOS --------------------------------------------------------------------
    const ghost = {};
    const g = async (key, entity) => { ghost[key] = id(await run("ghost_os.entity.save", { entity })); };
    await g("maya", { type: "person", title: "Maya Chen", notes: "Former teammate at the agency; now runs her own studio.", tags: ["work", "mentor"] });
    await g("leo", { type: "person", title: "Leo Park", notes: "Climbing partner.", tags: ["climbing"] });
    await g("shop", { type: "project", title: "Shop web rewrite", startedAt: daysAgo(200), tags: ["work"] });
    await g("garden", { type: "project", title: "Garden irrigation", startedAt: daysAgo(150), tags: ["home"] });
    await g("ts", { type: "skill", title: "TypeScript", tags: ["code"] });
    await g("pottery", { type: "skill", title: "Wheel-thrown pottery", tags: ["craft"] });
    await g("rust", { type: "knowledge", title: "Rust ownership rules", notes: "Borrowing: many readers or one writer.", tags: ["code"] });
    await g("run", { type: "memory", title: "First 10k under an hour", details: { text: "Ran along the river in 58 minutes; cold morning, felt great.", occurredAt: daysAgo(140, 7) } });
    await g("talk", { type: "event", title: "Talk at the local JS meetup", details: { occurredAt: daysAgo(40, 19), endedAt: daysAgo(40, 20) }, tags: ["work"] });
    await g("journal", { type: "habit", title: "Morning pages", details: { cadence: "daily" } });
    await g("vite", { type: "decision", title: "Move the shop to Vite", details: { decidedAt: daysAgo(180), choice: "Vite", alternatives: ["webpack 5", "Parcel"], rationale: "Dev server startup was 40 s with webpack." } });
    await g("lisbon", { type: "place", title: "Lisbon", tags: ["travel"] });
    await g("call", { type: "conversation", title: "Call with Maya about freelancing", details: { text: "Maya: Start with two clients, not five.\nMe: And rates?\nMaya: Day rate, never hourly.", participants: ["Maya", "Me"] } });
    const rel = (from, to, type, strength) => run("ghost_os.relation.save", { relation: { fromId: ghost[from], toId: ghost[to], type, strength } });
    await rel("maya", "shop", "worked_on", 0.9); await rel("shop", "ts", "uses", 1); await rel("shop", "vite", "related_to", 0.8);
    await rel("leo", "run", "involves", 0.6); await rel("talk", "ts", "about", 0.7); await rel("call", "maya", "involves", 1);
    await run("ghost_os.observation.add", { observation: { entityId: ghost.maya, statement: "Prefers async updates over calls", confidence: 0.8 } });
    await run("ghost_os.observation.add", { observation: { entityId: ghost.journal, statement: "Skipped mostly on travel days", confidence: 0.6 } });
    await run("ghost_os.decision.record_outcome", { outcome: { id: ghost.vite, outcome: "Dev server starts in under a second; builds 4x faster." } });

    // --- ObjectOS -------------------------------------------------------------------
    const obj = {};
    const o = async (key, input) => { obj[key] = id(await run("object_os.object.save", { input })); };
    await o("printer", { name: "Workshop 3D printer", category: "printer", make: "Prusa", model: "MK4", serial: "PR-2291", location: "Workshop", tags: ["3d", "maker"], notes: "Keep the enclosure closed when printing ABS." });
    await o("laptop", { name: "Work laptop", category: "computer", make: "Lenovo", model: "ThinkPad X1 Carbon", serial: "PF-3K2L9", location: "Office" });
    await o("car", { name: "Car", category: "vehicle", make: "Skoda", model: "Octavia", location: "Street" });
    await o("bike", { name: "Gravel bike", category: "vehicle", make: "Canyon", model: "Grail", location: "Garage" });
    await o("drill", { name: "Cordless drill", category: "tool", make: "Makita", model: "DHP485", location: "Garage", status: "lent_out", notes: "Lent to Leo." });
    await o("dishwasher", { name: "Dishwasher", category: "appliance", make: "Bosch", model: "SMS6", location: "Kitchen" });
    await o("nas", { name: "NAS", category: "computer", make: "Synology", model: "DS220+", location: "Office" });
    await o("hotend", { name: "Hotend", category: "other", make: "E3D", model: "Revo", location: "Workshop", parentId: null });
    if (obj.hotend && obj.printer) await run("object_os.object.save", { input: { id: obj.hotend, name: "Hotend", category: "other", make: "E3D", model: "Revo", location: "Workshop", parentId: obj.printer } });
    await run("object_os.state.set", { input: { objectId: obj.printer, key: "firmware", value: "6.1.2" } });
    await run("object_os.state.set", { input: { objectId: obj.printer, key: "filament", value: "PETG, black" } });
    const nozzle = id(await run("object_os.part.save", { input: { name: "0.4 mm nozzle", partNumber: "E3D-V6-04", supplier: "E3D", quantity: 1, lowStockAt: 2, fits: [obj.printer] } }));
    await run("object_os.part.save", { input: { name: "Brake pads (front)", partNumber: "TRP-HY", supplier: "Bike shop", quantity: 2, lowStockAt: 1, fits: [obj.bike] } });
    const sched = id(await run("object_os.schedule.save", { input: { objectId: obj.printer, title: "Replace nozzle", rule: { kind: "usage", every: 200, measurementKey: "print hours" }, startReading: 0, startsAt: daysAgo(300) } }));
    await run("object_os.schedule.save", { input: { objectId: obj.printer, title: "Lubricate rods", rule: { kind: "time", every: 3, unit: "months" }, startsAt: daysAgo(120) } });
    await run("object_os.schedule.save", { input: { objectId: obj.car, title: "Annual service", rule: { kind: "time", every: 1, unit: "years" }, startsAt: daysAgo(356) } });
    await run("object_os.schedule.save", { input: { objectId: obj.dishwasher, title: "Clean the filter", rule: { kind: "time", every: 1, unit: "months" }, startsAt: daysAgo(70) } });
    for (const [n, h] of [[250, 120], [180, 210], [90, 330], [30, 395], [3, 412]]) await run("object_os.measurement.add", { input: { objectId: obj.printer, key: "print hours", value: h, unit: "h", measuredAt: daysAgo(n) } });
    await run("object_os.maintenance.log", { input: { objectId: obj.printer, title: "Replaced nozzle", scheduleId: sched, doneAt: daysAgo(180), cost: { amount: "12.50", currency: "EUR" }, usageReading: 210, parts: nozzle ? [{ partId: nozzle, quantity: 1 }] : [] } });
    await run("object_os.maintenance.log", { input: { objectId: obj.printer, title: "Cleaned the bed with IPA", doneAt: daysAgo(20) } });
    await run("object_os.maintenance.log", { input: { objectId: obj.car, title: "Oil and filter", doneAt: daysAgo(356), cost: { amount: "189.00", currency: "EUR" }, doneBy: "Garage Novak" } });
    await run("object_os.modification.save", { input: { objectId: obj.printer, title: "Added an enclosure", doneAt: daysAgo(90), reason: "ABS warps in a draught.", before: "open frame", after: "enclosed", reversible: true } });
    await run("object_os.settings.save", { input: { objectId: obj.printer, name: "PETG profile", values: { nozzle_temp: 235, bed_temp: 80, fan: "50%" } } });
    await run("object_os.settings.save", { input: { objectId: obj.printer, name: "PETG profile", values: { nozzle_temp: 240, bed_temp: 80, fan: "40%", ironing: true }, note: "less stringing" } });
    await run("object_os.purchase.save", { input: { objectId: obj.printer, purchasedOn: new Date(Date.now() - 340 * 86_400_000).toISOString().slice(0, 10), price: { amount: "1099.00", currency: "EUR" }, shop: "Prusa shop", warrantyUntil: new Date(Date.now() + 25 * 86_400_000).toISOString().slice(0, 10) } });
    await run("object_os.purchase.save", { input: { objectId: obj.laptop, purchasedOn: "2024-03-14", price: { amount: "1849.00", currency: "EUR" }, shop: "Lenovo store", warrantyUntil: "2027-03-14" } });

    // --- Reality RPG: starter set + own rule + quest, then count past activity -------
    const snap = await d.realityRpgSnapshot();
    for (const rule of snap.starter?.rules ?? []) await run("reality_rpg.rule.save", { rule: { ...rule, enabled: true } });
    for (const achievement of snap.starter?.achievements ?? []) await run("reality_rpg.achievement.save", { achievement });
    await run("reality_rpg.rule.save", { rule: { id: "maintenance-logged", name: "Maintenance logged", enabled: true, match: { types: ["action_executed"], stream: "audit", actionIds: ["object_os.maintenance.log"], status: "success" }, award: { xp: 20, stat: "Order" }, dailyCap: 5 } });
    await run("reality_rpg.rule.save", { rule: { id: "memory-kept", name: "Memory kept in GhostOS", enabled: true, match: { types: ["action_executed"], stream: "audit", actionIds: ["ghost_os.entity.save"], status: "success" }, award: { xp: 5, stat: "Lore" }, dailyCap: 10 } });
    await run("reality_rpg.quest.create", { quest: { title: "Ship three commits this week", condition: { kind: "count", ruleIds: ["commit-observed"], target: 3 }, window: { kind: "weekly" } } });
    await run("reality_rpg.quest.create", { quest: { title: "Keep the workshop running", condition: { kind: "count", ruleIds: ["maintenance-logged"], target: 4 }, window: { kind: "none" } } });
    await run("reality_rpg.enable");
    for (const ruleId of ["commit-observed", "repositories-scanned", "maintenance-logged", "memory-kept"]) await run("reality_rpg.backfill", { ruleId });
    await run("reality_rpg.refresh");

    const summary = {
      projects: (await d.projectsList()).length,
      diRepositories: (await d.devIntelligenceRepositories())?.length ?? null,
      skills: (await d.skillConstellationSnapshot()).skills?.length ?? null,
      ghost: Object.values(ghost).filter(Boolean).length,
      objects: Object.values(obj).filter(Boolean).length,
      rpgXp: (await d.realityRpgSnapshot()).sheet?.totalXp ?? null
    };
    return { summary, log };
  }, { codeDir });
}
