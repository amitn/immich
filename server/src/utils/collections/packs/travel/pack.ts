import { TICKET_STUB_LAYOUT } from 'src/utils/book/layouts.js';
import { CollectionPack } from 'src/utils/collections/pack.js';
import { assignTravelPhotos } from 'src/utils/collections/packs/travel/assign.js';
import { getLegChapterTitle, getTicketStubPage, reviewTravelBook } from 'src/utils/collections/packs/travel/book.js';
import { TRAVEL_CLASSIFY_RULES, TRAVEL_PROMPTS } from 'src/utils/collections/packs/travel/classify.js';
import { formatMonth } from 'src/utils/collections/packs/travel/dates.js';
import { redactTravelText } from 'src/utils/collections/packs/travel/privacy.js';
import { parseTicket } from 'src/utils/collections/packs/travel/ticket.js';
import { SourceEntry } from 'src/utils/collections/source.js';
import { FallbackVisit, VisitOptions } from 'src/utils/collections/visits.js';

/** a trip: photos at most two days apart (a quiet day in the middle), for up to six weeks, anywhere */
export const TRIP_VISIT_OPTIONS: VisitOptions = {
  maxGapMinutes: 2 * 24 * 60,
  maxSpanMinutes: 42 * 24 * 60,
  maxDistanceMeters: 3_000_000,
  attachMinutes: 2 * 24 * 60,
};

/** what CLIP should see on the photos of a leg, by its mode */
const SCENES: Array<[RegExp, string]> = [
  [/^flight\b/i, 'an airport, a boarding gate or an airplane'],
  [/^ferry\b/i, 'a ferry boat, a harbour or the sea'],
  [/^bus\b/i, 'a bus, a bus station or a road'],
  [/^train\b/i, 'a train or a railway station'],
  [/^(?:monorail|metro|tram)\b/i, 'an elevated monorail, a train or a station'],
];

/** "Bus Chania → Sougia, 4 Oct 2016" → "Chania → Sougia" (the places, without the mode and the date) */
const getRoute = (name: string) =>
  name
    .replace(/,\s*\d{1,2} \p{L}{3}(?: \d{4})?$/u, '')
    .replace(/^(?:flight|ferry|bus|train|monorail|metro|tram)(?:\s+[A-Z\d]{2}\d{1,4})?\s*/i, '')
    .trim();

/** the CLIP text of a leg: what its photos may show, and where */
export const legPrompt = ({ name }: Pick<SourceEntry, 'name' | 'description'>) => {
  const scene = SCENES.find(([pattern]) => pattern.test(name))?.[1];
  const route = getRoute(name)
    .replace(/^from\s+/i, '')
    .replaceAll('→', 'to');
  // a leg without a mode is a visit to a sight: a park, a museum, a castle
  const text = scene
    ? `a photo of ${scene}, ${route}`
    : `a photo of ${route}, a sight: its entrance, its landscape or its halls`;
  return text.length > 200 ? text.slice(0, 200) : text;
};

/** texts of trip photos that belong to no leg: a day without documents */
export const OFF_TRIP_PROMPTS = ['a travel photo', 'a photo of a street in a town', 'a photo of a landscape'];

/** "Trip, October 2016", or "Chania, October 2016" when the photos are located */
export const getTripFallbackName = ({ city, day }: FallbackVisit) => {
  const [year, month] = day.split('-').map(Number);
  const when = year && month ? formatMonth(year, month) : day;
  return `${city ?? 'Trip'}, ${when}`;
};

/** the description a trip photo gets: "Bus Chania → Sougia, 4 Oct 2016 · Crete, October 2016" */
export const getTripPhotoDescription = (leg: string, trip: string) => `${leg.trim()} · ${trip.trim()}`;

/**
 * Travel: the legs of a trip. Trip photos are the subjects, travel documents (boarding passes, bus, train, ferry and
 * monorail tickets, entry tickets and fare receipts) the sources, the trip is the place and each document's leg an
 * entry; trips are the visits. Photos are matched to the legs by time (and the words and look they share), tagged
 * `Travel/<Trip>/<Leg>` and `Travel/<Trip>/Tickets`, and books in the Travel style have a chapter per leg, opened by a
 * ticket stub typeset from the fields of the document instead of its photo. Documents carry names and booking
 * references: every text the pack lets out is redacted, and the assistant never sees the documents themselves.
 */
