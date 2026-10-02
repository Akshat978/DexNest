/**
 * A real file port over a temp directory, for tests: the data boundary from
 * @dexnest/foundation with realpath, streamed copies with SHA-256, a temp
 * name and a rename, a size cap enforced while copying. The host's own port
 * (Phase 5) does the same with Electron around it.
 */
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import { createDataBoundary } from '@dexnest/foundation';
import type { CopiedFile, ImportArchive, ObjectFilePort } from '../index.ts';

export interface TestPort extends ObjectFilePort {
  dataRoot: string;
  folderOf(objectId: string): string;
  calls: string[];
  /** Fault injection: throw after this many bytes of the next copy. */
  failCopyAfterBytes: number | null;
}

const SAFE_SEGMENT = /^[A-Za-z0-9_][A-Za-z0-9 _.()-]*$/;

function within(child: string, parent: string): boolean {
  const c = child.endsWith(sep) ? child : child + sep;
  const p = parent.endsWith(sep) ? parent : parent + sep;
  return c.startsWith(p);
}

export function createTestPort(dataRoot: string): TestPort {
  const boundary = createDataBoundary({ dataRoot, realpath: (p) => realpathSync.native(p) });
  const objectsRoot = join(dataRoot, 'files', 'objects');
  const folderOf = (objectId: string) => {
    if (!/^[0-9A-Z]{8}$/.test(objectId)) throw new Error('bad object id');
    return join(objectsRoot, objectId);
  };
  const target = (objectId: string, storedName: string) => {
    if (!SAFE_SEGMENT.test(storedName) || storedName.includes('..')) throw new Error('bad stored name');
    return join(folderOf(objectId), storedName);
  };

  async function streamInto(read: NodeJS.ReadableStream, objectId: string, storedName: string, maxBytes: number, failAfter: number | null): Promise<CopiedFile> {
    const final = target(objectId, storedName);
    mkdirSync(dirname(final), { recursive: true });
    const temp = `${final}.part`;
    const hash = createHash('sha256');
    let size = 0;
    const meter = new Transform({
      transform(chunk: Buffer, _enc, done) {
        size += chunk.length;
        if (size > maxBytes) return done(new Error('file grew past the size limit'));
        if (failAfter !== null && size > failAfter) return done(new Error('disk I/O error (injected)'));
        hash.update(chunk);
        done(null, chunk);
      },
    });
    try {
      await pipeline(read, meter, createWriteStream(temp, { flags: 'wx' }));
      renameSync(temp, final);
    } catch (error) {
      rmSync(temp, { force: true });
      throw error;
    }
    return { sizeBytes: size, sha256: hash.digest('hex') };
  }

  const port: TestPort = {
    dataRoot,
    folderOf,
    calls: [],
    failCopyAfterBytes: null,
    inspect(sourcePath) {
      port.calls.push(`inspect ${sourcePath}`);
      if (!existsSync(sourcePath)) return null;
      const real = realpathSync.native(sourcePath);
      const st = statSync(real);
      return { realPath: real, insideDataRoot: boundary.isSensitive(sourcePath) || boundary.isSensitive(real), isFile: st.isFile(), sizeBytes: st.size };
    },
    async copyIn(sourcePath, objectId, storedName, maxBytes) {
      port.calls.push(`copyIn ${sourcePath}`);
      const failAfter = port.failCopyAfterBytes;
      port.failCopyAfterBytes = null;
      return streamInto(createReadStream(realpathSync.native(sourcePath)), objectId, storedName, maxBytes, failAfter);
    },
    remove(objectId, storedName) {
      rmSync(target(objectId, storedName), { force: true });
    },
    removeFolder(objectId) {
      rmSync(folderOf(objectId), { recursive: true, force: true });
    },
    resolveStored(objectId, storedName) {
      const path = target(objectId, storedName);
      if (!existsSync(path)) return null;
      const folder = realpathSync.native(folderOf(objectId));
      const real = realpathSync.native(path);
      // A link placed in the folder later, or a folder that is itself a link out, is refused.
      if (lstatSync(path).isSymbolicLink() || !within(real, folder) || !within(folder, realpathSync.native(objectsRoot))) return null;
      return real;
    },
  };
  return port;
}

/** An "archive" held in memory, as the host would present a zip it opened. */
export function memoryArchive(port: TestPort, entries: Map<string, Buffer>, manifest: string | null): ImportArchive & { entries: Map<string, Buffer> } {
  return {
    entries,
    manifestText: () => manifest,
    entrySize: (zipPath) => entries.get(zipPath)?.length ?? null,
    async copyEntry(zipPath, objectId, storedName, expected) {
      const bytes = entries.get(zipPath);
      if (!bytes) throw new Error('missing entry');
      const { Readable } = await import('node:stream');
      const got = await (async () => {
        const final = join(port.folderOf(objectId), storedName);
        mkdirSync(dirname(final), { recursive: true });
        const temp = `${final}.part`;
        const hash = createHash('sha256').update(bytes).digest('hex');
        if (bytes.length !== expected.sizeBytes || hash !== expected.sha256) throw new Error('size or hash does not match');
        await pipeline(Readable.from(bytes), createWriteStream(temp, { flags: 'wx' }));
        renameSync(temp, final);
        return hash;
      })();
      if (got !== expected.sha256) throw new Error('hash mismatch');
    },
  };
}

export const sha256Of = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');
