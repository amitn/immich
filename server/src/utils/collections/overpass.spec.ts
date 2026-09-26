import { describe, expect, it } from 'vitest';
import { OsmFilter, buildOverpassQuery, parseOverpassPlaces } from 'src/utils/collections/overpass.js';
import { FOOD_AMENITIES } from 'src/utils/collections/packs/food/pack.js';

const origin = { latitude: 37.8526, longitude: 15.2869 };
const food: OsmFilter[] = [{ key: 'amenity', values: FOOD_AMENITIES }];

describe('buildOverpassQuery', () => {
  it('should look for named food amenities around a point', () => {
    expect(buildOverpassQuery(origin, food, 75)).toBe(
      '[out:json][timeout:10];nwr(around:75,37.852600,15.286900)' +
        '["amenity"~"^(restaurant|cafe|bar|pub|fast_food|ice_cream|food_court|biergarten)$"]["name"];out center tags 30;',
    );
  });

  it('should bound the radius', () => {
    expect(buildOverpassQuery(origin, food, 5000)).toContain('around:300,');
    expect(buildOverpassQuery(origin, food, 0)).toContain('around:1,');
  });

  it('should look for the features of several filters at once', () => {
    expect(
      buildOverpassQuery(origin, [
        { key: 'tourism', values: ['museum', 'gallery'] },
        { key: 'amenity', values: ['arts_centre'] },
      ]),
    ).toBe(
      '[out:json][timeout:10];(nwr(around:75,37.852600,15.286900)["tourism"~"^(museum|gallery)$"]["name"];' +
        'nwr(around:75,37.852600,15.286900)["amenity"~"^(arts_centre)$"]["name"];);out center tags 30;',
    );
  });

  it('should reject invalid coordinates', () => {
    expect(() => buildOverpassQuery({ latitude: 91, longitude: 0 }, food)).toThrow('Invalid coordinates');
    expect(() => buildOverpassQuery({ latitude: NaN, longitude: 0 }, food)).toThrow('Invalid coordinates');
  });
});

describe('parseOverpassPlaces', () => {
  it('should list named places, closest first, once per name', () => {
    const places = parseOverpassPlaces(
      {
        elements: [
          {
            type: 'way',
            id: 2,
            center: { lat: 37.8531, lon: 15.2874 },
            tags: { name: 'Bar Turrisi', amenity: 'bar' },
          },
          {
            type: 'node',
            id: 1,
            lat: 37.8527,
            lon: 15.287,
            tags: { name: 'Trattoria da Nino', amenity: 'restaurant', cuisine: 'italian;seafood' },
          },
          { type: 'node', id: 3, lat: 37.8527, lon: 15.287, tags: { amenity: 'cafe' } },
          {
            type: 'node',
            id: 4,
            lat: 37.8535,
            lon: 15.288,
            tags: { name: 'trattoria da nino', amenity: 'restaurant' },
          },
          { type: 'node', id: 5, tags: { name: 'Nowhere' } },
        ],
      },
      origin,
      food,
    );

    expect(places).toEqual([
      { name: 'Trattoria da Nino', type: 'restaurant', cuisine: 'italian, seafood', distance: 14, osm: 'node/1' },
      { name: 'Bar Turrisi', type: 'bar', distance: 71, osm: 'way/2' },
    ]);
  });

  it('should handle unexpected responses', () => {
    expect(parseOverpassPlaces(null, origin, food)).toEqual([]);
    expect(parseOverpassPlaces({ remark: 'runtime error' }, origin, food)).toEqual([]);
  });
});
