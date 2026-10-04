import { GROWTH_TIMELINE_LAYOUTS } from 'src/utils/book/layouts.js';
import { CollectionPack } from 'src/utils/collections/pack.js';
import {
  describePlant,
  getPlantCaption,
  getPlantChapterTitle,
  reviewGardenBook,
} from 'src/utils/collections/packs/garden/book.js';
import {
  GARDEN_CLASSIFY_RULES,
  GARDEN_PROMPTS,
  GARDEN_RECEIPT_WORDS,
  GARDEN_WORDS,
} from 'src/utils/collections/packs/garden/classify.js';
import { parsePlantLabel } from 'src/utils/collections/packs/garden/label.js';
import { PLANT_PROMPTS, assignPlants } from 'src/utils/collections/packs/garden/plants.js';
import { SourceEntry } from 'src/utils/collections/source.js';
import { VisitOptions } from 'src/utils/collections/visits.js';

const DAY_MINUTES = 24 * 60;

/**
 * a garden: its photos over seasons and years, at one place, whatever the gaps between the rounds (a year and more
 * between two harvests), and the tags and packets photographed on a round (a text photographed apart from the plants,
 * months away, is not the garden's)
 */
export const GARDEN_VISIT_OPTIONS: VisitOptions = {
  maxGapMinutes: 2 * 366 * DAY_MINUTES,
  maxSpanMinutes: 30 * 366 * DAY_MINUTES,
  maxDistanceMeters: 300,
  attachMinutes: DAY_MINUTES,
  // a round of the garden is a walk around it; rounds without a location are one garden only with each other
  roundGapMinutes: 3 * 60,
};

/** texts for photos of a garden that are not of one plant */
export const NOT_A_PLANT_PROMPTS = ['a photo of a garden path', 'a photo of a house', 'a photo of garden tools'];

/** the CLIP text of a plant, compared with its photos */
export const plantPrompt = ({ name }: Pick<SourceEntry, 'name' | 'description'>) =>
  `a photo of a ${name.replaceAll(/['‘’]/g, '').slice(0, 160)} plant`;

/** labels and slogans on the signs of gardens and nurseries that don't name the place */
const NOT_A_NAME = /^(?:open|closed|welcome|entrance|exit|private|keep out|plants?|sale|nursery|garden)$/i;

/**
 * Garden: a garden journal. Plants, their flowers, fruit and harvests are the subjects; seed packets and plant tags the
 * sources, read into the variety ("Lettuce 'Anuenue'", see `label.ts`); the place is the garden, and a visit the whole
 * garden over seasons and years. The photos follow the tag they were photographed after, and every plant of a variety
 * is one plant over the years (see `plants.ts`); CLIP tells the growth stage of each photo, which save_entries writes
 * in its description. Photos are tagged `Garden/<Garden>/<Plant variety>`, with `Garden/<Garden>/Tag` or
 * `Garden/<Garden>/Seed packet` on the sources, and books in the Garden journal style have a chapter per plant, with
 * a growth-timeline page of its dated photos and their stages.
 */
