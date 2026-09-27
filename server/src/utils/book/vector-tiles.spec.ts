import {
  WorldView,
  chooseVectorZoom,
  clipLine,
  clipRing,
  decodeVectorTile,
  getMapCredit,
  getStyleVectorSource,
  getTilePlacement,
  getTilesInView,
  getVectorTileUrl,
  parseTileJson,
  toPlainAttribution,
} from 'src/utils/book/vector-tiles.js';
import { loadTaorminaTile } from 'test/fixtures/map/tile.js';

const STYLE_URL = 'https://tiles.example.org/v1/style/light.json';

/** a view `widthKm` wide around a point, 1000 by 1400 pixels */
const viewAround = (lat: number, lon: number, widthKm: number, width = 1000, height = 1400): WorldView => {
  const x = (lon + 180) / 360;
  const phi = (lat * Math.PI) / 180;
  const y = (1 - Math.log(Math.tan(phi) + 1 / Math.cos(phi)) / Math.PI) / 2;
  const worldWidth = (widthKm * 1000) / (40_075_016.686 * Math.cos(phi));
  return { x, y, scale: width / worldWidth, width, height };
};

describe('vector tiles', () => {
  describe('attribution', () => {
    it('should turn the HTML attribution into text', () => {
      expect(
        toPlainAttribution(
          '<a href="https://www.openstreetmap.org/copyright" target="_blank">&copy; OpenStreetMap</a>',
        ),
      ).toBe('© OpenStreetMap');
    });

    it('should always credit the OpenStreetMap contributors', () => {
      expect(getMapCredit('© OpenStreetMap')).toBe('© OpenStreetMap contributors');
      expect(getMapCredit('')).toBe('© OpenStreetMap contributors');
      expect(getMapCredit('© Protomaps © OpenStreetMap')).toBe('© Protomaps © OpenStreetMap contributors');
      expect(getMapCredit('© Example Tiles')).toBe('© Example Tiles © OpenStreetMap contributors');
    });
  });

  describe('getStyleVectorSource', () => {
    it('should find the TileJSON of the vector source', () => {
      const style = { sources: { vector: { type: 'vector', url: 'https://tiles.example.org/v1.json' } } };
      expect(getStyleVectorSource(style, STYLE_URL)).toEqual({ url: 'https://tiles.example.org/v1.json' });
    });

    it('should resolve relative URLs and keep the tile placeholders', () => {
      const style = {
        sources: {
          raster: { type: 'raster', tiles: ['https://raster.example.org/{z}/{x}/{y}.png'] },
          vector: { type: 'vector', tiles: ['../{z}/{x}/{y}.mvt'], maxzoom: 14, attribution: '&copy; OSM' },
        },
      };
      expect(getStyleVectorSource(style, STYLE_URL)).toEqual({
        tiles: ['https://tiles.example.org/v1/{z}/{x}/{y}.mvt'],
        minZoom: 0,
        maxZoom: 14,
        attribution: '© OSM',
      });
    });

    it('should refuse a style without vector tiles', () => {
      expect(() => getStyleVectorSource({ sources: {} }, STYLE_URL)).toThrow('no vector tiles');
      expect(() => getStyleVectorSource({}, STYLE_URL)).toThrow('no sources');
    });

    it('should refuse PMTiles sources', () => {
      const style = { sources: { vector: { type: 'vector', url: 'pmtiles://https://example.org/world.pmtiles' } } };
      expect(() => getStyleVectorSource(style, STYLE_URL)).toThrow('PMTiles');
    });
  });

  describe('parseTileJson', () => {
    it('should read the tiles, zooms and attribution', () => {
      expect(
        parseTileJson(
          {
            tilejson: '3.0.0',
            tiles: ['https://tiles.example.org/v1/{z}/{x}/{y}.mvt'],
            minzoom: 0,
            maxzoom: 15,
            attribution: '<a href="https://www.openstreetmap.org/copyright">&copy; OpenStreetMap</a>',
          },
          'https://tiles.example.org/v1.json',
        ),
      ).toEqual({
        tiles: ['https://tiles.example.org/v1/{z}/{x}/{y}.mvt'],
        minZoom: 0,
        maxZoom: 15,
        attribution: '© OpenStreetMap',
      });
    });

    it('should refuse a document without tiles or with the TMS scheme', () => {
      expect(() => parseTileJson({ tiles: [] }, 'https://example.org/t.json')).toThrow('no tiles');
      expect(() => parseTileJson('nope', 'https://example.org/t.json')).toThrow('not a TileJSON');
      expect(() => parseTileJson({ tiles: ['https://a/{z}/{x}/{y}'], scheme: 'tms' }, 'https://a/t.json')).toThrow(
        'TMS',
      );
    });

    it('should refuse OpenMapTiles sources, whose layers styled maps cannot read', () => {
      const tiles = ['https://tiles.openfreemap.org/planet/{z}/{x}/{y}.pbf'];
      const layers = (ids: string[]) => ids.map((id) => ({ id, fields: {} }));
      expect(() =>
        parseTileJson(
          { tiles, vector_layers: layers(['water', 'landcover', 'transportation', 'place']) },
          'https://tiles.openfreemap.org/planet',
        ),
      ).toThrow('OpenMapTiles');
      expect(
        parseTileJson({ tiles, vector_layers: layers(['earth', 'water', 'roads', 'places']) }, 'https://a/t.json').tiles,
      ).toEqual(tiles);
    });
  });

  describe('tile maths', () => {
    it('should fill the URL template and wrap around the antimeridian', () => {
      const source = { tiles: ['https://a.example.org/{z}/{x}/{y}.mvt'] };
      expect(getVectorTileUrl(source, { z: 3, x: 9, y: 2 })).toBe('https://a.example.org/3/1/2.mvt');
      expect(getVectorTileUrl(source, { z: 3, x: -1, y: 2 })).toBe('https://a.example.org/3/7/2.mvt');
      expect(getVectorTileUrl({ tiles: ['https://a/{z}/{x}/{-y}'] }, { z: 2, x: 1, y: 0 })).toBe('https://a/2/1/3');
    });

    it('should list the tiles that cover a view', () => {
      const view = viewAround(38.5725, -7.9072, 2);
      const tiles = getTilesInView(view, 15);
      const n = 2 ** 15;
      expect(tiles.length).toBeGreaterThan(1);
      for (const tile of tiles) {
        const placement = getTilePlacement(view, tile);
        expect(placement.left).toBeLessThan(view.width);
        expect(placement.top).toBeLessThan(view.height);
        expect(placement.left + placement.size).toBeGreaterThan(0);
        expect(placement.top + placement.size).toBeGreaterThan(0);
        expect(tile.y).toBeLessThan(n);
      }
    });

    it('should choose street detail for a city and a lower zoom for a region', () => {
      const options = { minZoom: 0, maxZoom: 15, maxTiles: 20 };
      const city = viewAround(38.5725, -7.9072, 1.6);
      const island = viewAround(35.35, 23.97, 60);
      const coast = viewAround(37.4, 15.2, 150);

      expect(chooseVectorZoom(city, 1, options)).toBe(15);
      expect(chooseVectorZoom(island, 1, options)).toBe(10);
      expect(chooseVectorZoom(coast, 1, options)).toBe(8);
      // the zoom follows the printed size, not the pixels
      expect(chooseVectorZoom({ ...island, scale: island.scale * 3, width: 3000, height: 4200 }, 3, options)).toBe(10);
    });

    it('should never ask for more tiles than allowed', () => {
      const wide = viewAround(38.5725, -7.9072, 6, 3000, 1000);
      const zoom = chooseVectorZoom(wide, 1, { minZoom: 0, maxZoom: 15, maxTiles: 6 });
      expect(getTilesInView(wide, zoom).length).toBeLessThanOrEqual(6);
      expect(chooseVectorZoom(wide, 1, { minZoom: 0, maxZoom: 12, maxTiles: 20 })).toBeLessThanOrEqual(12);
    });
  });

  describe('clipping', () => {
    it('should clip a ring to the square', () => {
      const ring: Array<[number, number]> = [
        [-10, -10],
        [20, -10],
        [20, 20],
        [-10, 20],
      ];
      const clipped = clipRing(ring, 0, 10);
      expect(clipped).toHaveLength(4);
      for (const [x, y] of clipped) {
        expect(x).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThanOrEqual(10);
        expect(y).toBeGreaterThanOrEqual(0);
        expect(y).toBeLessThanOrEqual(10);
      }
      expect(
        clipRing(
          ring.map(([x, y]) => [x + 100, y] as [number, number]),
          0,
          10,
        ),
      ).toEqual([]);
    });

    it('should clip lines and drop the edges made by cutting the tiles', () => {
      expect(
        clipLine(
          [
            [-5, 5],
            [15, 5],
          ],
          0,
          10,
        ),
      ).toEqual([
        [
          [0, 5],
          [10, 5],
        ],
      ]);

      // a coast, then a piece of the tile edge
      const outline: Array<[number, number]> = [
        [2, 2],
        [8, 8],
        [8, 10],
        [0, 10],
      ];
      expect(clipLine(outline, 0, 10, true)).toEqual([
        [
          [2, 2],
          [8, 8],
          [8, 10],
        ],
      ]);
    });
  });

  describe('decodeVectorTile', () => {
    const placement = { left: 100, top: 50, size: 1000 };

    it('should decode a real tile into features in page pixels', () => {
      const features = decodeVectorTile(loadTaorminaTile(), placement, { tolerance: 0.5 });
      const layers = new Set(features.map((feature) => feature.layer));
      expect([...layers]).toEqual(expect.arrayContaining(['earth', 'water', 'landuse', 'roads']));

      for (const feature of features) {
        for (const part of feature.parts) {
          for (let i = 0; i < part.length; i += 2) {
            // clipped to the tile, give or take the pixel of overlap
            expect(part[i]).toBeGreaterThanOrEqual(placement.left - 2);
            expect(part[i]).toBeLessThanOrEqual(placement.left + placement.size + 2);
            expect(part[i + 1]).toBeGreaterThanOrEqual(placement.top - 2);
            expect(part[i + 1]).toBeLessThanOrEqual(placement.top + placement.size + 2);
          }
        }
      }

      const land = features.find((feature) => feature.layer === 'earth' && feature.type === 'polygon');
      expect(land?.outline?.length).toBeGreaterThan(0);
      const roads = features.filter((feature) => feature.layer === 'roads');
      expect(roads.some((road) => road.kind === 'rail')).toBe(true);
      expect(roads.some((road) => road.kind === 'major_road')).toBe(true);
    });

    it('should keep only the asked layers and the features of the zoom', () => {
      const all = decodeVectorTile(loadTaorminaTile(), placement, { tolerance: 0.5 });
      const roads = decodeVectorTile(loadTaorminaTile(), placement, {
        tolerance: 0.5,
        layers: new Set(['roads']),
        maxFeatureZoom: 12,
      });
      expect(roads.every((feature) => feature.layer === 'roads')).toBe(true);
      expect(roads.length).toBeLessThan(all.filter((feature) => feature.layer === 'roads').length);
      expect(roads.every((feature) => (feature.minZoom ?? 0) <= 12.5)).toBe(true);
    });

    it('should leave the places outside the tile to its neighbour', () => {
      // the tile carries a hamlet just west of it, for labels near its edge
      const places = decodeVectorTile(loadTaorminaTile(), placement, { tolerance: 0.5, layers: new Set(['places']) });
      expect(places).toEqual([]);
    });
  });
});
