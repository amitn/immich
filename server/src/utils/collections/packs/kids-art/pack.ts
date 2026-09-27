import { CollectionPack, getNoticeDay } from 'src/utils/collections/pack.js';
import { parseArtwork } from 'src/utils/collections/packs/kids-art/artwork.js';
import { assignArtworks } from 'src/utils/collections/packs/kids-art/artworks.js';
import { KIDS_ART_PACK, getArtworkCaption, reviewKidsArtBook } from 'src/utils/collections/packs/kids-art/book.js';
import { KIDS_ART_CLASSIFY_RULES, KIDS_ART_PROMPTS } from 'src/utils/collections/packs/kids-art/classify.js';
import { redactChildNames } from 'src/utils/collections/packs/kids-art/names.js';
import { SourceEntry } from 'src/utils/collections/source.js';
import { VisitOptions, getLocalYear } from 'src/utils/collections/visits.js';

const YEAR_MINUTES = 366 * 24 * 60;

/**
 * a child's year of artworks: the artworks photographed in one calendar year, whatever the gaps (a drawing in
 * January, a painted plate in September); the child is told apart by the assistant and the user, never by the engine
 */
export const KIDS_ART_VISIT_OPTIONS: VisitOptions = {
  maxGapMinutes: YEAR_MINUTES,
  maxSpanMinutes: YEAR_MINUTES,
  maxDistanceMeters: 50_000,
  attachMinutes: 24 * 60,
  period: getLocalYear,
};

/** texts for photos of a child's year that are not an artwork */
export const NOT_ARTWORK_PROMPTS = ['a photo of a child', 'a photo of a room', 'a photo of a table'];

/** the CLIP text of an artwork, compared with its photos */
export const artworkPrompt = ({ name }: Pick<SourceEntry, 'name' | 'description'>) => {
  const title = name.replace(/\s*\([^)]*\)\s*$/, '');
  return `a photo of a child's drawing: ${title.length > 160 ? title.slice(0, 160) : title}`;
};

/**
 * Kids' art: an archive of a child's artworks. Drawings, paintings, crafts and illustrated letters are the subjects,
 * and each carries its own source, what the child wrote on it (a greeting, an age, a year), read in fragments (see
 * `artwork.ts`); the pages of a letter are one artwork (see `artworks.ts`). The place is the child and the year, or
 * the family: "Hanako, 2017". Photos are tagged `Kids art/<Child or family, year>/<Title (age N)>`, and books in the
 * Refrigerator gallery style show each artwork whole on a paper mat, taped at the corners, with a handwritten label.
 *
 * Privacy comes first: the pack is for artworks, never for photos of the children (CLIP takes a child's photo for
 * something else, and the book review reports a photo with a face); every text it lets out keeps at most the first
 * name of a person (`redactChildNames`), so no full name reaches a tag or a book; books never show where the photos
 * were taken.
 */
