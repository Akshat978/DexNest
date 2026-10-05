# L3: photos, the rest

Third of the leftovers after the fifteen fix phases. It finishes what phase 12
(HEIC photos) left open.

## What it does now

| Before | Now |
|---|---|
| A phone photo saved or renamed as `.jpg` was HEIC inside and failed everywhere: "Could not read image" in Tools, a broken picture in ObjectOS | It is recognised by its contents and opened like any other phone photo |
| Drop and Capture showed an icon for every file, pictures included | A file that is a picture shows a small preview of it. This is for every kind of picture, not only HEIC |

## How

### Recognised by contents

- `isHeicFile` in `main/heic.ts` reads the first sixteen bytes of a file and
  looks for the marker every HEIC and HEIF file starts with. A file named
  `.heic` or `.heif` is believed without looking.
- Every place that opens a picture uses it: the Tools image actions, Clean
  scan, OCR in Tools and the Vault, and an object's photo in ObjectOS.
  Nothing in the app trusts the file name alone any more.
- A real JPEG, a video and an AVIF are not mistaken for one. A `.jpg` that is
  not a picture at all still fails as before, in words.

### Previews

- `main/thumbnails.ts` and `views/Thumbnail.tsx`. A preview is a JPEG no
  larger than 96 pixels, made in the main process and never written to disk.
- **Only when seen.** A row asks for its preview once it is on screen. Rows
  below the fold ask for nothing until they are scrolled to.
- **One at a time.** Decoding a phone photo takes a moment, so previews are
  made in a queue, never several at once.
- **Once.** A preview is kept in memory (up to 200) and made again only if
  the file changes. A file that cannot be previewed is remembered as such and
  not retried every time the list is drawn.
- **By id.** The window asks for "the picture of this Drop item" or "of this
  capture". It cannot name a file; the file read is the one DexNest already
  holds for that item.
- **Not in Performance Mode.** With it on, no previews are made and rows keep
  their icons.
- Files over 60 MB are not previewed.

## Not covered here

- The Vault, Finance receipts and Search results have no previews.
- A preview does not open a larger view when clicked.
- Only the first picture in a HEIC is read (a burst or a Live Photo gives its
  main frame), as in phase 12.
- Files waiting in Drop's "Ready to send" list have no preview: they are not
  Drop items yet.

## Tests

- `apps/desktop/test/thumbnails.test.ts`: HEIC under other names, and what is
  not HEIC; every reader looking inside the file; the queue (never two at
  once, made once, made again when the file changes, a failure not blocking
  the rest, the cache dropping the least recently used); preview size; the
  request by id; rows asking only when on screen.
- Root `pnpm test`: 2,386 tests pass; typecheck clean.
- Checked in the real app on a scratch data root with a real phone photo
  saved as `IMG_0412.jpg`, 21 checks: Convert, Images to PDF, Clean scan and
  OCR taking it; a `.jpg` that is not a picture still refused; ObjectOS
  showing it; previews for a HEIC and the renamed one in Capture and for a
  HEIC in Drop; none for a text file or a note; the second request answered
  in 3 ms; 96 by 64 pixels; a request naming a file ignored; nothing asked
  for before the rows were scrolled into view; none made in Performance Mode.
