import { CollectionPack, CollectionSourcePage, getCollectionTagRules } from 'src/utils/collections/pack.js';
import { getCollectionPack, getCollectionPackByTagRoot, getCollectionPacks } from 'src/utils/collections/registry.js';
import { CollectionTag, getTagPrefix, parseCollectionTag } from 'src/utils/collections/tags.js';

/**
 * The photos of collections in books: a photo tagged `<Root>/<Place>/<Entry>` (or `<Root>/<Place>/<SourceLeaf>`) by
 * any registered pack, e.g. `Food/<Restaurant>/<Dish>` (see `src/utils/collections/tags.ts`), belongs to a chapter
 * per visit of its place, opened by its source page (the menu), with the entries captioned below their photos.
 */
export type BookCollectionTag = CollectionTag & {
  /** the id of the pack, e.g. food */
  pack: string;
};

/** A photo with the collection tag it carries */
export type CollectionPhoto = {
  id: string;
  takenAt: number;
  stackId?: string | null;
  collection?: BookCollectionTag | null;
  /** a source typeset as a page of its own instead of its photo (a ticket stub), see `CollectionPack.book.sourcePage` */
  sourcePage?: CollectionSourcePage | null;
};

/** photos of one place further apart than this are different visits */
export const VISIT_GAP_MS = 3 * 60 * 60 * 1000;
/** photos without a collection tag taken this close to the tagged photos of a visit belong to it, e.g. the table */
export const VISIT_MARGIN_MS = 20 * 60 * 1000;

export type PlaceVisit<T extends CollectionPhoto> = {
  /** the id of the pack */
  pack: string;
  place: string;
  /** the entry of a chapter per entry (e.g. a leg of a trip), see `CollectionPack.book.chapters` */
  entry?: string;
  photos: T[];
  start: number;
  end: number;
};

/** whether the pack of a tag names its entries below their photos (dishes do; the legs of a trip title chapters) */
const namesEntries = (tag: BookCollectionTag) => getCollectionPack(tag.pack)?.book.namedEntries !== false;

/** a photo of an entry that is named on the page, e.g. a dish */
export const isEntryPhoto = (photo: Pick<CollectionPhoto, 'collection'>) =>
  photo.collection?.kind === 'entry' && namesEntries(photo.collection);

/** a photo of the source, e.g. the menu */
export const isSourcePhoto = (photo: Pick<CollectionPhoto, 'collection'>) => photo.collection?.kind === 'source';

export const getEntryName = (photo: Pick<CollectionPhoto, 'collection'>) =>
  photo.collection?.kind === 'entry' ? photo.collection.entry : undefined;

/** the caption of an entry photo, as its pack formats it (e.g. the name of the dish) */
export const getEntryCaption = (photo: Pick<CollectionPhoto, 'collection'>) => {
  const tag = photo.collection;
  if (tag?.kind !== 'entry' || !namesEntries(tag)) {
    return;
  }
  const pack = getCollectionPack(tag.pack);
  return pack ? pack.book.caption(tag.entry, tag.place) : tag.entry;
};

/** the pack of a photo's collection tag */
export const getPhotoPack = (photo: Pick<CollectionPhoto, 'collection'>): CollectionPack | undefined =>
  photo.collection ? getCollectionPack(photo.collection.pack) : undefined;

/** the prefixes of the tags of every registered pack, e.g. `Food/` */
export const getCollectionTagPrefixes = () =>
  getCollectionPacks().map((pack) => getTagPrefix(getCollectionTagRules(pack)));

/** Reads a tag value of any registered pack */
export const parseBookCollectionTag = (value: string): BookCollectionTag | undefined => {
  const pack = getCollectionPackByTagRoot(value.split('/', 1)[0]);
  const tag = pack ? parseCollectionTag(getCollectionTagRules(pack), value) : undefined;
  return tag && pack ? { ...tag, pack: pack.id } : undefined;
};

/**
 * The collection tag of a photo from the values of its tags: an entry before a source (a photo of a dish next to the
 * menu is a dish), then the first in alphabetical order; other tags are ignored
 */
export const getCollectionTag = (values: Iterable<string>): BookCollectionTag | undefined => {
  const tags = [...values]
    .toSorted()
    .map((value) => parseBookCollectionTag(value))
    .filter((tag): tag is BookCollectionTag => !!tag);
  return tags.find((tag) => tag.kind === 'entry') ?? tags[0];
};