export const kidsArtPack: CollectionPack = {
  id: KIDS_ART_PACK,
  title: "Kids' art",
  description:
    "a children's artwork archive: drawings, paintings, crafts and illustrated letters, by child (first name only) " +
    'and year, named from what is written on them or what they show',
  tagRoot: 'Kids art',
  sourceLeaf: 'Note',
  names: {
    subject: 'artwork',
    subjects: 'artworks',
    source: 'note',
    sources: 'notes',
    place: 'child',
    entry: 'artwork',
    entries: 'artworks',
    visit: 'year',
    visits: 'years',
  },

  prompts: KIDS_ART_PROMPTS,
  classify: KIDS_ART_CLASSIFY_RULES,

  // what the child wrote on the artwork, or a parent on a note beside it
  source: { parse: parseArtwork, prompt: artworkPrompt, minEntries: 1, onSubjects: true },

  place: {
    // the child of a year is never read on the photos: the user names the child
    words: /(?<![\p{L}])kids(?![\p{L}])/iu,
    blocked: /[\s\S]*/,
    isNotName: () => true,
    fallbackName: ({ day }) => `Kids' art ${day.slice(0, 4)}`,
  },

  visits: { options: KIDS_ART_VISIT_OPTIONS },

  match: { options: { order: 'none' }, offListPrompts: NOT_ARTWORK_PROMPTS, assign: assignArtworks },

  describe: (artwork) => redactChildNames(artwork.trim()),

  book: {
    preset: {
      id: KIDS_ART_PACK,
      name: 'Refrigerator gallery',
      description:
        'A cheerful archive of artworks: warm paper, each artwork shown whole on a white mat taped to the page, ' +
        'handwritten-style labels with the title, the age and the date, a chapter per child and year, and no maps',
      summary:
        'a refrigerator gallery: warm paper, artworks shown whole on white mats with tape at the corners and ' +
        'handwritten-style labels (title, age, date); lays out one chapter per child and year',
      style: {
        marginMm: 14,
        gutterMm: 7,
        background: '#fbf3e2',
        textColor: '#3b3530',
        fontFamily: 'Patrick Hand, Comic Neue, sans-serif',
        titleSizePt: 30,
        captionSizePt: 11,
        theme: KIDS_ART_PACK,
        accentColor: '#e0603e',
      },
    },
    theme: {
      id: KIDS_ART_PACK,
      summary:
        'a refrigerator gallery: artworks shown whole on paper mats, taped at the corners, with handwritten-style ' +
        'labels and crayon underlines',
      look: 'mounted',
    },
    caption: (artwork, _child, context) => getArtworkCaption(artwork, context),
    review: { unnamedEntries: true, missingSourcePage: false, check: reviewKidsArtBook },
    // a child's year is one chapter
    visitGapHours: 366 * 24,
    sourcePage: false,
  },

  agent: {
    instructions:
      'Kids\' art (pack "kids-art": subjects are children\'s artworks, drawings, paintings, crafts and illustrated ' +
      'letters, each carrying its own text; places are a child and a year, e.g. "Hanako, 2017", or a family; ' +
      'entries are artworks): privacy first. Only artworks: never name or save a photo that shows a child, and tell ' +
      'the user when one is among the photos. Use only a first name for a child, and only one the user gave you or ' +
      'wrote on the artwork; every name you pass is cut to its first word, and surnames read on the artworks are ' +
      'removed. find_visits finds a year of artworks (do not pass maxGapMinutes); a year may hold the artworks of ' +
      'two children: ask the user whose they are. Scans have the date they were imported, not made: take the year ' +
      'written on the artwork, or ask. match_subjects with all the subjectIds reads what is written on each artwork ' +
      '(OCR reads handwriting in fragments and no Cyrillic or Japanese: your eyes do most of the work), puts the ' +
      'pages of a letter together and names an artwork only from a greeting it reads ("Buon Natale (1947)"); name ' +
      'the others from what they show, in sentence case, with the age when it is known: "Two foxes under green ' +
      'leaves (age 8)". Then save_entries with place = "<first name>, <year>" and entry = the title for every ' +
      'photo, and offer a Refrigerator gallery book (stylePreset "kids-art").',
  },

  messages: {
    smartSearchDisabled: 'Smart search is disabled: artworks cannot be recognized, only notes by their text',
    ocrDisabled: 'OCR is disabled: nothing written on the artworks can be read; look at them and name them yourself',
    fewEntries:
      'Little could be read on the artwork (OCR reads handwriting in fragments, and no Cyrillic or Japanese): look ' +
      'at it and name it yourself',
    noEntriesRead: 'Nothing could be read on the note: look at it yourself',
    noSource: 'Nothing could be read on the artworks: look at them and name them yourself',
    cannotMatch: 'Smart search is disabled: the artworks are named from what is written on them only',
    placeNeedsName: 'The year needs the first name of the child (or the family), e.g. "Hanako, 2017"',
    noLocation: 'Places of artworks are never looked up: ask the user whose artworks they are',
    // a year of artworks, and scans have the date they were imported: "today" is when they were added, not made
    newVisit: ({ day, today }) => {
      const { days, text } = getNoticeDay(day, today);
      if (days >= 0 && days < 7) {
        return `Name the artworks you added ${text}?`;
      }
      return day.slice(0, 4) === today.slice(0, 4)
        ? 'Name the artworks from this year?'
        : `Name the artworks from ${day.slice(0, 4)}?`;
    },
  },

  privacy: { redact: redactChildNames, location: false },
};
