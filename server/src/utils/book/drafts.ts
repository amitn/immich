import { BookDraftKind } from 'src/enum.js';
import { haversineKm, pickSpread, splitEvents, toLocalDay } from 'src/utils/agent/events.js';
import { PHOTOS_PER_PAGE, formatDateRange } from 'src/utils/book/auto-layout.js';
import {
  CollectionPhoto,
  getCollectionTag,
  getPlaceVisits,
  parseBookCollectionTag,
} from 'src/utils/book/collections.js';
import { getCollectionPack } from 'src/utils/collections/registry.js';

/**
 * Books drafted for a user in the background (see `BookDraftService`): what can be drafted from their photos, as pure
 * functions. A suggestion is only made when there is enough material, and every suggestion has a stable key (e.g.
 * `food:2026`, `trip:Travel/Crete, October 2016`, `birthday:<personId>:7`) so that it is made once: a key that was
 * drafted, kept or discarded is never suggested again.
 */

/** a photo of the timeline, with its local time (`localDateTime.getTime()`) and place */
export type DraftPhoto = {
  id: string;
  time: number;
  latitude?: number | null;
  longitude?: number | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
};

/** a collection tag on a photo, e.g. `Food/Da Enzo/Cacio e pepe`, with the local time of the photo */
export type DraftTaggedPhoto = { id: string; time: number; value: string };

export type DraftPerson = { id: string; name: string; birthDate: Date | string };

/** a book that can be drafted */
export type DraftCandidate = {
  key: string;
  kind: BookDraftKind;
  title: string;
  subtitle?: string;
  /** why it is suggested, e.g. "You visited 6 restaurants in 2026 and photographed 54 dishes" */
  reason: string;
  /** a `BookStylePreset`: the pack's for its books, classic for trips and soft for birthdays */
  stylePreset: string;
  includeMaps: boolean;
  /** the photos to lay out, in time order (at most `MAX_DRAFT_PHOTOS`) */
  assetIds: string[];
  /** the local time of the end of what it covers, e.g. the last day of a trip: newer suggestions are drafted first */
  endsAt: number;
};

export type DraftKinds = { yearly: boolean; trips: boolean; birthdays: boolean };

export const DRAFT_THRESHOLDS = {
  /** a year of a pack: at least this many visits (meals, museum visits, cooking sessions, tastings) */
  yearlyVisits: 3,
  /** and this many photos of its subjects (dishes, artworks, bottles) */
  yearlySubjects: 15,
  /** a trip: at least this many photos */
  tripPhotos: 40,
  /** over at least this many calendar days */
  tripDays: 2,
  /** a birthday book: at least this many photos of the person in the year */
  birthdayPhotos: 30,
} as const;

/** the most photos given to the automatic layout of a draft, spread over what it covers */
export const MAX_DRAFT_PHOTOS = 3000;
/** the most pages of a draft; the automatic layout leaves the less important photos out */
export const MAX_DRAFT_PAGES = 40;
/** a trip is over this long after its last photo */
const TRIP_OVER_MS = 2 * 24 * 60 * 60 * 1000;
/** photos further than this from home are away from home */
export const AWAY_KM = 80;
/** away photos further apart than this are different trips */
const TRIP_GAP_MINUTES = 48 * 60;
/** home is the place with photos on the most days, when it has photos in at least this many months */
const HOME_MIN_MONTHS = 3;
/** the size of the cells home is looked for in, in degrees (about 30 km) */
const HOME_CELL_DEGREES = 0.25;

const DAY_MS = 24 * 60 * 60 * 1000;

/** the yearly book of a pack: its title, and why it is suggested */
type YearlyBook = {
  title: (year: number) => string;
  reason: (stats: YearStats) => string;
};

type YearStats = { year: number; visits: number; places: number; subjects: number; entries: number };

const count = (value: number, singular: string, plural = `${singular}s`) =>
  `${value} ${value === 1 ? singular : plural}`;

