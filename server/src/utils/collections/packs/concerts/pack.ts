import { SETLIST_LAYOUT } from 'src/utils/book/layouts.js';
import { ClassifyRules, CollectionPrompts, OcrSummary, scoreText } from 'src/utils/collections/classify.js';
import { CollectionPack } from 'src/utils/collections/pack.js';
import { assignConcertPhotos } from 'src/utils/collections/packs/concerts/assign.js';
import {
  GIG_POSTER_THEME,
  formatSetlistPage,
  getActChapterTitle,
  reviewConcertBook,
} from 'src/utils/collections/packs/concerts/book.js';
import { isUnnamedSetlist, parseConcertSource } from 'src/utils/collections/packs/concerts/lineup.js';
import { VENUE_NAME_RULES, VENUE_OSM_FILTERS } from 'src/utils/collections/packs/concerts/venue.js';
import { SourceEntry } from 'src/utils/collections/source.js';
import { DEFAULT_VISIT_OPTIONS, FallbackVisit, VisitOptions } from 'src/utils/collections/visits.js';

/**
 * CLIP text prompts per kind: stage photos are the subjects, setlists, line-ups and boards of stage times the sources,
 * the marquee of the venue and the gates of a festival the signs, tickets and wristbands the receipts. The "other"
 * prompts give CLIP something else to prefer for the rest of a library (and the queues and bars of the night).
 */
export const CONCERT_PROMPTS: CollectionPrompts = {
  subject: [
    'a photo of a band performing on stage',
    'a photo of a singer with a microphone on stage',
    'a photo of a guitarist playing on stage',
    'a photo of a drummer playing on stage',
    'a photo of a concert stage with lights',
    'a photo of a crowd in front of a concert stage',
    'a photo of the main stage of a music festival',
    'a photo of musicians performing live',
    'a photo of a stage with instruments and amplifiers',
  ],
  source: [
    'a photo of a setlist taped to the floor of a stage',
    'a photo of a handwritten setlist',
    'a photo of a printed setlist on a sheet of paper',
    'a photo of a list of song titles',
    'a photo of the line-up poster of a music festival',
    'a photo of a board with the stage times of a festival',
  ],
  sign: [
    'a photo of the marquee of a concert venue',
    'a photo of the entrance of a music festival',
    'a photo of the sign of a music club',
  ],
  receipt: ['a photo of a concert ticket', 'a photo of a festival wristband'],
  other: [
    'a photo of people',
    'a selfie',
    'a photo of a landscape',
    'a photo of a city street',
    'a photo of food',
    'a photo of a drink',
    'a screenshot',
    'a photo of a car',
    'a photo of an animal',
    'a photo of a building',
  ],
};

/** words of tickets and wristbands */
export const CONCERT_TICKET_WORDS =
  /\b(?:ticket|tickets|admission|admit one|general admission|entrada|billet|eintritt|doors|door time|show time|showtime|row|seat|section|price|fee|total|order|barcode|valid|standing|floor|balcony)\b/gi;

/** the text of a setlist or a line-up: acts read on it (or the songs of a setlist) make a source */
export const scoreConcertText = (summary: OcrSummary) => {
  const scores = scoreText(summary);
  const listed = summary.items > 0 && summary.lines >= 5 ? Math.min(1, 0.4 + 0.04 * Math.min(summary.lines, 15)) : 0;
  return { ...scores, source: Math.max(scores.source, listed) };
};

/** a kind needs at least this score; stage photos keep their banners (a festival prints its name all over them) */
export const CONCERT_CLASSIFY_RULES: ClassifyRules = {
  thresholds: { subject: 0.5, source: 0.5, sign: 0.55, receipt: 0.6 },
  scoreText: scoreConcertText,
  subjectTextFactor: (lines) => (lines > 30 ? 0.5 : 1),
};

/** a gig lasts an evening, with changeovers between the sets, and a festival spreads its stages over its grounds */
export const CONCERT_VISIT_OPTIONS: VisitOptions = {
  ...DEFAULT_VISIT_OPTIONS,
  maxGapMinutes: 90,
  maxSpanMinutes: 8 * 60,
  maxDistanceMeters: 1500,
  attachMinutes: 180,
};

/** texts for photos of acts that no source names */
export const OFF_BILL_PROMPTS = [
  'a photo of a band on stage',
  'a photo of a concert',
  'a photo of a crowd at a concert',
];

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2019-03-07" → "7 Mar 2019" */
export const formatConcertDay = (day: string) => {
  const [year, month, date] = day.split('-').map(Number);
  return year && month && date ? `${date} ${MONTHS[month - 1]} ${year}` : day;
};

/** "Concert in Seattle, 7 Mar 2019", or "Concert, 7 Mar 2019" when the photos are not located */
export const getConcertFallbackName = ({ city, day }: FallbackVisit) =>
  `${city ? `Concert in ${city}` : 'Concert'}, ${formatConcertDay(day)}`;

/** the CLIP text of an act: CLIP knows a few famous performers, and a stage photo of any other looks alike */
export const actPrompt = ({ name }: Pick<SourceEntry, 'name' | 'description'>) =>
  isUnnamedSetlist(name) ? 'a photo of a band performing on stage' : `a photo of ${name} performing on stage`;

/**
 * Concerts: gigs and festivals. Stage photos are the subjects, the sources are what names the acts (the line-up of a
 * festival stage, a board of stage times, the setlist taped to the stage floor), the venue or the festival is the
 * place and the acts are the entries; a gig (a night) is a visit. The photos are matched with the acts by time: the
 * act on stage when a photo was taken, by the starts of a line-up, or by when its setlist was photographed and the
 * order of the bill. Photos are tagged `Concerts/<Festival or venue, date>/<Act>`, the setlists `…/Setlist` and the
 * line-ups `…/Line-up`, and books in the Gig poster style have a chapter per act, opened by its setlist typeset in bold
 * capitals beside the photo of the sheet.
 */
