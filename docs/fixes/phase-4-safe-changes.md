# Phase 4: safe changes in Projects

Fourth phase of the fixes found in hands-on testing on 3 October 2026.

The folder that prompted it held, next to the code: a tracked `.env` with
changes, incorporation papers, a grant, a pitch deck, a zip, and a dataset
folder. "Commit all" was one click from putting all of it on GitHub, and
DexNest never rewrites history, so it would have stayed there.

## What it does now

| Before | Now |
|---|---|
| "Commit all" took everything, no questions | When the sweep includes a secrets file, a document, an archive or a very large new file or folder, the plan names them and **asks first**. A tidy folder is still one click. |
| "Stash all" copied a dataset into a stash | Asks first when a very large new folder is included. A secrets file alone is no reason: a stash stays on this PC. |
| No way to keep a file out for good | **Ignore** on any new file or folder, and **Ignore N selected**, add it to `.gitignore`. |
| Ignored files were invisible | **Show ignored files** lists them, folders as one line. |
| Unclear what the commit button did with some boxes ticked | Checked: it reads "Commit N selected" and commits exactly those. |

Rows carry a mark (`secrets file?`, `document`, `archive`,
`very large · 1.2 GB in more than 2,000 files`), and the same lines the dialog
will show are on the screen above the buttons before anything is pressed.

## How

- `domain/risk.ts`: what a path looks like from its name, what counts as large
  (over 50 MB, over 1,000 files, or counting had to stop), and the lines a plan
  shows. `.env.example` and similar templates are not flagged.
- `planCommit` and `planStash`: with something risky in the sweep, safety
  becomes `caution` and the plan needs a confirmation. The steps are unchanged:
  nothing is left out behind the owner's back. A non-interactive trigger is
  refused, so nothing can commit a secrets file by saying nothing.
- Sizes: the reader measures new files and folders only when asked
  (`measureUntracked`): in the project detail, and when a commit or stash is
  planned. A folder is counted to at most 2,000 files, links not followed. The
  home screen does not measure.
- `domain/gitignore.ts`: a pattern is anchored to the repository root and has
  git's wildcard characters escaped, so ignoring `report.md` does not ignore
  `docs/report.md`, and `notes [draft].txt` matches only itself. Existing lines
  and line endings are kept; additions go under one `# Added from DexNest`.
- `projects.ignore` (new action, screen only): refuses a file git already
  tracks, with the reason, because ignoring it changes nothing and DexNest
  does not stop tracking files. Logged with counts, not file names.

## Not covered here

- A tracked secrets file (like the `.env` above) cannot be made to disappear by
  ignoring. The guard keeps it out of an accidental commit; removing it from
  tracking and rotating the secrets is work for a terminal.
- "Stash selected" is not offered.
- Removing a line from `.gitignore` is done by editing the file.

## Tests

- `packages/projects/test/safeChanges.test.ts`: names, sizes, plan wording,
  pattern escaping, file editing.
- `packages/projects/test/runtime.test.ts`: the Ignore action against real
  repositories, including the same-name-in-a-subfolder and bracket cases.
- `packages/projects/test/measureAndIgnored.test.ts`, and
  `packages/git-ops/test/safeChanges.test.ts`: nothing is committed or stashed
  until confirmed; a ticked clean file is one click.
- Desktop: new Changes tab cases in `projectDetail.test.mjs`.
- Checked in the real app on a scratch data root, in a folder shaped like the
  real one: the rows were marked and the warning shown; "Commit all" asked and
  was cancelled with nothing committed; Ignore removed four entries and wrote
  four lines under one heading; committing only the ticked script went through
  without a question and left the secrets file uncommitted; "Show ignored
  files" listed the four.
