// ObjectOS's export zips, written and read without holding them in memory.
//
// Writing: entries are stored (not compressed - photos and PDFs already
// are), each streamed from disk through CRC-32 and SHA-256; the local header
// is patched with the real sizes afterwards, so the zip is a plain one any
// tool opens. The zip is written under a temporary name and renamed when
// complete. Files whose bytes no longer match the SHA-256 ObjectOS recorded
// stop the export, so every export can be imported.
//
// Reading: the central directory is parsed with hard caps. Entry names are
// never used as paths: ObjectOS asks for entries by the names its validated
// rows produce, and the bytes go into a path built from the object id and
// stored name (zip-slip has nothing to act on). Encrypted entries, ZIP64,
// multi-disk archives, duplicate names and compression other than stored or
// deflate are refused. Every copied entry is checked against its declared
// size and CRC-32 and against the SHA-256 in the export.

import { createHash } from "node:crypto";
import { closeSync, createReadStream, fstatSync, openSync, readSync, renameSync, rmSync, writeSync } from "node:fs";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createInflateRaw, inflateRawSync } from "node:zlib";
import type { CopiedFile, ImportArchive } from "@dexnest/object-os";
import type { ObjectFileStore } from "./objectOsFiles.ts";

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_END = 0x06054b50;
const MAX_U32 = 0xffffffff;
const MAX_U16 = 0xffff;
/** UTF-8 names. */
const FLAG_UTF8 = 0x0800;

export const ZIP_LIMITS = {
  /** No ZIP64: the whole zip must fit the classic format. */
  maxZipBytes: MAX_U32 - 1024 * 1024,
  maxEntries: 60_000,
  maxCentralDirectoryBytes: 32 * 1024 * 1024,
  maxNameBytes: 512
} as const;

// --- CRC-32 -----------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(buffer: Uint8Array, previous = 0): number {
  let crc = (previous ^ MAX_U32) >>> 0;
  for (let i = 0; i < buffer.length; i++) crc = (CRC_TABLE[(crc ^ (buffer[i] as number)) & 0xff] as number) ^ (crc >>> 8);
  return (crc ^ MAX_U32) >>> 0;
}

// --- writing ----------------------------------------------------------------

export interface ZipSource {
  /** The name inside the zip. */
  name: string;
  /** Bytes held in memory (the JSON) or a file on disk. */
  data: Buffer | { path: string; sizeBytes: number; sha256: string };
}

interface Written {
  name: Buffer;
  crc: number;
  size: number;
  offset: number;
}

function localHeader(name: Buffer, crc: number, size: number): Buffer {
  const h = Buffer.alloc(30);
  h.writeUInt32LE(SIG_LOCAL, 0);
  h.writeUInt16LE(20, 4); // version needed
  h.writeUInt16LE(FLAG_UTF8, 6);
  h.writeUInt16LE(0, 8); // stored
  h.writeUInt16LE(0, 10); // time
  h.writeUInt16LE(0x21, 12); // date: 1980-01-01; ObjectOS keeps its own dates in the JSON
  h.writeUInt32LE(crc, 14);
  h.writeUInt32LE(size, 18);
  h.writeUInt32LE(size, 22);
  h.writeUInt16LE(name.length, 26);
  h.writeUInt16LE(0, 28);
  return h;
}

function centralHeader(entry: Written): Buffer {
  const h = Buffer.alloc(46);
  h.writeUInt32LE(SIG_CENTRAL, 0);
  h.writeUInt16LE(20, 4); // made by
  h.writeUInt16LE(20, 6); // needed
  h.writeUInt16LE(FLAG_UTF8, 8);
  h.writeUInt16LE(0, 10);
  h.writeUInt16LE(0, 12);
  h.writeUInt16LE(0x21, 14);
  h.writeUInt32LE(entry.crc, 16);
  h.writeUInt32LE(entry.size, 20);
  h.writeUInt32LE(entry.size, 24);
  h.writeUInt16LE(entry.name.length, 28);
  h.writeUInt16LE(0, 30); // extra
  h.writeUInt16LE(0, 32); // comment
  h.writeUInt16LE(0, 34); // disk
  h.writeUInt16LE(0, 36); // internal attributes
  h.writeUInt32LE(0, 38); // external attributes
  h.writeUInt32LE(entry.offset, 42);
  return h;
}

