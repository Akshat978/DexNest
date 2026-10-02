// ObjectOS's files, on disk.
//
// The real ObjectFilePort: every stored file lives at
// <data root>/files/objects/<object id>/<stored name>, and nothing else is
// written. Sources are checked against DexNest's data boundary by their
// written and their resolved path (links and junctions followed) - once
// when inspected, and again right before they are opened for copying.
// Copies stream through a size cap and SHA-256, into a temporary name that
// is renamed only when complete. Stored files are handed out only when,
// resolved, they are still inside their object's folder.
//
// Nothing here parses a file. See docs/modules/object_os/PLAN.md, section 7.

import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, existsSync, lstatSync, mkdirSync, realpathSync, renameSync, rmSync, statSync } from "node:fs";
import { dirname, join, sep } from "node:path";
import { Transform, type Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createDataBoundary } from "@dexnest/foundation";
import type { CopiedFile, ObjectFilePort } from "@dexnest/object-os";

export interface ObjectFileStoreOptions {
  /** DexNest's resolved data root. */
  dataRoot: string;
  /** Every other place DexNest data can live. */
  otherDataRoots: readonly string[];
  /** Tests only; production resolves junctions with fs.realpathSync.native. */
  realpath?: (path: string) => string;
}

export interface ObjectFileStore extends ObjectFilePort {
  /** Inside DexNest's data (any root), by the written or the resolved path, or through the parent folder. */
  isSensitive(path: string): boolean;
  /** The object's folder (it may not exist). */
  folderOf(objectId: string): string;
  /**
   * Streams bytes into an object's folder under a stored name: size-capped,
   * hashed, temporary name then rename. Used for attaching and for import.
   * `check` runs on the finished copy before the rename; if it throws, the
   * copy is removed.
   */
  writeFrom(open: () => Readable, objectId: string, storedName: string, maxBytes: number, check?: (copied: CopiedFile) => void): Promise<CopiedFile>;
}

// The object id and the stored name come from the domain, already validated;
// this is the last line, so it checks again.
const OBJECT_ID = /^[0-9A-HJKMNP-TV-Z]{8}$/;
const SAFE_SEGMENT = /^[A-Za-z0-9_][A-Za-z0-9 _.()-]*$/;

function within(child: string, parent: string): boolean {
  const norm = (p: string) => (process.platform === "win32" ? p.toLowerCase() : p);
  const c = norm(child.endsWith(sep) ? child : child + sep);
  const p = norm(parent.endsWith(sep) ? parent : parent + sep);
  return c.startsWith(p);
}

