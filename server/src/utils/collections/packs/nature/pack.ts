import { ClassifyRules, CollectionPrompts, OcrSummary, scoreText } from 'src/utils/collections/classify.js';
import { MatchOptions, SubjectAssigner, SubjectMatch, matchSubjects } from 'src/utils/collections/match.js';
import { CollectionPack, getDefaultFallbackName } from 'src/utils/collections/pack.js';
import {
  FIELD_GUIDE_THEME,
  captionSpecies,
  describeSpecies,
  reviewFieldGuide,
} from 'src/utils/collections/packs/nature/book.js';
import { GARDEN_NAME_RULES, GARDEN_OSM_FILTERS } from 'src/utils/collections/packs/nature/garden.js';
import { parsePlantLabel, parseTaxon } from 'src/utils/collections/packs/nature/label.js';
import { SourceEntry } from 'src/utils/collections/source.js';
import { DEFAULT_VISIT_OPTIONS, VisitOptions } from 'src/utils/collections/visits.js';

/**
 * CLIP text prompts per kind: plants and animals are the subjects, their labels and plaques the source, the gates of
 * a garden or a zoo the signs, tickets the receipts. The "other" prompts give CLIP something else to prefer for the
 * people, paths and buildings of the visit.
 */
export const NATURE_PROMPTS: CollectionPrompts = {
  subject: [
    'a photo of a flowering plant',
    'a close-up photo of a flower',
    'a photo of a rose bush in bloom',
    'a photo of a tree in a botanical garden',
    'a photo of the leaves of a plant',
    'a photo of fruit on a tree',
    'a photo of the bark of a tree trunk',
    'a photo of seedlings on the ground',
    'a photo of a palm tree',
    'a photo of an animal in a zoo',
    'a photo of a bird',
  ],
  source: [
    'a photo of a plant label',
    'a photo of a metal tag with engraved text',
    'a photo of a small label with the name of a plant',
    'a photo of a handwritten label on a stake in a flower bed',
    'a photo of a zoo sign with the name of an animal',
    'a photo of an information plaque about a species',
  ],
  sign: [
    'a photo of the entrance of a botanical garden',
    'a photo of the sign of a zoo',
    'a photo of the sign of a park',
  ],
  receipt: ['a photo of an admission ticket'],
  other: [
    'a photo of people',
    'a selfie',
    'a photo of a garden path',
    'a photo of a building',
    'a photo of a city street',
    'a photo of food',
    'a screenshot',
    'a photo of a car',
  ],
};

/** words of tickets */
export const NATURE_TICKET_WORDS = /\b(?:ticket|tickets|admission|adult|child|concession|entry|price|total|valid)\b/gi;

/** the text of a label: a species or a cultivar read on it makes a source, however little text it has */
export const scoreNatureText = (summary: OcrSummary) => {
  const scores = scoreText(summary);
  const label = summary.items > 0 ? Math.min(1, 0.5 + 0.05 * Math.min(summary.lines, 6)) : 0;
  return { ...scores, source: Math.max(scores.source, label) };
};

/** a kind needs at least this score */
export const NATURE_CLASSIFY_RULES: ClassifyRules = {
  thresholds: { subject: 0.5, source: 0.5, sign: 0.55, receipt: 0.6 },
  scoreText: scoreNatureText,
};

/** calibrated on real garden visits, see `benchmark.spec.ts`: a label is photographed seconds before or after its plant */
export const NATURE_MATCH_OPTIONS: Partial<MatchOptions> = {
  // a walk has no order that the photos follow, only the sequence of labels and plants
  order: 'none',
  // a plant is photographed several times (its habit, flowers, fruit, bark) beside its label
  sharePenalty: Math.log(2),
  // CLIP knows few species by name: the generic texts of plants stay off the list only when clearly better
  offListBias: -0.02,
  sequence: { step: 0.5, before: 0.7, time: 2, seconds: 60, off: 2 },
};

