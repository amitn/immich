import { haversineKm } from 'src/utils/agent/events.js';

export const DEFAULT_OVERPASS_URL = 'https://overpass-api.de/api/interpreter';

/** OpenStreetMap features with one of `values` for the tag `key`, e.g. amenity=restaurant or tourism=museum */
export type OsmFilter = { key: string; values: readonly string[] };

export const DEFAULT_LOOKUP_RADIUS = 75;
export const MAX_LOOKUP_RADIUS = 300;
const MAX_RESULTS = 30;

type Point = { latitude: number; longitude: number };

const coordinate = (value: number) => value.toFixed(6);

/** an Overpass QL query for the named features (nodes, ways and relations) of `filters` within `radius` meters */
export const buildOverpassQuery = (
  { latitude, longitude }: Point,
  filters: readonly OsmFilter[],
  radius = DEFAULT_LOOKUP_RADIUS,
) => {
  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    Math.abs(latitude) > 90 ||
    Math.abs(longitude) > 180
  ) {
    throw new Error('Invalid coordinates');
  }
  if (filters.length === 0) {
    throw new Error('Nothing to look up');
  }
  const meters = Math.round(Math.max(1, Math.min(MAX_LOOKUP_RADIUS, radius)));
  const around = `nwr(around:${meters},${coordinate(latitude)},${coordinate(longitude)})`;
  const statements = filters.map(({ key, values }) => `${around}["${key}"~"^(${values.join('|')})$"]["name"];`);
  return (
    `[out:json][timeout:10];` +
    (statements.length === 1 ? statements[0] : `(${statements.join('')});`) +
    `out center tags ${MAX_RESULTS};`
  );
};

export type NearbyPlace = {
  name: string;
  /** the value of the filter's tag, e.g. restaurant or museum */
  type: string;
  cuisine?: string;
  /** meters from the point that was looked up */
  distance: number;
  /** e.g. node/123456 */
  osm: string;
};

type OverpassElement = {
  type?: unknown;
  id?: unknown;
  lat?: unknown;
  lon?: unknown;
  center?: { lat?: unknown; lon?: unknown };
  tags?: Record<string, unknown>;
};

const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

/** the named places of an Overpass JSON response for `filters`, closest first; one entry per name */
export const parseOverpassPlaces = (response: unknown, origin: Point, filters: readonly OsmFilter[]): NearbyPlace[] => {
  const elements = (response as { elements?: unknown })?.elements;
  if (!Array.isArray(elements)) {
    return [];
  }

  const places: NearbyPlace[] = [];
  for (const element of elements as OverpassElement[]) {
    const tags = element?.tags ?? {};
    const name = typeof tags.name === 'string' ? tags.name.trim() : '';
    const latitude = isNumber(element?.lat) ? element.lat : element?.center?.lat;
    const longitude = isNumber(element?.lon) ? element.lon : element?.center?.lon;
    if (!name || !isNumber(latitude) || !isNumber(longitude)) {
      continue;
    }
    const type = filters.map(({ key }) => tags[key]).find((value) => typeof value === 'string');
    places.push({
      name,
      type: typeof type === 'string' ? type : (filters[0]?.values[0] ?? 'place'),
      ...(typeof tags.cuisine === 'string' && { cuisine: tags.cuisine.replaceAll(';', ', ') }),
      distance: Math.round(haversineKm(origin, { latitude, longitude }) * 1000),
      osm: `${String(element.type)}/${String(element.id)}`,
    });
  }

  const seen = new Set<string>();
  return places
    .toSorted((a, b) => a.distance - b.distance || a.name.localeCompare(b.name))
    .filter((place) => {
      const key = place.name.toLowerCase();
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
};
