import { haversineKm, sortByTime, toLocalDay, toLocalIso } from 'src/utils/agent/events.js';
import { CollectionPhotoKind } from 'src/utils/collections/classify.js';

export type VisitPhoto = {
  id: string;
  /** local wall-clock time in ms, i.e. `localDateTime.getTime()` */
  time: number;
  kind: CollectionPhotoKind;
  latitude?: number | null;
  longitude?: number | null;
  city?: string | null;
  country?: string | null;
};

export type VisitOptions = {
  /** a longer gap between the photos of a collection starts a new visit */
  maxGapMinutes: number;
  /** a visit lasts at most this long (a tasting menu can take four hours) */
  maxSpanMinutes: number;
  /** a photo further than this from the visit's place starts a new visit */
  maxDistanceMeters: number;
  /**
   * sources, signs and receipts photographed apart from any subject (the storefront on the way in, the menu signed by
   * the chef after the meal) join the closest visit within this many minutes
   */
  attachMinutes: number;
};

/** the grouping of food photos into meals, which suits most visits to one place */
export const DEFAULT_VISIT_OPTIONS: VisitOptions = {
  maxGapMinutes: 45,
  maxSpanMinutes: 300,
  maxDistanceMeters: 150,
  attachMinutes: 180,
};

type Located = { latitude: number; longitude: number };

const isLocated = (photo: VisitPhoto): photo is VisitPhoto & Located =>
  typeof photo.latitude === 'number' &&
  typeof photo.longitude === 'number' &&
  Number.isFinite(photo.latitude) &&
  Number.isFinite(photo.longitude) &&
  !(photo.latitude === 0 && photo.longitude === 0);

const centroid = (points: Located[]): Located | undefined =>
  points.length === 0
    ? undefined
    : {
        latitude: points.reduce((sum, point) => sum + point.latitude, 0) / points.length,
        longitude: points.reduce((sum, point) => sum + point.longitude, 0) / points.length,
      };

const hasSubject = (photos: VisitPhoto[]) => photos.some((photo) => photo.kind === 'subject');

const locatedOf = (photos: VisitPhoto[]) => photos.filter((photo) => isLocated(photo)) as Located[];

/** minutes between two groups of photos, each ordered by time */
const minutesApart = (a: VisitPhoto[], b: VisitPhoto[]) =>
  Math.max(0, b[0].time - a.at(-1)!.time, a[0].time - b.at(-1)!.time) / 60_000;

/** whether two groups can be the same place: yes unless both are located and too far apart */
const isSamePlace = (a: VisitPhoto[], b: VisitPhoto[], maxDistanceMeters: number) => {
  const placeA = centroid(locatedOf(a));
  const placeB = centroid(locatedOf(b));
  return !placeA || !placeB || haversineKm(placeA, placeB) * 1000 <= maxDistanceMeters;
};

/**
 * Groups the photos of a collection (subjects, sources, signs and receipts) into visits: photos taken at most
 * `maxGapMinutes` apart, within `maxSpanMinutes` of the first one and, when both are located, within
 * `maxDistanceMeters` of the place of the visit so far. Sources, signs and receipts photographed apart from any
 * subject join the closest visit at the same place within `attachMinutes`; a source on its own is a visit too, while
 * a lone sign or receipt is dropped. Ordered by time, as is each visit.
 */
export const groupVisits = <T extends VisitPhoto>(
  photos: T[],
  options: Partial<VisitOptions> = DEFAULT_VISIT_OPTIONS,
): T[][] => {
  const settings = { ...DEFAULT_VISIT_OPTIONS, ...options };
  const groups = splitVisits(photos, settings);

  // attach the groups without subjects to the closest visit with subjects
  const visits = groups.filter((group) => hasSubject(group));
  const others: T[][] = [];
  for (const group of groups) {
    if (hasSubject(group)) {
      continue;
    }
    const closest = visits
      .map((visit) => ({ visit, minutes: minutesApart(visit, group) }))
      .filter(
        ({ visit, minutes }) =>
          minutes <= settings.attachMinutes && isSamePlace(visit, group, settings.maxDistanceMeters),
      )
      .toSorted((a, b) => a.minutes - b.minutes)[0];
    if (closest) {
      closest.visit.push(...group);
    } else if (group.some((photo) => photo.kind === 'source')) {
      others.push(group);
    }
  }

  return [...visits, ...others]
    .map((visit) => sortByTime(visit))
    .toSorted((a, b) => a[0].time - b[0].time || a[0].id.localeCompare(b[0].id));
};