export const gardenPack: CollectionPack = {
  id: 'garden',
  title: 'Garden',
  description:
    'a garden journal: the same plants and beds over seasons and years, named from their plant tags and seed ' +
    'packets (the variety), with the growth stage of each photo',
  tagRoot: 'Garden',
  sourceLeaf: 'Tag',
  otherSourceLeaves: ['Seed packet'],
  names: {
    subject: 'plant photo',
    subjects: 'plant photos',
    source: 'plant tag',
    sources: 'plant tags',
    place: 'garden',
    entry: 'plant',
    entries: 'plants',
    visit: 'garden',
    visits: 'gardens',
  },

  prompts: GARDEN_PROMPTS,
  classify: { ...GARDEN_CLASSIFY_RULES, receiptWords: GARDEN_RECEIPT_WORDS },

  // a tag photographed again on another round is the tag of that round too, which the photos after it follow
  source: { parse: parsePlantLabel, prompt: plantPrompt, minEntries: 1, repeats: true },

  place: {
    words: GARDEN_WORDS,
    blocked: NOT_A_NAME,
    // a seed lab's name on a packet is not the garden
    sourceNameNeedsWord: true,
    fallbackName: ({ city }) => (city ? `Garden in ${city}` : 'Garden'),
  },

  visits: { options: GARDEN_VISIT_OPTIONS },

  match: {
    options: { order: 'none' },
    offListPrompts: NOT_A_PLANT_PROMPTS,
    photoPrompts: PLANT_PROMPTS,
    assign: assignPlants,
  },

  describe: (plant, _garden, photo) => describePlant(plant, photo),

  book: {
    preset: {
      id: 'garden',
      name: 'Garden journal',
      description:
        'A garden journal: herbarium paper, leaf green and ink, a chapter per plant with a growth-timeline page of ' +
        'its dated photos in order, each with its stage (flowering, young fruit, fruit, end of fruiting)',
      summary:
        'a garden journal: herbarium paper, leaf green, a chapter per plant and a growth timeline of its dated ' +
        'photos with their stages; lays out one chapter per plant',
      style: {
        marginMm: 15,
        gutterMm: 5,
        background: '#f3f1e7',
        textColor: '#253222',
        fontFamily: 'FreeSerif, serif',
        titleSizePt: 28,
        captionSizePt: 10.5,
        theme: 'garden',
        accentColor: '#4f7a3a',
      },
    },
    theme: {
      id: 'garden',
      summary:
        'a garden journal: small-caps headings, thin rules, and growth timelines with a dot, a date and a stage for ' +
        'each photo of a plant',
      look: 'printed',
    },
    caption: (plant, _garden, context) => getPlantCaption(plant, context),
    review: { unnamedEntries: true, missingSourcePage: false, check: reviewGardenBook },
    // a chapter per plant, over the years; its tag opens it
    chapters: 'entry',
    chapterTitle: getPlantChapterTitle,
    entryLayouts: [...GROWTH_TIMELINE_LAYOUTS],
  },

  agent: {
    instructions:
      'Garden (pack "garden": subjects are photos of plants, their flowers, fruit and harvests; sources are plant ' +
      'tags and seed packets; the place is the garden; entries are plant varieties; a visit is the whole garden ' +
      'over seasons and years): find_visits finds the garden (do not pass maxGapMinutes); match_subjects with all ' +
      'the subjectIds and sourceIds reads the packets and tags ("Lettuce \'Anuenue\'"), puts each plant photo with ' +
      'the tag it was photographed after (the tag is shot at the foot of its plant), and joins the photos of a ' +
      'variety over the years. Embossed metal tags read nothing: look at them (view_photos) and call match_subjects ' +
      'again with entries, one per sourceId in the same order (the variety on each tag, e.g. "Peach \'Tropic ' +
      'Prince\'"). Plants without a tag that day come back unnamed, with suggestions CLIP cannot be sure of (fruit ' +
      'trees of one kind look alike): check them on the photos and with the user; when the photographer was unsure ' +
      'too, say so. Then save_entries with place = the garden and entry = the variety for every plant photo, and ' +
      'entry "Tag" or "Seed packet" for the sources (the descriptions get the growth stage CLIP sees), and offer a ' +
      'Garden journal book (stylePreset "garden") with a growth timeline per plant.',
  },

  messages: {
    smartSearchDisabled: 'Smart search is disabled: plants cannot be recognized, only seed packets by their text',
    ocrDisabled: 'OCR is disabled: tags and packets cannot be read; look at them and pass the varieties yourself',
    fewEntries:
      'The tag or packet could not be read (embossed metal tags read nothing): look at it and pass the varieties as ' +
      'entries, one per source photo in the order of the sourceIds',
    noEntriesRead:
      'No variety could be read on the tags and packets: look at them yourself and pass the varieties as entries, ' +
      'one per source photo in the order of the sourceIds',
    noSource: 'No tag or seed packet: name the plants from what you see, with the user',
    cannotMatch: 'Smart search is disabled: the plants follow their tags by time only',
    placeNeedsName: 'The garden needs a name, e.g. "Hawea Pl garden"',
    noLocation: 'The photos have no location: ask the user for the name of the garden',
  },
};
