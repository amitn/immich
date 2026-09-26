import { createMatcher, normalizeName } from 'src/utils/collections/fuzzy.js';
import { CollectionPack, getCollectionTagRules, redactText } from 'src/utils/collections/pack.js';
import { parseCollectionTag } from 'src/utils/collections/tags.js';

/**
 * Questions about the library ("which wine did we have at Noma?", "when did we last make the quiche?"), answered from
 * the tags the collections engine saved: the tagged photos are read back into visits of a place (a meal, a museum
 * visit, a cooking session, a trip) with their entries (dishes, artworks, steps, legs), filtered with fuzzy names and
 * summarized per pack. Everything here is pure; `CollectionService` reads the rows.
 */

/** a collection tag on a photo, with what the question filters need, as the repository reads it */
export type CollectionTagRow = {
  assetId: string;
  /** the tag value, e.g. `Food/Noma Australia/Rum lamington` */
  value: string;
  /** local wall-clock time, stored as UTC */
  localDateTime: Date;
  city: string | null;
  country: string | null;
  /** named people on the photo */
  people: string[];
};

/** a tagged photo read by its pack: the place and entry are redacted when the pack hides private text */
export type CollectionPhoto = {
  pack: CollectionPack;
  assetId: string;
  place: string;
  kind: 'entry' | 'source';
  entry?: string;
  /** local time in ms */
  time: number;
  city: string | null;
  country: string | null;
  people: string[];
};

export type CollectionVisit = {
  pack: CollectionPack;
  place: string;
  photos: CollectionPhoto[];
  start: number;
  end: number;
};

export type CollectionQueryFilters = {
  /** alternatives for the place, e.g. ["noma"] */
  place?: string[];
  /** alternatives for the entry, e.g. ["dessert", "petits fours"] */
  entry?: string[];
  /** alternatives for the place or the entry: a visit of a matching place counts whole */
  text?: string[];
  city?: string[];
  country?: string[];
  /**
   * people who were there: each has to be on a photo taken during the visit (give or take an hour), tagged or not,
   * as the photos of dishes or artworks rarely show anyone
   */
  people?: CollectionPersonTimes[];
};

/** a person asked about, with the local times in ms of the photos that show them */
export type CollectionPersonTimes = { name: string; times: number[] };

/** a person on a photo this close to a visit was there */
export const PERSON_MARGIN_MINUTES = 60;

export type CollectionQueryOptions = {
  /** return visits (default) or places */
  detail?: 'visits' | 'places';
  /** newest first (default) or oldest first */
  order?: 'desc' | 'asc';
  /** visits or places returned */
  limit?: number;
  /** entries listed per visit */
  entriesPerVisit?: number;
  /** photo ids listed per entry */
  photosPerEntry?: number;
  /** list the ids of the source photos (menus, labels), except for packs that keep them private */
  sources?: boolean;
};

export const COLLECTION_QUERY_DEFAULTS = {
  limit: 20,
  entriesPerVisit: 30,
  photosPerEntry: 3,
  datesPerPlace: 10,
  placesPerPack: 5,
} as const;

/** local day of a local time in ms, e.g. 2016-10-04 */
export const toLocalDay = (time: number) => new Date(time).toISOString().slice(0, 10);

const unique = <T>(values: T[]) => [...new Set(values)];

/** the most frequent value, the first seen on a tie */
const mostCommon = (values: Array<string | null>) => {
  const counts = new Map<string, number>();
  for (const value of values) {
    if (value) {
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }
  }
  let best: string | undefined;
  for (const [value, count] of counts) {
    if (best === undefined || count > counts.get(best)!) {
      best = value;
    }
  }
  return best;
};

/**
 * Reads the collection tags of the photos with the packs (by tag root), redacting the names of packs that hide
 * private text (travel: booking codes and names never leave the pack, even when a tag holds them).
 */
