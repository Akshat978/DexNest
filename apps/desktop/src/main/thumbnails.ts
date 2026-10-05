// Small previews of pictures, for lists.
//
// A preview is made only when a row asking for it is on screen, one at a
// time, and kept in memory so the same picture is not decoded twice. Decoding
// a phone photo takes about half a second, so a list of them must not all
// start at once, and nothing here runs while no list is showing.
//
// Electron-free: main.ts supplies the function that turns a file into a
// preview. Nothing is written to disk.

export interface ThumbnailSource {
  /** The file to preview. */
  path: string;
  /** What changes when the file does, so a replaced file gets a new preview. */
  version: string;
}

export interface Thumbnailer {
  /** A data URL, or null when the file is not a picture or could not be read. */
  get(source: ThumbnailSource): Promise<string | null>;
  /** How many previews are held, and how many are waiting. */
  stats(): { cached: number; waiting: number; made: number };
}

export const THUMBNAIL_CACHE_SIZE = 200;

/**
 * `make` is called at most once per file version, and never two at a time.
 * A file that fails is remembered as "no preview" so a list does not keep
 * retrying it.
 */
export function createThumbnailer(make: (path: string) => Promise<string | null>, max: number = THUMBNAIL_CACHE_SIZE): Thumbnailer {
  const cache = new Map<string, string | null>();
  const inFlight = new Map<string, Promise<string | null>>();
  let tail: Promise<unknown> = Promise.resolve();
  let made = 0;

  function remember(key: string, value: string | null): void {
    cache.delete(key);
    cache.set(key, value);
    // The oldest goes first: a Map keeps the order things were put in.
    while (cache.size > max) cache.delete(cache.keys().next().value as string);
  }

  return {
    get(source) {
      const key = `${source.path}\n${source.version}`;
      if (cache.has(key)) {
        const hit = cache.get(key) ?? null;
        remember(key, hit);
        return Promise.resolve(hit);
      }
      const running = inFlight.get(key);
      if (running) return running;
      const job = tail.then(async () => {
        let result: string | null = null;
        try {
          made += 1;
          result = await make(source.path);
        } catch {
          result = null;
        }
        remember(key, result);
        inFlight.delete(key);
        return result;
      });
      // A failed job must not stop the ones queued behind it.
      tail = job.catch(() => undefined);
      inFlight.set(key, job);
      return job;
    },
    stats: () => ({ cached: cache.size, waiting: inFlight.size, made })
  };
}

/** File names that may be pictures. A phone photo saved under another picture's extension is caught by its bytes. */
export function mayBePicture(fileName: string): boolean {
  return /\.(png|jpe?g|gif|webp|bmp|heic|heif)$/i.test(fileName);
}

/** The size of a preview inside `box` pixels, keeping the picture's shape and never enlarging it. */
export function fitWithin(width: number, height: number, box: number): { width: number; height: number } {
  if (!(width > 0) || !(height > 0)) return { width: 0, height: 0 };
  const scale = Math.min(1, box / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}