/** Gives the photos of a stack that have no collection tag the tag of the stack (e.g. an improved copy of a dish) */
export const shareCollectionTagsInStacks = <T extends CollectionPhoto>(photos: T[]): T[] => {
  const byStack = new Map<string, BookCollectionTag>();
  for (const photo of photos) {
    if (photo.stackId && photo.collection && (!byStack.has(photo.stackId) || photo.collection.kind === 'entry')) {
      byStack.set(photo.stackId, photo.collection);
    }
  }
  return photos.map((photo) =>
    !photo.collection && photo.stackId && byStack.has(photo.stackId)
      ? { ...photo, collection: byStack.get(photo.stackId) }
      : photo,
  );
};

const placeKey = (tag: BookCollectionTag) => `${tag.pack}\n${tag.place.trim().toLowerCase()}`;

const entryKey = (entry: string) => entry.trim().toLowerCase();

/** the entry of a photo when its pack has a chapter per entry: its own, or the one its source page is for */
const getChapterEntry = (photo: CollectionPhoto) => {
  const tag = photo.collection;
  if (!tag || getCollectionPack(tag.pack)?.book.chapters !== 'entry') {
    return;
  }
  return tag.kind === 'entry' ? tag.entry : (photo.sourcePage?.entry ?? undefined);
};

/**
 * The visits among the photos: the photos tagged with one place of one pack, split where more than `VISIT_GAP_MS`
 * (or the pack's `book.visitGapHours`, e.g. a recipe photographed the day after the cooking) passes between two of
 * them, with the untagged photos taken during the visit (up to `VISIT_MARGIN_MS` before or after). A pack with a
 * chapter per entry (a trip, whose entries are its legs) has a visit per entry instead, whatever the gaps, and its
 * sources join the entry they are for. The other photos are returned as they are. Both are in time order.
 */
export const getPlaceVisits = <T extends CollectionPhoto>(photos: T[]): { visits: PlaceVisit<T>[]; others: T[] } => {
  const byTime = (a: T, b: T) => a.takenAt - b.takenAt || a.id.localeCompare(b.id);
  const ordered = photos.toSorted(byTime);
  const tagged = Map.groupBy(
    ordered.filter((photo) => photo.collection),
    (photo) => placeKey(photo.collection!),
  );

  const visits: PlaceVisit<T>[] = [];
  for (const group of tagged.values()) {
    const pack = group[0].collection!.pack;
    if (getCollectionPack(pack)?.book.chapters === 'entry') {
      visits.push(...getEntryVisits(group));
      continue;
    }
    const hours = getCollectionPack(pack)?.book.visitGapHours;
    const gap = hours === undefined ? VISIT_GAP_MS : hours * 60 * 60 * 1000;
    // the spelling used most often names the place
    const names = Map.groupBy(group, (photo) => photo.collection!.place.trim());
    const place = [...names].toSorted((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))[0][0];
    let current: T[] = [];
    for (const photo of group) {
      if (current.length > 0 && photo.takenAt - current.at(-1)!.takenAt > gap) {
        visits.push({ pack, place, photos: current, start: current[0].takenAt, end: current.at(-1)!.takenAt });
        current = [];
      }
      current.push(photo);
    }
    visits.push({ pack, place, photos: current, start: current[0].takenAt, end: current.at(-1)!.takenAt });
  }

  const others: T[] = [];
  for (const photo of ordered) {
    if (photo.collection) {
      continue;
    }
    const visit = visits
      .filter((item) => photo.takenAt >= item.start - VISIT_MARGIN_MS && photo.takenAt <= item.end + VISIT_MARGIN_MS)
      .toSorted(
        (a, b) =>
          Math.abs(photo.takenAt - (a.start + a.end) / 2) - Math.abs(photo.takenAt - (b.start + b.end) / 2) ||
          a.start - b.start,
      )[0];
    if (visit) {
      visit.photos.push(photo);
    } else {
      others.push(photo);
    }
  }

  for (const visit of visits) {
    visit.photos.sort(byTime);
  }
  return { visits: visits.toSorted((a, b) => a.start - b.start || a.place.localeCompare(b.place)), others };
};

/** "sougia" and "soutia": a letter off, or the same first five letters */
const isNearWord = (a: string, b: string) => {
  if (a === b) {
    return true;
  }
  if (Math.min(a.length, b.length) < 5) {
    return false;
  }
  if (a.slice(0, 5) === b.slice(0, 5)) {
    return true;
  }
  return a.length === b.length && [...a].filter((char, index) => char !== b[index]).length <= 1;
};

