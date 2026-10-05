# Phase 12: HEIC photos

Twelfth phase of the fixes found in hands-on testing on 3 October 2026.

## What it does now

| Before | Now |
|---|---|
| Tools refused a phone photo, or produced an empty result | **Images to PDF**, **Compress**, **Resize**, **Convert** and **Clean scan** take `.heic` and `.heif` |
| OCR said "Unsupported OCR image type: .heic" | OCR reads it (Tools and Vault): the photo is turned into a PNG first |
| An object's HEIC photo showed as a broken picture | ObjectOS shows it. The stored file stays the original HEIC |
| Some file pickers offered HEIC and some did not | Every picker that offers pictures offers HEIC and HEIF |
| A second DexNest would not start while another held port 43217 | It starts, and logs that the Deck and Drop endpoint is not running in this copy |

## How

- `src/main/heic.ts`: `isHeicPath`, `looksLikeHeic` (the first bytes of the
  file), `decodeHeic`, `toBgra`. No Electron in it.
- `main.ts` has one way to open a picture, `readImageFile`, used by the Tools
  image actions. `heicAsPng` is the same for the OCR engine, which needs a
  file it can open, and `jimpSource` for Clean scan.
- ObjectOS gets a `heicPhoto` host option: a JPEG no wider than 1600 px, made
  when the photo is shown. Nothing is written to disk.
- A photo larger than 100 megapixels is refused. A file that is not a HEIC is
  refused in words: "This HEIC photo could not be read".

## The decoder

Neither Chromium nor Jimp reads HEIC, so DexNest now depends on:

| Package | Licence | Notes |
|---|---|---|
| `heic-decode` 2.1.0 | ISC | A thin wrapper |
| `libheif-js` 1.23.5 | LGPL-3.0 | libheif built to JavaScript and WebAssembly, about 8.6 MB |

- It runs on this computer. Nothing is sent anywhere, and no GPU is used.
- It is loaded the first time a HEIC is opened, never at start-up
  (`decoder ??= import("heic-decode")`).
- It is left out of the main bundle (`external` in `vite.main.config.ts`) and
  stays a separate module in `node_modules`. That keeps start-up small, and it
  is what the LGPL asks for: the library can be replaced without rebuilding
  DexNest.

## Not covered here

- No sample photo is in the repository. The decode test runs when
  `DEXNEST_TEST_HEIC` points at a file, and is skipped otherwise.
- Only the first picture of a HEIC is read. A burst or a Live Photo gives its
  main frame.
- A HEIC renamed to `.jpg` is not detected: files are recognised by name.
  `looksLikeHeic` exists for it and is not yet used.
- Drop and Capture already accepted HEIC files as files; they do not show a
  preview of one.
- The installer was not rebuilt. `heic-decode` is a runtime dependency like
  `better-sqlite3`, so it should be packaged the same way; that is checked in
  the finish phase.
- Whether OCR returns text depends on Tesseract being installed. What was
  checked is that the photo reaches it.

## Tests

- `apps/desktop/test/heic.test.ts`: names and first bytes, pixel order, the
  decoder not loaded until needed, a broken file, a real decode, every reader
  and every file picker.
- `apps/desktop/test/housekeeping.test.ts`: the port in use.
- Checked in the real app on a scratch data root with a real 718 KB HEIC:
  images to PDF (0.5 s), convert to JPEG and PNG, resize, compress, clean
  scan, OCR, a broken file, and an ObjectOS photo drawn at 1280 x 854 with the
  original file kept.