const splitVisits = <T extends VisitPhoto>(photos: T[], options: VisitOptions): T[][] => {
  const groups: T[][] = [];
  let current: T[] = [];
  let located: Located[] = [];

  const flush = () => {
    if (current.length > 0) {
      groups.push(current);
    }
    current = [];
    located = [];
  };

  for (const photo of sortByTime(photos)) {
    const first = current[0];
    const previous = current.at(-1);
    if (first && previous) {
      const place = centroid(located);
      const tooLate =
        photo.time - previous.time > options.maxGapMinutes * 60_000 ||
        photo.time - first.time > options.maxSpanMinutes * 60_000;
      const tooFar = !!place && isLocated(photo) && haversineKm(place, photo) * 1000 > options.maxDistanceMeters;
      if (tooLate || tooFar) {
        flush();
      }
    }

    current.push(photo);
    if (isLocated(photo)) {
      located.push(photo);
    }
  }
  flush();

  return groups;
};

const mostCommon = (values: Array<string | null | undefined>) => {
  const counts = new Map<string, number>();
  for (const value of values) {
    if (value) {
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }
  }
  return [...counts].toSorted((a, b) => b[1] - a[1])[0]?.[0];
};

export type VisitSummary = {
  start: string;
  end: string;
  day: string;
  /** the kind of visit by its time, from the pack (e.g. Lunch or Dinner), when it has kinds */
  type?: string;
  city?: string;
  country?: string;
  /** [latitude, longitude] of the visit, the average of its located photos */
  gps?: [number, number];
  subjectIds: string[];
  sourceIds: string[];
  signIds: string[];
  receiptIds: string[];
};

const round = (value: number, digits: number) => Math.round(value * 10 ** digits) / 10 ** digits;

/** a visit; `getType` names the kind of visit from the time of its first subject (or photo) */
export const summarizeVisit = (photos: VisitPhoto[], getType?: (time: number) => string): VisitSummary => {
  const sorted = sortByTime(photos);
  const first = sorted[0];
  const last = sorted.at(-1)!;
  const place = centroid(sorted.filter((photo) => isLocated(photo)) as Located[]);
  const city = mostCommon(sorted.map((photo) => photo.city));
  const country = mostCommon(sorted.map((photo) => photo.country));
  const ids = (kind: VisitPhoto['kind']) => sorted.filter((photo) => photo.kind === kind).map(({ id }) => id);

  return {
    start: toLocalIso(first.time),
    end: toLocalIso(last.time),
    day: toLocalDay(first.time),
    // the subjects tell when the visit happened better than a sign photographed on the way in
    ...(getType && { type: getType((sorted.find((photo) => photo.kind === 'subject') ?? first).time) }),
    ...(city && { city }),
    ...(country && { country }),
    ...(place && { gps: [round(place.latitude, 5), round(place.longitude, 5)] as [number, number] }),
    subjectIds: ids('subject'),
    sourceIds: ids('source'),
    signIds: ids('sign'),
    receiptIds: ids('receipt'),
  };
};

const count = (names: string[], name: string) => names.filter((candidate) => candidate === name).length;

export type FallbackVisit = Pick<VisitSummary, 'type' | 'city' | 'day' | 'start'>;

/**
 * Names for visits whose place is unknown, from `getName` (e.g. "Dinner in Taormina"); the day is added when the name
 * would repeat ("Dinner in Taormina, 2024-06-12"), and the time when a day has two such visits.
 */
export const getFallbackVisitNames = (visits: FallbackVisit[], getName: (visit: FallbackVisit) => string) => {
  const base = visits.map((visit) => getName(visit));

  const withDay = base.map((name, index) =>
    count(base, name) > 1 && visits[index].city ? `${name}, ${visits[index].day}` : name,
  );
  return withDay.map((name, index) =>
    count(withDay, name) > 1 ? `${name} ${visits[index].start.slice(11, 16)}` : name,
  );
};

/** a photo that another pack named, e.g. a dish of a Food meal: when it was taken (local ms) and its place */
export type LinkedPlacePhoto = { id: string; time: number; place: string };

/** photos of another pack this many minutes before or after a visit are of the same occasion */
export const LINKED_PLACE_MINUTES = 60;

/**
 * The place another pack named at the time of a visit, e.g. the restaurant of the Food meal the drinks of a tasting
 * were poured at: the place of most of the other pack's photos taken during the visit (or up to `marginMinutes`
 * before or after it), with those photos; undefined when there are none.
 */
export const findLinkedPlace = (
  visit: { start: number; end: number },
  photos: LinkedPlacePhoto[],
  marginMinutes = LINKED_PLACE_MINUTES,
) => {
  const margin = marginMinutes * 60_000;
  const during = photos.filter(({ time }) => time >= visit.start - margin && time <= visit.end + margin);
  const byPlace = Map.groupBy(during, ({ place }) => place);
  const [best] = [...byPlace].toSorted((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
  return best ? { name: best[0], assetIds: best[1].map(({ id }) => id) } : undefined;
};