/**
 * Writes a zip at `outPath` (through `<outPath>.part`). Throws, leaving
 * nothing behind, if a file is missing, changed since ObjectOS recorded it,
 * or the zip would be too large for the classic format.
 */
export async function writeZip(outPath: string, sources: readonly ZipSource[]): Promise<{ bytes: number }> {
  if (sources.length > ZIP_LIMITS.maxEntries) throw new Error("That is too many files for one export. Export fewer objects at a time.");
  const temp = `${outPath}.part`;
  const fd = openSync(temp, "wx");
  let position = 0;
  const put = (buffer: Buffer, at?: number) => {
    const where = at ?? position;
    let done = 0;
    while (done < buffer.length) done += writeSync(fd, buffer, done, buffer.length - done, where + done);
    if (at === undefined) position += buffer.length;
  };
  const written: Written[] = [];
  try {
    for (const source of sources) {
      const name = Buffer.from(source.name, "utf8");
      if (name.length > ZIP_LIMITS.maxNameBytes) throw new Error("An export entry name is too long.");
      const offset = position;
      put(localHeader(name, 0, 0));
      put(name);
      let crc = 0;
      let size = 0;
      if (Buffer.isBuffer(source.data)) {
        crc = crc32(source.data);
        size = source.data.length;
        put(source.data);
      } else {
        const hash = createHash("sha256");
        for await (const chunk of createReadStream(source.data.path) as AsyncIterable<Buffer>) {
          size += chunk.length;
          if (size > source.data.sizeBytes) break;
          crc = crc32(chunk, crc);
          hash.update(chunk);
          put(chunk);
        }
        if (size !== source.data.sizeBytes || hash.digest("hex") !== source.data.sha256) {
          throw new Error("A stored file has changed since it was attached, so the export was stopped.");
        }
      }
      if (position > ZIP_LIMITS.maxZipBytes) throw new Error("That export is too large for one zip. Export fewer objects at a time.");
      // Patch the real CRC and sizes into the local header.
      put(localHeader(name, crc, size), offset);
      written.push({ name, crc, size, offset });
    }
    const centralStart = position;
    for (const entry of written) {
      put(centralHeader(entry));
      put(entry.name);
    }
    const centralSize = position - centralStart;
    if (position > ZIP_LIMITS.maxZipBytes) throw new Error("That export is too large for one zip. Export fewer objects at a time.");
    const end = Buffer.alloc(22);
    end.writeUInt32LE(SIG_END, 0);
    end.writeUInt16LE(written.length, 8);
    end.writeUInt16LE(written.length, 10);
    end.writeUInt32LE(centralSize, 12);
    end.writeUInt32LE(centralStart, 16);
    put(end);
    closeSync(fd);
    renameSync(temp, outPath);
    return { bytes: position };
  } catch (error) {
    try {
      closeSync(fd);
    } catch {
      // already closed
    }
    rmSync(temp, { force: true });
    throw error;
  }
}

// --- reading ----------------------------------------------------------------

interface CentralEntry {
  name: string;
  method: number;
  crc: number;
  compressedSize: number;
  size: number;
  localOffset: number;
}

export interface OpenedZip extends ImportArchive {
  /** Names of every entry, as the zip lists them (for tests and diagnostics; never used as paths). */
  names(): string[];
  close(): void;
}

export class ZipRefused extends Error {}

function readAt(fd: number, position: number, length: number): Buffer {
  const buffer = Buffer.alloc(length);
  let done = 0;
  while (done < length) {
    const n = readSync(fd, buffer, done, length - done, position + done);
    if (n === 0) throw new ZipRefused("The zip ends early.");
    done += n;
  }
  return buffer;
}

/** A stream of an entry's bytes, uncompressed, that fails if it yields more than `limit` bytes. */
function capped(limit: number): Transform {
  let size = 0;
  return new Transform({
    transform(chunk: Buffer, _encoding, done) {
      size += chunk.length;
      if (size > limit) {
        done(new ZipRefused("A file in the zip is larger than it says."));
        return;
      }
      done(null, chunk);
    }
  });
}

