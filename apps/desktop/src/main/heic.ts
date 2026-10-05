// HEIC and HEIF: the photos phones take.
//
// Chromium (and so Electron's nativeImage) does not decode them, and neither
// does Jimp, so every place DexNest reads an image goes through here first.
// The decoder is `heic-decode` on top of `libheif-js`: JavaScript and
// WebAssembly, run locally, nothing sent anywhere. It is several megabytes, so
// it is imported the first time a HEIC file is actually opened and never at
// start-up.
//
// Electron-free: the callers turn the pixels into whatever they need.

import { closeSync, openSync, readFileSync, readSync } from "node:fs";
import { extname } from "node:path";

export const HEIC_EXTENSIONS: readonly string[] = [".heic", ".heif"];

/** By extension alone. `isHeicFile` also looks inside. */
export function isHeicPath(filePath: string): boolean {
  return HEIC_EXTENSIONS.includes(extname(filePath).toLowerCase());
}

/**
 * Whether the file is a HEIC or HEIF photo, whatever it is called. A phone
 * photo saved or renamed as .jpg is still HEIC inside, and nothing that
 * trusts the name can open it. Reads sixteen bytes; a file that cannot be
 * read is simply not one.
 */
export function isHeicFile(filePath: string): boolean {
  if (isHeicPath(filePath)) return true;
  let handle: number | null = null;
  try {
    handle = openSync(filePath, "r");
    const head = new Uint8Array(16);
    const read = readSync(handle, head, 0, head.length, 0);
    return looksLikeHeic(head.subarray(0, read));
  } catch {
    return false;
  } finally {
    if (handle !== null) {
      try { closeSync(handle); } catch { /* already closed */ }
    }
  }
}

const BRANDS = new Set(["heic", "heix", "hevc", "hevx", "heim", "heis", "hevm", "hevs", "mif1", "msf1", "heif"]);

/** The ISO base media "ftyp" box with a HEIF brand, in the first bytes of the file. */
export function looksLikeHeic(bytes: Uint8Array): boolean {
  if (bytes.length < 12) return false;
  const text = (from: number) => String.fromCharCode(bytes[from]!, bytes[from + 1]!, bytes[from + 2]!, bytes[from + 3]!);
  return text(4) === "ftyp" && BRANDS.has(text(8));
}

export interface DecodedImage {
  width: number;
  height: number;
  /** RGBA, four bytes a pixel, top row first. */
  data: Uint8Array;
}

/** Largest picture decoded: 100 megapixels. A phone photo is 12 to 50. */
export const MAX_HEIC_PIXELS = 100_000_000;

type Decoder = (input: { buffer: Uint8Array }) => Promise<{ width: number; height: number; data: Uint8ClampedArray | Uint8Array }>;
let decoder: Promise<Decoder> | null = null;

function loadDecoder(): Promise<Decoder> {
  // On demand: the module is not touched until a HEIC file is.
  decoder ??= import("heic-decode").then((module) => ((module as { default?: Decoder }).default ?? (module as unknown as Decoder)));
  return decoder;
}

export async function decodeHeic(bytes: Uint8Array): Promise<DecodedImage> {
  let decoded: Awaited<ReturnType<Decoder>>;
  try {
    decoded = await (await loadDecoder())({ buffer: bytes });
  } catch (error) {
    throw new Error(`This HEIC photo could not be read${error instanceof Error && error.message ? `: ${error.message}` : "."}`);
  }
  if (!Number.isInteger(decoded.width) || !Number.isInteger(decoded.height) || decoded.width <= 0 || decoded.height <= 0) {
    throw new Error("This HEIC photo has no picture in it.");
  }
  if (decoded.width * decoded.height > MAX_HEIC_PIXELS) throw new Error("This HEIC photo is too large to open.");
  return { width: decoded.width, height: decoded.height, data: decoded.data instanceof Uint8Array ? decoded.data : new Uint8Array(decoded.data.buffer, decoded.data.byteOffset, decoded.data.byteLength) };
}

export async function decodeHeicFile(filePath: string): Promise<DecodedImage> {
  return decodeHeic(readFileSync(filePath));
}

/** RGBA to BGRA in place: the order Electron's bitmap images use. */
export function toBgra(data: Uint8Array): Uint8Array {
  for (let i = 0; i + 3 < data.length; i += 4) {
    const red = data[i]!;
    data[i] = data[i + 2]!;
    data[i + 2] = red;
  }
  return data;
}

/** Whether the decoder has been loaded: for the test that start-up does not load it. */
export const heicDecoderLoaded = (): boolean => decoder !== null;