/** the packs that have a yearly book, by pack id */
export const YEARLY_BOOKS: Record<string, YearlyBook> = {
  food: {
    title: (year) => `${year} in food`,
    reason: ({ year, places, subjects }) =>
      `You visited ${count(places, 'restaurant')} in ${year} and photographed ${count(subjects, 'dish', 'dishes')}`,
  },
  museum: {
    title: (year) => `Museums we visited in ${year}`,
    reason: ({ year, places, subjects }) =>
      `You visited ${count(places, 'museum')} in ${year} and photographed ${count(subjects, 'artwork')}`,
  },
  cookbook: {
    title: (year) => `${year} in the kitchen`,
    reason: ({ year, places, visits }) =>
      `You cooked ${count(places, 'recipe')} in ${year}, in ${count(visits, 'cooking session')}`,
  },
  wine: {
    title: (year) => `Cellar notes ${year}`,
    reason: ({ year, visits, entries }) =>
      `You tasted ${count(entries, 'wine')} at ${count(visits, 'tasting')} in ${year}`,
  },
};

const TRAVEL_PACK = 'travel';

const byTime = <T extends { time: number; id: string }>(a: T, b: T) => a.time - b.time || a.id.localeCompare(b.id);

const yearOf = (time: number) => new Date(time).getUTCFullYear();

/** the number of calendar days from the day of `start` to the day of `end`, both included */
export const getDaySpan = (start: number, end: number) =>
  Math.round((Date.parse(toLocalDay(end)) - Date.parse(toLocalDay(start))) / DAY_MS) + 1;

/** the photos to lay out: all of them, or `MAX_DRAFT_PHOTOS` spread over the time they cover */
const toAssetIds = (photos: Array<{ id: string; time: number }>) => {
  const unique = new Map(photos.map((photo) => [photo.id, photo])).values().toArray().toSorted(byTime);
  return pickSpread(unique, MAX_DRAFT_PHOTOS).map(({ id }) => id);
};

/** the collection tag of every photo, among the tags of the packs given (by pack id) */
const getTaggedPhotos = (tags: DraftTaggedPhoto[], packs: Set<string>) => {
  const byAsset = Map.groupBy(
    tags.filter((tag) => packs.has(parseBookCollectionTag(tag.value)?.pack ?? '')),
    (tag) => tag.id,
  );
  const photos: Array<CollectionPhoto & { time: number }> = [];
  for (const [id, values] of byAsset) {
    const collection = getCollectionTag(values.map(({ value }) => value));
    if (collection) {
      photos.push({ id, time: values[0].time, takenAt: values[0].time, collection });
    }
  }
  return photos.toSorted(byTime);
};

/**
 * Yearly books of the packs with one (`YEARLY_BOOKS`), e.g. "2026 in food": a year that is over, with at least
 * `yearlyVisits` visits of the pack's places and `yearlySubjects` photos of its subjects
 */
export const getYearlyDrafts = (tags: DraftTaggedPhoto[], now: Date): DraftCandidate[] => {
  const currentYear = now.getUTCFullYear();
  const photos = getTaggedPhotos(tags, new Set(Object.keys(YEARLY_BOOKS)));
  const groups = Map.groupBy(photos, (photo) => `${photo.collection!.pack}:${yearOf(photo.time)}`);

  const candidates: DraftCandidate[] = [];
  for (const [key, group] of groups) {
    const { pack: packId } = group[0].collection!;
    const year = yearOf(group[0].time);
    const pack = getCollectionPack(packId);
    const book = YEARLY_BOOKS[packId];
    if (!pack || !book || year >= currentYear) {
      continue;
    }

    const { visits } = getPlaceVisits(group);
    const entries = group.filter((photo) => photo.collection?.kind === 'entry');
    const stats: YearStats = {
      year,
      visits: visits.length,
      places: new Set(visits.map((visit) => visit.place.trim().toLowerCase())).size,
      subjects: entries.length,
      entries: new Set(
        entries.map((photo) => {
          const tag = photo.collection!;
          return `${tag.place.trim().toLowerCase()}\n${tag.kind === 'entry' ? tag.entry.trim().toLowerCase() : ''}`;
        }),
      ).size,
    };
    if (stats.visits < DRAFT_THRESHOLDS.yearlyVisits || stats.subjects < DRAFT_THRESHOLDS.yearlySubjects) {
      continue;
    }

    candidates.push({
      key,
      kind: BookDraftKind.Yearly,
      title: book.title(year),
      reason: book.reason(stats),
      stylePreset: pack.book.preset.id,
      includeMaps: false,
      assetIds: toAssetIds(group),
      endsAt: Date.UTC(year, 11, 31, 23, 59, 59),
    });
  }
  return candidates;
};