export const readCollectionRows = (rows: CollectionTagRow[], packs: CollectionPack[]): CollectionPhoto[] => {
  const byRoot = new Map(packs.map((pack) => [pack.tagRoot, { pack, rules: getCollectionTagRules(pack) }]));
  const photos: CollectionPhoto[] = [];
  for (const row of rows) {
    const found = byRoot.get(row.value.split('/', 1)[0]);
    const tag = found && parseCollectionTag(found.rules, row.value);
    if (!found || !tag) {
      continue;
    }
    const place = redactText(found.pack, tag.place);
    photos.push({
      pack: found.pack,
      assetId: row.assetId,
      place,
      kind: tag.kind,
      ...(tag.kind === 'entry' && { entry: redactText(found.pack, tag.entry) }),
      time: row.localDateTime.getTime(),
      city: row.city || null,
      country: row.country || null,
      people: row.people,
    });
  }
  return photos;
};

/** photos of one place further apart than this are different visits: the pack's own gaps, the longest of them */
export const getVisitGapMinutes = (pack: CollectionPack) =>
  Math.max(pack.visits.options.maxGapMinutes, pack.visits.options.attachMinutes, (pack.book.visitGapHours ?? 3) * 60);

/** groups the photos into visits: by pack and place (case-insensitive), split where the photos are far apart in time */
export const groupCollectionVisits = (photos: CollectionPhoto[]): CollectionVisit[] => {
  const groups = new Map<string, CollectionPhoto[]>();
  for (const photo of photos) {
    const key = `${photo.pack.id}\u{0}${normalizeName(photo.place)}`;
    groups.set(key, [...(groups.get(key) ?? []), photo]);
  }

  const visits: CollectionVisit[] = [];
  for (const group of groups.values()) {
    const sorted = group.toSorted((a, b) => a.time - b.time || a.assetId.localeCompare(b.assetId));
    const gap = getVisitGapMinutes(sorted[0].pack) * 60_000;
    let current: CollectionPhoto[] = [];
    const flush = () => {
      if (current.length > 0) {
        visits.push({
          pack: current[0].pack,
          // the spelling most photos of the visit have
          place: mostCommon(current.map(({ place }) => place)) ?? current[0].place,
          photos: current,
          start: current[0].time,
          end: current.at(-1)!.time,
        });
      }
      current = [];
    };
    for (const photo of sorted) {
      if (current.length > 0 && photo.time - current.at(-1)!.time > gap) {
        flush();
      }
      current.push(photo);
    }
    flush();
  }
  return visits.toSorted((a, b) => a.start - b.start || a.place.localeCompare(b.place));
};

type MatchedVisit = CollectionVisit & {
  /** the entry photos that answer the question */
  entries: CollectionPhoto[];
  sources: CollectionPhoto[];
  /** the people asked about, seen during the visit */
  seen: string[];
};

/** whether a sorted list of times has one within [from, to] */
const hasTimeWithin = (times: number[], from: number, to: number) => {
  let low = 0;
  let high = times.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (times[middle] < from) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  return low < times.length && times[low] <= to;
};

/**
 * The visits that answer the filters, with the entries that do: a place filter keeps the visits of matching places, an
 * entry filter the matching entries, and a text filter either (a matching place counts whole, like a recipe named
 * "Quiche Lorraine" for "quiche"). City and country match any photo of the visit, and the people asked about have to be
 * on a photo taken during it.
 */
export const filterCollectionVisits = (visits: CollectionVisit[], filters: CollectionQueryFilters): MatchedVisit[] => {
  const matchPlace = createMatcher(filters.place);
  const matchEntry = createMatcher(filters.entry);
  const matchText = createMatcher(filters.text);
  const matchCity = createMatcher(filters.city);
  const matchCountry = createMatcher(filters.country);
  const hasEntryFilter = !!filters.entry?.some((value) => normalizeName(value));
  const hasTextFilter = !!filters.text?.some((value) => normalizeName(value));
  const hasCityFilter = !!filters.city?.some((value) => normalizeName(value));
  const hasCountryFilter = !!filters.country?.some((value) => normalizeName(value));

  const margin = PERSON_MARGIN_MINUTES * 60_000;
  const people = (filters.people ?? []).map(({ name, times }) => ({ name, times: times.toSorted((a, b) => a - b) }));

  const matched: MatchedVisit[] = [];
  for (const visit of visits) {
    if (!matchPlace(visit.place)) {
      continue;
    }
    if (hasCityFilter && visit.photos.every(({ city }) => !matchCity(city))) {
      continue;
    }
    if (hasCountryFilter && visit.photos.every(({ country }) => !matchCountry(country))) {
      continue;
    }
    const seen = people.filter(({ times }) => hasTimeWithin(times, visit.start - margin, visit.end + margin));
    if (seen.length < people.length) {
      continue;
    }
    const placeAnswers = hasTextFilter && matchText(visit.place);
    const entries = visit.photos.filter(
      (photo) =>
        photo.kind === 'entry' && matchEntry(photo.entry) && (!hasTextFilter || placeAnswers || matchText(photo.entry)),
    );
    const sources = visit.photos.filter(({ kind }) => kind === 'source');
    // a visit without matching entries answers only when nothing narrows the entries (e.g. a menu photographed alone)
    const narrowed = hasEntryFilter || (hasTextFilter && !placeAnswers);
    if (entries.length === 0 && (narrowed || sources.length === 0)) {
      continue;
    }
    matched.push({ ...visit, entries, sources, seen: seen.map(({ name }) => name) });
  }
  return matched;
};

