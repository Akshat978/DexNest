/**
 * What ObjectOS needs from the host to handle files. The package never
 * touches the file system itself (static test); the host implements this
 * with the data boundary and real I/O, and tests implement it over temp
 * directories.
 *
 * Every path the host builds is `<data root>/files/objects/<object id>/<stored name>`,
 * from an object id and a stored name the domain has already validated.
 */

/** What the host found out about a source without reading its contents. */
export interface SourceInfo {
  /** Where it really is, junctions and links resolved. */
  realPath: string;
  /** Inside DexNest's data root, by its written or its resolved path. */
  insideDataRoot: boolean;
  isFile: boolean;
  sizeBytes: number;
}

export interface CopiedFile {
  sizeBytes: number;
  /** Lower-case hex SHA-256, computed while copying. */
  sha256: string;
}

export interface ObjectFilePort {
  /** Null when the source does not exist. Never reads the contents. */
  inspect(sourcePath: string): SourceInfo | null;
  /**
   * Copies the source into the object's folder. Streams, hashing as it goes;
   * stops and leaves nothing behind if the file grows past `maxBytes` or
   * anything fails (it writes a temporary name and renames at the end).
   */
  copyIn(sourcePath: string, objectId: string, storedName: string, maxBytes: number): Promise<CopiedFile>;
  /** Deletes one stored file. Missing is fine. */
  remove(objectId: string, storedName: string): void;
  /** Deletes an object's whole folder. Missing is fine. */
  removeFolder(objectId: string): void;
  /**
   * The absolute path of a stored file, only if it exists and - resolved -
   * is still inside that object's folder (a link or junction placed there
   * later is refused). Null otherwise.
   */
  resolveStored(objectId: string, storedName: string): string | null;
}

/** An import zip, as the host opened it. Entry names are the zip's own; ObjectOS asks only for names it expects. */
export interface ImportArchive {
  /** The text of `object-os.json`, or null if the zip has none. */
  manifestText(): string | null;
  /** Uncompressed size of an entry, or null if there is no such entry. */
  entrySize(zipPath: string): number | null;
  /**
   * Copies one entry into the object's folder, verifying size and SHA-256 as
   * it goes; throws (leaving nothing) on any mismatch.
   */
  copyEntry(zipPath: string, objectId: string, storedName: string, expected: CopiedFile): Promise<void>;
}
