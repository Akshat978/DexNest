# Finish: regression, installer, checklist

The last step of the fixes found in hands-on testing on 3 October 2026.
Fifteen phases are in `docs/fixes/phase-*.md`. This note covers what was done
to close them out.

## Regression

- `pnpm test`: all 14 packages pass. 2,361 tests, 0 failed, 2 skipped (both
  need a file or a tool that is not in the repository).
- `pnpm typecheck`: clean.
- Every phase's real-app check was run again on the final code, on a scratch
  data root. All pass except phase 5's, which clicks a settings panel that
  phase 11 moved into Settings; phase 11's check covers it there.

### What the regression found

1. **`pnpm test` had been failing since phase 13.** That phase let the Deck
   run the "open" action of Today, Skills, Reality RPG, GhostOS and ObjectOS,
   and narrowed three desktop tests that said those modules are not offered
   to the Deck. Four more tests in the modules' own packages said the same
   and were failing; they were missed because only the desktop suite was run
   in phases 13 to 15. The change was reversed: the three tests are restored
   exactly as they were, the five actions are back to their original
   triggers, and the five Deck buttons are gone. Voice still opens those
   screens, which never depended on it.
2. Five steps in older check scripts depended on the time of day or on
   things later phases changed (a date format, extra sidebar buttons, a
   timetable block that happened to be running, reminders that were not yet
   due). The scripts were corrected to test the behaviour itself; none was a
   fault in DexNest.

The lesson kept for later work: run `pnpm test`, not only the desktop suite,
before a phase is called done.

## Installer

- Version 0.4.0 (`apps/desktop/package.json`).
- `apps/desktop/release/DexNest Setup 0.4.0.exe`, 143,866,035 bytes.
  SHA-256 `e7810e670e7fd29915bd6e3c451be53632e5c127b8776e97862857e612523062`.
  The `release/` folder is not in git.
- The HEIC decoder is in the package (`heic-decode`, `libheif-js` and their
  licence files). Nothing from `local-data/` is.
- The packaged app was started on a scratch data root and checked: it is
  0.4.0, the database opens, an object saves, a HEIC photo converts to JPEG
  and to PDF, Search finds the object, all 26 sidebar screens open with no
  page error, and Outside AI is off with no key.
- **Not done:** the installer itself was not run. Installing would replace the
  DexNest that is installed and running. What was checked is the unpacked
  build the installer is made from.
- The build log shows a signing step, and the project configures no
  certificate. Whether the installer carries a valid signature was not
  checked; treat it as unsigned.

## For the user

`docs/fixes/HANDS_ON_CHECKLIST.md`: what to try on real data, what happens
once on first start, and the four steps to do in order.

## Still open

- Outside AI (phases 14 and 15) has never been used with a real key.
- Heatmap overlay (item 78): not built, no answer yet.
- Reality RPG counting journal, finance or vault entries (item 79): no answer
  yet.
- Seven further uses of Outside AI (item 83): not built, on purpose.
- Dates by UTC day in four modules (item 84).
- The fix branch `fix/phase-1-scanner-truth` is not merged into `main`.
