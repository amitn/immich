import type { BookMap, BookStyle, NormalizedRect } from 'src/dtos/book.dto.js';
import { cosineDistance } from 'src/utils/agent/clustering.js';
import { EventSplitOptions, getAdaptiveEventOptions, isShortSpan, splitEvents } from 'src/utils/agent/events.js';
import { MAIN_PEOPLE_DEFAULTS, getMainPeople } from 'src/utils/agent/selection.js';
import {
  BookCollectionTag,
  getEntryCaption,
  getPlaceVisits,
  getRunsBetweenVisits,
  isCollectionTheme,
  isEntryPhoto,
  isSourcePhoto,
} from 'src/utils/book/collections.js';
import {
  BookLayout,
  LayoutRect,
  PageSize,
  bookLayouts,
  getLayout,
  getSlotRectsMm,
  isMapLayout,
} from 'src/utils/book/layouts.js';
import { BookMapStyle } from 'src/utils/book/map-styles.js';
import { MIN_PRINT_DPI, getEffectiveDpi, getSmartCrop } from 'src/utils/book/render.js';

/**
 * What an asset is: an original photo, or a copy stacked with it (the original is the primary asset of the stack).
 * Artwork (the result of an art job) is artwork even outside a stack.
 */
export type AutoLayoutPhotoKind = 'original' | 'artwork' | 'crop' | 'enhanced' | 'improved' | 'copy';

export type AutoLayoutPerson = { id: string; name?: string | null };

export type AutoLayoutCaptions = 'none' | 'place' | 'place-time' | 'people' | 'dish';

export type AutoLayoutPhoto = {
  id: string;
  /** size of the photo as displayed (orientation applied); 0 when unknown */
  width: number;
  height: number;
  /** local capture time in ms */
  takenAt: number;
  lat?: number | null;
  lon?: number | null;
  city?: string | null;
  country?: string | null;
  /** quality score, 0..1 */
  score: number;
  /** face boxes normalized to 0..1 */
  faces: NormalizedRect[];
  isFavorite: boolean;
  /** near-duplicate cluster; photos without one are unique */
  clusterId?: number | null;
  /** event the photo belongs to; events are computed when any photo lacks one */
  eventIndex?: number | null;
  stackId?: string | null;
  /** default original */
  kind?: AutoLayoutPhotoKind;
  /** people (named or not) in the photo */
  people?: AutoLayoutPerson[];
  /** L2-normalized CLIP embedding, to keep similar photos off neighbouring pages */
  embedding?: Float32Array | null;
  /**
   * the entry or the source of a place of a collection, e.g. the dish or the menu of a restaurant, from the
   * `<Root>/<Place>/<Entry>` tags such as `Food/<Restaurant>/<Dish>` (see `src/utils/collections/tags.ts`)
   */
  collection?: BookCollectionTag | null;
  /** lines of text read in the photo (OCR); of several source photos, the one that reads best gets the source page */
  textLines?: number;
  /**
   * the text its pack typesets on the source page of the photo (see `CollectionPack.book.sourceText`), e.g. the
   * ingredients and steps of a recipe: the page gets the recipe layout with the text as its caption
   */
  sourceText?: string;
};

export type AutoLayoutOptions = {
  size: PageSize;
  style: BookStyle;
  /** default: about one page per 2.5 photos, 4 to 80 pages */
  targetPageCount?: number;
  /** open the sections with GPS locations with a map page, default true */
  includeMaps?: boolean;
  mapStyle?: BookMapStyle;
  /** photos that get a page of their own */
  heroIds?: string[];
  /** start with a cover page, default true */
  cover?: boolean;
  /** end with a text page */
  closing?: { title?: string; caption?: string };
  /** default: scaled to the photos, see `getAdaptiveEventOptions` */
  events?: EventSplitOptions;
  layouts?: readonly BookLayout[];
  /** most pages with artwork, as a share of the pages, default 0.2; never two artwork pages in a row */
  maxArtworkShare?: number;
  /** artworks shown next to their original on the same page, default 2 */
  maxStackPairs?: number;
  /**
   * factual captions drafted for the pages, default dish in a collection book (every entry, e.g. a dish, captioned as
   * its pack formats it), otherwise place
   */
  captions?: AutoLayoutCaptions;
  /**
   * a collection book, e.g. a food book: one chapter per visit of a place (a restaurant) opened by its source page (the
   * menu), entries (dishes) on layouts that leave room for their names; default when the style has the theme of a
   * pack (e.g. food) or photos have the tags of a pack
   */
  collection?: boolean;
  /** people spread over the sections; default: the people who appear most often (see `getMainPeople`) */
  mainPersonIds?: string[];
  /** photos of every main person in each section they appear in, default 1 */
  minPerPersonPerSection?: number;
  /** photos of every main person in the book, default 4 */
  minPerPersonPerBook?: number;
};

export type AutoLayoutSlot = { assetId: string; crop: NormalizedRect; caption?: string };

export type AutoLayoutPage = {
  layout: string;
  slots: AutoLayoutSlot[];
  sectionTitle?: string;
  caption?: string;
  map?: BookMap;
  /** index of the section the page belongs to */
  section?: number;
};

export type AutoLayoutSection = {
  title: string;
  dates: string;
  photoIds: string[];
  located: boolean;
  /** the place of a chapter that is a visit of a collection, e.g. a restaurant */
  place?: string;
  /** the id of the pack of that visit, e.g. food */
  pack?: string;
};

export type AutoLayoutDropReason = 'duplicate' | 'stack' | 'artwork' | 'resolution' | 'budget';

export type AutoLayoutPersonCoverage = { personId: string; name?: string; photos: number; placed: number };

export type AutoLayoutPlan = {
  pages: AutoLayoutPage[];
  sections: AutoLayoutSection[];
  usedIds: string[];
  /** photos left out because of near-duplicates, stacks, artwork limits, low resolution or the page budget */
  droppedIds: string[];
  /** why each photo of `droppedIds` was left out */
  dropReasons: Record<string, AutoLayoutDropReason>;
  /** how often the main people appear in the photos and in the book */
  people: AutoLayoutPersonCoverage[];
};

/** a crop that loses more than this share of the photo is not acceptable */
export const MAX_CROP_LOSS = 0.45;
export const PHOTOS_PER_PAGE = 2.5;
export const MIN_AUTO_PAGES = 4;
export const MAX_AUTO_PAGES = 80;
export const DEFAULT_MAX_ARTWORK_SHARE = 0.2;
export const DEFAULT_MAX_STACK_PAIRS = 2;
export const MAX_SINGLES_IN_A_ROW = 2;
/** photos closer than this (CLIP cosine distance) count as similar, fully so at `SIMILAR_FULL_DISTANCE` */
export const SIMILAR_DISTANCE = 0.2;
const SIMILAR_FULL_DISTANCE = 0.08;
/** more photos per content page than this and the lowest ranked photos are dropped */
const MAX_DENSITY = 4;
const MIN_SECTION_SIZE = 3;
const PAGE_SIZES = [1, 2, 3, 4, 6] as const;
const SIZE_PENALTY: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0.05, 6: 0.35 };
const SIZE_REPEAT_PENALTY = 0.15;
const LAYOUT_REPEAT_PENALTY = 2;
const HERO_SHARED_PENALTY = 5;
const SAME_CLUSTER_PENALTY = 3;
const SINGLES_PENALTY = 3;
const ARTWORK_REPEAT_PENALTY = 4;
/** penalty for similar photos on facing pages; half of it across a page turn */
const SIMILAR_SPREAD_PENALTY = 1.5;
/** a copy (crop, enhanced) replaces the original of its stack only when it scores this much better */
const CROP_MARGIN = 0.03;
const COPY_MARGIN = 0.05;
/** an improved copy replaces its original unless it scores this much worse: its fixes were measured to help */
const IMPROVED_MARGIN = 0.02;
const MAIN_PERSON_BONUS = 0.05;
/** layouts that open a chapter with its title (and a photo) */
const TITLE_LAYOUTS = new Set(['section-opener', 'dish-opener', 'menu', 'menu-wide', 'recipe']);
/** the source pages of the collections: a printed page (a menu, a wall label...) opens the chapter of a visit */
const SOURCE_LAYOUTS = ['menu', 'menu-wide'];
/** the source page of a source whose text a pack typesets beside its photo (see `AutoLayoutPhoto.sourceText`) */
const SOURCE_TEXT_LAYOUT = 'recipe';
/** the entries of a source page are listed one per line up to this many */
const SOURCE_LIST_MAX = 7;
const OPENER_LAYOUTS = new Set(['cover', 'text', 'map', 'map-photo', ...TITLE_LAYOUTS]);
/** the most dishes on one page, so that each gets room for its name */
const MAX_DISHES_PER_PAGE = 4;
/** a dish on a layout without room for its name below it, where the name covers the photo */
const DISH_PLAIN_PENALTY = 0.4;
/** four dishes on a page */
const DISH_DENSE_PENALTY = 0.6;
/** a photo without a dish name (e.g. the bread) on a layout made for dishes, whose caption stays empty */
const UNNAMED_DISH_PENALTY = 0.3;
/** a food book gives its dishes more room: a page per this many dishes */
export const DISHES_PER_PAGE = 1.6;

