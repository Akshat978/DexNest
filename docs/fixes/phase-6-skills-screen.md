# Phase 6: the Skills screen

Sixth phase of the fixes found in hands-on testing on 3 October 2026.

What prompted it: two of seventeen stars had no name; four languages sat on top
of each other while most of the sky was empty; nothing said what a line or a
percentage meant; two lines reported the same rebuild; and the evidence panel
opened on a wall of TODO cards.

## What it does now

| Before | Now |
|---|---|
| The 15 strongest stars were named | Every star is named (up to 40; a real constellation is well under). Under 10% strength the name is quieter. Every star also has a tooltip |
| Stars clumped at the centre and along the rim | Placed by rank from the centre outward, in an ellipse as wide as the panel, a wider slice for a category with more skills, and at least 96 units between any two |
| One sentence under the sky | A legend with a key for each mark: size, glow, line, dashed line |
| "Constellation rebuilt: 17 skill(s)…" and "17 skills · built…" | One status line. A finished rebuild adds no second message; "(s)" is gone from the messages and the audit line |
| Percentages unexplained | A line under each bar saying what it measures and what fills it, and "What the percentages mean" in the side panel |
| Evidence: one card per row, newest first, so open TODOs led | "Where it comes from": one line per repository from the whole counts ("260 commits · named in a manifest · 1 open TODO"), with the rows folded away beneath, work first and TODOs last and quieter |
| The page was "Skill Constellation", the sidebar "Skills" | Both say Skills |

A file or manifest row's date now reads "seen 4 Oct 2026": it is when the scan
read it, not when work happened.

## How

- `packages/skill-constellation/src/domain/layout.ts`: rank sets the distance
  from the centre, a hash of the id picks one of evenly spaced angles in the
  category's slice, the result is flattened to 0.62 of its width, and pairs
  closer than `MIN_SEPARATION` are pushed apart (at most 120 passes).
  Deterministic. Adding a skill now moves the others: the old promise that it
  would not was what left the sky unused.
- The scoring version is 3, so a constellation built before this shows as out
  of date and one Rebuild gives it the new layout.
- `countEvidenceByRepository` (store), `evidenceCounts` (module) and the
  channel `dexnest:skill-constellation-evidence-counts`: the whole counts per
  repository and kind. The row list is still the newest 200; the summary line
  does not depend on it, and the fold says "the latest 158 of 263".
- Model: `summariseRepositories`, `orderEvidence`, `countsFromEvidence`,
  `METER_HELP`, `STRENGTH_HELP`, `LABEL_LIMIT` 40.

## Not covered here

- Past about 45 skills the ellipse cannot give every pair 96 units; stars stay
  apart as far as the passes get them, and labels beyond the 40 strongest
  appear on hover, focus or selection.
- Skills' settings still sit on this page; moving module settings into
  Settings is phase 11.

## Tests

- `packages/skill-constellation`: `domain-links-layout.test.ts` (rank from
  centre to edge, wider than tall, wider slice for a bigger category, 18 equal
  skills each with room), `store.test.ts` (counts).
- Desktop: `skillConstellationModel.test.ts` (labels, repository lines, row
  order), `skillConstellationView.test.mjs` (every star named and with a
  tooltip, legend, bar help, summary and fold).
- Checked in the real app on a scratch data root with three synthetic
  repositories giving 17 skills: 17 names for 17 stars, no name over another
  name or star, stars across 82% of the sky's width, the nearest pair 71 px
  apart, one status line after pressing Rebuild, the panel leading with
  "260 commits · …" and the rows folded, commits first and the TODO last,
  nothing running off the panel's edge.
