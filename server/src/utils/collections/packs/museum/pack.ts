import { ClassifyRules, CollectionPrompts, OcrSummary, scoreText } from 'src/utils/collections/classify.js';
import { MatchOptions } from 'src/utils/collections/match.js';
import { CollectionPack, getDefaultFallbackName } from 'src/utils/collections/pack.js';
import { captionArtwork, describeArtwork, getArtworkPrompt } from 'src/utils/collections/packs/museum/artwork.js';
import { GALLERY_THEME, reviewMuseumBook } from 'src/utils/collections/packs/museum/book.js';
import { parseWallLabel } from 'src/utils/collections/packs/museum/label.js';
import { MUSEUM_NAME_RULES, MUSEUM_OSM_FILTERS } from 'src/utils/collections/packs/museum/museum.js';
import { assignArtworks } from 'src/utils/collections/packs/museum/pairing.js';
import { DEFAULT_VISIT_OPTIONS, VisitOptions } from 'src/utils/collections/visits.js';

/**
 * CLIP text prompts per kind: artworks are the subjects, wall labels the source, museum entrances and name plates the
 * signs, tickets the receipts. The "other" prompts give CLIP something else to prefer for the people and places that
 * fill the rest of a library (and the halls of the museum itself).
 */
export const MUSEUM_PROMPTS: CollectionPrompts = {
  subject: [
    'a photo of a painting in a museum',
    'a photo of a framed painting on a wall',
    'a photo of an old religious painting',
    'a photo of a portrait painting',
    'a photo of a sculpture in a museum',
    'a photo of a marble statue',
    'a photo of an ancient stone sculpture',
    'a photo of a stone relief carving',
    'a photo of a bronze statue',
    'a photo of a porcelain plate in a museum',
    'a photo of a painted ceramic tile panel',
    'a photo of a small enamel triptych',
    'a photo of an antique table in a museum',
    'a close-up photo of a detail of a painting',
  ],
  source: [
    'a photo of a museum wall label with text',
    'a photo of a small printed card with the title of an artwork',
    'a photo of a museum placard with text',
    'a photo of a metal plaque with an inscription',
    'a photo of a text panel in a museum',
    'a photo of a page of text',
  ],
  sign: [
    'a photo of the entrance of a museum',
    'a photo of the facade of a museum',
    'a photo of the sign of a museum',
    'a photo of the name plate of a gallery',
  ],
  receipt: ['a photo of a museum ticket', 'a photo of an admission ticket'],
  other: [
    'a photo of people',
    'a selfie',
    'a photo of a landscape',
    'a photo of a city street',
    'a photo of a room with visitors',
    'a photo of a hall with columns',
    'a photo of food',
    'a photo of an animal',
    'a screenshot',
    'a photo of a car',
  ],
};

/** words of tickets */
export const TICKET_WORDS =
  /\b(?:ticket|tickets|billet|billete|bilhete|biglietto|eintritt|eintrittskarte|admission|entrada|entrée|ingresso|adult|adulte|adulto|erwachsene|tarif|tariffa|price|prix|preço|prezzo|total|vat|tva|iva|mwst|valid|valable|válido|valido)\b/gi;

/**
 * The text of a wall label: an artwork read on it (an artist, a date, a medium or an inventory number beside a title)
 * makes a source, whatever the prices say; a few large words with "Museum" a sign.
 */
export const scoreMuseumText = (summary: OcrSummary) => {
  const scores = scoreText(summary);
  const label = summary.items > 0 && summary.lines >= 2 ? Math.min(1, 0.45 + 0.05 * Math.min(summary.lines, 7)) : 0;
  return { ...scores, source: Math.max(scores.source, label) };
};

/** a kind needs at least this score */
export const MUSEUM_CLASSIFY_RULES: ClassifyRules = {
  thresholds: { subject: 0.5, source: 0.5, sign: 0.55, receipt: 0.6 },
  scoreText: scoreMuseumText,
};

/** calibrated on real visits, see `benchmark.spec.ts` */
export const MUSEUM_MATCH_OPTIONS: Partial<MatchOptions> = {
  // an exhibition has no order that the photos follow, only the sequence of labels and artworks
  order: 'none',
  sharePenalty: Math.log(4),
  sequence: { step: 2.5, before: 0.7, time: 2, seconds: 30, off: 2.5 },
};

/** a visit to a museum can last a morning, with a long pause (a café, a floor of other rooms) */
export const MUSEUM_VISIT_OPTIONS: VisitOptions = {
  ...DEFAULT_VISIT_OPTIONS,
  maxGapMinutes: 75,
  maxSpanMinutes: 360,
  maxDistanceMeters: 300,
  attachMinutes: 120,
};

/** texts for artworks that no label names; the best of them competes with the labels as "no label" */
export const NO_LABEL_PROMPTS = [
  'a photo of an artwork in a museum',
  'a photo of a painting',
  'a photo of a sculpture',
  'a photo of a museum gallery',
  'a photo of objects in a display case',
];

