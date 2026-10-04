import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * A real vector tile, captured from the map tiles of Immich's Map page (tiles.immich.cloud, the Protomaps basemap, data
 * © OpenStreetMap contributors, ODbL): the coast below Taormina, Sicily, at zoom 15, with land, sea, beaches, scrub,
 * roads, paths, a railway and a hamlet.
 */
export const TAORMINA_TILE = { z: 15, x: 17_775, y: 12_657 } as const;

/** the middle of the tile */
export const TAORMINA_TILE_CENTER = { lat: 37.8445, lon: 15.2875 } as const;

export const loadTaorminaTile = () =>
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'taormina-15-17775-12657.mvt'));