export function createObjectFileStore(options: ObjectFileStoreOptions): ObjectFileStore {
  const realpath = options.realpath ?? ((p: string) => realpathSync.native(p));
  const boundary = createDataBoundary({ dataRoot: options.dataRoot, extraSensitiveRoots: options.otherDataRoots, realpath });
  // A path that does not exist yet (an export destination) is judged by its folder too.
  const isSensitive = (path: string) => boundary.isSensitive(path) || boundary.isSensitive(dirname(path));
  const objectsRoot = join(options.dataRoot, "files", "objects");

  const folderOf = (objectId: string) => {
    if (!OBJECT_ID.test(objectId)) throw new Error("ObjectOS refused a malformed object id.");
    return join(objectsRoot, objectId);
  };
  const target = (objectId: string, storedName: string) => {
    if (!SAFE_SEGMENT.test(storedName) || storedName.includes("..") || storedName.length > 200) throw new Error("ObjectOS refused a malformed stored name.");
    return join(folderOf(objectId), storedName);
  };

  /**
   * Makes sure the object's folder exists and is really where it should be:
   * neither files/objects nor the folder may be a link that leads elsewhere.
   */
  function ensureFolder(objectId: string): string {
    const folder = folderOf(objectId);
    mkdirSync(folder, { recursive: true });
    const realRoot = realpath(options.dataRoot);
    const realObjects = realpath(objectsRoot);
    if (realObjects !== join(realRoot, "files", "objects") && !(process.platform === "win32" && realObjects.toLowerCase() === join(realRoot, "files", "objects").toLowerCase())) {
      throw new Error("ObjectOS's folder is not where it should be, so nothing was written.");
    }
    if (lstatSync(folder).isSymbolicLink() || !within(realpath(folder), realObjects)) {
      throw new Error("This object's folder is not where it should be, so nothing was written.");
    }
    return folder;
  }

  async function writeFrom(open: () => Readable, objectId: string, storedName: string, maxBytes: number, check?: (copied: CopiedFile) => void): Promise<CopiedFile> {
    ensureFolder(objectId);
    const final = target(objectId, storedName);
    const temp = `${final}.part`;
    const hash = createHash("sha256");
    let size = 0;
    const meter = new Transform({
      transform(chunk: Buffer, _encoding, done) {
        size += chunk.length;
        if (size > maxBytes) {
          done(new Error("The file is larger than ObjectOS allows."));
          return;
        }
        hash.update(chunk);
        done(null, chunk);
      }
    });
    try {
      // "wx": never write through something already sitting at the temporary name.
      // The source is opened only once the destination is known to be safe.
      await pipeline(open(), meter, createWriteStream(temp, { flags: "wx" }));
      const copied = { sizeBytes: size, sha256: hash.digest("hex") };
      check?.(copied);
      if (existsSync(final)) throw new Error("A stored file with that name already exists.");
      renameSync(temp, final);
      return copied;
    } catch (error) {
      rmSync(temp, { force: true });
      throw error;
    }
  }

  const store: ObjectFileStore = {
    isSensitive,
    folderOf,
    writeFrom,
    inspect(sourcePath) {
      if (!existsSync(sourcePath)) return null;
      const real = realpath(sourcePath);
      const st = statSync(real);
      return { realPath: real, insideDataRoot: isSensitive(sourcePath) || isSensitive(real), isFile: st.isFile(), sizeBytes: st.size };
    },
    async copyIn(sourcePath, objectId, storedName, maxBytes) {
      // Checked again at the moment of copying: the source may have been swapped for a link since it was inspected.
      const real = realpath(sourcePath);
      if (isSensitive(sourcePath) || isSensitive(real)) throw new Error("ObjectOS does not copy files from inside DexNest's data.");
      if (!statSync(real).isFile()) throw new Error("Only files can be attached.");
      return writeFrom(() => createReadStream(real), objectId, storedName, maxBytes);
    },
    remove(objectId, storedName) {
      rmSync(target(objectId, storedName), { force: true });
    },
    removeFolder(objectId) {
      const folder = folderOf(objectId);
      if (!existsSync(folder)) return;
      // A folder that has become a link is unlinked, never followed.
      if (lstatSync(folder).isSymbolicLink()) {
        rmSync(folder, { force: true });
        return;
      }
      rmSync(folder, { recursive: true, force: true });
    },
    resolveStored(objectId, storedName) {
      let path: string;
      try {
        path = target(objectId, storedName);
      } catch {
        return null;
      }
      if (!existsSync(path)) return null;
      try {
        const folder = folderOf(objectId);
        // A link placed in the folder later, or a folder that is itself a link out, is refused.
        if (lstatSync(path).isSymbolicLink() || lstatSync(folder).isSymbolicLink()) return null;
        const real = realpath(path);
        const realFolder = realpath(folder);
        if (!within(real, realFolder) || !within(realFolder, realpath(objectsRoot))) return null;
        if (isSensitiveOutsideObjects(real)) return null;
        return statSync(real).isFile() ? real : null;
      } catch {
        return null;
      }
    }
  };

  /** Belt and braces: the resolved file must still be inside the data root's objects folder. */
  function isSensitiveOutsideObjects(real: string): boolean {
    return !within(real, realpath(objectsRoot));
  }

  return store;
}