/**
 * Museum & gallery visits: artworks are the subjects, the wall label beside each one is the source, the museum is the
 * place and the artworks named on the labels are the entries. Each artwork is paired with its label by the sequence of
 * the photos (a label is photographed a few seconds after, or before, its artwork) and by what CLIP sees. Photos are
 * tagged `Art/<Museum>/<Title — Artist, Date, Medium>` and the labels `Art/<Museum>/Label`, and books in the Gallery
 * style read like an exhibition catalogue: a chapter per visit, the artworks whole on white pages, captioned and
 * numbered like the works of the catalogue; the labels themselves stay out of the book.
 */
export const museumPack: CollectionPack = {
  id: 'museum',
  title: 'Museum',
  description:
    'museum and gallery visits: photos of artworks (paintings, sculptures, objects), each paired with the wall label ' +
    'photographed next to it',
  tagRoot: 'Art',
  sourceLeaf: 'Label',
  names: {
    subject: 'artwork',
    subjects: 'artworks',
    source: 'wall label',
    sources: 'wall labels',
    place: 'museum',
    entry: 'label entry',
    entries: 'label entries',
    visit: 'museum visit',
    visits: 'museum visits',
  },

  prompts: MUSEUM_PROMPTS,
  classify: { ...MUSEUM_CLASSIFY_RULES, receiptWords: TICKET_WORDS },

  source: { parse: parseWallLabel, prompt: getArtworkPrompt, minEntries: 1 },

  place: {
    ...MUSEUM_NAME_RULES,
    fallbackName: getDefaultFallbackName({ visit: 'museum visit' }),
    lookup: { filters: MUSEUM_OSM_FILTERS },
  },

  visits: { options: MUSEUM_VISIT_OPTIONS },

  match: {
    options: MUSEUM_MATCH_OPTIONS,
    offListPrompts: NO_LABEL_PROMPTS,
    assign: assignArtworks,
    reportUnmatched: true,
  },

  describe: (entry, museum) => describeArtwork(entry, museum),

  book: {
    preset: {
      id: 'museum',
      name: 'Gallery',
      description:
        'An exhibition catalogue: white gallery walls and generous space, every artwork shown whole (never cropped) ' +
        'with a museum-label caption and its catalogue number, and a chapter per museum visit',
      summary:
        'an exhibition catalogue: white pages, artworks shown whole with museum-label captions and catalogue ' +
        'numbers; lays out one chapter per museum visit',
      style: {
        marginMm: 20,
        gutterMm: 10,
        background: '#fbfaf7',
        textColor: '#1d1d1b',
        fontFamily: 'sans-serif',
        titleSizePt: 26,
        captionSizePt: 8.5,
        theme: GALLERY_THEME,
        accentColor: '#8a8580',
      },
    },
    theme: {
      id: GALLERY_THEME,
      summary:
        'an exhibition catalogue: photos shown whole on white, never cropped, with museum-label captions (the title ' +
        'in italics, then the artist, the date and the medium) and catalogue numbers',
      look: 'gallery',
    },
    caption: (entry) => captionArtwork(entry),
    // the captions of the artworks say what their wall labels say
    sourcePage: false,
    numbered: true,
    review: { unnamedEntries: true, missingSourcePage: false, check: reviewMuseumBook },
  },

  agent: {
    instructions:
      'Museum (pack "museum": subjects are artworks, the source is the wall label beside each one, places are ' +
      'museums, visits are museum visits): find_visits finds the museum visits (artworks, labels, museum signs, ' +
      'tickets) in an album, a date range or photos. For each visit: match_subjects with the subjectIds and the ' +
      'sourceIds (the label photos; the engine reads every label and pairs each artwork with the label photographed ' +
      'next to it, before or after), then check every suggestion with view_photos: a detail shot shares the label of ' +
      'its artwork, one label can cover a whole case (pick the object, e.g. "B"), and an artwork without a label gets ' +
      'a short name from what you see ("Bust of a woman"); read_source a label whose entry looks wrong (look at the ' +
      'image too) and fix the names when saving. The museum name comes from the tags, a sign, a label or a ticket; ' +
      'when its source is fallback, ask the user for the name (if they agree, lookup_place can search OpenStreetMap ' +
      'near the photos, but it sends the location to a public service and the admin may have disabled it). Then save ' +
      'with save_entries (entries as "Title — Artist, Date, Medium", as the engine writes them; label photos with ' +
      'source: true; leave out the halls, signs and tickets), and offer an album of the visit or a gallery photo book ' +
      '(stylePreset "museum").',
  },

  messages: {
    smartSearchDisabled:
      'Smart search is disabled: artworks cannot be recognized, only wall labels, signs and tickets by their text',
    ocrDisabled: 'OCR is disabled: wall labels, signs and tickets are recognized by their look only',
    fewEntries: 'No artwork could be read on this label: look at the label image and read it yourself',
  },
};