/** a walk through a garden or a zoo can take a morning, with pauses */
export const NATURE_VISIT_OPTIONS: VisitOptions = {
  ...DEFAULT_VISIT_OPTIONS,
  maxGapMinutes: 60,
  maxSpanMinutes: 360,
  maxDistanceMeters: 1500,
  attachMinutes: 120,
};

/** texts for plants and animals that no label names; the best of them competes with the labels as "no label" */
export const NO_LABEL_PROMPTS = [
  'a photo of a plant',
  'a photo of flowers in a garden border',
  'a photo of a tree',
  'a photo of leaves',
  'a photo of an animal',
];

/** the CLIP text of a species: its common name and its scientific name, "a photo of a rose, Pride and Prejudice" */
export const speciesPrompt = ({ name, description }: Pick<SourceEntry, 'name' | 'description'>) => {
  const { common, scientific } = parseTaxon(name);
  const rose = scientific === 'Rosa';
  const kind = description?.split(' · ', 1)[0];
  const text = rose
    ? `a photo of a ${kind && /floribunda|hybrid tea|climber|rambler|shrub/i.test(kind) ? `${kind} ` : ''}rose${common && /'/.test(common) ? `, ${common.replace(/^Rose\s+/, '')}` : ''}`
    : `a photo of ${[common, scientific].filter(Boolean).join(', ')}`;
  return text.length > 200 ? text.slice(0, 200) : text;
};

/**
 * The nature pack's assignment of the plants and animals to the species of the labels: what CLIP sees of each photo
 * and each species, weighed by the sequence of the photos (a label is photographed seconds before or after its plant,
 * and a species labelled on two trees is an entry of each label), see `MatchOptions.sequence`. Photos that smart
 * search has not seen yet are left for the reader to name.
 */
export const assignSpecies: SubjectAssigner = (photos, entries, options) => {
  const seen = photos.filter((photo) => photo.embedding.length > 0);
  const candidates = entries.every((entry) => entry.embedding)
    ? entries.map(({ embedding, sourceTime }) => ({
        embedding: embedding!,
        ...(sourceTime !== undefined && { sourceTime }),
      }))
    : [];
  const result = matchSubjects(seen, candidates, options);
  const unseen: SubjectMatch[] = photos
    .filter((photo) => photo.embedding.length === 0)
    .map((photo) => ({ ids: [photo.id], score: 0, unsure: true, suggestions: [] }));
  return { ...result, matches: [...result.matches, ...unseen] };
};

/**
 * Nature field guide: botanical gardens, arboretums and zoos. Plants and animals are the subjects, the labels beside
 * them (engraved accession tags, zoo plaques, chalk labels of cultivars) the source, the garden or the zoo the place,
 * and the species or cultivars the entries. Each photo is paired with the label photographed next to it and by what
 * CLIP sees; photos of a plant without a label stay off the list. Photos are tagged `Nature/<Garden or zoo>/<Common
 * name (Scientific name, Family)>`, the labels `Nature/<Garden or zoo>/Label`, and books in the Field guide style lay
 * out numbered plates on cream paper, captioned with the scientific name in italics, the common name and the family.
 */