/** the numbers of a name, e.g. its date */
const numbersOf = (list: string[]) =>
  list
    .filter((word) => /\d/.test(word))
    .toSorted()
    .join(' ');

const words = (text: string) =>
  text
    .toLowerCase()
    .split(/[^\p{L}\d]+/u)
    .filter((word) => word.length >= 3);

/**
 * whether two names are of the same entry, give or take a place name corrected when it was saved: the same numbers
 * (a date), and three in four of their words the same or a letter off
 */
const isSimilarName = (a: string, b: string) => {
  const [x, y] = [words(a), words(b)];
  if (numbersOf(x) !== numbersOf(y)) {
    return false;
  }
  const [p, q] = [x.filter((word) => !/\d/.test(word)), y.filter((word) => !/\d/.test(word))];
  const shared = p.filter((word) => q.some((other) => isNearWord(word, other))).length;
  return p.length > 0 && q.length > 0 && shared >= 0.75 * Math.max(p.length, q.length);
};

/** an entry named like `entry`, e.g. after a correction of a place name */
const findSimilarEntry = (entry: string, chapters: Array<{ entry: string }>) =>
  chapters.find((chapter) => isSimilarName(entry, chapter.entry))?.entry;

/**
 * The chapters of a place of a pack with a chapter per entry: one per entry, with the sources of the entry; a source
 * for an entry no photo has is a chapter of its own (a leg without photos), and one for no entry joins the entry
 * closest in time
 */
const getEntryVisits = <T extends CollectionPhoto>(group: T[]): PlaceVisit<T>[] => {
  const { pack, place } = group[0].collection!;
  const byEntry = new Map<string, { entry: string; photos: T[] }>();
  const add = (entry: string, photo: T) => {
    const chapter = byEntry.get(entryKey(entry)) ?? { entry, photos: [] };
    chapter.photos.push(photo);
    byEntry.set(entryKey(entry), chapter);
  };
  const loose: T[] = [];
  for (const photo of group) {
    if (photo.collection?.kind === 'entry') {
      add(getChapterEntry(photo)!, photo);
    }
  }
  for (const photo of group) {
    if (photo.collection?.kind === 'entry') {
      continue;
    }
    const entry = getChapterEntry(photo);
    if (entry) {
      // the entry as the source names it, or an entry named a little differently (renamed when it was saved)
      add(byEntry.get(entryKey(entry))?.entry ?? findSimilarEntry(entry, byEntry.values().toArray()) ?? entry, photo);
    } else {
      loose.push(photo);
    }
  }
  const chapters = byEntry.values().toArray();
  for (const photo of loose) {
    const closest = chapters
      .map((chapter) => ({
        chapter,
        distance: Math.min(...chapter.photos.map((other) => Math.abs(other.takenAt - photo.takenAt))),
      }))
      .toSorted((a, b) => a.distance - b.distance)[0];
    if (closest) {
      closest.chapter.photos.push(photo);
    } else {
      chapters.push({ entry: place, photos: [photo] });
    }
  }
  return chapters.map(({ entry, photos }) => {
    // a chapter is when its entry's photos were taken; a source is often photographed later
    const times = (
      photos.some((photo) => photo.collection?.kind === 'entry')
        ? photos.filter((photo) => photo.collection?.kind === 'entry')
        : photos
    ).map((photo) => photo.takenAt);
    return { pack, place, entry, photos, start: Math.min(...times), end: Math.max(...times) };
  });
};

/** Splits time-ordered photos into the runs between the visits (a run for every gap, empty runs left out) */
export const getRunsBetweenVisits = <T extends CollectionPhoto>(
  photos: T[],
  visits: PlaceVisit<CollectionPhoto>[],
): T[][] => {
  const starts = visits.map((visit) => visit.start).toSorted((a, b) => a - b);
  const runs = Map.groupBy(photos, (photo) => starts.filter((start) => start <= photo.takenAt).length);
  return [...runs].toSorted((a, b) => a[0] - b[0]).map(([, run]) => run);
};

/** the theme of a pack's books, e.g. food */
const getPackTheme = (theme?: string | null) =>
  theme ? getCollectionPacks().find((pack) => pack.book.theme?.id === theme)?.book.theme : undefined;

/** whether a style theme is the theme of a pack, so that books in it are laid out as collections */
export const isCollectionTheme = (theme?: string | null) => !!getPackTheme(theme);

/** whether a style theme is drawn like a printed page (a menu): a hairline frame, small caps and ornaments */
export const isPrintedTheme = (theme?: string | null) => getPackTheme(theme)?.look === 'printed';
