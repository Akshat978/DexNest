/**
 * The built-in set - data only, every rule disabled until the owner picks it.
 *
 * Rules, quests and achievements written so nobody has to know an event
 * type's name to play. Each rule names an event DexNest really writes (the
 * tests check every one against the list of known events), and none from
 * vault, finance or journal: those are still not read, even by type.
 *
 * `STARTER_INFO` says, for each rule, what earns it in plain words and which
 * group it sits under; `recommended` ones are ticked when the game is first
 * turned on.
 */

export type StarterGroup = 'projects' | 'dexnest' | 'life';

export interface StarterInfo {
  group: StarterGroup;
  /** What earns it, as a sentence that follows "You get XP when…". */
  when: string;
  recommended: boolean;
}

export const STARTER_GROUP_LABELS: Record<StarterGroup, string> = {
  projects: 'Your projects',
  dexnest: 'Things done in DexNest',
  life: 'Day to day',
};

const audit = (types: string[], actionIds: string[]) => ({ types, stream: 'audit', actionIds, status: 'success' });

export const STARTER_RULES: readonly unknown[] = [
  // --- your projects: seen by the repository scan, however the work was done ---
  { id: 'commit-observed', name: 'Made a commit', enabled: false, match: { types: ['dev.commit.observed'], stream: 'dev' }, award: { xp: 5, stat: 'Craft' }, dailyCap: 20 },
  { id: 'push-observed', name: 'Pushed your work', enabled: false, match: { types: ['dev.push.observed'], stream: 'dev' }, award: { xp: 8, stat: 'Craft' }, dailyCap: 10 },
  { id: 'pull-observed', name: 'Pulled the latest', enabled: false, match: { types: ['dev.pull.observed'], stream: 'dev' }, award: { xp: 3, stat: 'Order' }, dailyCap: 5 },
  { id: 'todo-resolved', name: 'Cleared a TODO', enabled: false, match: { types: ['dev.todo.resolved'], stream: 'dev' }, award: { xp: 4, stat: 'Craft' }, dailyCap: 20 },
  { id: 'merge-finished', name: 'Finished a merge or rebase', enabled: false, match: { types: ['dev.git_operation.resolved'], stream: 'dev' }, award: { xp: 10, stat: 'Craft' }, dailyCap: 5 },
  { id: 'working-tree-cleaned', name: 'Left a project with nothing uncommitted', enabled: false, match: { types: ['dev.working_tree.cleaned'], stream: 'dev' }, award: { xp: 6, stat: 'Order' }, dailyCap: 5 },
  { id: 'skill-discovered', name: 'Picked up a new skill', enabled: false, match: { types: ['skill.discovered'], stream: 'skill' }, award: { xp: 20, stat: 'Craft' }, dailyCap: 5 },
  { id: 'standup-generated', name: 'Read the morning Standup', enabled: false, match: audit(['action_executed'], ['standup.generate']), award: { xp: 10, stat: 'Focus' }, dailyCap: 1 },
  { id: 'repositories-scanned', name: 'Scanned your repositories', enabled: false, match: audit(['action_executed'], ['dev.scan_repositories']), award: { xp: 5, stat: 'Order' }, dailyCap: 3 },

  // --- things done in DexNest ---
  { id: 'backup-completed', name: 'Made a backup', enabled: false, match: audit(['backup_created', 'action_executed'], ['backup.create']), award: { xp: 15, stat: 'Order' }, dailyCap: 1 },
  {
    id: 'capture-saved',
    name: 'Captured a thought',
    enabled: false,
    match: audit(['capture_action', 'action_executed'], ['capture.create_note', 'capture.create_from_clipboard', 'capture.create_from_file']),
    award: { xp: 2, stat: 'Focus' },
    dailyCap: 10,
  },
  {
    id: 'capture-filed',
    name: 'Filed something from the inbox',
    enabled: false,
    // Routing to Vault, Finance or Journal is left out on purpose: those are not read, even by type.
    match: audit(['capture_action', 'action_executed'], ['capture.route_to_calendar', 'capture.route_to_drop', 'capture.route_to_finder', 'capture.archive_item']),
    award: { xp: 3, stat: 'Order' },
    dailyCap: 10,
  },
  { id: 'calendar-event-added', name: 'Put something in the calendar', enabled: false, match: audit(['calendar_action', 'action_executed'], ['calendar.create_event']), award: { xp: 2, stat: 'Order' }, dailyCap: 5 },
  {
    id: 'tool-used',
    name: 'Made something with Tools',
    enabled: false,
    match: audit(
      ['tools_action', 'action_executed'],
      ['tools.merge_pdfs', 'tools.split_pdf', 'tools.images_to_pdf', 'tools.pdf_to_text', 'tools.ocr_image', 'tools.ocr_pdf', 'tools.convert_image', 'tools.compress_image', 'tools.resize_image', 'tools.clean_scan'],
    ),
    award: { xp: 2, stat: 'Craft' },
    dailyCap: 5,
  },
  { id: 'object-located', name: 'Remembered where something is', enabled: false, match: { types: ['object.located'], stream: 'object' }, award: { xp: 1, stat: 'Order' }, dailyCap: 10 },
  { id: 'memory-written', name: 'Wrote down a memory or decision', enabled: false, match: { types: ['ghost.entity.saved'], stream: 'ghost' }, award: { xp: 3, stat: 'Focus' }, dailyCap: 5 },

  // --- day to day ---
  { id: 'block-done', name: 'Finished a timetable block', enabled: false, match: audit(['timetable_mark_done', 'action_executed'], ['timetable.mark_done']), award: { xp: 5, stat: 'Focus' }, dailyCap: 12 },
  { id: 'maintenance-logged', name: 'Looked after something you own', enabled: false, match: { types: ['object.maintenance_logged'], stream: 'object' }, award: { xp: 10, stat: 'Order' }, dailyCap: 5 },
];

