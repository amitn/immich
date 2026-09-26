import { OcrBoxInput, groupLines, toTextBoxes } from 'src/utils/collections/ocr.js';
import { CollectionPack, getDefaultFallbackName } from 'src/utils/collections/pack.js';
import { ParsedSource } from 'src/utils/collections/source.js';
import { DEFAULT_VISIT_OPTIONS } from 'src/utils/collections/visits.js';

/**
 * A test-only pack that proves a second pack plugs into the engine without touching food: walks in botanical gardens,
 * where photos of plants (subjects) are matched with the names on the label boards (the source) of a garden (the
 * place), and tagged `Labels/<Garden>/<Plant>` and `Labels/<Garden>/Board`. Inventory numbers are hidden.
 */

/** every line of a label board with letters is a plant name, top to bottom */
export const parseLabelBoard = (ocr: OcrBoxInput[]): ParsedSource => {
  const lines = groupLines(toTextBoxes(ocr)).filter((line) => /\p{L}{3}/u.test(line.text));
  return {
    items: lines.map((line) => ({
      name: line.text,
      column: 0,
      box: [line.left, line.top, line.right, line.bottom],
    })),
    sections: [],
    columns: lines.length > 0 ? 1 : 0,
    lines: lines.length,
  };
};

/** inventory numbers of the garden, e.g. "Inv. 19870412" */
export const redactInventoryNumbers = (text: string) => text.replaceAll(/\d{5,}/g, '•••');

export const labelsPack: CollectionPack = {
  id: 'labels',
  title: 'Labels',
  description: 'botanical garden walks: photos of plants, matched with the names on the label boards',
  tagRoot: 'Labels',
  sourceLeaf: 'Board',
  names: {
    subject: 'plant',
    subjects: 'plants',
    source: 'label board',
    sources: 'label boards',
    place: 'garden',
    entry: 'plant name',
    entries: 'plant names',
    visit: 'garden walk',
    visits: 'garden walks',
  },

  prompts: {
    subject: ['a photo of a plant', 'a photo of a flower'],
    source: ['a photo of a label board with the names of plants'],
    sign: ['a photo of the gate of a botanical garden'],
    receipt: [],
    other: ['a photo of people', 'a photo of a street'],
  },
  classify: { thresholds: { subject: 0.5, source: 0.5, sign: 0.55, receipt: 0.55 } },

  source: { parse: parseLabelBoard, prompt: ({ name }) => `a photo of the plant ${name}` },

  place: {
    words: /(?<!\p{L})(?:garden|gardens|giardino|jardin|arboretum)(?!\p{L})/iu,
    blocked: /^(?:exit|entrance|no entry)$/i,
    fallbackName: getDefaultFallbackName({ visit: 'garden walk' }),
  },

  visits: { options: { ...DEFAULT_VISIT_OPTIONS, maxGapMinutes: 60 } },

  match: { options: { order: 'none' }, offListPrompts: ['a photo of a leaf', 'a photo of a garden path'] },

  describe: (plant, garden) => `${plant.trim()}, ${garden.trim()}`,

  book: {
    preset: {
      id: 'labels',
      name: 'Labels',
      description: 'A herbarium: white paper and the name of every plant below its photo',
      summary: 'a herbarium: plant names below the photos',
      style: {
        marginMm: 15,
        gutterMm: 5,
        background: '#ffffff',
        textColor: '#1f2a1f',
        fontFamily: 'serif',
        titleSizePt: 28,
        captionSizePt: 10,
        theme: 'plain',
        accentColor: '#1f2a1f',
      },
    },
    caption: (plant) => plant,
    review: { unnamedEntries: true, missingSourcePage: false },
  },

  agent: {
    instructions:
      'Labels (pack "labels"): find_visits finds the garden walks, match_subjects matches the plants with the ' +
      'names on the label boards, and save_entries saves them.',
  },

  privacy: { redact: redactInventoryNumbers },
};
