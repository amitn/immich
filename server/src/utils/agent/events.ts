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
