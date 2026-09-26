import { TASTING_LAYOUTS } from 'src/utils/book/layouts.js';
import { CollectionPack, getDefaultFallbackName } from 'src/utils/collections/pack.js';
import { assignBottles } from 'src/utils/collections/packs/wine/bottles.js';
import { getWineCaption, reviewWineBook } from 'src/utils/collections/packs/wine/book.js';
import {
  WINERY_WORDS,
  WINE_CLASSIFY_RULES,
  WINE_PROMPTS,
  WINE_RECEIPT_WORDS,
} from 'src/utils/collections/packs/wine/classify.js';
import { findTerms, parseWine } from 'src/utils/collections/packs/wine/label.js';
import { normalizeWords } from 'src/utils/collections/packs/wine/lexicon.js';
import { SourceEntry } from 'src/utils/collections/source.js';
import { DEFAULT_VISIT_OPTIONS } from 'src/utils/collections/visits.js';

/** texts for photos of a tasting that are not of one wine: the table, a glass alone, water, a cocktail */
export const OFF_LIST_PROMPTS = [
  'a photo of a glass of water',
  'a photo of a cocktail',
  'a photo of a cup of coffee',
  'a photo of a table set for dinner',
];

/** the CLIP text of a line of a wine list, compared with the bottle photos */
export const winePrompt = ({ name, description }: Pick<SourceEntry, 'name' | 'description'>) => {
  const text = description ? `${name}, ${description}` : name;
  return `a photo of a bottle of wine: ${text.length > 160 ? text.slice(0, 160) : text}`;
};

/** labels, slogans and small print on the signs of wineries that don't name the place */
const NOT_A_NAME =
  /^(?:open|opened|closed|welcome|willkommen|bienvenue|entrance|eingang|exit|ausgang|tasting|weinprobe|verkauf|sale|wine|wein|vin|vino|since \d{4}|seit \d{4}|est\.? \d{4}|visa|mastercard)$/i;

/** a line that only names a grape, a style or a region is a line of a label, never the name of the place */
const isWineWordsOnly = (text: string) => {
  const words = normalizeWords(text).split(' ').filter(Boolean);
  const terms = findTerms(words);
  const covered = terms.reduce((sum, { start, end }) => sum + end - start, 0);
  return words.length > 0 && covered === words.length && terms.every(({ entry }) => entry.kind !== 'prefix');
};

/**
 * Wine: a wine and drinks journal. The bottles (their labels), glasses and pours are the subjects, and each label is
 * its own source: it is read into the producer, the wine, the vintage, the region and the grape, and the photos of one
 * bottle are grouped (see `bottles.ts`). A wine list, a tasting sheet or the pairing of a menu, when one was
 * photographed, is the source the bottles are matched with. The place is the tasting: a winery, a wine bar, a dinner
 * (the restaurant of a Food meal at the same time, whose name the tasting takes). Photos are tagged
 * `Wine/<Tasting>/<Producer · Wine · Vintage>` (what is unknown is left out: `Wine/Noma Australia/Snakebite`) and
 * `Wine/<Tasting>/Wine list`, and books in the Cellar notes style have a chapter per tasting with a tasting-note page
 * per bottle: its photo, its fiche and the note written in its description.
 */
