import { TASTING_LAYOUTS } from 'src/utils/book/layouts.js';
import { CollectionCaptionContext, CollectionReviewInput, CollectionReviewIssue } from 'src/utils/collections/pack.js';
import { parseBookName } from 'src/utils/collections/packs/reading/title-page.js';
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

/** "15 September 2021", from a local time in ms */
export const formatReadDate = (time: number) => {
  const date = new Date(time);
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
};

const normalize = (text: string) =>
  text
    .normalize('NFD')
    .replaceAll(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replaceAll(/[^\p{L}\d]+/gu, ' ')
    .trim();

/** the description save_entries writes on a book photo: its name */
export const describeBook = (book: string) => book.trim();

/**
 * The caption of a book in a book of books. On a tasting-note page of a Reading journal it is the book's page of the
 * journal: its title and author, when it was read (the photo's date), then the note the user wrote in the photo's
 * description (not the one save_entries wrote), e.g.
 *
 *   Title: Wanderungen in den Dolomiten
 *   Author: Paul Grohmann
 *   Read: 9 July 2022
 *
 *   The climbs of the 1860s, told by the first man up the Marmolada.
 *
 * Elsewhere it is the name as tagged, "Title — Author".
 */
export const getBookCaption = (book: string, context: CollectionCaptionContext = {}) => {
  if (!context.layout || !TASTING_LAYOUTS.includes(context.layout)) {
    return book;
  }
  const { title, author } = parseBookName(book);
  const fields = [
    title && `Title: ${title}`,
    author && `Author: ${author}`,
    context.takenAt !== undefined && `Read: ${formatReadDate(context.takenAt)}`,
  ].filter(Boolean);
  const note = context.description?.trim();
  const written = note && normalize(note) !== normalize(describeBook(book)) ? note : undefined;
  return [fields.join('\n'), written].filter(Boolean).join('\n\n');
};

/** a name the assistant could not read: no title, a placeholder, or letters OCR made up */
export const isUnreadableBook = (book: string) => {
  const { title } = parseBookName(book);
  const text = (title ?? '').trim();
  return (
    text.length === 0 ||
    /^(?:unknown|unread|unreadable|unnamed|untitled|book|page|cover|title page|\?+|n\/?a)(?:\s+\d+)?$/i.test(text) ||
    isGarbled(text)
  );
};

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

/**
 * The checks of a reading journal: books without a readable name, and one book on more than one page (the cover and
 * the title page: keep the better one, or set them side by side)
 */
export const reviewReadingBook = ({ chapters }: CollectionReviewInput): CollectionReviewIssue[] => {
  const issues: CollectionReviewIssue[] = [];
  for (const chapter of chapters) {
    const unreadable = chapter.placed.filter(({ entry }) => isUnreadableBook(entry));
    if (unreadable.length > 0) {
      issues.push({
        severity: 'medium',
        type: 'missing-dish-name',
        message:
          `The chapter of ${chapter.place} shows ${plural(unreadable.length, 'book')} without a readable title ` +
          `(e.g. "${unreadable[0].entry}"): look at the covers and title pages and save their names ("Title — Author")`,
        pages: chapter.pages,
        assetIds: unreadable.flatMap(({ assetIds }) => assetIds).slice(0, 6),
      });
    }
    const repeated = chapter.placed.filter(({ assetIds }) => assetIds.length > 1);
    if (repeated.length > 0) {
      issues.push({
        severity: 'low',
        type: 'missing-dish-name',
        message:
          `The chapter of ${chapter.place} shows ${plural(repeated.length, 'book')} on more than one photo (e.g. ` +
          `${repeated[0].entry}, ${repeated[0].assetIds.length} photos): keep its cover or its title page, or set ` +
          'them side by side on a two-notes page',
        pages: chapter.pages,
        assetIds: repeated.flatMap(({ assetIds }) => assetIds.slice(1)).slice(0, 6),
      });
    }
  }
  return issues;
};