export const naturePack: CollectionPack = {
  id: 'nature',
  title: 'Nature',
  description:
    'botanical gardens, arboretums and zoos: photos of plants and animals, each paired with the label or plaque ' +
    'photographed next to it (common and scientific names, family)',
  tagRoot: 'Nature',
  sourceLeaf: 'Label',
  // (no common words: the words of the names point questions typed in the search bar to the pack)
  names: {
    subject: 'specimen',
    subjects: 'specimens',
    source: 'plant label',
    sources: 'plant labels',
    place: 'garden',
    entry: 'species',
    entries: 'species',
    visit: 'garden walk',
    visits: 'garden walks',
  },

  prompts: NATURE_PROMPTS,
  classify: { ...NATURE_CLASSIFY_RULES, receiptWords: NATURE_TICKET_WORDS },

  source: { parse: parsePlantLabel, prompt: speciesPrompt, minEntries: 1, repeats: true },

  place: {
    ...GARDEN_NAME_RULES,
    fallbackName: getDefaultFallbackName({ visit: 'garden walk' }),
    lookup: { filters: GARDEN_OSM_FILTERS },
  },

  visits: { options: NATURE_VISIT_OPTIONS },

  match: {
    options: NATURE_MATCH_OPTIONS,
    offListPrompts: NO_LABEL_PROMPTS,
    assign: assignSpecies,
    reportUnmatched: true,
  },

  describe: describeSpecies,

  book: {
    preset: {
      id: 'nature',
      name: 'Field guide',
      description:
        "A naturalist's field guide: cream paper and fine sepia ink, each plant or animal shown whole as a numbered " +
        'plate, captioned with its scientific name in italics, its common name and its family, a chapter per walk',
      summary:
        'a field guide: cream paper, fine ink, numbered plates shown whole with the scientific name in italics, the ' +
        'common name and the family; lays out one chapter per garden or zoo visit',
      style: {
        marginMm: 18,
        gutterMm: 8,
        background: '#f3ecd8',
        textColor: '#2e2a22',
        fontFamily: 'FreeSerif, serif',
        titleSizePt: 26,
        captionSizePt: 10,
        theme: FIELD_GUIDE_THEME,
        accentColor: '#6b6a3a',
      },
    },
    theme: {
      id: FIELD_GUIDE_THEME,
      summary:
        'a field guide: plates shown whole on cream paper, never cropped, numbered, with the scientific name in ' +
        'italics, then the common name and the family',
      look: 'gallery',
    },
    caption: (entry) => captionSpecies(entry),
    // the captions of the plates say what their labels say
    sourcePage: false,
    numbered: true,
    review: { unnamedEntries: true, missingSourcePage: false, check: reviewFieldGuide },
  },

  agent: {
    instructions:
      'Nature (pack "nature": subjects are photos of plants and animals, the source is the label or plaque beside ' +
      'each one, places are gardens, arboretums and zoos, entries are species or cultivars, visits are garden walks): ' +
      'find_visits finds the walks in an album or a date range. For each: match_subjects with the subjectIds and the ' +
      'sourceIds (the label photos; the engine reads every label and pairs each photo with the label photographed ' +
      'next to it, before or after; a species labelled on two trees is an entry of each label), then check the ' +
      'suggestions with view_photos: several photos of one plant (its habit, flowers, fruit, bark) share its label, ' +
      'and a plant without a label stays off the list unless you or the user know it. Labels in handwriting are read ' +
      'as they are ("Lady Madmalade", "Hotchocolate"): correct the obvious OCR errors when saving. The garden comes ' +
      'from a sign, the code on the accession tags or the tags; when its source is fallback, ask the user (if they ' +
      'agree, lookup_place can search OpenStreetMap near the photos; it sends the location to a public service and ' +
      'the admin may have disabled it). Then save_entries with entries as "Common name (Genus species, Family)" as ' +
      'the engine writes them ("Rose \'Pride and Prejudice\' (Rosa)"; the scientific name alone when there is no ' +
      'common name), label photos with source: true, and offer an album of the walk or a field-guide photo book ' +
      '(stylePreset "nature").',
  },

  messages: {
    smartSearchDisabled:
      'Smart search is disabled: plants and animals cannot be recognized, only their labels and signs by their text',
    ocrDisabled: 'OCR is disabled: labels and signs are recognized by their look only',
    fewEntries: 'No species could be read on this label: look at the label image and read it yourself',
    noSource: 'No plant label: name the plants and animals from what you see, or leave them unnamed',
    placeNeedsName: 'The garden or zoo needs a name',
  },
};
