export type EventPoint = {
  id: string;
  /** local wall-clock time in ms, i.e. `localDateTime.getTime()` */
  time: number;
  latitude?: number | null;
  longitude?: number | null;
  city?: string | null;
  country?: string | null;
  people?: string[];
};

export type EventSplitOptions = {
  /** a gap longer than this starts a new event */
  maxGapMinutes: number;
  /** a jump further than this from the last located photo starts a new event */
  maxDistanceKm: number;
  /** one event per local calendar day instead of gap/distance splitting */
  byDay?: boolean;
};

export type EventSummary = {
  index: number;
  start: string;
  end: string;
  day: string;
  city?: string;
  country?: string;
  count: number;
  people?: string[];
  sampleIds: string[];
};

export const DEFAULT_EVENT_OPTIONS: EventSplitOptions = { maxGapMinutes: 180, maxDistanceKm: 30 };

const EARTH_RADIUS_KM = 6371;
const toRadians = (degrees: number) => (degrees * Math.PI) / 180;

export const haversineKm = (a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }) => {
  const dLat = toRadians(b.latitude - a.latitude);
  const dLon = toRadians(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(a.latitude)) * Math.cos(toRadians(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
};

const hasLocation = (point: EventPoint): point is EventPoint & { latitude: number; longitude: number } =>
  typeof point.latitude === 'number' &&
  typeof point.longitude === 'number' &&
  Number.isFinite(point.latitude) &&
  Number.isFinite(point.longitude) &&
  !(point.latitude === 0 && point.longitude === 0);

/** local ISO date-time without milliseconds or zone, e.g. 2024-06-01T14:03:22 */
export const toLocalIso = (time: number | Date) => new Date(time).toISOString().slice(0, 19);

/** local calendar day, e.g. 2024-06-01 */
export const toLocalDay = (time: number | Date) => new Date(time).toISOString().slice(0, 10);

export const sortByTime = <T extends { time: number; id: string }>(items: T[]) =>
  items.toSorted((a, b) => a.time - b.time || a.id.localeCompare(b.id));

/** books spanning at most this long are split into chapters with gaps and distances scaled to the photos */
export const SHORT_SPAN_MS = 36 * 60 * 60 * 1000;
const MIN_ADAPTIVE_GAP_MINUTES = 15;
const MIN_ADAPTIVE_DISTANCE_KM = 0.5;

export const isShortSpan = (points: Array<{ time: number }>) => {
  if (points.length < 2) {
    return true;
  }
  const times = points.map((point) => point.time);
  return Math.max(...times) - Math.min(...times) <= SHORT_SPAN_MS;
};

/**
 * Event splitting scaled to the photos: the default for longer periods, and for a single day (or a night and a day)
 * a gap of three times the median gap between photos (at least 15 minutes, at most the default) and a distance of a
 * sixth of the extent of the locations (at least 500 m), so that e.g. a day ride becomes one chapter per stop.
 */
export const getAdaptiveEventOptions = (points: EventPoint[]): EventSplitOptions => {
  if (!isShortSpan(points)) {
    return DEFAULT_EVENT_OPTIONS;
  }

  const times = points.map((point) => point.time).toSorted((a, b) => a - b);
  const gaps = times
    .slice(1)
    .map((time, i) => (time - times[i]) / 60_000)
    .toSorted((a, b) => a - b);
  const median = gaps.length > 0 ? gaps[Math.floor(gaps.length / 2)] : 0;
  const maxGapMinutes = Math.min(DEFAULT_EVENT_OPTIONS.maxGapMinutes, Math.max(MIN_ADAPTIVE_GAP_MINUTES, 3 * median));

  const located = points.filter((point) => hasLocation(point));
  let maxDistanceKm = DEFAULT_EVENT_OPTIONS.maxDistanceKm;
  if (located.length >= 2) {
    const lats = located.map((point) => point.latitude!);
    const lons = located.map((point) => point.longitude!);
    const extent = haversineKm(
      { latitude: Math.min(...lats), longitude: Math.min(...lons) },
      { latitude: Math.max(...lats), longitude: Math.max(...lons) },
    );
    maxDistanceKm = Math.min(DEFAULT_EVENT_OPTIONS.maxDistanceKm, Math.max(MIN_ADAPTIVE_DISTANCE_KM, extent / 6));
  }

  return { maxGapMinutes: Math.round(maxGapMinutes * 10) / 10, maxDistanceKm: Math.round(maxDistanceKm * 100) / 100 };
};

/** splits photos into events; the result is ordered by time, as is each event */
export const splitEvents = <T extends EventPoint>(points: T[], options: EventSplitOptions = DEFAULT_EVENT_OPTIONS) => {
  const events: T[][] = [];
  const maxGap = options.maxGapMinutes * 60 * 1000;

  let current: T[] = [];
  let lastLocated: (T & { latitude: number; longitude: number }) | undefined;
  for (const point of sortByTime(points)) {
    const previous = current.at(-1);
    let split = false;
    if (previous) {
      if (options.byDay) {
        split = toLocalDay(previous.time) !== toLocalDay(point.time);
      } else {
        split = point.time - previous.time > maxGap;
        if (!split && lastLocated && hasLocation(point)) {
          split = haversineKm(lastLocated, point) > options.maxDistanceKm;
        }
      }
    }

    if (split) {
      events.push(current);
      current = [];
      lastLocated = undefined;
    }

    current.push(point);
    if (hasLocation(point)) {
      lastLocated = point;
    }
  }

  if (current.length > 0) {
    events.push(current);
  }

  return events;
};

/** picks `count` items evenly spread over the list, always including the first and last */
export const pickSpread = <T>(items: T[], count: number): T[] => {
  if (count <= 0) {
    return [];
  }
  if (items.length <= count) {
    return [...items];
  }
  if (count === 1) {
    return [items[Math.floor(items.length / 2)]];
  }

  const result: T[] = [];
  const step = (items.length - 1) / (count - 1);
  for (let i = 0; i < count; i++) {
    result.push(items[Math.round(i * step)]);
  }
  return result;
};

const mostCommon = (values: Array<string | null | undefined>) => {
  const counts = new Map<string, number>();
  for (const value of values) {
    if (value) {
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }
  }

  let best: string | undefined;
  let bestCount = 0;
  for (const [value, count] of counts) {
    if (count <= bestCount) {
      continue;
    }

    best = value;
    bestCount = count;
  }
  return best;
};

const topCounts = (values: string[], limit: number) => {
  const counts = new Map<string, number>();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts]
    .toSorted((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([value]) => value);
};

export const summarizeEvent = (points: EventPoint[], index: number, sampleCount = 6): EventSummary => {
  const first = points[0];
  const last = points.at(-1)!;
  const city = mostCommon(points.map((point) => point.city));
  const country = mostCommon(points.map((point) => point.country));
  const people = topCounts(
    points.flatMap((point) => point.people ?? []),
    5,
  );

  return {
    index,
    start: toLocalIso(first.time),
    end: toLocalIso(last.time),
    day: toLocalDay(first.time),
    ...(city && { city }),
    ...(country && { country }),
    count: points.length,
    ...(people.length > 0 && { people }),
    sampleIds: pickSpread(points, sampleCount).map((point) => point.id),
  };
};

/** groups event indexes by the local day each event starts on */
export const groupEventsByDay = (events: EventSummary[]) => {
  const days = new Map<string, { day: string; count: number; events: number[] }>();
  for (const event of events) {
    let day = days.get(event.day);
    if (!day) {
      day = { day: event.day, count: 0, events: [] };
      days.set(event.day, day);
    }
    day.count += event.count;
    day.events.push(event.index);
  }
  return days.values().toArray();
};