/**
 * Opens an import zip. Throws ZipRefused for anything that is not a plain,
 * unencrypted, single-disk zip within the caps.
 */
export function openZip(path: string, files: ObjectFileStore, maxZipBytes: number): OpenedZip {
  const fd = openSync(path, "r");
  try {
    const total = fstatSync(fd).size;
    if (total > Math.min(maxZipBytes, ZIP_LIMITS.maxZipBytes)) throw new ZipRefused("That zip is too large to import.");
    if (total < 22) throw new ZipRefused("That is not a zip file.");

    // The end record is in the last 22 + 65535 bytes.
    const tailLength = Math.min(total, 22 + MAX_U16);
    const tail = readAt(fd, total - tailLength, tailLength);
    let endAt = -1;
    for (let i = tail.length - 22; i >= 0; i--) {
      if (tail.readUInt32LE(i) === SIG_END) {
        endAt = i;
        break;
      }
    }
    if (endAt < 0) throw new ZipRefused("That is not a zip file.");
    const diskNumber = tail.readUInt16LE(endAt + 4);
    const cdDisk = tail.readUInt16LE(endAt + 6);
    const entriesHere = tail.readUInt16LE(endAt + 8);
    const entriesTotal = tail.readUInt16LE(endAt + 10);
    const cdSize = tail.readUInt32LE(endAt + 12);
    const cdOffset = tail.readUInt32LE(endAt + 16);
    if (diskNumber !== 0 || cdDisk !== 0 || entriesHere !== entriesTotal) throw new ZipRefused("Multi-part zips are not supported.");
    if (entriesTotal === MAX_U16 || cdSize === MAX_U32 || cdOffset === MAX_U32) throw new ZipRefused("ZIP64 zips are not supported.");
    if (entriesTotal > ZIP_LIMITS.maxEntries) throw new ZipRefused("That zip has too many entries.");
    if (cdSize > ZIP_LIMITS.maxCentralDirectoryBytes) throw new ZipRefused("That zip's directory is too large.");
    const endPosition = total - tailLength + endAt;
    if (cdOffset + cdSize > endPosition) throw new ZipRefused("That zip's directory is damaged.");

    const cd = readAt(fd, cdOffset, cdSize);
    const entries = new Map<string, CentralEntry>();
    let p = 0;
    for (let i = 0; i < entriesTotal; i++) {
      if (p + 46 > cd.length || cd.readUInt32LE(p) !== SIG_CENTRAL) throw new ZipRefused("That zip's directory is damaged.");
      const flags = cd.readUInt16LE(p + 8);
      const method = cd.readUInt16LE(p + 10);
      const crc = cd.readUInt32LE(p + 16);
      const compressedSize = cd.readUInt32LE(p + 20);
      const size = cd.readUInt32LE(p + 24);
      const nameLength = cd.readUInt16LE(p + 28);
      const extraLength = cd.readUInt16LE(p + 30);
      const commentLength = cd.readUInt16LE(p + 32);
      const localOffset = cd.readUInt32LE(p + 42);
      if (nameLength > ZIP_LIMITS.maxNameBytes) throw new ZipRefused("A name in that zip is too long.");
      if (p + 46 + nameLength + extraLength + commentLength > cd.length) throw new ZipRefused("That zip's directory is damaged.");
      if (flags & 0x0001) throw new ZipRefused("Encrypted zips are not supported.");
      if (compressedSize === MAX_U32 || size === MAX_U32 || localOffset === MAX_U32) throw new ZipRefused("ZIP64 zips are not supported.");
      const name = cd.toString(flags & FLAG_UTF8 ? "utf8" : "latin1", p + 46, p + 46 + nameLength);
      if (entries.has(name)) throw new ZipRefused("That zip lists the same name twice.");
      if (localOffset + 30 > cdOffset) throw new ZipRefused("That zip's directory is damaged.");
      entries.set(name, { name, method, crc, compressedSize, size, localOffset });
      p += 46 + nameLength + extraLength + commentLength;
    }

    /** The entry's compressed bytes: where they start, checked against the local header. */
    const dataRange = (entry: CentralEntry): { start: number; end: number } => {
      const local = readAt(fd, entry.localOffset, 30);
      if (local.readUInt32LE(0) !== SIG_LOCAL) throw new ZipRefused("A file in the zip is damaged.");
      if (local.readUInt16LE(6) & 0x0001) throw new ZipRefused("Encrypted zips are not supported.");
      const start = entry.localOffset + 30 + local.readUInt16LE(26) + local.readUInt16LE(28);
      const end = start + entry.compressedSize;
      if (end > cdOffset) throw new ZipRefused("A file in the zip is damaged.");
      return { start, end };
    };

    /** The entry's uncompressed bytes, capped at its declared size, with its CRC checked at the end. */
    const entryStream = (entry: CentralEntry): Readable => {
      if (entry.method !== 0 && entry.method !== 8) throw new ZipRefused("A file in the zip uses a compression ObjectOS does not read.");
      const { start, end } = dataRange(entry);
      const raw: Readable = entry.compressedSize === 0 ? Readable.from([]) : createReadStream(path, { start, end: end - 1 });
      let crc = 0;
      let seen = 0;
      const verify = new Transform({
        transform(chunk: Buffer, _encoding, done) {
          seen += chunk.length;
          if (seen > entry.size) {
            done(new ZipRefused("A file in the zip is larger than it says."));
            return;
          }
          crc = crc32(chunk, crc);
          done(null, chunk);
        },
        flush(done) {
          if (seen !== entry.size || crc !== entry.crc) done(new ZipRefused("A file in the zip is damaged."));
          else done();
        }
      });
      // .pipe() does not pass errors on: every stage's error ends the last
      // one (which the caller's pipeline watches), and when the last one
      // closes, for any reason, every stage before it is closed too.
      const stages: Readable[] = entry.method === 8 ? [raw, createInflateRaw(), capped(entry.size)] : [raw];
      let tail: Readable = stages[0] as Readable;
      for (const stage of stages.slice(1)) tail = tail.pipe(stage as Transform);
      tail.pipe(verify);
      for (const stage of stages) stage.on("error", (error) => verify.destroy(error));
      verify.on("close", () => {
        for (const stage of stages) stage.destroy();
      });
      return verify;
    };

    let closed = false;
    return {
      names: () => [...entries.keys()],
      manifestText() {
        const entry = entries.get("object-os.json");
        if (!entry) return null;
        // Read synchronously through the same checks; the caller has already capped the size.
        return readEntrySync(fd, entry, dataRange(entry));
      },
      entrySize(zipPath) {
        return entries.get(zipPath)?.size ?? null;
      },
      async copyEntry(zipPath, objectId, storedName, expected: CopiedFile) {
        const entry = entries.get(zipPath);
        if (!entry) throw new ZipRefused("The zip is missing a file the export lists.");
        if (entry.size !== expected.sizeBytes) throw new ZipRefused("A file in the zip does not match the export.");
        await files.writeFrom(() => entryStream(entry), objectId, storedName, expected.sizeBytes, (copied) => {
          if (copied.sizeBytes !== expected.sizeBytes || copied.sha256 !== expected.sha256) throw new ZipRefused("A file in the zip does not match the export.");
        });
      },
      close() {
        if (closed) return;
        closed = true;
        closeSync(fd);
      }
    };
  } catch (error) {
    closeSync(fd);
    throw error;
  }
}

/** The manifest, read whole (it is size-capped by the caller) and CRC-checked. */
function readEntrySync(fd: number, entry: CentralEntry, range: { start: number; end: number }): string {
  if (entry.method !== 0 && entry.method !== 8) throw new ZipRefused("A file in the zip uses a compression ObjectOS does not read.");
  const raw = readAt(fd, range.start, range.end - range.start);
  const bytes = entry.method === 8 ? inflateRawSync(raw, { maxOutputLength: Math.max(1, entry.size) }) : raw;
  if (bytes.length !== entry.size || crc32(bytes) !== entry.crc) throw new ZipRefused("A file in the zip is damaged.");
  return bytes.toString("utf8");
}