export const STARTER_INFO: Readonly<Record<string, StarterInfo>> = {
  'commit-observed': { group: 'projects', when: 'you make a commit in a project the scan follows', recommended: true },
  'push-observed': { group: 'projects', when: 'you push, from DexNest, an editor or the command line', recommended: true },
  'pull-observed': { group: 'projects', when: 'you pull the latest changes', recommended: false },
  'todo-resolved': { group: 'projects', when: 'a TODO comment the scan had seen is gone', recommended: true },
  'merge-finished': { group: 'projects', when: 'a merge, rebase or cherry-pick that was in progress finishes', recommended: false },
  'working-tree-cleaned': { group: 'projects', when: 'a project that had uncommitted changes has none', recommended: true },
  'skill-discovered': { group: 'projects', when: 'Skills finds a language or tool it had not seen in your work', recommended: true },
  'standup-generated': { group: 'projects', when: 'the day’s Standup is generated', recommended: false },
  'repositories-scanned': { group: 'projects', when: 'you run a repository scan', recommended: false },
  'backup-completed': { group: 'dexnest', when: 'you make a backup', recommended: true },
  'capture-saved': { group: 'dexnest', when: 'you capture a note, a clipboard item or a file', recommended: false },
  'capture-filed': { group: 'dexnest', when: 'you send a capture where it belongs, or archive it', recommended: false },
  'calendar-event-added': { group: 'dexnest', when: 'you add an event to the calendar', recommended: false },
  'tool-used': { group: 'dexnest', when: 'you merge, split, convert or scan something in Tools', recommended: false },
  'object-located': { group: 'dexnest', when: 'you record where something is, or that it moved', recommended: false },
  'memory-written': { group: 'dexnest', when: 'you add a memory, decision, person or place in GhostOS', recommended: false },
  'block-done': { group: 'life', when: 'you mark a timetable block done', recommended: true },
  'maintenance-logged': { group: 'life', when: 'you log maintenance on an object in ObjectOS', recommended: true },
};

const xp = (id: string, name: string, target: number, description = `Earn ${target.toLocaleString('en')} XP.`) => ({ id, name, description, condition: { kind: 'xp', target } });
const count = (id: string, name: string, description: string, ruleId: string, target: number) => ({ id, name, description, condition: { kind: 'count', ruleIds: [ruleId], target } });
const days = (id: string, name: string, description: string, ruleId: string, target: number) => ({ id, name, description, condition: { kind: 'days', ruleIds: [ruleId], target } });