type Trip = { start: number; end: number; photos: DraftPhoto[] };

/** whether a trip is over, has enough days and enough photos */
const isDraftableTrip = ({ start, end, photos }: Trip, now: Date) =>
  end < now.getTime() - TRIP_OVER_MS &&
  getDaySpan(start, end) >= DRAFT_THRESHOLDS.tripDays &&
  photos.length >= DRAFT_THRESHOLDS.tripPhotos;

/** the timeline photos taken from the first day of a trip to its last */
const getPhotosOfDays = (timeline: DraftPhoto[], start: number, end: number) => {
  const [first, last] = [toLocalDay(start), toLocalDay(end)];
  return timeline.filter((photo) => {
    const day = toLocalDay(photo.time);
    return day >= first && day <= last;
  });
};

/**
 * A book per trip of the travel pack (a `Travel/<Trip>` tag): the photos from its first day to its last, when the trip
 * is over, spans at least `tripDays` days and has at least `tripPhotos` photos. Its preset is the travel pack's, whose
 * chapters are the legs of the trip.
 */
export const getTaggedTripDrafts = (tags: DraftTaggedPhoto[], timeline: DraftPhoto[], now: Date): DraftCandidate[] => {
  const photos = getTaggedPhotos(tags, new Set([TRAVEL_PACK]));
  const pack = getCollectionPack(TRAVEL_PACK);
  if (!pack) {
    return [];
  }

  const trips = Map.groupBy(photos, (photo) => photo.collection!.place.trim());
  const candidates: DraftCandidate[] = [];
  for (const [place, group] of trips) {
    // a trip is when its photos were taken; its documents are often photographed later
    const entries = group.filter((photo) => photo.collection?.kind === 'entry');
    const times = (entries.length > 0 ? entries : group).map((photo) => photo.time);
    const [start, end] = [Math.min(...times), Math.max(...times)];
    const tripPhotos: DraftPhoto[] = new Map(
      [...getPhotosOfDays(timeline, start, end), ...group.map(({ id, time }) => ({ id, time }))].map((photo) => [
        photo.id,
        photo,
      ]),
    )
      .values()
      .toArray();
    const trip = { start, end, photos: tripPhotos };
    if (!isDraftableTrip(trip, now)) {
      continue;
    }

    const days = getDaySpan(start, end);
    candidates.push({
      key: `trip:${pack.tagRoot}/${place}`,
      kind: BookDraftKind.Trip,
      title: place,
      subtitle: formatDateRange(start, end),
      reason: `Your trip ${place}: ${count(days, 'day')} and ${count(tripPhotos.length, 'photo')}`,
      stylePreset: pack.book.preset.id,
      includeMaps: true,
      assetIds: toAssetIds(trip.photos),
      endsAt: end,
    });
  }
  return candidates;
};

const hasLocation = (photo: DraftPhoto): photo is DraftPhoto & { latitude: number; longitude: number } =>
  typeof photo.latitude === 'number' &&
  typeof photo.longitude === 'number' &&
  Number.isFinite(photo.latitude) &&
  Number.isFinite(photo.longitude) &&
  !(photo.latitude === 0 && photo.longitude === 0);

