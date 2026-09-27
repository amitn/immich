import { existsSync } from 'node:fs';
import { mkdtemp, readdir, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TileCache } from 'src/utils/book/tile-cache.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const URL_A = 'https://tiles.example.org/v1/15/1/2.mvt';
const URL_B = 'https://tiles.example.org/v1/15/1/3.mvt';

const listFiles = async (folder: string) => {
  const files: string[] = [];
  for (const directory of await readdir(folder)) {
    const names = await readdir(join(folder, directory));
    files.push(...names.filter((name) => name.endsWith('.mvt')));
  }
  return files;
};

describe(TileCache.name, () => {
  let folder: string;

  beforeEach(async () => {
    folder = await mkdtemp(join(tmpdir(), 'immich-tile-cache-'));
  });

  afterEach(async () => {
    await rm(folder, { recursive: true, force: true });
  });

  it('should keep tiles in memory', async () => {
    const cache = new TileCache();
    await cache.set(URL_A, Buffer.from('tile'));
    await expect(cache.get(URL_A)).resolves.toEqual(Buffer.from('tile'));
    await expect(cache.get(URL_B)).resolves.toBeUndefined();
  });

  it('should keep tiles on disk for the next process, empty tiles too', async () => {
    await new TileCache().set(URL_A, Buffer.from('tile'), folder);
    await new TileCache().set(URL_B, null, folder);

    const cache = new TileCache();
    await expect(cache.get(URL_A, folder)).resolves.toEqual(Buffer.from('tile'));
    await expect(cache.get(URL_B, folder)).resolves.toBeNull();
    expect(await listFiles(folder)).toHaveLength(2);
  });

  it('should forget tiles after the time to live', async () => {
    let now = Date.now();
    const cache = new TileCache({ ttlMs: 30 * DAY_MS, now: () => now });
    await cache.set(URL_A, Buffer.from('tile'), folder);

    now += 29 * DAY_MS;
    cache.clearMemory();
    await expect(cache.get(URL_A, folder)).resolves.toEqual(Buffer.from('tile'));

    now += 2 * DAY_MS;
    cache.clearMemory();
    await expect(cache.get(URL_A, folder)).resolves.toBeUndefined();
  });

  it('should remove the oldest tiles past the size cap', async () => {
    const cache = new TileCache({ maxBytes: 10, pruneIntervalMs: 0 });
    await cache.set(URL_A, Buffer.alloc(8), folder);
    const pathA = join(folder, TileCache.keyOf(URL_A).slice(0, 2), `${TileCache.keyOf(URL_A)}.mvt`);
    const old = new Date(Date.now() - DAY_MS);
    await utimes(pathA, old, old);

    await cache.set(URL_B, Buffer.alloc(8), folder);
    await cache.prune(folder);

    expect(existsSync(pathA)).toBe(false);
    expect(await listFiles(folder)).toHaveLength(1);
  });

  it('should remove expired tiles when pruning', async () => {
    const cache = new TileCache({ ttlMs: DAY_MS });
    await cache.set(URL_A, Buffer.from('tile'), folder);
    const path = join(folder, TileCache.keyOf(URL_A).slice(0, 2), `${TileCache.keyOf(URL_A)}.mvt`);
    const old = new Date(Date.now() - 2 * DAY_MS);
    await utimes(path, old, old);

    await cache.prune(folder);
    expect(existsSync(path)).toBe(false);
  });

  it('should not fail without a folder it can write to', async () => {
    // a folder inside a file
    await writeFile(join(folder, 'file'), 'not a folder');
    const broken = join(folder, 'file', 'tiles');
    const cache = new TileCache();
    await expect(cache.set(URL_A, Buffer.from('tile'), broken)).resolves.toBeUndefined();
    await expect(cache.get(URL_A, broken)).resolves.toEqual(Buffer.from('tile'));
    await expect(cache.prune(broken)).resolves.toBeUndefined();
  });
});