/** the entries of a visit, each once in the order first photographed, with its photos */
const groupEntries = (photos: CollectionPhoto[]) => {
  const entries = new Map<string, { name: string; assetIds: string[] }>();
  for (const photo of photos.toSorted((a, b) => a.time - b.time)) {
    const key = normalizeName(photo.entry!) || photo.entry!;
    const entry = entries.get(key) ?? { name: photo.entry!, assetIds: [] };
    entry.assetIds.push(photo.assetId);
    entries.set(key, entry);
  }
  return entries.values().toArray();
};

const describeWhere = (visit: CollectionVisit) => {
  const city = mostCommon(visit.photos.map(({ city }) => city));
  const country = mostCommon(visit.photos.map(({ country }) => country));
  return { ...(city && { city }), ...(country && { country }) };
};

/** whether a pack lets the ids of its source photos out (travel documents are never shown) */
const sharesSources = (pack: CollectionPack) => pack.privacy?.sourceImages !== false;

const compactVisit = (
  visit: MatchedVisit,
  options: Required<Omit<CollectionQueryOptions, 'detail' | 'order' | 'limit'>>,
) => {
  const entries = groupEntries(visit.entries);
  const people = unique([...visit.photos.flatMap((photo) => photo.people), ...visit.seen]).toSorted();
  const type = visit.pack.visits.type?.(visit.start);
  const startDay = toLocalDay(visit.start);
  const endDay = toLocalDay(visit.end);
  return {
    pack: visit.pack.id,
    place: visit.place,
    date: startDay,
    ...(endDay !== startDay && { endDate: endDay }),
    ...(type && { type }),
    ...describeWhere(visit),
    ...(people.length > 0 && { people }),
    entries: entries.slice(0, options.entriesPerVisit).map(({ name, assetIds }) => ({
      name,
      photoIds: assetIds.slice(0, options.photosPerEntry),
      ...(assetIds.length > options.photosPerEntry && { n: assetIds.length }),
    })),
    ...(entries.length > options.entriesPerVisit && { moreEntries: entries.length - options.entriesPerVisit }),
    ...(visit.sources.length > 0 && { sources: visit.sources.length }),
    ...(options.sources &&
      visit.sources.length > 0 &&
      sharesSources(visit.pack) && { sourcePhotoIds: visit.sources.map(({ assetId }) => assetId) }),
  };
};

/** the first or last visit, in a line: when, where and what */
const describeOccurrence = (visit: MatchedVisit, photosPerEntry: number) => {
  const entries = groupEntries(visit.entries);
  return {
    pack: visit.pack.id,
    place: visit.place,
    date: toLocalDay(visit.start),
    ...describeWhere(visit),
    ...(entries.length > 0 && { entries: entries.slice(0, 5).map(({ name }) => name) }),
    photoIds: (entries.length > 0
      ? entries.flatMap(({ assetIds }) => assetIds)
      : visit.photos.map((p) => p.assetId)
    ).slice(0, photosPerEntry),
  };
};

