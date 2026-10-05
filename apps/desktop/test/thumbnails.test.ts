/**
 * A phone photo is recognised by what is in it, not by its name; and Drop and
 * Capture show small previews, made one at a time and only when asked for.
 */

import { strict as assert } from "node:assert";
import { test } from "node:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { isHeicFile, isHeicPath } from "../src/main/heic.ts";
import { createThumbnailer, fitWithin, mayBePicture, THUMBNAIL_CACHE_SIZE } from "../src/main/thumbnails.ts";

const desktop = fileURLToPath(new URL("..", import.meta.url));
const read = (path: string) => readFileSync(join(desktop, path), "utf8").replace(/\r\n/g, "\n");
const ftyp = (brand: string) => new Uint8Array([0, 0, 0, 28, ...Buffer.from("ftyp"), ...Buffer.from(brand), 0, 0, 0, 0]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0, 1, 1, 1, 0, 72]);

test("a phone photo saved under another name is still known for what it is", () => {
  const folder = mkdtempSync(join(tmpdir(), "dexnest-heic-names-"));
  try {
    const file = (name: string, bytes: Uint8Array | string) => { const path = join(folder, name); writeFileSync(path, bytes); return path; };
    assert.equal(isHeicFile(file("IMG_0412.jpg", ftyp("heic"))), true, "HEIC inside, .jpg outside");
    assert.equal(isHeicFile(file("photo.png", ftyp("mif1"))), true);
    assert.equal(isHeicFile(file("no-extension", ftyp("heix"))), true);
    assert.equal(isHeicPath(join(folder, "IMG_0412.jpg")), false, "the name alone says nothing");
    assert.equal(isHeicFile(file("real.jpg", JPEG)), false, "a real JPEG is left to the usual reader");
    assert.equal(isHeicFile(file("clip.mp4", ftyp("isom"))), false, "a video in the same kind of file is not a photo");
    assert.equal(isHeicFile(file("picture.avif", ftyp("avif"))), false);
    assert.equal(isHeicFile(file("tiny.jpg", new Uint8Array([1, 2, 3]))), false);
    assert.equal(isHeicFile(file("empty.jpg", new Uint8Array(0))), false);
    assert.equal(isHeicFile(file("named.heic", "not a photo at all")), true, "a .heic name is believed; decoding it then fails in words");
    assert.equal(isHeicFile(join(folder, "missing.jpg")), false, "a file that is not there is not one");
    assert.equal(isHeicFile(folder), false, "nor is a folder");
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});

test("every place a picture is opened looks inside the file", () => {
  const main = read("src/main/main.ts");
  assert.match(main, /if \(!isHeicFile\(filePath\)\) return nativeImage\.createFromPath\(filePath\);/);
  assert.match(main, /async function heicAsPng\(filePath: string, tempFolder: string\): Promise<string> \{\s*if \(!isHeicFile\(filePath\)\) return filePath;/);
  assert.match(main, /return isHeicFile\(filePath\) \? \(await readImageFile\(filePath\)\)\.toPNG\(\) : filePath;/);
  assert.doesNotMatch(main, /isHeicPath\(/, "nothing in the app trusts the name alone any more");
  const host = read("src/main/objectOsHost.ts");
  assert.match(host, /const heic = named \|\| isHeicFile\(path\);/, "an object's photo too");
});

test("previews are made once per file, one at a time, and a changed file gets a new one", async () => {
  let running = 0;
  let most = 0;
  const made: string[] = [];
  const thumbs = createThumbnailer(async (path) => {
    running += 1;
    most = Math.max(most, running);
    await new Promise((resolve) => setTimeout(resolve, 5));
    made.push(path);
    running -= 1;
    return `data:image/jpeg;base64,${Buffer.from(path).toString("base64")}`;
  });
  const a = { path: "a.heic", version: "1:100" };
  const results = await Promise.all([thumbs.get(a), thumbs.get(a), thumbs.get({ path: "b.jpg", version: "1:5" }), thumbs.get({ path: "c.png", version: "1:7" }), thumbs.get(a)]);
  assert.equal(most, 1, "never two decodes at once");
  assert.deepEqual(made, ["a.heic", "b.jpg", "c.png"], "asked for five times, made three");
  assert.equal(results[0], results[1]);
  assert.match(results[0]!, /^data:image\/jpeg;base64,/);
  await thumbs.get(a);
  assert.equal(made.length, 3, "a preview already made is not made again");
  await thumbs.get({ path: "a.heic", version: "2:140" });
  assert.equal(made.length, 4, "the file changed, so its preview is made again");
  assert.deepEqual(thumbs.stats(), { cached: 4, waiting: 0, made: 4 });
});

test("a file that cannot be previewed says so once and does not block the rest", async () => {
  let tries = 0;
  const thumbs = createThumbnailer(async (path) => {
    if (path === "broken.heic") { tries += 1; throw new Error("This HEIC photo could not be read"); }
    return path === "notes.txt" ? null : "data:image/jpeg;base64,AA==";
  });
  assert.equal(await thumbs.get({ path: "broken.heic", version: "1" }), null);
  assert.equal(await thumbs.get({ path: "notes.txt", version: "1" }), null);
  assert.equal(await thumbs.get({ path: "fine.jpg", version: "1" }), "data:image/jpeg;base64,AA==", "the queue carries on after a failure");
  assert.equal(await thumbs.get({ path: "broken.heic", version: "1" }), null);
  assert.equal(tries, 1, "a failed file is not retried every time the list is drawn");
});

test("the cache holds a bounded number of previews, dropping the ones used longest ago", async () => {
  let made = 0;
  const thumbs = createThumbnailer(async () => { made += 1; return "data:image/jpeg;base64,AA=="; }, 3);
  for (const name of ["1", "2", "3"]) await thumbs.get({ path: name, version: "v" });
  await thumbs.get({ path: "1", version: "v" }); // used again: now the newest
  await thumbs.get({ path: "4", version: "v" }); // pushes out "2"
  assert.equal(thumbs.stats().cached, 3);
  made = 0;
  await thumbs.get({ path: "1", version: "v" });
  await thumbs.get({ path: "3", version: "v" });
  assert.equal(made, 0, "the ones still in use are kept");
  await thumbs.get({ path: "2", version: "v" });
  assert.equal(made, 1, "the one dropped is made again when asked for");
  assert.ok(THUMBNAIL_CACHE_SIZE >= 100);
});

test("a preview keeps the picture's shape and is never larger than the picture", () => {
  assert.deepEqual(fitWithin(4032, 3024, 96), { width: 96, height: 72 });
  assert.deepEqual(fitWithin(3024, 4032, 96), { width: 72, height: 96 });
  assert.deepEqual(fitWithin(40, 30, 96), { width: 40, height: 30 }, "a small picture is not blown up");
  assert.deepEqual(fitWithin(10000, 10, 96), { width: 96, height: 1 }, "never zero pixels");
  assert.deepEqual(fitWithin(0, 100, 96), { width: 0, height: 0 });
  for (const name of ["a.JPG", "b.jpeg", "c.png", "d.webp", "e.heic", "f.HEIF", "g.gif", "h.bmp"]) assert.equal(mayBePicture(name), true, name);
  for (const name of ["notes.txt", "scan.pdf", "clip.mp4", "heic", "archive.jpg.zip"]) assert.equal(mayBePicture(name), false, name);
});

test("a preview is asked for by the item's id, never by a path, and not at all in Performance Mode", () => {
  const main = read("src/main/main.ts");
  const fn = main.slice(main.indexOf("async function imageThumbnail"), main.indexOf('// --- Previews for lists') > main.indexOf("async function imageThumbnail") ? undefined : main.indexOf("async function imagesToPdf"));
  assert.match(fn, /if \(loadPerformanceModeSettings\(\)\.performanceModeEnabled\) return null;/);
  assert.match(fn, /const item = loadDropShelf\(\)\.find\(\(entry\) => entry\.id === id\);/);
  assert.match(fn, /const item = loadCaptureItems\(\)\.find\(\(entry\) => entry\.id === id && entry\.status !== "deleted"\);/);
  assert.doesNotMatch(fn, /request\??\.path|request\??\.filePath/, "the request cannot name a file");
  assert.match(fn, /stat\.size > THUMBNAIL_MAX_BYTES\) return null;/);
  assert.match(fn, /if \(!mayBePicture\(name\) && !mayBePicture\(filePath\) && !isHeicFile\(filePath\)\) return null;/, "only pictures are opened");
  assert.match(fn, /version: `\$\{stat\.mtimeMs\}:\$\{stat\.size\}`/);
  assert.match(main, /const THUMBNAIL_PIXELS = 96;/);
  assert.doesNotMatch(main.slice(main.indexOf("const thumbnailer = createThumbnailer"), main.indexOf("async function imageThumbnail")), /writeFileSync/, "nothing is written to disk");
});

test("a row asks only once it is on screen, and keeps its icon when there is no picture", () => {
  const view = read("src/renderer/views/Thumbnail.tsx");
  assert.match(view, /const observer = new IntersectionObserver\(\(entries\) => \{\s*if \(entries\.some\(\(entry\) => entry\.isIntersecting\)\) \{\s*ask\(\);\s*observer\.disconnect\(\);/);
  assert.match(view, /typeof url === "string" && url\.startsWith\("data:image\/"\)/, "only a picture is ever put in the page");
  assert.match(view, /\{src \? <img src=\{src\} alt="" className="thumbnail-image" \/> : fallback\}/);
  const drop = read("src/renderer/views/DropView.tsx");
  assert.equal((drop.match(/<Thumbnail bridge=\{getBridge\(\) as ThumbnailBridge\} module="drop"/g) ?? []).length, 2, "incoming and outgoing files");
  assert.match(read("src/renderer/main.tsx"), /\{item\.filePath \? <Thumbnail bridge=\{getBridge\(\) as ThumbnailBridge\} module="capture" id=\{item\.id\}/);
});