export const travelPack: CollectionPack = {
  id: 'travel',
  title: 'Travel',
  description:
    'trips: the photos of a trip matched by time with the legs read on its travel documents (boarding passes, bus, ' +
    'train, ferry and monorail tickets, entry tickets, fare receipts)',
  tagRoot: 'Travel',
  sourceLeaf: 'Tickets',
  names: {
    subject: 'trip photo',
    subjects: 'trip photos',
    source: 'travel document',
    sources: 'travel documents',
    place: 'trip',
    entry: 'leg',
    entries: 'legs',
    visit: 'trip',
    visits: 'trips',
  },

  prompts: TRAVEL_PROMPTS,
  classify: TRAVEL_CLASSIFY_RULES,

  source: { parse: parseTicket, prompt: legPrompt, minEntries: 1 },

  place: {
    // the name of a trip is never a line of a document: it is made from its places and dates
    words: /(?<![\p{L}])trip(?![\p{L}])/iu,
    blocked: /[\s\S]*/,
    isNotName: () => true,
    fallbackName: getTripFallbackName,
  },

  visits: { options: TRIP_VISIT_OPTIONS },

  // the legs follow each other in time, not in the order of the documents
  match: { options: { order: 'none' }, offListPrompts: OFF_TRIP_PROMPTS, assign: assignTravelPhotos },

  describe: (leg, trip) => getTripPhotoDescription(leg, trip),

  book: {
    preset: {
      id: 'travel',
      name: 'Travel',
      description:
        'A travel journal: passport-blue ink and stamp red on cream paper, small-caps headings, a chapter for every ' +
        'leg opened by its ticket stub, typeset from the redacted fields of the document',
      summary:
        'a travel journal: cream paper, passport-blue ink, stamps and ticket stubs typeset from the legs (never the ' +
        'documents themselves); lays out one chapter per leg of the trip',
      style: {
        marginMm: 16,
        gutterMm: 5,
        background: '#f4efe3',
        textColor: '#1f2f4a',
        fontFamily: 'FreeSerif, serif',
        titleSizePt: 28,
        captionSizePt: 10,
        theme: 'travel',
        accentColor: '#b0412e',
      },
    },
    theme: {
      id: 'travel',
      summary:
        'a travel journal: small-caps headings, thin rules, and ticket stubs with a route line and a date stamp for ' +
        'the legs',
      look: 'printed',
    },
    caption: (leg) => leg,
    review: { unnamedEntries: false, missingSourcePage: false, check: reviewTravelBook },
    // a chapter per leg, titled with the leg: its photos are laid out as any photos, not named one by one
    chapters: 'entry',
    namedEntries: false,
    chapterTitle: getLegChapterTitle,
    sourcePage: { layout: TICKET_STUB_LAYOUT, read: getTicketStubPage },
  },

  agent: {
    instructions:
      'Travel (pack "travel": subjects are trip photos, sources are travel documents such as boarding passes, ' +
      'tickets and fare receipts, the place is the trip, entries are legs, visits are trips): find_visits finds the ' +
      'trips in an album or a date range; read_source reads each document into its leg (mode, carrier, from → to, ' +
      'date, time, seat, class) as redacted text only, never the image: names, booking references and ticket ' +
      'numbers are hidden, so never ask for them or view the documents with view_photos; its warnings say what is ' +
      'missing (a date printed vertically, the year) or ambiguous (a time changed by hand, Greek names read as ' +
      'Latin lookalikes): check these with the user. match_subjects with the subjectIds and all sourceIds assigns ' +
      'the photos to the legs by time (a leg runs from just before its departure until the next leg or the end of ' +
      'its day), and by the places and look they share; photos with match null are days without documents: leave ' +
      'them, or name them "<City> day" when a sign or what you see says where they are. Name the trip from its ' +
      'destinations and month (e.g. "Crete, October 2016"), not from the fallback. Then save_entries with ' +
      'place = the trip, entry = the leg name for each photo, and the documents with source: true, and offer a ' +
      'travel book (stylePreset "travel"), whose ticket stubs are typeset from the redacted legs.',
  },

  messages: {
    fewEntries: 'No leg could be read on this travel document: ask the user what journey it is for',
    noEntriesRead:
      'No legs could be read on the travel documents: ask the user for the legs (mode, from → to, date and time) ' +
      'and pass them as entries',
    noSource: 'No travel documents: name the legs or days of the trip with the user',
    placeNeedsName: 'The trip needs a name, e.g. "Crete, October 2016"',
    noLocation: 'Trips are never looked up: ask the user for the name of the trip',
  },

  privacy: { redact: redactTravelText, sourceImages: false },
};