type Candidate = AutoLayoutPhoto & {
  importance: number;
  hero: boolean;
  located: boolean;
  artwork: boolean;
  /** an artwork and its original, placed together on one page */
  pair?: [Candidate, Candidate];
};

type LayoutChoice = { layout: BookLayout; cost: number; order: Candidate[]; crops: NormalizedRect[] };

type Group = { photos: Candidate[]; choices: LayoutChoice[]; artwork: boolean };

type PlannedPage = LayoutChoice;

/** the page before a run of pages */
type PartitionContext = {
  previous?: string;
  previousPhotos?: Candidate[];
  /** single-photo pages right before */
  singles: number;
  /** one-based number of the first page */
  pageNumber: number;
};

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

const byTime = (a: AutoLayoutPhoto, b: AutoLayoutPhoto) => a.takenAt - b.takenAt || a.id.localeCompare(b.id);

const byImportance = (a: Candidate, b: Candidate) => b.importance - a.importance || byTime(a, b);

const isLocated = (photo: AutoLayoutPhoto) =>
  typeof photo.lat === 'number' &&
  typeof photo.lon === 'number' &&
  Number.isFinite(photo.lat) &&
  Number.isFinite(photo.lon) &&
  !(photo.lat === 0 && photo.lon === 0);

const membersOf = (candidate: Candidate): Candidate[] => candidate.pair ?? [candidate];

export const getImportance = (photo: AutoLayoutPhoto, hero = false, mainPeople?: Set<string>) =>
  clamp(photo.score, 0, 1) +
  (photo.isFavorite ? 0.2 : 0) +
  (photo.faces.length > 0 ? 0.05 : 0) +
  (mainPeople && photo.people?.some(({ id }) => mainPeople.has(id)) ? MAIN_PERSON_BONUS : 0) +
  (hero ? 1 : 0);

export const getTargetPageCount = (photoCount: number, collection?: { entries: number; sources: number }) =>
  clamp(
    Math.round(
      collection
        ? (photoCount - collection.entries - collection.sources) / PHOTOS_PER_PAGE +
            collection.entries / DISHES_PER_PAGE +
            collection.sources
        : photoCount / PHOTOS_PER_PAGE,
    ),
    MIN_AUTO_PAGES,
    MAX_AUTO_PAGES,
  );

/** see `AutoLayoutPhotoKind`; copies are told apart by the suffix of their file name (e.g. IMG_1-crop.jpg) */
export const getPhotoKind = (asset: {
  isArtwork?: boolean | null;
  stackId?: string | null;
  isPrimary?: boolean | null;
  originalFileName?: string | null;
}): AutoLayoutPhotoKind => {
  if (asset.isArtwork) {
    return 'artwork';
  }
  if (!asset.stackId || asset.isPrimary) {
    return 'original';
  }
  const name = (asset.originalFileName ?? '').replace(/\.[^.]*$/, '').toLowerCase();
  if (name.endsWith('-crop')) {
    return 'crop';
  }
  if (name.endsWith('-improved')) {
    return 'improved';
  }
  return name.endsWith('-enhanced') ? 'enhanced' : 'copy';
};

/** 0 for different photos, 1 for near-duplicates, by the CLIP distance; photos of one stack are not compared */
type SimilarityPhoto = Pick<AutoLayoutPhoto, 'id' | 'embedding' | 'stackId'>;

export const getPhotoSimilarity = (a: SimilarityPhoto, b: SimilarityPhoto) => {
  if (!a.embedding || !b.embedding || a.id === b.id || (a.stackId && a.stackId === b.stackId)) {
    return 0;
  }
  const distance = cosineDistance(a.embedding, b.embedding);
  return clamp((SIMILAR_DISTANCE - distance) / (SIMILAR_DISTANCE - SIMILAR_FULL_DISTANCE), 0, 1);
};

/** a page that shows one photo on its own; the cover and map pages don't count */
export const isSinglePhotoPage = (layout: string | BookLayout | undefined) => {
  const definition = typeof layout === 'string' ? getLayout(layout) : layout;
  return !!definition && definition.slots.length === 1 && !definition.map && definition.id !== 'cover';
};

/** pages whose facing page is the previous page: 2|3, 4|5, … (page 1 is alone on the right) */
export const isRightPage = (pageNumber: number) => pageNumber > 1 && pageNumber % 2 === 1;

/** print resolution of a crop of the photo in a slot, Infinity when the size of the photo is unknown */
export const getPlacementDpi = (
  photo: { width: number; height: number },
  crop: NormalizedRect,
  slotMm: Pick<LayoutRect, 'width' | 'height'>,
) =>
  photo.width > 0 && photo.height > 0
    ? getEffectiveDpi({ width: crop.width * photo.width, height: crop.height * photo.height }, slotMm)
    : Infinity;

const dateFormat = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});
const dayMonthFormat = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', timeZone: 'UTC' });

/** e.g. "12 June 2024", "12–14 June 2024" or "30 June – 2 July 2024" */
export const formatDateRange = (start: number, end: number) => {
  const a = new Date(start);
  const b = new Date(end);
  const sameYear = a.getUTCFullYear() === b.getUTCFullYear();
  const sameMonth = sameYear && a.getUTCMonth() === b.getUTCMonth();
  if (sameMonth && a.getUTCDate() === b.getUTCDate()) {
    return dateFormat.format(a);
  }
  if (sameMonth) {
    return `${a.getUTCDate()}–${dateFormat.format(b)}`;
  }
  return sameYear
    ? `${dayMonthFormat.format(a)} – ${dateFormat.format(b)}`
    : `${dateFormat.format(a)} – ${dateFormat.format(b)}`;
};

/** local wall-clock time, e.g. "2:15 pm" */
export const formatTime = (time: number) => {
  const date = new Date(time);
  const hours = date.getUTCHours();
  const minutes = String(date.getUTCMinutes()).padStart(2, '0');
  return `${hours % 12 || 12}:${minutes} ${hours < 12 ? 'am' : 'pm'}`;
};

const formatList = (items: string[]) =>
  items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;

