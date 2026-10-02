import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { MapRepository } from 'src/repositories/map.repository.js';
import { VectorTileSource } from 'src/utils/book/vector-tiles.js';

const STYLE_URL = 'https://tiles.example.org/v1/style/light.json';

const source: VectorTileSource = {
  tiles: ['https://tiles.example.org/v1/{z}/{x}/{y}.mvt'],
  minZoom: 0,
  maxZoom: 15,
  attribution: '© OpenStreetMap',
};

describe(`${MapRepository.name} vector tiles`, () => {
  let sut: MapRepository;
  let folder: string;
  const fetchMock = vi.fn();

  beforeEach(async () => {
    sut = new MapRepository({} as never, {} as never, { setContext: () => {} } as never, {} as never);
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    folder = await mkdtemp(join(tmpdir(), 'immich-map-tiles-'));
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await rm(folder, { recursive: true, force: true });
  });

  it('should follow the style to its TileJSON, with a generic User-Agent and a timeout', async () => {
    fetchMock
      .mockResolvedValueOnce(
        Response.json({ sources: { vector: { type: 'vector', url: 'https://tiles.example.org/v1.json' } } }),
      )
      .mockResolvedValueOnce(
        Response.json({
          tiles: ['https://tiles.example.org/v1/{z}/{x}/{y}.mvt'],
          maxzoom: 15,
          attribution: '&copy; OpenStreetMap',
        }),
      );

    await expect(sut.getVectorTileSource(STYLE_URL)).resolves.toEqual(source);
    // kept for a while
    await expect(sut.getVectorTileSource(STYLE_URL)).resolves.toEqual(source);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const [, init] of fetchMock.mock.calls) {
      expect(init.headers['User-Agent']).toMatch(/^immich-server\/\S+ \(\+https:\/\/immich\.app\)$/);
      expect(init.signal).toBeInstanceOf(AbortSignal);
      expect(init.headers.Cookie).toBeUndefined();
    }
  });

  it('should fail when the style cannot be loaded', async () => {
    fetchMock.mockResolvedValue(new Response('gone', { status: 404, statusText: 'Not Found' }));
    await expect(sut.getVectorTileSource(STYLE_URL)).rejects.toThrow('tiles.example.org responded with 404 Not Found');
  });

  it('should load a tile once, then from the cache on disk', async () => {
    fetchMock.mockResolvedValue(new Response(Buffer.from('tile-data')));

    await expect(sut.getVectorTile(source, { z: 15, x: 1, y: 2 }, { cacheFolder: folder })).resolves.toEqual(
      Buffer.from('tile-data'),
    );
    expect(fetchMock).toHaveBeenCalledWith('https://tiles.example.org/v1/15/1/2.mvt', expect.anything());

    sut.clearMapCaches();
    await expect(sut.getVectorTile(source, { z: 15, x: 1, y: 2 }, { cacheFolder: folder })).resolves.toEqual(
      Buffer.from('tile-data'),
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('should treat a missing tile as empty and unzip a gzipped one', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response(gzipSync(Buffer.from('zipped'))));

    await expect(sut.getVectorTile(source, { z: 3, x: 1, y: 1 })).resolves.toBeNull();
    await expect(sut.getVectorTile(source, { z: 3, x: 2, y: 1 })).resolves.toEqual(Buffer.from('zipped'));
  });

  it('should fail on a server error and a timeout', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response('busy', { status: 503, statusText: 'Service Unavailable' }))
      .mockRejectedValueOnce(new DOMException('timeout', 'TimeoutError'));

    await expect(sut.getVectorTile(source, { z: 3, x: 3, y: 1 })).rejects.toThrow('503 Service Unavailable');
    await expect(sut.getVectorTile(source, { z: 3, x: 4, y: 1 })).rejects.toThrow('timeout');
  });
});
