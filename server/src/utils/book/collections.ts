import { CollectionPack, getCollectionTagRules } from 'src/utils/collections/pack.js';
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
};

/** photos of one place further apart than this are different visits */
export const VISIT_GAP_MS = 3 * 60 * 60 * 1000;
/** photos without a collection tag taken this close to the tagged photos of a visit belong to it, e.g. the table */
export const VISIT_MARGIN_MS = 20 * 60 * 1000;

export type PlaceVisit<T extends CollectionPhoto> = {
  /** the id of the pack */
  pack: string;
  place: string;
  photos: T[];
  start: number;
  end: number;
};

/** a photo of an entry, e.g. a dish */
export const isEntryPhoto = (photo: Pick<CollectionPhoto, 'collection'>) => photo.collection?.kind === 'entry';

/** a photo of the source, e.g. the menu */
export const isSourcePhoto = (photo: Pick<CollectionPhoto, 'collection'>) => photo.collection?.kind === 'source';

export const getEntryName = (photo: Pick<CollectionPhoto, 'collection'>) =>
  photo.collection?.kind === 'entry' ? photo.collection.entry : undefined;

/** the caption of an entry photo, as its pack formats it (e.g. the name of the dish) */
export const getEntryCaption = (photo: Pick<CollectionPhoto, 'collection'>) => {
  const tag = photo.collection;
  if (tag?.kind !== 'entry') {
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

/**
 * The visits among the photos: the photos tagged with one place of one pack, split where more than `VISIT_GAP_MS`
 * passes between two of them, with the untagged photos taken during the visit (up to `VISIT_MARGIN_MS` before or
 * after). The other photos are returned as they are. Both are in time order.
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
    // the spelling used most often names the place
    const names = Map.groupBy(group, (photo) => photo.collection!.place.trim());
    const place = [...names].toSorted((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))[0][0];
    let current: T[] = [];
    for (const photo of group) {
      if (current.length > 0 && photo.takenAt - current.at(-1)!.takenAt > VISIT_GAP_MS) {
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

/** whether a style theme is drawn like an exhibition catalogue: photos shown whole, never cropped, with labels */
export const isGalleryTheme = (theme?: string | null) => getPackTheme(theme)?.look === 'gallery';

/** whether the source photos of a pack's visits open their chapters on a page of their own (a menu), default yes */
export const hasSourcePages = (packId: string) => getCollectionPack(packId)?.book.sourcePages !== false;

/**
 * Numbers the entries of the packs that number them (a catalogue of artworks) through the pages, in their order: the
 * slot captions become "1. Caption"; another photo of an entry (a detail) keeps its number.
 */
export const numberEntryCaptions = <T extends { slots: Array<{ assetId: string; caption?: string }> }>(
  pages: T[],
  photos: Map<string, Pick<CollectionPhoto, 'collection'>>,
) => {
  const numbers = new Map<string, number>();
  for (const page of pages) {
    for (const slot of page.slots) {
      const tag = photos.get(slot.assetId)?.collection;
      if (!slot.caption || tag?.kind !== 'entry' || !getCollectionPack(tag.pack)?.book.numbered) {
        continue;
      }
      const key = `${tag.pack}\n${tag.place.toLowerCase()}\n${tag.entry}`;
      if (!numbers.has(key)) {
        numbers.set(key, numbers.size + 1);
      }
      slot.caption = `${numbers.get(key)}. ${slot.caption}`;
    }
  }
  return pages;
};