const compactPlaces = (visits: MatchedVisit[], options: { order: 'desc' | 'asc'; photosPerEntry: number }) => {
  const places = new Map<string, MatchedVisit[]>();
  for (const visit of visits) {
    const key = `${visit.pack.id}\u{0}${normalizeName(visit.place)}`;
    places.set(key, [...(places.get(key) ?? []), visit]);
  }
  const results = places
    .values()
    .map((group) => {
      const sorted = group.toSorted((a, b) => b.start - a.start);
      const days = unique(sorted.map(({ start }) => toLocalDay(start)));
      const entries = unique(group.flatMap(({ entries }) => entries.map(({ entry }) => normalizeName(entry!))));
      const where = describeWhere({ ...sorted[0], photos: group.flatMap(({ photos }) => photos) });
      return {
        last: sorted[0].start,
        first: sorted.at(-1)!.start,
        result: {
          pack: sorted[0].pack.id,
          place: sorted[0].place,
          visits: group.length,
          dates: days.slice(0, COLLECTION_QUERY_DEFAULTS.datesPerPlace),
          ...(days.length > COLLECTION_QUERY_DEFAULTS.datesPerPlace && {
            moreDates: days.length - COLLECTION_QUERY_DEFAULTS.datesPerPlace,
          }),
          ...where,
          entries: entries.length,
          photoIds: sorted
            .flatMap(({ entries, photos }) => (entries.length > 0 ? entries : photos))
            .map(({ assetId }) => assetId)
            .slice(0, options.photosPerEntry),
        },
      };
    })
    .toArray();
  return results
    .toSorted((a, b) => (options.order === 'asc' ? a.first - b.first : b.last - a.last))
    .map(({ result }) => result);
};

export type CollectionVisitResult = ReturnType<typeof compactVisit>;
export type CollectionPlaceResult = ReturnType<typeof compactPlaces>[number];
export type CollectionOccurrence = ReturnType<typeof describeOccurrence>;

export type CollectionQueryResult = {
  /** what matched: visits, places, distinct entries and the photos of the entries */
  total: { visits: number; places: number; entries: number; photos: number };
  packs?: string[];
  first?: CollectionOccurrence;
  last?: CollectionOccurrence;
  visits?: CollectionVisitResult[];
  moreVisits?: number;
  places?: CollectionPlaceResult[];
  morePlaces?: number;
};

/**
 * Answers a question about the collections: the matching visits (or places), newest first by default, with totals and
 * the first and last time, so that "when did we last…" takes one call.
 */
export const queryCollectionVisits = (
  photos: CollectionPhoto[],
  filters: CollectionQueryFilters,
  options: CollectionQueryOptions = {},
): CollectionQueryResult => {
  const order = options.order ?? 'desc';
  const limit = options.limit ?? COLLECTION_QUERY_DEFAULTS.limit;
  const settings = {
    entriesPerVisit: options.entriesPerVisit ?? COLLECTION_QUERY_DEFAULTS.entriesPerVisit,
    photosPerEntry: options.photosPerEntry ?? COLLECTION_QUERY_DEFAULTS.photosPerEntry,
    sources: options.sources ?? false,
  };

  const visits = filterCollectionVisits(groupCollectionVisits(photos), filters);
  const sorted = order === 'asc' ? visits : visits.toReversed();
  const places = new Set(visits.map((visit) => `${visit.pack.id}\u{0}${normalizeName(visit.place)}`));
  const entries = new Set(
    visits.flatMap((visit) =>
      visit.entries.map(
        (photo) => `${visit.pack.id}\u{0}${normalizeName(visit.place)}\u{0}${normalizeName(photo.entry!)}`,
      ),
    ),
  );
  const packs = unique(visits.map((visit) => visit.pack.id));

  const total = {
    visits: visits.length,
    places: places.size,
    entries: entries.size,
    photos: visits.reduce((sum, visit) => sum + visit.entries.length, 0),
  };

  if (options.detail === 'places') {
    const all = compactPlaces(visits, { order, photosPerEntry: settings.photosPerEntry });
    return {
      total,
      ...(packs.length > 0 && { packs }),
      ...(visits.length > 0 && {
        first: describeOccurrence(visits[0], settings.photosPerEntry),
        last: describeOccurrence(visits.at(-1)!, settings.photosPerEntry),
      }),
      places: all.slice(0, limit),
      ...(all.length > limit && { morePlaces: all.length - limit }),
    };
  }

  return {
    total,
    ...(packs.length > 0 && { packs }),
    ...(visits.length > 0 && {
      first: describeOccurrence(visits[0], settings.photosPerEntry),
      last: describeOccurrence(visits.at(-1)!, settings.photosPerEntry),
    }),
    visits: sorted.slice(0, limit).map((visit) => compactVisit(visit, settings)),
    ...(sorted.length > limit && { moreVisits: sorted.length - limit }),
  };
};

