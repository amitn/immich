import { join } from 'node:path';
import type { StyledMapSource } from 'src/utils/book/map.js';
import type { TileKey, VectorTileSource } from 'src/utils/book/vector-tiles.js';
import { StorageCore } from 'src/cores/storage.core.js';
import { StorageFolder } from 'src/enum.js';

/**
 * Where styled maps take their map data: the vector tiles of the style of Immich's own Map page (Administration →
 * Settings → Map), loaded through the map repository and cached on disk under the thumbnails folder.
 */

export type MapDataRepository = {
  getVectorTileSource: (styleUrl: string) => Promise<VectorTileSource>;
  getVectorTile: (
    source: VectorTileSource,
    tile: TileKey,
    options?: { cacheFolder?: string },
  ) => Promise<Buffer | null>;
};

/** the tile cache, inside the thumbnails folder; hidden, so that the integrity checks leave it alone */
export const MAP_TILE_CACHE_PATH = ['.cache', 'map-tiles'] as const;

export const getMapTileCacheFolder = () =>
  join(StorageCore.getBaseFolder(StorageFolder.Thumbnails), ...MAP_TILE_CACHE_PATH);

/** a failure to load the map data is reported by the review of a book for this long */
const ERROR_MEMORY_MS = 30 * 60 * 1000;

let lastError: { message: string; at: number } | undefined;

/** why the map data could not be loaded lately, if it could not */
export const getStyledMapError = (now = Date.now()) =>
  lastError && now - lastError.at < ERROR_MEMORY_MS ? lastError.message : undefined;

export const clearStyledMapError = () => {
  lastError = undefined;
};

/** a readable reason, e.g. a timeout instead of "The operation was aborted due to timeout" */
export const describeMapError = (error: unknown) => {
  const name = (error as Error)?.name;
  if (name === 'TimeoutError' || name === 'AbortError') {
    return 'the map server did not answer in time';
  }
  const message = (error as Error)?.message ?? String(error);
  return message === 'fetch failed' ? 'the map server could not be reached' : message;
};

const remember = (error: unknown) => {
  const message = describeMapError(error);
  lastError = { message, at: Date.now() };
  return new Error(message, { cause: error });
};

/**
 * The map data of styled maps for `renderMap`: throws when the Map feature is disabled, or when the style, its
 * TileJSON or a tile cannot be loaded (the map is then drawn as a sketch, and the review reports it for a while)
 */
export const createStyledMapSource =
  (
    repository: MapDataRepository,
    config: { enabled: boolean; styleUrl: string; cacheFolder?: string },
  ): (() => Promise<StyledMapSource>) =>
  async () => {
    if (!config.enabled) {
      throw new Error('the Map feature is disabled (Administration → Settings → Map)');
    }

    let source: VectorTileSource;
    try {
      source = await repository.getVectorTileSource(config.styleUrl);
    } catch (error) {
      throw remember(error);
    }

    return {
      source,
      getTile: async (tile) => {
        try {
          const data = await repository.getVectorTile(source, tile, { cacheFolder: config.cacheFolder });
          clearStyledMapError();
          return data;
        } catch (error) {
          throw remember(error);
        }
      },
    };
  };

/** The map data of styled maps, as the server config sets it: the light style of the Map page, if the map is enabled */
export const getStyledMapSource = (
  repository: MapDataRepository,
  config: { map: { enabled: boolean; lightStyle: string } },
) =>
  createStyledMapSource(repository, {
    enabled: config.map.enabled,
    styleUrl: config.map.lightStyle,
    cacheFolder: getMapTileCacheFolder(),
  });