const median = (values: number[]) => {
  const sorted = values.toSorted((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};

/**
 * Home: the place (a cell of about 30 km) with located photos on the most days, when it has photos in at least
 * `HOME_MIN_MONTHS` months; undefined when no place is photographed that often (e.g. a library of trips only)
 */
export const getHome = (timeline: DraftPhoto[]) => {
  const located = timeline.filter((photo) => hasLocation(photo));
  const cells = Map.groupBy(
    located,
    (photo) => `${Math.floor(photo.latitude / HOME_CELL_DEGREES)}:${Math.floor(photo.longitude / HOME_CELL_DEGREES)}`,
  );
  let best: { photos: typeof located; days: number } | undefined;
  for (const photos of cells.values()) {
    const days = new Set(photos.map((photo) => toLocalDay(photo.time))).size;
    if (!best || days > best.days) {
      best = { photos, days };
    }
  }
  if (!best || new Set(best.photos.map((photo) => toLocalDay(photo.time).slice(0, 7))).size < HOME_MIN_MONTHS) {
    return;
  }
  return {
    latitude: median(best.photos.map((photo) => photo.latitude)),
    longitude: median(best.photos.map((photo) => photo.longitude)),
  };
};

/** the most common value, when it names at least `share` of the values */
const mostCommon = (values: Array<string | null | undefined>, share: number) => {
  const present = values.filter((value): value is string => !!value);
  const counts = Map.groupBy(present, (value) => value);
  const [best] = [...counts].toSorted((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
  return best && best[1].length >= share * present.length ? best[0] : undefined;
};

/** where a trip went: its city, region or country, the first that most of its located photos share */
export const getTripPlace = (photos: DraftPhoto[]) => {
  const located = photos.filter((photo) => photo.city || photo.state || photo.country);
  return (
    mostCommon(
      located.map((photo) => photo.city),
      0.6,
    ) ??
    mostCommon(
      located.map((photo) => photo.state),
      0.6,
    ) ??
    mostCommon(
      located.map((photo) => photo.country),
      0.5,
    )
  );
};

/**
 * Trips found in the timeline, for libraries without travel tags: the photos taken away from home (further than
 * `AWAY_KM`), split into events (`splitEvents`) where no photo was taken for `TRIP_GAP_MINUTES` or a photo was taken
 * at home. Without a home (see `getHome`) every located photo counts as away. The photos without a location taken
 * during a trip belong to it.
 */
export const findTrips = (timeline: DraftPhoto[]): Trip[] => {
  const home = getHome(timeline);
  const sorted = timeline.toSorted(byTime);
  const isAway = (photo: DraftPhoto & { latitude: number; longitude: number }) =>
    !home || haversineKm(home, photo) > AWAY_KM;

  // the runs of away photos between photos taken at home
  const runs: DraftPhoto[][] = [];
  let run: DraftPhoto[] = [];
  for (const photo of sorted) {
    if (!hasLocation(photo)) {
      continue;
    }
    if (isAway(photo)) {
      run.push(photo);
    } else if (run.length > 0) {
      runs.push(run);
      run = [];
    }
  }
  if (run.length > 0) {
    runs.push(run);
  }

  const trips: Trip[] = [];
  for (const points of runs) {
    for (const event of splitEvents(points, { maxGapMinutes: TRIP_GAP_MINUTES, maxDistanceKm: Infinity })) {
      const [start, end] = [event[0].time, event.at(-1)!.time];
      const unlocated = sorted.filter((photo) => !hasLocation(photo) && photo.time >= start && photo.time <= end);
      trips.push({ start, end, photos: [...event, ...unlocated].toSorted(byTime) });
    }
  }
  return trips;
};

/**
 * A book per trip away from home (see `findTrips`) that is over, spans at least `tripDays` days and has at least
 * `tripPhotos` photos, keyed by its first day (`trip:2025-08-12`), in the classic preset with maps
 */
export const getTimelineTripDrafts = (timeline: DraftPhoto[], now: Date): DraftCandidate[] =>
  findTrips(timeline)
    .filter((trip) => isDraftableTrip(trip, now))
    .map(({ start, end, photos }) => {
      const place = getTripPlace(photos);
      const days = getDaySpan(start, end);
      return {
        key: `trip:${toLocalDay(start)}`,
        kind: BookDraftKind.Trip,
        title: place ? `Our trip to ${place}` : 'Our trip',
        subtitle: formatDateRange(start, end),
        reason: `You spent ${count(days, 'day')}${place ? ` in ${place}` : ' away'} and took ${count(photos.length, 'photo')}`,
        stylePreset: 'classic',
        includeMaps: true,
        assetIds: toAssetIds(photos),
        endsAt: end,
      };
    });

/** the trip drafts: the travel pack's trips when the user has travel tags, otherwise the trips in the timeline */
export const getTripDrafts = (tags: DraftTaggedPhoto[], timeline: DraftPhoto[], now: Date) =>
  tags.some((tag) => parseBookCollectionTag(tag.value)?.pack === TRAVEL_PACK)
    ? getTaggedTripDrafts(tags, timeline, now)
    : getTimelineTripDrafts(timeline, now);

const isLeapYear = (year: number) => (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;

/** the birthday in a year, on 28 February for 29 February in other years */
const birthdayIn = (year: number, month: number, day: number) =>
  Date.UTC(year, month, month === 1 && day === 29 && !isLeapYear(year) ? 28 : day);

const toDate = (value: Date | string) =>
  typeof value === 'string' ? new Date(`${value.slice(0, 10)}T00:00:00.000Z`) : value;

/**
 * The year of a person's life that ended on their latest birthday (today's included): from the birthday before it to
 * the end of the birthday (the party is in the book), and the age they turned; undefined before their first birthday
 */
export const getBirthdayYear = (birthDate: Date | string, now: Date) => {
  const born = toDate(birthDate);
  const [month, day] = [born.getUTCMonth(), born.getUTCDate()];
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  let year = now.getUTCFullYear();
  if (birthdayIn(year, month, day) > today) {
    year--;
  }
  const age = year - born.getUTCFullYear();
  if (age < 1) {
    return;
  }
  const birthday = birthdayIn(year, month, day);
  return { age, birthday, from: birthdayIn(year - 1, month, day), to: birthday + DAY_MS - 1 };
};

/**
 * A birthday book of a named person with a birth date: the photos of them from the year that ended on their latest
 * birthday (see `getBirthdayYear`), when there are at least `birthdayPhotos`, in the soft preset
 */
export const getBirthdayDraft = (
  person: DraftPerson,
  photos: Array<{ id: string; time: number }>,
  now: Date,
): DraftCandidate | undefined => {
  const window = getBirthdayYear(person.birthDate, now);
  const name = person.name.trim();
  if (!window || !name) {
    return;
  }
  const inYear = photos.filter((photo) => photo.time >= window.from && photo.time <= window.to);
  if (new Set(inYear.map((photo) => photo.id)).size < DRAFT_THRESHOLDS.birthdayPhotos) {
    return;
  }
  return {
    key: `birthday:${person.id}:${window.age}`,
    kind: BookDraftKind.Birthday,
    title: `${name} turns ${window.age}`,
    subtitle: formatDateRange(window.from, window.to),
    reason: `${count(new Set(inYear.map((photo) => photo.id)).size, 'photo')} of ${name} from the year before they turned ${window.age}`,
    stylePreset: 'soft',
    includeMaps: false,
    assetIds: toAssetIds(inYear),
    endsAt: window.birthday,
  };
};

/**
 * The suggestions to draft now: those whose key was never suggested, of the kinds that are enabled, the newest first,
 * at most `limit`
 */
export const selectDrafts = (
  candidates: DraftCandidate[],
  options: { existingKeys: Set<string>; kinds: DraftKinds; limit: number },
) => {
  const enabled: Record<BookDraftKind, boolean> = {
    [BookDraftKind.Yearly]: options.kinds.yearly,
    [BookDraftKind.Trip]: options.kinds.trips,
    [BookDraftKind.Birthday]: options.kinds.birthdays,
  };
  const seen = new Set(options.existingKeys);
  const selected: DraftCandidate[] = [];
  for (const candidate of candidates.toSorted((a, b) => b.endsAt - a.endsAt || a.key.localeCompare(b.key))) {
    if (selected.length >= options.limit) {
      break;
    }
    if (!enabled[candidate.kind] || seen.has(candidate.key) || candidate.assetIds.length === 0) {
      continue;
    }
    seen.add(candidate.key);
    selected.push(candidate);
  }
  return selected;
};

/** the page count to aim for: the automatic layout's own (about one page per 2.5 photos), up to `MAX_DRAFT_PAGES` */
export const getDraftPageCount = (photoCount: number) =>
  photoCount / PHOTOS_PER_PAGE > MAX_DRAFT_PAGES ? MAX_DRAFT_PAGES : undefined;
