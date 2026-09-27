import { LRUMap } from 'mnemonist';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * A cache of map tiles in memory and on disk, so that a book's maps are drawn again (the preview, the PDF, a highlight
 * video) without asking the tile server again. Tiles on disk expire after `ttlMs`, and the oldest are removed once the
 * folder grows past `maxBytes`. An empty tile is kept as an empty file.
 */
export type TileCacheOptions = {
  /** default 30 days */
  ttlMs?: number;
  /** default 512 MB */
  maxBytes?: number;
  /** tiles kept in memory, default 160 */
  memoryEntries?: number;
  /** how often the folder is pruned, default once an hour */
  pruneIntervalMs?: number;
  now?: () => number;
};

const DAY_MS = 24 * 60 * 60 * 1000;

export const TILE_CACHE_TTL_MS = 30 * DAY_MS;
export const TILE_CACHE_MAX_BYTES = 512 * 1024 * 1024;

type Entry = { data: Buffer | null; at: number };

export class TileCache {
  private memory: LRUMap<string, Entry>;
  private ttlMs: number;
  private maxBytes: number;
  private pruneIntervalMs: number;
  private now: () => number;
  private lastPrune = 0;
  private pruning?: Promise<void>;

  constructor(options: TileCacheOptions = {}) {
    this.ttlMs = options.ttlMs ?? TILE_CACHE_TTL_MS;
    this.maxBytes = options.maxBytes ?? TILE_CACHE_MAX_BYTES;
    this.pruneIntervalMs = options.pruneIntervalMs ?? 60 * 60 * 1000;
    this.now = options.now ?? Date.now;
    this.memory = new LRUMap(options.memoryEntries ?? 160);
  }

  static keyOf(url: string) {
    return createHash('sha1').update(url).digest('hex');
  }

  private pathOf(folder: string, key: string) {
    return join(folder, key.slice(0, 2), `${key}.mvt`);
  }

  /** a fresh tile, `null` for a known empty tile, `undefined` when it is not cached (or expired) */
  async get(url: string, folder?: string): Promise<Buffer | null | undefined> {
    const key = TileCache.keyOf(url);
    const cached = this.memory.get(key);
    if (cached && this.now() - cached.at < this.ttlMs) {
      return cached.data;
    }

    if (!folder) {
      return;
    }
    try {
      const path = this.pathOf(folder, key);
      const info = await stat(path);
      if (this.now() - info.mtimeMs >= this.ttlMs) {
        return;
      }
      const data = await readFile(path);
      const entry = { data: data.length > 0 ? data : null, at: info.mtimeMs };
      this.memory.set(key, entry);
      return entry.data;
    } catch {
      return;
    }
  }

  async set(url: string, data: Buffer | null, folder?: string) {
    const key = TileCache.keyOf(url);
    this.memory.set(key, { data, at: this.now() });
    if (!folder) {
      return;
    }

    const path = this.pathOf(folder, key);
    const temporary = `${path}.${process.pid}.tmp`;
    try {
      await mkdir(join(folder, key.slice(0, 2)), { recursive: true });
      await writeFile(temporary, data ?? Buffer.alloc(0));
      await rename(temporary, path);
    } catch {
      await rm(temporary, { force: true }).catch(() => {});
      return;
    }

    if (this.now() - this.lastPrune >= this.pruneIntervalMs && !this.pruning) {
      this.lastPrune = this.now();
      this.pruning = this.prune(folder).finally(() => (this.pruning = undefined));
    }
  }

  /** Removes the expired tiles, then the oldest until the folder is under the size cap */
  async prune(folder: string) {
    const files: Array<{ path: string; size: number; mtimeMs: number }> = [];
    let directories: string[];
    try {
      directories = await readdir(folder);
    } catch {
      return;
    }
    for (const directory of directories) {
      let names: string[];
      try {
        names = await readdir(join(folder, directory));
      } catch {
        continue;
      }
      for (const name of names) {
        const path = join(folder, directory, name);
        try {
          const info = await stat(path);
          files.push({ path, size: info.size, mtimeMs: info.mtimeMs });
        } catch {
          // removed meanwhile
        }
      }
    }

    let total = files.reduce((sum, file) => sum + file.size, 0);
    for (const file of files.toSorted((a, b) => a.mtimeMs - b.mtimeMs)) {
      const expired = this.now() - file.mtimeMs >= this.ttlMs;
      if (!expired && total <= this.maxBytes) {
        break;
      }
      await rm(file.path, { force: true }).catch(() => {});
      total -= file.size;
    }
  }

  clearMemory() {
    this.memory.clear();
  }
}