export const concertsPack: CollectionPack = {
  id: 'concerts',
  title: 'Concerts',
  description:
    'gigs and festivals: stage photos matched by time with the acts read on line-ups, boards of stage times and ' +
    'setlists',
  tagRoot: 'Concerts',
  sourceLeaf: 'Setlist',
  otherSourceLeaves: ['Line-up'],
  // (no common words: the words of the names point questions typed in the search bar to the pack)
  names: {
    subject: 'stage shot',
    subjects: 'stage shots',
    source: 'setlist',
    sources: 'setlists',
    place: 'venue',
    entry: 'act',
    entries: 'acts',
    visit: 'gig',
    visits: 'gigs',
  },

  prompts: CONCERT_PROMPTS,
  classify: { ...CONCERT_CLASSIFY_RULES, receiptWords: CONCERT_TICKET_WORDS },

  source: { parse: parseConcertSource, prompt: actPrompt, minEntries: 1 },

  place: {
    ...VENUE_NAME_RULES,
    fallbackName: getConcertFallbackName,
    lookup: { filters: VENUE_OSM_FILTERS },
  },

  visits: { options: CONCERT_VISIT_OPTIONS },

  // the acts follow each other in time, not in the order of the sources
  match: { options: { order: 'none' }, offListPrompts: OFF_BILL_PROMPTS, assign: assignConcertPhotos },

  describe: (act, venue) => `${act.trim()} · ${venue.trim()}`,

  book: {
    preset: {
      id: 'concerts',
      name: 'Gig poster',
      description:
        'A gig poster: dark paper and a hot-pink accent like a screen print, bold capitals, a chapter for every act ' +
        'opened by its setlist typeset beside the photo of the sheet, and the stage photos laid out large',
      summary:
        'a gig poster: dark paper, a bright screen-print accent, bold capitals, the setlist of each act typeset ' +
        'beside the photo of the sheet; lays out one chapter per act',
      style: {
        marginMm: 14,
        gutterMm: 4,
        background: '#141218',
        textColor: '#f3ede2',
        fontFamily: 'sans-serif',
        titleSizePt: 32,
        captionSizePt: 10,
        theme: GIG_POSTER_THEME,
        accentColor: '#ff3d7a',
      },
    },
    theme: {
      id: GIG_POSTER_THEME,
      summary:
        'a gig poster: the printed look on dark paper, headings in spaced capitals with the accent, and setlists ' +
        'typeset in bold capitals',
      look: 'printed',
    },
    caption: (act) => act,
    review: { unnamedEntries: false, missingSourcePage: false, check: reviewConcertBook },
    // a chapter per act, titled with it: its stage photos are laid out as any photos, not named one by one
    chapters: 'entry',
    namedEntries: false,
    chapterTitle: getActChapterTitle,
    sourcePage: { layout: SETLIST_LAYOUT, read: formatSetlistPage },
  },

  agent: {
    instructions:
      'Concerts (pack "concerts": subjects are stage photos, sources are setlists, festival line-ups and boards of ' +
      'stage times, places are venues or festivals, entries are acts, visits are gigs): find_visits finds the gigs ' +
      '(a night each) in an album or a date range. match_subjects with the subjectIds and the sourceIds matches the ' +
      'photos with the acts by time: a line-up or a board gives each act its start and stage, a setlist when it was ' +
      'photographed and the order of the bill ("X w/ Y"); at a festival pass the line-ups of the other days too (a ' +
      'stage banner lists the whole week). Photos with match null are acts on no source (a support act, another ' +
      'stage): name them only when you can tell who it is (a banner, the user), otherwise leave them out. Check the ' +
      'unsure ones with view_photos: the stage banners (a sponsor, the stage name) tell the stage. An entry in ' +
      'parentheses, "(setlist: Future Me, Knees Deep …)", is a setlist that names no act: name it from the other ' +
      'setlists of the night or the songs. Read act names as printed but fix what OCR broke ("Cherryglazerr" is ' +
      '"Cherry Glazerr"). The place is the venue or the festival with the date, e.g. "Neumos, 17 Feb 2023" or ' +
      '"Primavera Sound 2019": the venue from a setlist, a ticket or a sign; when its source is fallback, ask the ' +
      'user (lookup_place can search OpenStreetMap near the photos if they agree; it sends the location to a public ' +
      'service and the admin may have disabled it). Then save_entries (each stage photo with its act, setlists ' +
      'with source: true, line-ups and boards with entry "Line-up"), and offer an album of the gig or a gig-poster ' +
      'photo book (stylePreset "concerts"), a chapter per act opened by its setlist.',
  },

  messages: {
    smartSearchDisabled:
      'Smart search is disabled: stage photos cannot be recognized, only setlists, line-ups and tickets by their text',
    ocrDisabled: 'OCR is disabled: setlists and line-ups are recognized by their look only',
    fewEntries: 'No act could be read on this setlist or line-up: look at the image and read it yourself',
    noEntriesRead:
      'No acts could be read on the setlists and line-ups: look at them yourself and pass the acts (with their ' +
      'starts, "Saturday 20:45 · Seat"), or name the stage photos from what you see',
    noSource: 'No setlist or line-up: name the acts from what you see, or ask the user who played',
    placeNeedsName: 'The venue needs a name, with the date: e.g. "Neumos, 17 Feb 2023" or "Primavera Sound 2019"',
  },
};
