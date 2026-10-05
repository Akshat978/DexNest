/**
 * HEIC and HEIF: recognised by name and by their first bytes, decoded by a
 * module that is loaded only when one is opened, and read everywhere DexNest
 * takes a picture.
 *
 * No photo is checked into the repository, so the decode itself is exercised
 * with a file given in DEXNEST_TEST_HEIC when there is one (the real-app check
 * uses one); the rest runs always.
 */

import { strict as assert } from "node:assert";
import { test } from "node:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { decodeHeic, heicDecoderLoaded, isHeicPath, looksLikeHeic, MAX_HEIC_PIXELS, toBgra } from "../src/main/heic.ts";

const desktop = fileURLToPath(new URL("..", import.meta.url));
const read = (path: string) => readFileSync(join(desktop, path), "utf8").replace(/\r\n/g, "\n");

const ftyp = (brand: string) => new Uint8Array([0, 0, 0, 28, ...Buffer.from("ftyp"), ...Buffer.from(brand), 0, 0, 0, 0]);

test("a phone photo is known by its name, whatever its case", () => {
  for (const name of ["IMG_0412.HEIC", "photo.heic", "scan.heif", "C:\\Users\\me\\Pictures\\a b.Heic"]) assert.equal(isHeicPath(name), true, name);
  for (const name of ["photo.jpg", "heic.png", "notes.heic.txt", "heic"]) assert.equal(isHeicPath(name), false, name);
});

test("and by its first bytes, so a renamed one is still recognised", () => {
  for (const brand of ["heic", "heix", "mif1", "msf1", "hevc"]) assert.equal(looksLikeHeic(ftyp(brand)), true, brand);
  assert.equal(looksLikeHeic(ftyp("avif")), false, "AVIF is a different picture format in the same kind of file");
  assert.equal(looksLikeHeic(ftyp("isom")), false, "a video is not a photo");
  assert.equal(looksLikeHeic(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0, 1])), false, "a JPEG");
  assert.equal(looksLikeHeic(new Uint8Array(4)), false);
});

test("pixels are reordered for Electron in place, alpha untouched", () => {
  const rgba = new Uint8Array([10, 20, 30, 255, 1, 2, 3, 128]);
  assert.deepEqual([...toBgra(rgba)], [30, 20, 10, 255, 3, 2, 1, 128]);
  assert.deepEqual([...toBgra(new Uint8Array(0))], []);
});

test("the decoder is not loaded until a HEIC is opened, and a broken file is refused in words", async () => {
  assert.equal(heicDecoderLoaded(), false, "importing the module loads nothing heavy");
  await assert.rejects(() => decodeHeic(ftyp("heic")), /^Error: This HEIC photo could not be read/);
  assert.equal(heicDecoderLoaded(), true, "it was loaded for that file");
  assert.ok(MAX_HEIC_PIXELS >= 50_000_000, "a 50 megapixel phone photo is allowed");
});

test("a real photo decodes to its pixels", { skip: !process.env.DEXNEST_TEST_HEIC || !existsSync(process.env.DEXNEST_TEST_HEIC) }, async () => {
  const bytes = readFileSync(process.env.DEXNEST_TEST_HEIC as string);
  assert.equal(looksLikeHeic(bytes), true);
  const image = await decodeHeic(bytes);
  assert.ok(image.width > 0 && image.height > 0);
  assert.equal(image.data.length, image.width * image.height * 4);
  // Not a blank frame: the picture has more than one colour in it.
  const colours = new Set<number>();
  for (let i = 0; i < image.data.length && colours.size < 8; i += 4 * 997) colours.add((image.data[i]! << 16) | (image.data[i + 1]! << 8) | image.data[i + 2]!);
  assert.ok(colours.size > 1);
});

test("every place a picture is read goes through the HEIC-aware reader", () => {
  const main = read("src/main/main.ts");
  // Tools: images to PDF, and compress / resize / convert.
  assert.match(main, /const image = await readImageFile\(filePath\);/);
  assert.match(main, /let image = await readImageFile\(filePath\);/);
  assert.equal((main.match(/nativeImage\.createFromPath\(filePath\)/g) ?? []).length, 1, "only the reader itself opens a chosen picture directly");
  // OCR: the engine is handed a PNG, with or without preprocessing.
  assert.match(main, /const inputPath = await heicAsPng\(originalPath, tempFolder\);/);
  assert.match(main, /Jimp\.read\(await jimpSource\(filePath\)\)/);
  assert.match(main, /\[".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tif", ".tiff", ".heic", ".heif"\]\.includes\(extension\)/);
  // Vault OCR accepts them, and so does the screen that says whether a document can be read.
  assert.match(main, /\[".png", ".jpg", ".jpeg", ".webp", ".heic", ".heif", ".pdf"\]\.includes\(fileType\.toLowerCase\(\)\)/);
  assert.match(read("src/renderer/main.tsx"), /\[".png", ".jpg", ".jpeg", ".webp", ".heic", ".heif", ".pdf"\]\.includes\(document\.fileType\.toLowerCase\(\)\)/);
  // ObjectOS shows a HEIC photo as a JPEG, and leaves the stored file alone.
  assert.match(read("src/main/objectOsHost.ts"), /if \(heic && heicPhoto\) return heicPhoto\(path\)\.catch\(\(\) => null\);/);
  assert.match(main, /heicPhoto: async \(path\) => \{/);
});

test("every file picker that offers pictures offers HEIC and HEIF", () => {
  const main = read("src/main/main.ts");
  const filters = [...main.matchAll(/extensions: \[([^\]]+)\]/g)].map((m) => m[1]!).filter((list) => /"jpg"/.test(list));
  assert.ok(filters.length >= 5);
  for (const list of filters) assert.match(list, /"heic", "heif"/, list);
});

test("the decoder stays a separate module, loaded on demand", () => {
  assert.match(read("vite.main.config.ts"), /external: \["electron", "better-sqlite3", "heic-decode"\]/);
  assert.match(read("src/main/heic.ts"), /decoder \?\?= import\("heic-decode"\)/);
  assert.doesNotMatch(read("src/main/main.ts"), /from "heic-decode"/, "never imported at start-up");
  const pkg = JSON.parse(read("package.json")) as { dependencies: Record<string, string> };
  assert.ok(pkg.dependencies["heic-decode"], "a runtime dependency, so it is in the packaged app");
});