export type CollectionPackSummary = {
  pack: string;
  title: string;
  /** the words of the pack: place, entries and visits, e.g. restaurant, menu items, meals */
  place: string;
  entry: string;
  visit: string;
  photos: number;
  visits: number;
  places: number;
  entries: number;
  sources: number;
  years: number[];
  first?: string;
  last?: string;
  /** the places visited most recently, with how often */
  recentPlaces: Array<{ name: string; visits: number; last: string }>;
};

/** what the library holds per pack: every pack, with zeros when it has no tagged photos yet */
export const summarizeCollections = (photos: CollectionPhoto[], packs: CollectionPack[]): CollectionPackSummary[] => {
  const visits = groupCollectionVisits(photos);
  return packs.map((pack) => {
    const own = visits.filter((visit) => visit.pack === pack);
    const places = new Map<string, { name: string; visits: number; last: number }>();
    const entries = new Set<string>();
    let sources = 0;
    let count = 0;
    for (const visit of own) {
      const key = normalizeName(visit.place);
      const place = places.get(key) ?? { name: visit.place, visits: 0, last: 0 };
      place.visits++;
      place.last = Math.max(place.last, visit.start);
      places.set(key, place);
      for (const photo of visit.photos) {
        count++;
        if (photo.kind === 'source') {
          sources++;
        } else {
          entries.add(`${key}\u{0}${normalizeName(photo.entry!)}`);
        }
      }
    }
    const years = unique(
      own.flatMap((visit) => [visit.start, visit.end]).map((time) => new Date(time).getUTCFullYear()),
    );
    return {
      pack: pack.id,
      title: pack.title,
      place: pack.names.place,
      entry: pack.names.entries,
      visit: pack.names.visits,
      photos: count,
      visits: own.length,
      places: places.size,
      entries: entries.size,
      sources,
      years: years.toSorted((a, b) => a - b),
      ...(own.length > 0 && { first: toLocalDay(own[0].start), last: toLocalDay(own.at(-1)!.end) }),
      recentPlaces: places
        .values()
        .toArray()
        .toSorted((a, b) => b.last - a.last)
        .slice(0, COLLECTION_QUERY_DEFAULTS.placesPerPack)
        .map(({ name, visits, last }) => ({ name, visits, last: toLocalDay(last) })),
    };
  });
};

const PERIOD = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/;

/**
 * A bound of a date range on local time: a year (2025), a month (2025-06) or a day (2016-10-04) covers the whole
 * period, so from and to can be the same day; a date-time is local time too (a zone given with it is ignored). The end is exclusive.
 */
export const parseDateBound = (value: string, bound: 'from' | 'to'): Date | undefined => {
  const text = value.trim();
  const period = PERIOD.exec(text);
  if (period) {
    const [, year, month, day] = period;
    const y = Number(year);
    const m = month ? Number(month) - 1 : 0;
    const d = day ? Number(day) : 1;
    const start = Date.UTC(y, m, d);
    const check = new Date(start);
    if (check.getUTCFullYear() !== y || check.getUTCMonth() !== m || check.getUTCDate() !== d) {
      return;
    }
    if (bound === 'from') {
      return new Date(start);
    }
    return new Date(day ? Date.UTC(y, m, d + 1) : month ? Date.UTC(y, m + 1, 1) : Date.UTC(y + 1, 0, 1));
  }
  // photos are compared on their local time: a zone given with the date-time is dropped, not converted
  const local = text.replace(/(?:z|[+-]\d{2}:?\d{2})$/i, '');
  const date = /^\d{4}-\d{2}-\d{2}t\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/i.test(local) ? new Date(`${local}Z`) : undefined;
  if (!date || Number.isNaN(date.getTime())) {
    return;
  }
  // a local date-time given as the end is included
  return bound === 'to' ? new Date(date.getTime() + 1) : date;
};