const countValues = (values: Array<string | null | undefined>) => {
  const counts = new Map<string, number>();
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) {
      counts.set(trimmed, (counts.get(trimmed) ?? 0) + 1);
    }
  }
  return [...counts].toSorted((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
};

/** place names listed in full up to this many; more are shortened to the first two and a count */
export const MAX_LISTED_PLACES = 3;

/** e.g. "Taormina", "Taormina & Catania", "Taormina, Catania & Milo" or "Taormina, Catania & 2 more" */
export const formatPlaces = (places: string[]) => {
  if (places.length <= 1) {
    return places[0] ?? '';
  }
  if (places.length > MAX_LISTED_PLACES) {
    return `${places[0]}, ${places[1]} & ${places.length - 2} more`;
  }
  return `${places.slice(0, -1).join(', ')} & ${places.at(-1)}`;
};

/**
 * The places (EXIF cities) of the photos, every one of them: the most frequent first when they are too many to list,
 * then in the order they were first visited
 */
export const getPlaces = (photos: Array<Pick<AutoLayoutPhoto, 'city' | 'takenAt'>>) => {
  const ordered = photos.toSorted((a, b) => a.takenAt - b.takenAt);
  const cities = countValues(ordered.map((photo) => photo.city));
  const first = new Map<string, number>();
  for (const [index, photo] of ordered.entries()) {
    const city = photo.city?.trim();
    if (city && !first.has(city)) {
      first.set(city, index);
    }
  }
  const byVisit = (a: string, b: string) => first.get(a)! - first.get(b)!;
  const names = cities.toSorted((a, b) => b[1] - a[1] || byVisit(a[0], b[0])).map(([city]) => city);
  if (names.length > MAX_LISTED_PLACES) {
    return [...names.slice(0, 2).toSorted(byVisit), ...names.slice(2)];
  }
  return names.toSorted(byVisit);
};

/**
 * The places of the photos, falling back to the country and then to the dates. Titles name at most three places, and
 * a chapter is named after the places it adds to the `earlier` chapters, so chapters that pass through the same towns
 * still get different titles
 */
export const getSectionTitle = (photos: AutoLayoutPhoto[], earlier: ReadonlySet<string> = new Set()) => {
  const places = getPlaces(photos);
  if (places.length > 0) {
    const added = places.filter((place) => !earlier.has(place));
    return formatPlaces((added.length > 0 ? added : places).slice(0, MAX_LISTED_PLACES));
  }

  const countries = countValues(photos.map((photo) => photo.country)).map(([country]) => country);
  if (countries.length > 0) {
    return formatPlaces(countries);
  }

  const times = photos.map((photo) => photo.takenAt);
  return formatDateRange(Math.min(...times), Math.max(...times));
};

/** the place of a visit (e.g. to a restaurant): its most frequent city, or else its country */
const getVisitPlace = (photos: AutoLayoutPhoto[]) =>
  getPlaces(photos)[0] ?? countValues(photos.map((photo) => photo.country))[0]?.[0];

/**
 * The title of a chapter that is a restaurant visit: the restaurant, then its place and date, e.g.
 * "Trattoria da Nino · Taormina, 23 June 2009"; `withTime` adds the time of the first photo, for two visits on one day
 */
export const getVisitTitle = (place: string, photos: AutoLayoutPhoto[], withTime = false) => {
  const times = photos.map((photo) => photo.takenAt);
  if (times.length === 0) {
    return place;
  }
  const start = Math.min(...times);
  const date = `${formatDateRange(start, Math.max(...times))}${withTime ? `, ${formatTime(start)}` : ''}`;
  return `${place} · ${[getVisitPlace(photos), date].filter(Boolean).join(', ')}`;
};

/**
 * A short caption made only of facts about the photos of a page: their places (EXIF cities, see `formatPlaces`), the
 * local time of the first photo and the names of the named people, e.g. "Westcott · 2:15 pm", "Taormina & Catania"
 * or "Box Hill with Amit". It never describes what the photos look like. `place` skips a place that repeats the
 * section title or the previous caption.
 */
export const getFactualCaption = (
  photos: AutoLayoutPhoto[],
  mode: AutoLayoutCaptions,
  context: { sectionTitle?: string; previous?: string } = {},
): string | undefined => {
  if (mode === 'none' || photos.length === 0) {
    return;
  }

  const place = formatPlaces(getPlaces(photos)) || undefined;
  const time = formatTime(Math.min(...photos.map((photo) => photo.takenAt)));
  const isNew = (value: string) => value !== context.sectionTitle && value !== context.previous;

  switch (mode) {
    case 'place': {
      return place && isNew(place) ? place : undefined;
    }
    case 'place-time': {
      return [place, time].filter(Boolean).join(' · ');
    }
    case 'dish': {
      // the entries (dishes) are named below their photos, so the page names the place of the other photos
      const others = photos.filter((photo) => !isEntryPhoto(photo));
      const otherPlace = formatPlaces(getPlaces(others)) || undefined;
      return otherPlace && isNew(otherPlace) ? otherPlace : undefined;
    }
    case 'people': {
      const names = countValues(photos.flatMap((photo) => (photo.people ?? []).map((person) => person.name)))
        .slice(0, 3)
        .map(([name]) => name);
      if (names.length === 0) {
        return place && isNew(place) ? place : undefined;
      }
      return place ? `${place} with ${formatList(names)}` : `With ${formatList(names)}`;
    }
  }
};

const getEvents = (photos: Candidate[], options?: EventSplitOptions): Candidate[][] => {
  if (photos.every((photo) => typeof photo.eventIndex === 'number')) {
    return Map.groupBy(photos, (photo) => photo.eventIndex!)
      .values()
      .map((event) => event.toSorted(byTime))
      .toArray()
      .toSorted((a, b) => byTime(a[0], b[0]));
  }

  const points = photos.map((photo) => ({
    id: photo.id,
    time: photo.takenAt,
    latitude: photo.lat,
    longitude: photo.lon,
    photo,
  }));
  return splitEvents(points, options ?? getAdaptiveEventOptions(points)).map((event) =>
    event.map(({ photo }) => photo),
  );
};

/** merges the smallest events into their closest neighbour until there are few enough and none is tiny */
export const mergeEvents = <T extends { takenAt: number }>(events: T[][], maxSections: number, minSize: number) => {
  const sections = events.filter((event) => event.length > 0).map((event) => [...event]);
  const gap = (a: T[], b: T[]) => b[0].takenAt - a.at(-1)!.takenAt;

  while (sections.length > 1) {
    let index = -1;
    for (const [i, section] of sections.entries()) {
      if (index === -1 || section.length < sections[index].length) {
        index = i;
      }
    }

    if (sections.length <= maxSections && sections[index].length >= minSize) {
      break;
    }

    const before = index > 0 ? gap(sections[index - 1], sections[index]) : Infinity;
    const after = index < sections.length - 1 ? gap(sections[index], sections[index + 1]) : Infinity;
    const target = before <= after ? index - 1 : index + 1;
    const [first, second] = target < index ? [target, index] : [index, target];
    sections.splice(first, 2, [...sections[first], ...sections[second]]);
  }

  return sections;
};

const permutations = <T>(items: T[]): T[][] => {
  if (items.length <= 1) {
    return [items];
  }
  return items.flatMap((item, i) =>
    permutations([...items.slice(0, i), ...items.slice(i + 1)]).map((rest) => [item, ...rest]),
  );
};

type SlotShape = { aspect: number; area: number; rectMm: LayoutRect };

/**
 * One photo per stack: the original, unless a copy (crop, enhanced) scores clearly better; an improved copy unless it
 * scores clearly worse. Artwork is a separate,
 * limited resource: the best artworks up to `budget`, shown next to their original as an intentional pair (at most
 * `maxPairs`), or instead of it when they rank higher. Heroes are always kept on their own.
 */
const resolveStacks = (
  photos: Candidate[],
  budget: number,
  maxPairs: number,
  drop: (photo: Candidate, reason: AutoLayoutDropReason) => void,
): Candidate[] => {
  const result: Candidate[] = [];
  const artworks: Array<{ artwork: Candidate; original?: Candidate }> = [];
  const stacks = Map.groupBy(
    photos.filter((photo) => photo.stackId),
    (photo) => photo.stackId!,
  );

  for (const photo of photos) {
    if (photo.stackId) {
      continue;
    }
    if (photo.artwork && !photo.hero) {
      artworks.push({ artwork: photo });
    } else {
      result.push(photo);
    }
  }

  for (const members of stacks.values()) {
    const heroes = members.filter((photo) => photo.hero);
    result.push(...heroes);
    if (heroes.length > 0) {
      for (const photo of members) {
        if (!photo.hero) {
          drop(photo, 'stack');
        }
      }
      continue;
    }

    const copies = members.filter((photo) => !photo.artwork).toSorted(byImportance);
    const original = copies.find((photo) => (photo.kind ?? 'original') === 'original');
    const improved = copies.find((photo) => photo.kind === 'improved');
    let chosen = copies[0];
    if (chosen && original && chosen !== original) {
      const margin = chosen.kind === 'crop' ? CROP_MARGIN : chosen.kind === 'improved' ? -IMPROVED_MARGIN : COPY_MARGIN;
      chosen = chosen.importance > original.importance + margin ? chosen : original;
    }
    if (chosen === original && improved && improved.importance >= original.importance - IMPROVED_MARGIN) {
      chosen = improved;
    }
    for (const photo of copies) {
      if (photo !== chosen) {
        drop(photo, 'stack');
      }
    }

    const [artwork, ...others] = members.filter((photo) => photo.artwork).toSorted(byImportance);
    for (const photo of others) {
      drop(photo, 'stack');
    }

    if (artwork) {
      artworks.push({ artwork, original: chosen });
    } else if (chosen) {
      result.push(chosen);
    }
  }

  let used = 0;
  let pairs = 0;
  for (const { artwork, original } of artworks.toSorted((a, b) => byImportance(a.artwork, b.artwork))) {
    if (used >= budget) {
      drop(artwork, 'artwork');
      if (original) {
        result.push(original);
      }
      continue;
    }

    if (!original) {
      result.push(artwork);
      used++;
    } else if (pairs < maxPairs) {
      result.push({
        ...original,
        id: `pair:${original.id}`,
        importance: Math.max(original.importance, artwork.importance),
        artwork: true,
        pair: [original, artwork],
      });
      used++;
      pairs++;
    } else if (artwork.importance > original.importance) {
      result.push(artwork);
      drop(original, 'stack');
      used++;
    } else {
      result.push(original);
      drop(artwork, 'stack');
    }
  }

  return result.toSorted(byTime);
};

/**
 * Photos of the main people that the page budget must keep: the best `perSection` of every person in each section
 * they appear in, then the best others until every person has `perBook` photos (spread over the sections).
 */
export const getPersonMinimums = <
  T extends { id: string; importance: number; takenAt: number; people?: AutoLayoutPerson[] },
>(
  sections: T[][],
  personIds: string[],
  perSection: number,
  perBook: number,
) => {
  const keep = new Set<string>();
  const order = (a: T, b: T) => b.importance - a.importance || a.takenAt - b.takenAt || a.id.localeCompare(b.id);
  const has = (photo: T, personId: string) => photo.people?.some(({ id }) => id === personId) ?? false;

  for (const personId of personIds) {
    const perSectionCount = sections.map(() => 0);
    for (const [index, section] of sections.entries()) {
      for (const photo of section
        .filter((item) => has(item, personId))
        .toSorted(order)
        .slice(0, perSection)) {
        keep.add(photo.id);
        perSectionCount[index]++;
      }
    }

    let total = sections.flat().filter((photo) => keep.has(photo.id) && has(photo, personId)).length;
    while (total < perBook) {
      let best: { photo: T; section: number } | undefined;
      for (const [index, section] of sections.entries()) {
        const photo = section.filter((item) => has(item, personId) && !keep.has(item.id)).toSorted(order)[0];
        if (
          photo &&
          (!best ||
            perSectionCount[index] < perSectionCount[best.section] ||
            (perSectionCount[index] === perSectionCount[best.section] && order(photo, best.photo) < 0))
        ) {
          best = { photo, section: index };
        }
      }
      if (!best) {
        break;
      }
      keep.add(best.photo.id);
      perSectionCount[best.section]++;
      total++;
    }
  }

  return keep;
};

class LayoutPlanner {
  private crops = new Map<string, ReturnType<typeof getSmartCrop>>();
  private shapes = new Map<string, SlotShape[]>();
  readonly contentLayouts: Map<number, BookLayout[]>;
  readonly layoutList: BookLayout[] = [];
  readonly layoutIndex = new Map<string, number>();

  constructor(
    private size: PageSize,
    private style: BookStyle,
    layouts: readonly BookLayout[],
    /** collection books (e.g. food books) also use the layouts made for entries (dishes) */
    collection = false,
  ) {
    this.contentLayouts = new Map();
    for (const layout of layouts) {
      if (
        OPENER_LAYOUTS.has(layout.id) ||
        layout.slots.length === 0 ||
        layout.map ||
        (layout.collection && !collection)
      ) {
        continue;
      }
      const list = this.contentLayouts.get(layout.slots.length) ?? [];
      list.push(layout);
      this.contentLayouts.set(layout.slots.length, list);
      this.layoutIndex.set(layout.id, this.layoutList.length);
      this.layoutList.push(layout);
    }
  }

  getShapes(layout: BookLayout) {
    let shapes = this.shapes.get(layout.id);
    if (!shapes) {
      shapes = getSlotRectsMm(layout, this.size, this.style).map((rectMm, i) => ({
        aspect: rectMm.height > 0 ? rectMm.width / rectMm.height : 1,
        area: layout.slots[i].width * layout.slots[i].height,
        rectMm,
      }));
      this.shapes.set(layout.id, shapes);
    }
    return shapes;
  }

  getCrop(photo: AutoLayoutPhoto, aspect: number) {
    const key = `${photo.id}:${aspect.toFixed(4)}`;
    let crop = this.crops.get(key);
    if (!crop) {
      crop = getSmartCrop(photo, photo.faces, aspect);
      this.crops.set(key, crop);
    }
    return crop;
  }

  /** whether the crop of the photo for the slot prints at `MIN_PRINT_DPI` or more */
  isSharpEnough(photo: AutoLayoutPhoto, shape: SlotShape) {
    return getPlacementDpi(photo, this.getCrop(photo, shape.aspect).crop, shape.rectMm) >= MIN_PRINT_DPI;
  }

  /** whether the photo prints sharp enough in any slot of the content layouts */
  isPrintable(photo: AutoLayoutPhoto) {
    return this.layoutList.some((layout) => this.getShapes(layout).some((shape) => this.isSharpEnough(photo, shape)));
  }

  /**
   * cost of the photo in a slot, Infinity when the slot is too large for its resolution, or (when strict) the crop cuts
   * a face or loses too much of the photo
   */
  slotCost(photo: Candidate, shape: SlotShape, ideal: number, strict: boolean) {
    const crop = this.getCrop(photo, shape.aspect);
    const loss = 1 - crop.kept;
    if (strict && (!crop.feasible || loss > MAX_CROP_LOSS)) {
      return Infinity;
    }
    if (getPlacementDpi(photo, crop.crop, shape.rectMm) < MIN_PRINT_DPI) {
      return Infinity;
    }
    return 3 * loss + 0.5 * crop.droppedFaces + (crop.feasible ? 0 : 2) + 0.5 * Math.log(shape.area / ideal) ** 2;
  }

  /** the best order of the photos in the slots of a layout */
  fit(layout: BookLayout, photos: Candidate[], ideals: Map<string, number>, strict: boolean): LayoutChoice | null {
    const shapes = this.getShapes(layout);
    const uniform = shapes.every(
      (shape) => Math.abs(shape.aspect - shapes[0].aspect) < 1e-3 && Math.abs(shape.area - shapes[0].area) < 1e-3,
    );
    const orders = uniform || photos.length > 4 ? [photos] : permutations(photos);

    let best: { cost: number; order: Candidate[] } | null = null;
    for (const order of orders) {
      let cost = 0;
      for (const [i, photo] of order.entries()) {
        cost += this.slotCost(photo, shapes[i], ideals.get(photo.id)!, strict);
        if (cost === Infinity) {
          break;
        }
      }
      if (cost < Infinity && (!best || cost < best.cost - 1e-9)) {
        best = { cost, order };
      }
    }

    if (!best) {
      return null;
    }

    return {
      layout,
      cost: best.cost,
      order: best.order,
      crops: best.order.map((photo, i) => this.getCrop(photo, shapes[i].aspect).crop),
    };
  }

  group(units: Candidate[], ideals: Map<string, number>, strict: boolean): Group | null {
    const pair = units.length === 1 ? units[0].pair : undefined;
    if (!pair && units.some((unit) => unit.pair)) {
      return null;
    }

    const photos = pair ?? units;
    // dishes get room for their names: at most four on a page, preferably on the layouts made for them, which are
    // only for dishes
    const dishes = pair ? 0 : photos.filter((photo) => isEntryPhoto(photo)).length;
    if (dishes > 0 && photos.length > MAX_DISHES_PER_PAGE) {
      return null;
    }
    const layouts = (this.contentLayouts.get(photos.length) ?? []).filter((layout) => !layout.collection || dishes > 0);
    const dishPenalty = (layout: BookLayout) =>
      dishes > 0
        ? (layout.collection ? UNNAMED_DISH_PENALTY * (photos.length - dishes) : DISH_PLAIN_PENALTY * dishes) +
          (photos.length >= 4 ? DISH_DENSE_PENALTY : 0)
        : 0;
    const sharedHero = !pair && photos.length > 1 && photos.some((photo) => photo.hero);
    if (sharedHero && strict) {
      return null;
    }
    let clusterPenalty = sharedHero ? HERO_SHARED_PENALTY : 0;
    for (const [i, a] of photos.entries()) {
      for (const b of photos.slice(i + 1)) {
        if (!pair && a.clusterId !== null && a.clusterId !== undefined && a.clusterId === b.clusterId) {
          clusterPenalty += SAME_CLUSTER_PENALTY;
        }
      }
    }

    const choices = layouts
      .map((layout) => this.fit(layout, photos, ideals, strict))
      .filter((choice): choice is LayoutChoice => !!choice)
      .map((choice) => ({
        ...choice,
        cost: choice.cost + clusterPenalty + SIZE_PENALTY[photos.length] + dishPenalty(choice.layout),
      }))
      .toSorted((a, b) => a.cost - b.cost);

    return choices.length > 0 ? { photos, choices, artwork: photos.some((photo) => photo.artwork) } : null;
  }

  /**
   * Splits the time-ordered photos of a section into `pages` pages and picks their layouts, choosing page sizes by
   * importance and fit. It avoids the layout (and preferably the size) of the previous page, more than
   * `MAX_SINGLES_IN_A_ROW` single-photo pages in a row, artwork on consecutive pages and similar photos on
   * neighbouring pages (on facing pages most of all); when `strict`, the first two are ruled out.
   */
  partition(units: Candidate[], pages: number, strict: boolean, context: PartitionContext): PlannedPage[] | null {
    const n = units.length;
    const ideals = getIdealAreas(units, pages);

    const groups = new Map<string, Group | null>();
    const getGroup = (start: number, size: number) => {
      const key = `${start}:${size}`;
      if (!groups.has(key)) {
        groups.set(key, this.group(units.slice(start, start + size), ideals, strict));
      }
      return groups.get(key)!;
    };

    // states: the layout of the last page (none = the page before the section) and the single-photo pages before it
    const runs = MAX_SINGLES_IN_A_ROW + 2;
    const none = this.layoutList.length;
    const states = (none + 1) * runs;

    // the units on the page that ends at `end`, with layout `layout`
    const previousUnits = (end: number, layout: number): Candidate[] => {
      if (end === 0 || layout === none) {
        return context.previousPhotos ?? [];
      }
      const size = units[end - 1]?.pair ? 1 : this.layoutList[layout].slots.length;
      return units.slice(end - size, end);
    };

    const similarities = new Map<string, number>();
    const getSimilarity = (end: number, layout: number, size: number) => {
      const key = `${end}:${layout}:${size}`;
      let value = similarities.get(key);
      if (value === undefined) {
        value = 0;
        const before = previousUnits(end, layout).flatMap((unit) => membersOf(unit));
        const after = units.slice(end, end + size).flatMap((unit) => membersOf(unit));
        for (const a of before) {
          for (const b of after) {
            value = Math.max(value, getPhotoSimilarity(a, b));
          }
        }
        similarities.set(key, value);
      }
      return value;
    };

    const cost: Float64Array[][] = [];
    const from: Int32Array[][] = [];
    for (let j = 0; j <= pages; j++) {
      cost.push(Array.from({ length: n + 1 }, () => new Float64Array(states).fill(Infinity)));
      from.push(Array.from({ length: n + 1 }, () => new Int32Array(states).fill(-1)));
    }
    const initialLayout = context.previous === undefined ? none : (this.layoutIndex.get(context.previous) ?? none);
    cost[0][0][initialLayout * runs + Math.min(context.singles, runs - 1)] = 0;

    for (let j = 0; j < pages; j++) {
      const sameSpread = isRightPage(context.pageNumber + j);
      for (let i = 0; i < n; i++) {
        for (let last = 0; last < states; last++) {
          const current = cost[j][i][last];
          if (current === Infinity) {
            continue;
          }
          const lastLayout = Math.floor(last / runs);
          const run = last % runs;
          const lastSize = lastLayout === none ? 0 : this.layoutList[lastLayout].slots.length;
          const lastArtwork = previousUnits(i, lastLayout).some((unit) => unit.artwork);
          for (const size of PAGE_SIZES) {
            if (i + size > n) {
              break;
            }
            const group = getGroup(i, size);
            if (!group) {
              continue;
            }
            const artworkRepeat = lastArtwork && group.artwork;
            if (strict && artworkRepeat) {
              continue;
            }
            const slots = group.photos.length;
            const sizeRepeat = lastSize === slots ? SIZE_REPEAT_PENALTY * (slots === 6 ? 4 : 1) : 0;
            const similar = getSimilarity(i, lastLayout, size) * SIMILAR_SPREAD_PENALTY * (sameSpread ? 1 : 0.5);
            const base = current + sizeRepeat + similar + (artworkRepeat ? ARTWORK_REPEAT_PENALTY : 0);
            for (const choice of group.choices) {
              const layout = this.layoutIndex.get(choice.layout.id)!;
              const nextRun = isSinglePhotoPage(choice.layout) ? Math.min(run + 1, runs - 1) : 0;
              const tooManySingles = nextRun > MAX_SINGLES_IN_A_ROW;
              if (strict && tooManySingles) {
                continue;
              }
              const state = layout * runs + nextRun;
              const next =
                base +
                choice.cost +
                (layout === lastLayout ? LAYOUT_REPEAT_PENALTY : 0) +
                (tooManySingles ? SINGLES_PENALTY : 0);
              if (next >= cost[j + 1][i + size][state] - 1e-9) {
                continue;
              }
              cost[j + 1][i + size][state] = next;
              from[j + 1][i + size][state] = last;
            }
          }
        }
      }
    }

    let best = -1;
    for (let state = 0; state < none * runs; state++) {
      if (cost[pages][n][state] < Infinity && (best === -1 || cost[pages][n][state] < cost[pages][n][best] - 1e-9)) {
        best = state;
      }
    }
    if (best === -1) {
      return null;
    }

    const result: PlannedPage[] = [];
    let i = n;
    let state = best;
    for (let j = pages; j > 0; j--) {
      const layout = this.layoutList[Math.floor(state / runs)];
      const size = units[i - 1].pair ? 1 : layout.slots.length;
      const group = getGroup(i - size, size)!;
      result.unshift(group.choices.find((choice) => choice.layout.id === layout.id)!);
      state = from[j][i][state];
      i -= size;
    }
    return result;
  }
}

/**
 * The share of a page each photo deserves: proportional to exp(4 × importance), with a bonus for the best two photos
 * of the section, so that the sum over all photos matches the number of pages. Heroes get a whole page, and the two
 * photos of a pair half a page each.
 */
export const getIdealAreas = (photos: Candidate[], pages: number) => {
  const heroes = photos.filter((photo) => photo.hero);
  const pairs = photos.filter((photo) => photo.pair);
  const others = photos.filter((photo) => !photo.hero && !photo.pair);
  const featured = new Map(
    photos.length >= 4
      ? others
          .toSorted(byImportance)
          .slice(0, 2)
          .map((photo, rank) => [photo.id, rank === 0 ? 0.35 : 0.15])
      : [],
  );
  const weights = others.map((photo) => Math.exp(4 * (photo.importance + (featured.get(photo.id) ?? 0))));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  const available = Math.max(pages - heroes.length - pairs.length, others.length / 6);

  return new Map([
    ...heroes.map((photo) => [photo.id, 1] as const),
    ...pairs.flatMap((pair) => pair.pair!.map((photo) => [photo.id, 0.5] as const)),
    ...others.map((photo, i) => [photo.id, clamp((available * weights[i]) / total, 0.12, 1)] as const),
  ]);
};

/** the fewest pages for the photos: six per page (four with dishes), and a page of its own for every pair */
const getMinimumPages = (units: Candidate[]) => {
  const perPage = units.some((unit) => isEntryPhoto(unit)) ? MAX_DISHES_PER_PAGE : 6;
  let pages = 0;
  let run = 0;
  for (const unit of units) {
    if (unit.pair) {
      pages += Math.ceil(run / perPage) + 1;
      run = 0;
    } else {
      run++;
    }
  }
  return pages + Math.ceil(run / perPage);
};

/** splits `total` pages over sections proportional to their photos: at least one page each, at most six photos per page */
export const allocatePages = (sizes: number[], total: number) => {
  const pages = sizes.map((size) => Math.max(1, Math.ceil(size / 6)));
  let remaining = total - pages.reduce((sum, count) => sum + count, 0);
  while (remaining > 0) {
    let best = -1;
    for (const [i, size] of sizes.entries()) {
      if (pages[i] < size && (best === -1 || size / pages[i] > sizes[best] / pages[best] + 1e-9)) {
        best = i;
      }
    }
    if (best === -1) {
      break;
    }
    pages[best]++;
    remaining--;
  }
  return pages;
};

/**
 * Lays out photos as a photo book: a cover, then one section per event (merged when events are small or too many;
 * a single day is split into chapters by its own gaps and distances), each opened by a map (with GPS) or a section
 * opener, followed by content pages. Stacks show one photo (or an artwork next to its original), artwork is limited,
 * and no photo is placed in a slot it can't fill at print resolution. Important photos (heroes, favourites, high
 * scores, faces) get whole pages or hero slots, the others fill denser layouts, and the main people are kept in every
 * section. Page sizes, layouts and the order of photos in them minimize crop loss, never cut faces, and avoid
 * repeated layouts, long runs of single photos, artwork back to back and similar photos on neighbouring pages.
 * The result only depends on the input.
 */
export const planAutoLayout = (input: AutoLayoutPhoto[], options: AutoLayoutOptions): AutoLayoutPlan => {
  const layouts = options.layouts ?? bookLayouts;
  const seen = new Set<string>();
  const unique = input.filter((photo) => !seen.has(photo.id) && !!seen.add(photo.id));
  const collectionBook =
    options.collection ?? (isCollectionTheme(options.style.theme) || unique.some((photo) => photo.collection));
  const planner = new LayoutPlanner(options.size, options.style, layouts, collectionBook);
  const heroes = new Set(options.heroIds);
  const includeMaps = options.includeMaps ?? true;
  const mapStyle = options.mapStyle ?? 'sketch';
  const withCover = options.cover ?? true;
  const captions = options.captions ?? (collectionBook ? 'dish' : 'place');
  const layoutIds = new Set(layouts.map((layout) => layout.id));
  const hasLayout = (id: string) => layoutIds.has(id);
  /** the name of the entry (dish) below its photo */
  const dishCaption = (photo: AutoLayoutPhoto) => {
    const dish = captions === 'dish' ? getEntryCaption(photo) : undefined;
    return dish ? { caption: dish } : {};
  };
  const mainPersonIds =
    options.mainPersonIds ?? getMainPeople(unique.map((photo) => ({ personIds: photo.people?.map(({ id }) => id) })));
  const mainPeople = new Set(mainPersonIds);
  const photos: Candidate[] = unique
    .map((photo) => ({
      ...photo,
      hero: heroes.has(photo.id),
      importance: getImportance(photo, heroes.has(photo.id), mainPeople),
      located: isLocated(photo),
      artwork: photo.kind === 'artwork',
    }))
    .toSorted(byTime);

  const empty: AutoLayoutPlan = {
    pages: [],
    sections: [],
    usedIds: [],
    droppedIds: [],
    dropReasons: {},
    people: [],
  };
  if (photos.length === 0) {
    return empty;
  }

  const dropReasons = new Map<string, AutoLayoutDropReason>();
  const drop = (photo: Candidate, reason: AutoLayoutDropReason) => {
    for (const member of membersOf(photo)) {
      if (!dropReasons.has(member.id)) {
        dropReasons.set(member.id, reason);
      }
    }
  };

  // photos too small for every slot, then one photo (or an intentional pair) per stack
  const printable: Candidate[] = [];
  for (const photo of photos) {
    if (planner.isPrintable(photo)) {
      printable.push(photo);
    } else {
      drop(photo, 'resolution');
    }
  }
  const stacks = Map.groupBy(printable, (photo) => photo.stackId ?? photo.id)
    .values()
    .toArray();
  // a collection book has a page per source (menu), and more room for the entries (dishes)
  const collectionCounts = collectionBook
    ? {
        entries: stacks.filter((stack) => stack.some((photo) => isEntryPhoto(photo))).length,
        sources: new Set(
          printable
            .filter((photo) => isSourcePhoto(photo))
            .map((photo) => `${photo.collection!.pack}\n${photo.collection!.place}`),
        ).size,
      }
    : undefined;
  const target = Math.max(
    1,
    Math.round(options.targetPageCount ?? getTargetPageCount(stacks.length, collectionCounts)),
  );
  const artworkBudget = Math.round(target * clamp(options.maxArtworkShare ?? DEFAULT_MAX_ARTWORK_SHARE, 0, 1));
  const units = resolveStacks(
    printable,
    artworkBudget,
    Math.max(0, options.maxStackPairs ?? DEFAULT_MAX_STACK_PAIRS),
    drop,
  );

  const pages: AutoLayoutPage[] = [];
  const used = new Set<string>();
  const pagePhotos = new Map<AutoLayoutPage, Candidate[]>();
  const place = (photo: Candidate, layout: BookLayout, slot = 0): AutoLayoutSlot => {
    used.add(photo.id);
    const aspect = planner.getShapes(layout)[slot].aspect;
    return {
      assetId: photo.id,
      crop: planner.getCrop(photo, aspect).crop,
      ...(layout.id !== 'cover' && dishCaption(photo)),
    };
  };

  const fitsSlot = (photo: Candidate, layout: BookLayout, slot = 0) => {
    const shape = planner.getShapes(layout)[slot];
    const crop = planner.getCrop(photo, shape.aspect);
    return crop.feasible && 1 - crop.kept <= MAX_CROP_LOSS;
  };

  /** the best of the top photos that fits the slot well, or the best photo; never artwork or a too small photo */
  const pickFor = (candidates: Candidate[], layout: BookLayout, top = 3) => {
    const shape = planner.getShapes(layout)[0];
    const ranked = candidates
      .filter((photo) => !photo.artwork && !photo.pair && !isSourcePhoto(photo) && planner.isSharpEnough(photo, shape))
      .toSorted(byImportance);
    return ranked.slice(0, top).find((photo) => fitsSlot(photo, layout)) ?? ranked[0];
  };

  let pool = units;
  const coverLayout = layouts.find((layout) => layout.id === 'cover');
  const cover = withCover && coverLayout && units.length > 1 ? pickFor(units, coverLayout, 5) : undefined;
  if (cover && coverLayout) {
    pages.push({ layout: 'cover', slots: [place(cover, coverLayout)] });
    pool = units.filter((photo) => photo.id !== cover.id);
  }

  // one photo per near-duplicate cluster, unless that leaves too few photos for the pages
  const contentEstimate = Math.max(1, target - pages.length);
  const clusterRanks = new Map<string, number>();
  const byCluster = new Map<number, Candidate[]>();
  for (const photo of pool) {
    if (photo.clusterId !== null && photo.clusterId !== undefined) {
      byCluster.set(photo.clusterId, [...(byCluster.get(photo.clusterId) ?? []), photo]);
    }
  }
  for (const [clusterId, members] of byCluster) {
    // a cluster already represented on the cover counts as used
    const offset = cover?.clusterId === clusterId ? 1 : 0;
    for (const [rank, photo] of members.toSorted(byImportance).entries()) {
      clusterRanks.set(photo.id, rank + offset);
    }
  }

  let kept = pool.filter((photo) => photo.hero || (clusterRanks.get(photo.id) ?? 0) === 0);
  const wanted = Math.ceil(contentEstimate * 1.5);
  if (kept.length < wanted) {
    const extras = pool
      .filter((photo) => !kept.includes(photo) && (clusterRanks.get(photo.id) ?? 0) === 1)
      .toSorted(byImportance)
      .slice(0, wanted - kept.length);
    kept = [...kept, ...extras].toSorted(byTime);
  }
  for (const photo of pool) {
    if (!kept.includes(photo)) {
      drop(photo, 'duplicate');
    }
  }

  // sections; a short book gets more, smaller chapters
  const shortBook = isShortSpan(photos.map((photo) => ({ time: photo.takenAt })));
  const maxSections = Math.max(1, Math.round(contentEstimate / (shortBook ? 3.5 : 4.5)));
  // a collection book has a chapter for every visit of a place (a restaurant), and the photos between them are split
  // by event as usual
  let sections: Array<{ photos: Candidate[]; visit?: { pack: string; place: string } }>;
  const { visits, others } = collectionBook ? getPlaceVisits(kept) : { visits: [], others: kept };
  if (visits.length > 0) {
    const otherSections = Math.max(1, maxSections - visits.length);
    sections = [
      ...visits.map((visit) => ({ photos: visit.photos, visit: { pack: visit.pack, place: visit.place } })),
      ...getRunsBetweenVisits(others, visits).flatMap((run) =>
        mergeEvents(
          getEvents(run, options.events),
          Math.max(1, Math.round((otherSections * run.length) / others.length)),
          MIN_SECTION_SIZE,
        ).map((section) => ({ photos: section })),
      ),
    ].toSorted((a, b) => byTime(a.photos[0], b.photos[0]));
  } else {
    sections = mergeEvents(getEvents(kept, options.events), maxSections, MIN_SECTION_SIZE).map((section) => ({
      photos: section,
    }));
  }
  const singleDay =
    sections.length > 1 &&
    formatDateRange(photos[0].takenAt, photos.at(-1)!.takenAt) === dateFormat.format(photos[0].takenAt);

  type SectionPlan = {
    photos: Candidate[];
    all: Candidate[];
    title: string;
    dates: string;
    opener: 'map' | 'map-photo' | 'section-opener' | 'dish-opener' | null;
    openerPhoto?: Candidate;
    /** the place of a visit of a collection (a restaurant) and its pack */
    visit?: { pack: string; place: string };
    /** the source (menu) of the visit, on a page of its own after the opener (or as the opener) */
    menu?: { photo: Candidate; layout: BookLayout };
  };

  /**
   * the source page layout that keeps most of the photo and prints it sharp enough; the recipe layout for a source
   * whose text is typeset beside it
   */
  const getMenuLayout = (photo: Candidate) =>
    [...(photo.sourceText ? [[SOURCE_TEXT_LAYOUT]] : []), SOURCE_LAYOUTS]
      .map((ids) =>
        ids
          .map((id) => layouts.find((layout) => layout.id === id))
          .filter(
            (layout): layout is BookLayout => !!layout && planner.isSharpEnough(photo, planner.getShapes(layout)[0]),
          )
          .toSorted(
            (a, b) =>
              planner.getCrop(photo, planner.getShapes(b)[0].aspect).kept -
              planner.getCrop(photo, planner.getShapes(a)[0].aspect).kept,
          )
          .at(0),
      )
      .find((layout) => layout !== undefined);

  const sectionPlans: SectionPlan[] = sections.map(({ photos: units, visit }) => {
    let section = units;
    const ids = new Set(section.flatMap((unit) => membersOf(unit).map((photo) => photo.id)));
    const all = photos.filter((photo) => ids.has(photo.id));

    // one source (menu) page per visit; the other photos of the source are left out
    let menu: SectionPlan['menu'];
    if (visit) {
      const byLegibility = (a: Candidate, b: Candidate) =>
        (b.textLines ?? 0) - (a.textLines ?? 0) || byImportance(a, b);
      for (const photo of section.filter((unit) => !unit.pair && isSourcePhoto(unit)).toSorted(byLegibility)) {
        const layout = menu ? undefined : getMenuLayout(photo);
        if (layout) {
          menu = { photo, layout };
        } else if (menu) {
          drop(photo, 'duplicate');
        } else {
          continue;
        }
        section = section.filter((unit) => unit.id !== photo.id);
      }
    }

    const located = units.some((photo) => photo.located);
    let opener: SectionPlan['opener'] = null;
    if (includeMaps && located && hasLayout('map')) {
      opener = !menu && section.length >= 5 && hasLayout('map-photo') ? 'map-photo' : 'map';
    } else if (visit) {
      // the source (menu) page opens the chapter; without one, an entry (a dish) does
      opener = menu ? null : hasLayout('dish-opener') ? 'dish-opener' : 'section-opener';
    } else if (sections.length > 1 && section.length >= 4 && hasLayout('section-opener')) {
      opener = 'section-opener';
    }
    const dates = formatDateRange(units[0].takenAt, units.at(-1)!.takenAt);
    return {
      photos: section,
      all,
      title: visit ? getVisitTitle(visit.place, all) : getSectionTitle(section),
      dates: singleDay ? `${dates} · ${formatTime(units[0].takenAt)}` : dates,
      opener,
      visit,
      menu,
    };
  });

  const locatedSections = sectionPlans.filter((section) => section.photos.some((photo) => photo.located)).length;
  let overview = includeMaps && locatedSections >= 3 && target >= 12 && hasLayout('map');

  // keep enough content pages: drop the overview, then the openers of the smallest sections
  const closingPages = options.closing ? 1 : 0;
  const menuPages = sectionPlans.filter((section) => section.menu).length;
  const openerCount = () => sectionPlans.filter((section) => section.opener).length + (overview ? 1 : 0);
  const contentPages = () => target - pages.length - closingPages - menuPages - openerCount();
  const minContent = () => Math.max(sectionPlans.length, Math.ceil((target - pages.length - closingPages) * 0.6));
  while (contentPages() < minContent() && openerCount() > 0) {
    if (overview) {
      overview = false;
      continue;
    }
    const smallest = sectionPlans
      .filter((section) => section.opener)
      .toSorted((a, b) => a.photos.length - b.photos.length || a.photos[0].takenAt - b.photos[0].takenAt)[0];
    smallest.opener = null;
  }

  for (const section of sectionPlans) {
    const layout = section.opener === 'map' ? undefined : layouts.find((item) => item.id === section.opener);
    // a visit (to a restaurant) is opened by an entry (a dish), even its only one
    const candidates =
      section.opener === 'dish-opener' ? section.photos.filter((photo) => isEntryPhoto(photo)) : section.photos;
    const openerPhoto =
      layout && section.photos.length > (section.visit ? 0 : 1) ? pickFor(candidates, layout) : undefined;
    const sectionOpener = layouts.find((item) => item.id === 'section-opener');
    if (openerPhoto) {
      section.openerPhoto = openerPhoto;
      section.photos = section.photos.filter((photo) => photo.id !== openerPhoto.id);
    } else if (section.opener === 'dish-opener' && sectionOpener && section.photos.length > 0) {
      // no dish fits: any photo of the visit opens it
      const photo = pickFor(section.photos, sectionOpener);
      section.opener = photo ? 'section-opener' : null;
      if (photo) {
        section.openerPhoto = photo;
        section.photos = section.photos.filter((unit) => unit.id !== photo.id);
      }
    } else if (section.opener !== 'map') {
      section.opener = includeMaps && section.opener === 'map-photo' ? 'map' : null;
    }
  }

  // page budget: drop the least important photos when the pages would get too dense, keeping the main people
  let content = Math.max(sectionPlans.length, contentPages());
  const totalPhotos = sectionPlans.reduce((sum, section) => sum + section.photos.length, 0);
  const maxPhotos = Math.floor(content * MAX_DENSITY);
  if (totalPhotos > maxPhotos) {
    const keepPeople = getPersonMinimums(
      sectionPlans.map((section) => section.photos),
      mainPersonIds,
      options.minPerPersonPerSection ?? MAIN_PEOPLE_DEFAULTS.perEvent,
      options.minPerPersonPerBook ?? MAIN_PEOPLE_DEFAULTS.perBook,
    );
    const droppable = sectionPlans
      .flatMap((section) => section.photos.filter((photo) => !photo.hero && !keepPeople.has(photo.id)))
      .toSorted((a, b) => a.importance - b.importance || byTime(b, a));
    const remaining = new Map(sectionPlans.map((section, i) => [i, section.photos.length]));
    const sectionOf = new Map(sectionPlans.flatMap((section, i) => section.photos.map((photo) => [photo.id, i])));
    const dropped = new Set<string>();
    for (const photo of droppable) {
      if (totalPhotos - dropped.size <= maxPhotos) {
        break;
      }
      const index = sectionOf.get(photo.id)!;
      if (remaining.get(index)! <= 1) {
        continue;
      }
      dropped.add(photo.id);
      drop(photo, 'budget');
      remaining.set(index, remaining.get(index)! - 1);
    }
    for (const section of sectionPlans) {
      section.photos = section.photos.filter((photo) => !dropped.has(photo.id));
    }
  }

  const sizes = sectionPlans.map((section) => section.photos.length);
  content = Math.min(
    content,
    sizes.reduce((sum, size) => sum + size, 0),
  );
  const allocation = allocatePages(sizes, content);

  const newMap = (extra: Partial<BookMap> = {}): BookMap => ({
    style: mapStyle,
    showRoute: true,
    labels: true,
    ...extra,
  });
  const context = (): PartitionContext => {
    let singles = 0;
    while (singles < pages.length && isSinglePhotoPage(pages.at(-1 - singles)!.layout)) {
      singles++;
    }
    const last = pages.at(-1);
    return {
      previous: last?.layout,
      previousPhotos: last ? (pagePhotos.get(last) ?? []) : [],
      singles,
      pageNumber: pages.length + 1,
    };
  };
  const openerCaption = (value: string) => (captions === 'none' ? {} : { caption: value });

  if (overview) {
    const located = kept.flatMap((unit) => membersOf(unit)).filter((photo) => photo.located);
    pages.push({
      layout: 'map',
      slots: [],
      ...openerCaption(formatDateRange(photos[0].takenAt, photos.at(-1)!.takenAt)),
      map: newMap({ assetIds: located.map((photo) => photo.id) }),
    });
  }

  for (const [index, section] of sectionPlans.entries()) {
    if (section.photos.length === 0 && !section.openerPhoto && !section.menu) {
      continue;
    }

    switch (section.opener) {
      case 'map': {
        pages.push({
          layout: 'map',
          slots: [],
          sectionTitle: section.title,
          ...openerCaption(section.dates),
          map: newMap({ title: section.visit?.place ?? section.title }),
          section: index,
        });
        break;
      }
      case 'map-photo':
      case 'dish-opener':
      case 'section-opener': {
        const layout = layouts.find((item) => item.id === section.opener)!;
        const page: AutoLayoutPage = {
          layout: layout.id,
          slots: [place(section.openerPhoto!, layout)],
          sectionTitle: section.title,
          ...(section.title !== section.dates && openerCaption(section.dates)),
          ...(section.opener === 'map-photo' && { map: newMap() }),
          section: index,
        };
        pages.push(page);
        pagePhotos.set(page, [section.openerPhoto!]);
        break;
      }
      case null: {
        break;
      }
    }

    if (section.menu) {
      const page: AutoLayoutPage = {
        layout: section.menu.layout.id,
        slots: [place(section.menu.photo, section.menu.layout)],
        sectionTitle: section.title,
        section: index,
      };
      pages.push(page);
      pagePhotos.set(page, [section.menu.photo]);
    }

    if (section.photos.length === 0) {
      continue;
    }

    const fewest = getMinimumPages(section.photos);
    const count = clamp(allocation[index], fewest, section.photos.length);
    const ctx = context();
    let planned = planner.partition(section.photos, count, true, ctx);
    // looser: crops may lose more, runs of singles and artwork back to back are only penalized, then fewer pages
    const counts = new Set([count, count - 1, count - 2, fewest].filter((pageCount) => pageCount >= fewest));
    for (const pageCount of counts) {
      planned ??= planner.partition(section.photos, pageCount, false, ctx);
    }
    for (const choice of planned ?? []) {
      const page: AutoLayoutPage = {
        layout: choice.layout.id,
        slots: choice.order.map((photo, i) => {
          used.add(photo.id);
          return { assetId: photo.id, crop: choice.crops[i], ...dishCaption(photo) };
        }),
        section: index,
      };
      pages.push(page);
      pagePhotos.set(page, choice.order);
    }
    for (const photo of section.photos.flatMap((unit) => membersOf(unit))) {
      if (!used.has(photo.id)) {
        drop(photo, 'resolution');
      }
    }
  }

  // titles and captions name the places of the photos that are actually placed: an opener covers the pages up to the
  // next opener, like its map (see `getMapAssetIds`), which may include a section that has no opener of its own
  const photosOf = (page: AutoLayoutPage) => (pagePhotos.get(page) ?? []).flatMap((unit) => membersOf(unit));
  const opensChapter = (page: AutoLayoutPage) =>
    !!page.map || TITLE_LAYOUTS.has(page.layout) || isMapLayout(page.layout);
  const isOpener = (page: AutoLayoutPage) => page.section !== undefined && opensChapter(page);

  // a visit is titled after the photos placed in it; two visits of one place on one day get the time
  const visitPhotos = new Map<number, Candidate[]>();
  for (const [index, section] of sectionPlans.entries()) {
    if (!section.visit) {
      continue;
    }

    const placed = pages.filter((page) => page.section === index).flatMap((page) => photosOf(page));
    visitPhotos.set(index, placed.length > 0 ? placed : section.all);
  }
  const visitTitles = new Map<number, { title: string; place?: string; detail: string }>();
  for (const [index, placed] of visitPhotos) {
    const { pack, place } = sectionPlans[index].visit!;
    const sameDay = [...visitPhotos].some(
      ([other, otherPhotos]) =>
        other !== index &&
        sectionPlans[other].visit!.pack === pack &&
        sectionPlans[other].visit!.place.toLowerCase() === place.toLowerCase() &&
        getVisitTitle(place, otherPhotos) === getVisitTitle(place, placed),
    );
    const title = getVisitTitle(place, placed, sameDay);
    visitTitles.set(index, { title, place: getVisitPlace(placed), detail: title.slice(place.length + 3) });
  }
  /** the entries (dishes) of a visit in the order they are shown, e.g. for its source (menu) page */
  const getDishes = (section: number) => [
    ...new Set(
      pages
        .filter((page) => page.section === section)
        .flatMap((page) => page.slots.map((slot) => slot.caption))
        .filter((dish): dish is string => !!dish),
    ),
  ];

  let chapterTitle: string | undefined;
  let previousCaption: string | undefined;
  const visited = new Set<string>();
  for (const [index, page] of pages.entries()) {
    if (page.map?.assetIds || page.layout === 'cover') {
      chapterTitle = undefined;
      previousCaption = undefined;
      continue;
    }

    const visit = page.section === undefined ? undefined : visitTitles.get(page.section);
    if (visit && isOpener(page)) {
      // the map is titled with the place (restaurant) and captioned with the city and date; the source lists the
      // entries (the menu page lists the dishes)
      page.sectionTitle = visit.title;
      delete page.caption;
      if (page.map) {
        page.map = { ...page.map, title: sectionPlans[page.section!].visit!.place };
        if (page.layout === 'map') {
          Object.assign(page, openerCaption(visit.detail));
        }
      }
      const dishes = SOURCE_LAYOUTS.includes(page.layout) && captions === 'dish' ? getDishes(page.section!) : [];
      if (dishes.length > 0) {
        // a short list beside a menu, or a run of names below a wide one or when there are many
        page.caption = dishes.join(page.layout === 'menu' && dishes.length <= SOURCE_LIST_MAX ? '\n' : ' · ');
      }
      // the text the pack typesets beside the source, e.g. the ingredients and steps of a recipe
      const sourceText = page.layout === SOURCE_TEXT_LAYOUT ? pagePhotos.get(page)?.[0]?.sourceText : undefined;
      if (sourceText) {
        page.caption = sourceText;
      }
      for (const place of getPlaces(visitPhotos.get(page.section!) ?? [])) {
        visited.add(place);
      }
      // the place is in the title, so the pages of the visit only name other places
      chapterTitle = visit.place;
      previousCaption = undefined;
      continue;
    }

    if (isOpener(page)) {
      const covered = [...photosOf(page)];
      for (const next of pages.slice(index + 1)) {
        if (opensChapter(next)) {
          break;
        }
        covered.push(...photosOf(next));
      }
      previousCaption = undefined;
      if (covered.length === 0) {
        chapterTitle = page.sectionTitle;
        continue;
      }

      const title = getSectionTitle(covered, visited);
      for (const place of getPlaces(covered)) {
        visited.add(place);
      }
      const times = covered.map((photo) => photo.takenAt);
      const range = formatDateRange(Math.min(...times), Math.max(...times));
      const dates = singleDay ? `${range} · ${formatTime(Math.min(...times))}` : range;
      page.sectionTitle = title;
      if (page.map?.title) {
        page.map = { ...page.map, title };
      }
      delete page.caption;
      if (page.layout === 'map' || title !== dates) {
        Object.assign(page, openerCaption(dates));
      }
      chapterTitle = title;
      continue;
    }

    if (page.section === undefined) {
      continue;
    }
    const caption = getFactualCaption(pagePhotos.get(page) ?? [], captions, {
      sectionTitle: chapterTitle,
      previous: previousCaption,
    });
    if (!caption) {
      continue;
    }
    page.caption = caption;
    previousCaption = caption;
  }

  if (options.closing && hasLayout('text')) {
    pages.push({
      layout: 'text',
      slots: [],
      ...(options.closing.title && { sectionTitle: options.closing.title }),
      ...(options.closing.caption && { caption: options.closing.caption }),
    });
  }

  const droppedIds = photos.filter((photo) => !used.has(photo.id)).map((photo) => photo.id);
  const names = new Map<string, string>();
  for (const person of photos.flatMap((photo) => photo.people ?? [])) {
    if (person.name) {
      names.set(person.id, person.name);
    }
  }
  const has = (photo: AutoLayoutPhoto, personId: string) => photo.people?.some(({ id }) => id === personId) ?? false;

  return {
    pages,
    sections: sectionPlans.map((section, index) => {
      const placed = pages.filter((page) => page.section === index).flatMap((page) => photosOf(page));
      return {
        title: visitTitles.get(index)?.title ?? getSectionTitle(placed.length > 0 ? placed : section.all),
        dates: section.dates,
        photoIds: section.all.map((photo) => photo.id),
        located: section.all.some((photo) => photo.located),
        ...(section.visit && { place: section.visit.place, pack: section.visit.pack }),
      };
    }),
    usedIds: photos.filter((photo) => used.has(photo.id)).map((photo) => photo.id),
    droppedIds,
    dropReasons: Object.fromEntries(droppedIds.map((id) => [id, dropReasons.get(id) ?? 'budget'])),
    people: mainPersonIds.map((personId) => ({
      personId,
      ...(names.has(personId) && { name: names.get(personId) }),
      photos: photos.filter((photo) => has(photo, personId)).length,
      placed: photos.filter((photo) => used.has(photo.id) && has(photo, personId)).length,
    })),
  };
};
