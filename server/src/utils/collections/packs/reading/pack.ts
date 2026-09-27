import { TASTING_LAYOUTS } from 'src/utils/book/layouts.js';
import { CollectionPack } from 'src/utils/collections/pack.js';
import { describeBook, getBookCaption, reviewReadingBook } from 'src/utils/collections/packs/reading/book.js';
import { assignBooks } from 'src/utils/collections/packs/reading/books.js';
import {
  LIBRARY_WORDS,
  READING_CLASSIFY_RULES,
  READING_PROMPTS,
  READING_RECEIPT_WORDS,
} from 'src/utils/collections/packs/reading/classify.js';
import { parseBooks } from 'src/utils/collections/packs/reading/title-page.js';
import { SourceEntry } from 'src/utils/collections/source.js';
import { VisitOptions, getLocalYear } from 'src/utils/collections/visits.js';

const YEAR_MINUTES = 366 * 24 * 60;

/**
 * a reading period: the books photographed in one calendar year, at one place (a library abroad is a visit of its
 * own when the photos are located), whatever the gaps between them
 */
export const READING_VISIT_OPTIONS: VisitOptions = {
  maxGapMinutes: YEAR_MINUTES,
  maxSpanMinutes: YEAR_MINUTES,
  maxDistanceMeters: 1000,
  attachMinutes: 180,
  period: getLocalYear,
};

/** texts for photos of a reading period that are not of one book */
export const OFF_SHELF_PROMPTS = ['a photo of a room', 'a photo of a bookshelf', 'a photo of a museum display case'];

/** the CLIP text of a book, compared with its photos */
export const bookPrompt = ({ name }: Pick<SourceEntry, 'name' | 'description'>) => {
  const [title, author] = name.split(/\s+—\s+/, 2);
  const text = author ? `${title} by ${author}` : title;
  return `a photo of the cover of the book ${text.length > 160 ? text.slice(0, 160) : text}`;
};

/** labels and slogans on the signs of libraries and bookshops that don't name the place */
const NOT_A_NAME =
  /^(?:open|opened|closed|welcome|entrance|eingang|exit|ausgang|books?|b[uü]cher|library|bibliothek|sale|new|neu)$/i;

/**
 * Reading: a reading log. Photos of book covers, spines and title pages are the subjects, and each one carries its
 * own source, the book's printed text: it is read into the title, the author, the year, the publisher and the place
 * (see `title-page.ts`), and the photos of one book are grouped (see `books.ts`). A reading list, when one was
 * photographed, is the source the books are matched with. The place is the reading period ("Reading 2024"), or the
 * library or bookshop whose sign was photographed with the books. Photos are tagged `Reading/<Year or place>/<Title —
 * Author>` and `Reading/<Year or place>/Reading list`, and books in the Reading journal style have a page per book:
 * its cover, its title and author, when it was read, and the note written in its description.
 */
export const readingPack: CollectionPack = {
  id: 'reading',
  title: 'Reading',
  description:
    'a reading log: photos of book covers, spines and title pages, named from their printed text (title, author, ' +
    'year, publisher), by reading period or the library they were photographed at',
  tagRoot: 'Reading',
  sourceLeaf: 'Reading list',
  names: {
    subject: 'book',
    subjects: 'books',
    source: 'reading list',
    sources: 'reading lists',
    place: 'reading period',
    entry: 'book',
    entries: 'books',
    visit: 'reading period',
    visits: 'reading periods',
  },

  prompts: READING_PROMPTS,
  classify: { ...READING_CLASSIFY_RULES, receiptWords: READING_RECEIPT_WORDS },

  // a cover or title page is one book; a reading list is a book per line
  source: { parse: parseBooks, prompt: bookPrompt, minEntries: 1, onSubjects: true },

  place: {
    words: LIBRARY_WORDS,
    blocked: NOT_A_NAME,
    // the large type of a title page names the book, not the place
    sourceNameNeedsWord: true,
    fallbackName: ({ day }) => `Reading ${day.slice(0, 4)}`,
  },

  visits: { options: READING_VISIT_OPTIONS },

  // the books name themselves by their pages; the order of a list says nothing of the order they were read in
  match: { options: { order: 'none' }, offListPrompts: OFF_SHELF_PROMPTS, assign: assignBooks },

  describe: (book) => describeBook(book),

  book: {
    preset: {
      id: 'reading',
      name: 'Reading journal',
      description:
        'A notebook of the books read: off-white paper, ink blue and small-caps headings, a chapter per reading ' +
        'period and a journal page per book with its cover, its title and author, when it was read and your note',
      summary:
        'a reading journal: off-white paper, ink blue, a page per book with its cover, title, author, the date it ' +
        'was read and the note from its description; lays out one chapter per reading period',
      style: {
        marginMm: 16,
        gutterMm: 5,
        background: '#f7f3ea',
        textColor: '#24211c',
        fontFamily: 'FreeSerif, serif',
        titleSizePt: 28,
        captionSizePt: 10.5,
        theme: 'reading',
        accentColor: '#2c4a6b',
      },
    },
    theme: {
      id: 'reading',
      summary:
        'a reading journal: small-caps headings, thin rules, and the title, author and reading date typeset beside ' +
        'each cover with room for a note',
      look: 'printed',
      noteHeading: 'Notes',
    },
    caption: (book, _period, context) => getBookCaption(book, context),
    review: { unnamedEntries: true, missingSourcePage: false, check: reviewReadingBook },
    entryLayouts: [...TASTING_LAYOUTS],
    // a reading period is a year: one chapter
    visitGapHours: 366 * 24,
  },

  agent: {
    instructions:
      'Reading (pack "reading": subjects are photos of book covers, spines and title pages, each carrying its own ' +
      'source, the printed text; a reading list is the source when there is one; places are reading periods ' +
      '("Reading 2024") or the library or bookshop whose sign was photographed; entries are books): find_visits ' +
      'finds the reading periods (a calendar year each; do not pass maxGapMinutes); match_subjects with all the ' +
      'subjectIds reads every page at full resolution, groups the photos of one book (its cover and its title page) ' +
      'and names it "Title — Author" with the year, publisher and place as its description, with a contact sheet of ' +
      'the title crops. Fraktur and decorated type are read as other letters ("Rumft umd Proletariat" is "Kunst und ' +
      'Proletariat"): check every unsure book on its crop (read_source on it gives a zoomed crop) and correct the ' +
      'names as printed, in the language of the book; a book open at a page with no title gets no name: ask the ' +
      'user, or leave it. Then save_entries with place = the period or the library and entry = "Title — Author" for ' +
      'every photo of the book, and offer a Reading journal book (stylePreset "reading"), which sets the title, ' +
      'author and reading date beside each cover, with the photo description as the note.',
  },

  messages: {
    smartSearchDisabled:
      'Smart search is disabled: books cannot be recognized, only reading lists and title pages by their text',
    ocrDisabled: 'OCR is disabled: covers and title pages cannot be read; look at them and name the books yourself',
    fewEntries: 'Little of the page could be read: look at the zoomed crop and read the title and author yourself',
    noEntriesRead: 'No book could be read on the reading list: look at it yourself and pass its books as entries',
    noSource: 'No title could be read: look at the covers and name the books yourself',
    cannotMatch: 'Smart search is disabled: the books are named from their pages only',
    placeNeedsName: 'The reading period needs a name, e.g. "Reading 2024" or the library',
    noLocation: 'The photos have no location: ask the user where the books were read, or name the period by its year',
  },
};
