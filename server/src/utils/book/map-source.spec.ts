import {
  clearStyledMapError,
  createStyledMapSource,
  describeMapError,
  getStyledMapError,
} from 'src/utils/book/map-source.js';
import { VectorTileSource } from 'src/utils/book/vector-tiles.js';

const source: VectorTileSource = {
  tiles: ['https://tiles.example.org/{z}/{x}/{y}.mvt'],
  minZoom: 0,
  maxZoom: 15,
  attribution: '© OpenStreetMap',
};

const timeout = () => new DOMException('The operation was aborted due to timeout', 'TimeoutError');

describe('styled map source', () => {
  const repository = { getVectorTileSource: vi.fn(), getVectorTile: vi.fn() };
  const config = { enabled: true, styleUrl: 'https://tiles.example.org/style.json', cacheFolder: '/cache' };

  beforeEach(() => {
    repository.getVectorTileSource.mockReset();
    repository.getVectorTile.mockReset();
    clearStyledMapError();
  });

  it('should load the tiles of the map style, through the cache folder', async () => {
    repository.getVectorTileSource.mockResolvedValue(source);
    repository.getVectorTile.mockResolvedValue(Buffer.from('tile'));

    const mapSource = await createStyledMapSource(repository, config)();
    await expect(mapSource.getTile({ z: 1, x: 0, y: 1 })).resolves.toEqual(Buffer.from('tile'));

    expect(mapSource.source).toBe(source);
    expect(repository.getVectorTileSource).toHaveBeenCalledWith('https://tiles.example.org/style.json');
    expect(repository.getVectorTile).toHaveBeenCalledWith(source, { z: 1, x: 0, y: 1 }, { cacheFolder: '/cache' });
  });

  it('should not ask for anything when the map is disabled', async () => {
    await expect(createStyledMapSource(repository, { ...config, enabled: false })()).rejects.toThrow(
      'the Map feature is disabled',
    );
    expect(repository.getVectorTileSource).not.toHaveBeenCalled();
  });

  it('should remember why the map data could not be loaded, for the review', async () => {
    repository.getVectorTileSource.mockRejectedValue(new Error('tiles.example.org responded with 503'));
    await expect(createStyledMapSource(repository, config)()).rejects.toThrow('503');
    expect(getStyledMapError()).toBe('tiles.example.org responded with 503');
    expect(getStyledMapError(Date.now() + 60 * 60 * 1000)).toBeUndefined();
  });

  it('should report a timeout of a tile, and forget it once the tiles load again', async () => {
    repository.getVectorTileSource.mockResolvedValue(source);
    repository.getVectorTile.mockRejectedValueOnce(timeout()).mockResolvedValueOnce(null);

    const mapSource = await createStyledMapSource(repository, config)();
    await expect(mapSource.getTile({ z: 1, x: 0, y: 0 })).rejects.toThrow('the map server did not answer in time');
    expect(getStyledMapError()).toBe('the map server did not answer in time');

    await expect(mapSource.getTile({ z: 1, x: 0, y: 0 })).resolves.toBeNull();
    expect(getStyledMapError()).toBeUndefined();
  });

  it('should describe network errors', () => {
    expect(describeMapError(new TypeError('fetch failed'))).toBe('the map server could not be reached');
    expect(describeMapError(timeout())).toBe('the map server did not answer in time');
    expect(describeMapError('boom')).toBe('boom');
  });
});