export const winePack: CollectionPack = {
  id: 'wine',
  title: 'Wine',
  description:
    'a wine and drinks journal: photos of bottles, glasses and pours at tastings, winery visits and dinners, named ' +
    'from their labels (producer, wine, vintage) or the wine list',
  tagRoot: 'Wine',
  sourceLeaf: 'Wine list',
  names: {
    subject: 'bottle',
    subjects: 'bottles',
    source: 'wine list',
    sources: 'wine lists',
    place: 'tasting',
    entry: 'wine',
    entries: 'wines',
    visit: 'tasting',
    visits: 'tastings',
  },

  prompts: WINE_PROMPTS,
  classify: { ...WINE_CLASSIFY_RULES, receiptWords: WINE_RECEIPT_WORDS },

  // a label is one wine; a list is read like a menu
  source: { parse: parseWine, prompt: winePrompt, minEntries: 1, onSubjects: true },

  place: {
    words: WINERY_WORDS,
    blocked: NOT_A_NAME,
    // "MAX FERD.RICHTER" is Max Ferd. Richter
    cleanLine: (text) => text.replaceAll(/(\p{L})\.(\p{L}{2,})/gu, '$1. $2').trim(),
    isNotName: isWineWordsOnly,
    title: (ocr) => parseWine(ocr).title,
    fallbackName: getDefaultFallbackName({ visit: 'tasting' }),
    lookup: {
      filters: [
        { key: 'craft', values: ['winery', 'brewery'] },
        { key: 'shop', values: ['wine'] },
        { key: 'amenity', values: ['bar', 'pub', 'restaurant', 'biergarten'] },
      ],
    },
    // drinks at a restaurant are part of the meal the Food pack named
    linkedPacks: ['food'],
  },

  // a tasting is slow: a glass every twenty minutes over a long lunch, a winery visit from the tasting room to the
  // cellar; see `benchmark.spec.ts`
  visits: {
    options: { ...DEFAULT_VISIT_OPTIONS, maxGapMinutes: 60, maxSpanMinutes: 480, maxDistanceMeters: 300 },
  },

  // the bottles name themselves by their labels; the order of a list says nothing of the order they are poured in
  match: { options: { order: 'none' }, offListPrompts: OFF_LIST_PROMPTS, assign: assignBottles },

  describe: (wine) => wine.trim(),

  book: {
    preset: {
      id: 'wine',
      name: 'Cellar notes',
      description:
        'A tasting notebook: cream paper, deep burgundy and ink, small-caps headings, a chapter per tasting and a ' +
        'tasting-note page per bottle with its fiche (producer, wine, vintage, region, grape) and your note',
      summary:
        'a tasting notebook: cream paper, burgundy ink, a tasting-note page per bottle with its fiche and the note ' +
        'from its description; lays out one chapter per tasting',
      style: {
        marginMm: 17,
        gutterMm: 5,
        background: '#f5eee1',
        textColor: '#2b1f22',
        fontFamily: 'FreeSerif, serif',
        titleSizePt: 30,
        captionSizePt: 10.5,
        theme: 'wine',
        accentColor: '#6d1a2c',
      },
    },
    theme: {
      id: 'wine',
      summary:
        'a tasting notebook: small-caps headings, thin rules, and a typeset fiche beside each bottle with room for the ' +
        'tasting note',
      look: 'printed',
    },
    caption: (wine, _tasting, context) => getWineCaption(wine, context),
    review: { unnamedEntries: true, missingSourcePage: false, check: reviewWineBook },
    entryLayouts: [...TASTING_LAYOUTS],
    // a tasting is a day at one place: the aperitif and the last glass of a long dinner are one chapter
    visitGapHours: 8,
  },

  agent: {
    instructions:
      'Wine (pack "wine": subjects are bottles, glasses and pours, each label is its own source, a wine list or ' +
      'tasting sheet is the source when there is one, places are tastings: a winery, a wine bar, a dinner): ' +
      'find_visits finds the tastings (a place named by a Food meal at the same time comes as source tag: keep that ' +
      'restaurant name, so the food book shows the wines with the meal); match_subjects with all the subjectIds (and ' +
      'the sourceIds of a list) reads every label at full resolution, groups the photos of one bottle and names it ' +
      '"Producer · Wine · Vintage" (unknown parts left out), with a contact sheet of the label crops. OCR reads labels ' +
      'in fragments: your eyes are the main reader, so check every unsure bottle (read_source on it gives a zoomed crop ' +
      'of its label, view_photos the photo) and correct the names as printed (e.g. "Willi Haag · Brauneberger Juffer ' +
      'Riesling Spätlese · 2009"). Then save_entries with place = the tasting and entry = the name for every bottle ' +
      'photo (the list with source: true), and offer a Cellar notes book (stylePreset "wine").',
  },

  messages: {
    smartSearchDisabled:
      'Smart search is disabled: bottles cannot be recognized, only wine lists and labels by their text',
    ocrDisabled: 'OCR is disabled: labels cannot be read; look at the bottles and name them yourself',
    fewEntries: 'Little of the label could be read: look at the zoomed crop of the label and read it yourself',
    noEntriesRead: 'No wine could be read on the list: look at it yourself and pass its wines as entries',
    noSource: 'No label could be read: look at the bottles and name them yourself',
    cannotMatch: 'Smart search is disabled: the bottles are named from their labels only',
  },
};