export const STARTER_ACHIEVEMENTS: readonly unknown[] = [
  // XP and levels (the level curve in data/levels.ts: level 5 at 1,000 XP, 10 at 4,500, 20 at 19,000).
  xp('first-steps', 'First steps', 1, 'Earn your first XP.'),
  xp('hundred', 'Hundred', 100),
  xp('level-5', 'Level 5', 1000, 'Reach level 5 (1,000 XP).'),
  xp('level-10', 'Level 10', 4500, 'Reach level 10 (4,500 XP).'),
  xp('level-20', 'Level 20', 19000, 'Reach level 20 (19,000 XP).'),
  // Commits.
  count('commits-10', 'Ten commits', 'Make 10 commits.', 'commit-observed', 10),
  count('commits-100', 'A hundred commits', 'Make 100 commits.', 'commit-observed', 100),
  count('commits-1000', 'A thousand commits', 'Make 1,000 commits.', 'commit-observed', 1000),
  days('committed-week', 'Committed week', 'Commit on 7 different days.', 'commit-observed', 7),
  days('committed-month', 'Committed month', 'Commit on 30 different days.', 'commit-observed', 30),
  days('committed-hundred', 'A hundred days of commits', 'Commit on 100 different days.', 'commit-observed', 100),
  // Pushing and tidying.
  count('pushes-10', 'Shipped ten times', 'Push 10 times.', 'push-observed', 10),
  count('pushes-100', 'Shipped a hundred times', 'Push 100 times.', 'push-observed', 100),
  count('todos-10', 'Ten TODOs gone', 'Clear 10 TODOs.', 'todo-resolved', 10),
  count('todos-50', 'Fifty TODOs gone', 'Clear 50 TODOs.', 'todo-resolved', 50),
  count('clean-10', 'Nothing left hanging', 'Leave a project with nothing uncommitted, 10 times.', 'working-tree-cleaned', 10),
  count('skills-5', 'Five new skills', 'Pick up 5 new skills.', 'skill-discovered', 5),
  // DexNest and day to day.
  count('backups-5', 'Five backups', 'Make 5 backups.', 'backup-completed', 5),
  count('backups-25', 'Twenty-five backups', 'Make 25 backups.', 'backup-completed', 25),
  count('blocks-10', 'Ten blocks done', 'Finish 10 timetable blocks.', 'block-done', 10),
  count('blocks-100', 'A hundred blocks done', 'Finish 100 timetable blocks.', 'block-done', 100),
  days('routine-week', 'A week of routine', 'Finish a timetable block on 7 different days.', 'block-done', 7),
  days('routine-month', 'A month of routine', 'Finish a timetable block on 30 different days.', 'block-done', 30),
  count('maintenance-3', 'Looked after', 'Log maintenance 3 times.', 'maintenance-logged', 3),
  count('maintenance-25', 'Well kept', 'Log maintenance 25 times.', 'maintenance-logged', 25),
];

/** Quests offered at turn-on. Each needs the rule it counts; `needs` names it so the two are picked together. */
export const STARTER_QUESTS: readonly { id: string; title: string; needs: string; recommended: boolean; condition: unknown; window: unknown }[] = [
  { id: 'commit-5-days', title: 'Commit on 5 days this week', needs: 'commit-observed', recommended: true, condition: { kind: 'days', ruleIds: ['commit-observed'], target: 5 }, window: { kind: 'weekly' } },
  { id: 'push-3-week', title: 'Push 3 times this week', needs: 'push-observed', recommended: true, condition: { kind: 'count', ruleIds: ['push-observed'], target: 3 }, window: { kind: 'weekly' } },
  { id: 'todos-5-week', title: 'Clear 5 TODOs this week', needs: 'todo-resolved', recommended: false, condition: { kind: 'count', ruleIds: ['todo-resolved'], target: 5 }, window: { kind: 'weekly' } },
  { id: 'clean-3-week', title: 'Leave nothing uncommitted, 3 times this week', needs: 'working-tree-cleaned', recommended: false, condition: { kind: 'count', ruleIds: ['working-tree-cleaned'], target: 3 }, window: { kind: 'weekly' } },
  { id: 'backup-week', title: 'Back up this week', needs: 'backup-completed', recommended: true, condition: { kind: 'count', ruleIds: ['backup-completed'], target: 1 }, window: { kind: 'weekly' } },
  { id: 'blocks-3-day', title: 'Finish 3 timetable blocks today', needs: 'block-done', recommended: true, condition: { kind: 'count', ruleIds: ['block-done'], target: 3 }, window: { kind: 'daily' } },
  { id: 'maintenance-3', title: 'Log maintenance 3 times', needs: 'maintenance-logged', recommended: false, condition: { kind: 'count', ruleIds: ['maintenance-logged'], target: 3 }, window: { kind: 'none' } },
];
