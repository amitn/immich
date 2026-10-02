import { AssetType } from 'src/enum.js';
import { parseBookCollectionTag } from 'src/utils/book/collections.js';
import { DraftPhoto, findTrips, getDaySpan, getTripPlace } from 'src/utils/book/drafts.js';
import { getCollectionPack } from 'src/utils/collections/registry.js';

/**
 * The stats of a year in review (#12), as the `year_recap` memory stores them in its context: how many photos, the
 * places, the people and pets, the trips, and what the journals saw (dishes and restaurants, museums, concerts…).
 * Only facts are stored; the cards are worded in the viewer's language (`web/src/lib/utils/memory-card.ts`).
 */

/** a photo or video of the year, with its local time and place */
export type YearRecapAsset = DraftPhoto & { type: string; isFavorite: boolean };

/** a named person or pet of the user, with how many of the year's photos show them */
export type YearRecapPerson = { id: string; name: string; type: string; count: number };

/** a journal tag of one of the year's photos, e.g. `Food/Da Enzo/Cacio e pepe` */
export type YearRecapTag = { id: string; value: string };

/** what one journal saw in the year: its places (restaurants, museums) and its entries (dishes, artworks) */
export type YearRecapJournalStats = { places: number; entries: number; topPlaces: string[] };

export type YearRecapStats = {
  year: number;
  count: number;
  photoCount: number;
  videoCount: number;
  /** distinct cities, and the most photographed ones */
  places: number;
  countries: number;
  topPlaces: string[];
  people: number;
  topPeople: Array<{ id: string; name: string }>;
  pets: number;
  topPets: Array<{ id: string; name: string }>;
  trips: number;
  topTrips: string[];
  /** by journal pack id, e.g. food, museum; only the journals with something in the year */
  journals: Record<string, YearRecapJournalStats>;
};

/** the most shown, at most this many */
export const YEAR_RECAP_TOP = 3;
/** a trip of the timeline counts in the stats with at least this many photos, over at least two days */
const MIN_TRIP_PHOTOS = 10;

const top = <T>(counts: Map<string, { value: T; count: number }>, limit = YEAR_RECAP_TOP) =>
  [...counts.entries()]
    .toSorted((a, b) => b[1].count - a[1].count || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([, { value }]) => value);

const countBy = (values: string[]) => {
  const counts = new Map<string, { value: string; count: number }>();
  for (const value of values) {
    const key = value.trim().toLowerCase();
    if (!key) {
      continue;
    }
    const entry = counts.get(key) ?? { value: value.trim(), count: 0 };
    entry.count++;
    counts.set(key, entry);
  }
  return counts;
};

/** what each journal saw in the year, from the journal tags of its photos */
export const getJournalStats = (tags: YearRecapTag[]): Record<string, YearRecapJournalStats> => {
  const byPack = new Map<string, { places: string[]; entries: Set<string> }>();
  for (const { value } of tags) {
    const tag = parseBookCollectionTag(value);
    if (!tag) {
      continue;
    }
    const pack = byPack.get(tag.pack) ?? { places: [], entries: new Set<string>() };
    pack.places.push(tag.place);
    if (tag.kind === 'entry') {
      pack.entries.add(`${tag.place.trim().toLowerCase()}\n${tag.entry.trim().toLowerCase()}`);
    }
    byPack.set(tag.pack, pack);
  }

  const journals: Record<string, YearRecapJournalStats> = {};
  for (const [packId, { places, entries }] of byPack) {
    if (!getCollectionPack(packId)) {
      continue;
    }
    // a place counts once, whatever number of its photos are tagged
    const counts = countBy(places);
    journals[packId] = { places: counts.size, entries: entries.size, topPlaces: top(counts) };
  }
  return journals;
};

/** the trips of the year: the travel journal's when the user keeps one, otherwise the trips away from home */
export const getYearTrips = (assets: YearRecapAsset[], journals: Record<string, YearRecapJournalStats>) => {
  const travel = journals.travel;
  if (travel && travel.places > 0) {
    return { trips: travel.places, topTrips: travel.topPlaces };
  }
  const trips = findTrips(assets.filter((asset) => asset.type === AssetType.Image))
    .filter(({ start, end, photos }) => getDaySpan(start, end) >= 2 && photos.length >= MIN_TRIP_PHOTOS)
    .toSorted((a, b) => b.photos.length - a.photos.length || a.start - b.start);
  return {
    trips: trips.length,
    topTrips: trips
      .map(({ photos }) => getTripPlace(photos))
      .filter((place): place is string => !!place)
      .filter((place, index, places) => places.indexOf(place) === index)
      .slice(0, YEAR_RECAP_TOP),
  };
};

/** the stats of a year, from its photos and videos, its people and pets, and its journal tags */
export const getYearRecapStats = (
  year: number,
  assets: YearRecapAsset[],
  people: YearRecapPerson[],
  tags: YearRecapTag[],
): YearRecapStats => {
  const photoCount = assets.filter((asset) => asset.type === AssetType.Image).length;
  const cities = countBy(assets.map((asset) => asset.city ?? ''));
  const countries = countBy(assets.map((asset) => asset.country ?? ''));
  const named = people.filter((person) => person.name.trim() && person.count > 0);
  const byCount = (a: YearRecapPerson, b: YearRecapPerson) => b.count - a.count || a.name.localeCompare(b.name);
  const humans = named.filter((person) => person.type !== 'pet').toSorted(byCount);
  const pets = named.filter((person) => person.type === 'pet').toSorted(byCount);
  const journals = getJournalStats(tags);
  const travel = journals.travel;
  if (travel) {
    // the trips are stats of their own
    delete journals.travel;
  }

  return {
    year,
    count: assets.length,
    photoCount,
    videoCount: assets.length - photoCount,
    places: cities.size,
    countries: countries.size,
    topPlaces: top(cities),
    people: humans.length,
    topPeople: humans.slice(0, YEAR_RECAP_TOP).map(({ id, name }) => ({ id, name })),
    pets: pets.length,
    topPets: pets.slice(0, YEAR_RECAP_TOP).map(({ id, name }) => ({ id, name })),
    ...getYearTrips(assets, travel ? { travel } : {}),
    journals,
  };
};

/** the stats in a sentence, for a notification or the assistant (the cards word them in the viewer's language) */
export const describeYearRecap = (stats: YearRecapStats) => {
  const plural = (count: number, singular: string, pluralForm = `${singular}s`) =>
    `${count.toLocaleString('en')} ${count === 1 ? singular : pluralForm}`;
  const parts = [plural(stats.count, 'photo')];
  if (stats.places > 0) {
    parts.push(plural(stats.places, 'place'));
  }
  if (stats.people > 0) {
    parts.push(plural(stats.people, 'person', 'people'));
  }
  if (stats.trips > 0) {
    parts.push(plural(stats.trips, 'trip'));
  }
  const food = stats.journals.food;
  if (food && food.entries > 0) {
    parts.push(plural(food.entries, 'dish', 'dishes'));
  }
  const museum = stats.journals.museum;
  if (museum && museum.places > 0) {
    parts.push(plural(museum.places, 'museum'));
  }
  return parts.join(', ');
};
