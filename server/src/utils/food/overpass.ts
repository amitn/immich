import { haversineKm } from 'src/utils/agent/events.js';

export const DEFAULT_OVERPASS_URL = 'https://overpass-api.de/api/interpreter';

/** OpenStreetMap amenities where people eat or drink */
export const FOOD_AMENITIES = [
  'restaurant',
  'cafe',
  'bar',
  'pub',
  'fast_food',
  'ice_cream',
  'food_court',
  'biergarten',
] as const;

export const DEFAULT_LOOKUP_RADIUS = 75;
export const MAX_LOOKUP_RADIUS = 300;
const MAX_RESULTS = 30;

type Point = { latitude: number; longitude: number };

const coordinate = (value: number) => value.toFixed(6);

/** an Overpass QL query for named food amenities (nodes, ways and relations) within `radius` meters of a point */
export const buildOverpassQuery = ({ latitude, longitude }: Point, radius = DEFAULT_LOOKUP_RADIUS) => {
  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    Math.abs(latitude) > 90 ||
    Math.abs(longitude) > 180
  ) {
    throw new Error('Invalid coordinates');
  }
  const meters = Math.round(Math.max(1, Math.min(MAX_LOOKUP_RADIUS, radius)));
  return (
    `[out:json][timeout:10];` +
    `nwr(around:${meters},${coordinate(latitude)},${coordinate(longitude)})` +
    `["amenity"~"^(${FOOD_AMENITIES.join('|')})$"]["name"];` +
    `out center tags ${MAX_RESULTS};`
  );
};

export type NearbyPlace = {
  name: string;
  amenity: string;
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

/** the named places of an Overpass JSON response, closest first; one entry per name */
export const parseOverpassPlaces = (response: unknown, origin: Point): NearbyPlace[] => {
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
    places.push({
      name,
      amenity: typeof tags.amenity === 'string' ? tags.amenity : 'restaurant',
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
