import { CollectionCaptionContext, CollectionReviewInput, CollectionReviewIssue } from 'src/utils/collections/pack.js';
import { parseArtworkName } from 'src/utils/collections/packs/kids-art/artwork.js';
import { redactChildNames } from 'src/utils/collections/packs/kids-art/names.js';
import { isGarbled } from 'src/utils/collections/place.js';

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/** the id of the pack, for its checks of the books */
export const KIDS_ART_PACK = 'kids-art';

/** "May 2020", from a local time in ms */
const formatMonth = (time: number) => {
  const date = new Date(time);
  return `${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
};

/**
 * The caption of an artwork in a book, like the label a parent writes on the back: its title, then the age and the
 * date, e.g. "Two foxes under green leaves\nage 8 · January 2025"; a year written on the artwork ("Buon Natale
 * (1947)") is its date
 */
export const getArtworkCaption = (entry: string, context: CollectionCaptionContext = {}) => {
  const { title, age, year } = parseArtworkName(entry);
  const date = year ?? (context.takenAt === undefined ? undefined : formatMonth(context.takenAt));
  const details = [age && `age ${age}`, date].filter(Boolean).join(' · ');
  return redactChildNames(details ? `${title}\n${details}` : title);
};

/** a name the assistant could not give: a placeholder, or letters OCR made up */
export const isUnnamedArtwork = (entry: string) => {
  const { title } = parseArtworkName(entry);
  return (
    title.length === 0 ||
    /^(?:unknown|unnamed|untitled|artwork|drawing|painting|picture|\?+|n\/?a)(?:\s+\d+)?$/i.test(title) ||
    isGarbled(title)
  );
};

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

/** a map on a page: it would show where the photos were taken */
const isMapLayout = (layout: string) => layout === 'map' || layout === 'map-photo';

/**
 * The checks of a kids' art book, privacy first: a photo of the book's artworks with a face on it (the pack is for
 * artworks, never for photos of the children), a caption or a title with what reads like a full name, a map (where
 * the family lives), and artworks without a name
 */
export const reviewKidsArtBook = ({ pages, photos, chapters }: CollectionReviewInput): CollectionReviewIssue[] => {
  const issues: CollectionReviewIssue[] = [];
  const placed = new Map<string, number[]>();
  for (const [index, page] of pages.entries()) {
    for (const { assetId } of page.assets) {
      placed.set(assetId, [...(placed.get(assetId) ?? []), index + 1]);
    }
  }
  const art = photos.filter((photo) => photo.collection?.pack === KIDS_ART_PACK);
  const faces = art.filter((photo) => (photo.faces?.length ?? 0) > 0);
  if (faces.length > 0) {
    const onPages = [...new Set(faces.flatMap((photo) => placed.get(photo.id) ?? []))].toSorted((a, b) => a - b);
    issues.push({
      severity: 'high',
      type: 'privacy',
      message:
        `${plural(faces.length, 'photo')} of the artworks ${faces.length === 1 ? 'shows' : 'show'} a face: a ` +
        "kids' art book is for the artworks only, never for photos of the children. Take them out of the book (and " +
        'of the journal), or crop them to the artwork',
      pages: onPages,
      assetIds: faces.map(({ id }) => id).slice(0, 12),
    });
  }

  if (art.length > 0) {
    const named = pages.flatMap((page, index) =>
      [page.caption, page.sectionTitle, ...page.assets.map(({ caption }) => caption)].some(
        (text) => !!text && redactChildNames(text) !== text,
      )
        ? [index + 1]
        : [],
    );
    if (named.length > 0) {
      issues.push({
        severity: 'high',
        type: 'privacy',
        message:
          'A caption or title reads like a full name: keep at most the first name of a child in the book (write ' +
          'titles in sentence case, e.g. "Two foxes under green leaves")',
        pages: named,
      });
    }
    const maps = pages.flatMap((page, index) => (isMapLayout(page.layout) ? [index + 1] : []));
    if (maps.length > 0) {
      issues.push({
        severity: 'medium',
        type: 'privacy',
        message:
          "A map shows where the photos were taken, which a kids' art book should not: replace the map page with " +
          'a section opener',
        pages: maps,
      });
    }
  }

  for (const chapter of chapters) {
    const unnamed = chapter.placed.filter(({ entry }) => isUnnamedArtwork(entry));
    if (unnamed.length > 0) {
      issues.push({
        severity: 'medium',
        type: 'missing-dish-name',
        message:
          `The chapter of ${chapter.place} shows ${plural(unnamed.length, 'artwork')} without a title (e.g. ` +
          `"${unnamed[0].entry}"): look at them and save a short title, with the age when it is known ("Two foxes ` +
          'under green leaves (age 8)")',
        pages: chapter.pages,
        assetIds: unnamed.flatMap(({ assetIds }) => assetIds).slice(0, 6),
      });
    }
  }
  return issues;
};
