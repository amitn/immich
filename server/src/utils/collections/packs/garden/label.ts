import { OcrBoxInput, TextLine, groupLines, toTextBoxes } from 'src/utils/collections/ocr.js';
import { isGarbled, toTitleCase } from 'src/utils/collections/place.js';
import { ParsedSource, SourceEntry } from 'src/utils/collections/source.js';
import { editDistance, stripAccents } from 'src/utils/collections/text.js';

/*
 * Reading a seed packet or a plant tag: the crop ("LETTUCE", "CAULIFLOWER", read as "LOWER" when the tiles cut it) and
 * the variety printed large next to it ("ANUENUE"), as "Lettuce 'Anuenue'". The small print of a packet (the seed
 * lab, its address and phone, the net weight, the year it was packed for) is left out. A tag may name the variety
 * alone ("Tropic Prince"); an embossed metal tag reads nothing at all, and the assistant reads it on the photo.
 */

/** the crops of seed packets and plant tags, in English */
const CROPS = [
  'lettuce',
  'tomato',
  'cauliflower',
  'broccoli',
  'cabbage',
  'kale',
  'carrot',
  'bean',
  'pea',
  'cucumber',
  'zucchini',
  'squash',
  'pumpkin',
  'pepper',
  'chili',
  'eggplant',
  'basil',
  'parsley',
  'cilantro',
  'coriander',
  'dill',
  'mint',
  'onion',
  'garlic',
  'leek',
  'radish',
  'beet',
  'beetroot',
  'spinach',
  'chard',
  'corn',
  'melon',
  'watermelon',
  'strawberry',
  'sunflower',
  'marigold',
  'zinnia',
  'cosmos',
  'nasturtium',
  'poppy',
  'lavender',
  'rose',
  'tulip',
  'dahlia',
  'peach',
  'nectarine',
  'apple',
  'pear',
  'plum',
  'cherry',
  'apricot',
  'fig',
  'lemon',
  'lime',
  'orange',
  'avocado',
  'mango',
  'banana',
  'papaya',
  'grape',
  'blueberry',
  'raspberry',
  'blackberry',
  'potato',
  'okra',
  'arugula',
  'celery',
  'asparagus',
  'artichoke',
  'fennel',
  'turnip',
  'parsnip',
  'bok choy',
  'pak choi',
  'mustard',
];

/** the small print of packets and tags, never a variety */
const NOISE =
  /(?:seed\s?lab|seeds?\b|college|university|universit|agricultur|diagnostic|service|center|centre|program|net\.?\s?wt|packed|weight|road|street|\brm\b|lab\b|hawaii|phone|\bph\b|fax|www|\.com|organic|heirloom|days?\b|sow|plant\s+(?:in|by)|grams?\b|\bg\b|oz\b|lot\b|germination)/iu;

const fold = (text: string) =>
  stripAccents(text)
    .toLowerCase()
    .replaceAll(/[^\p{L}\s]+/gu, ' ')
    .replaceAll(/\s+/g, ' ')
    .trim();

const letters = (text: string) => text.replaceAll(/[^\p{L}]/gu, '').length;

/** the crop a line names, as printed or cut at the edge of the photo ("LOWER" of CAULIFLOWER) */
export const findCrop = (text: string): string | undefined => {
  const key = fold(text);
  const word = key.replaceAll(' ', '');
  for (const crop of CROPS) {
    const target = crop.replaceAll(' ', '');
    if (key === crop || word === target || (target.length >= 6 && editDistance(word, target) <= 1)) {
      return crop;
    }
  }
  // cut at the edge: the end of a long crop name, five letters at least
  if (word.length >= 5 && !key.includes(' ')) {
    return CROPS.find((crop) => crop.length >= 8 && crop.endsWith(word) && word !== crop);
  }
};

/** "'Tropic Prince'", "LETTUCE" → "Lettuce" */
const toName = (text: string) =>
  toTitleCase(
    text
      .replaceAll(/[‘’'"]/g, '')
      .replaceAll(/\s+/g, ' ')
      .trim(),
  );

export type PlantLabel = {
  crop?: string;
  variety?: string;
  /** the variety read clearly, in large print next to the crop */
  sure: boolean;
  box?: [number, number, number, number];
};

/** Reads the crop and the variety of a seed packet or a plant tag; undefined when neither was read */
export const readPlantLabel = (ocr: OcrBoxInput[]): PlantLabel | undefined => {
  const lines = groupLines(toTextBoxes(ocr)).filter((line) => letters(line.text) >= 3);
  if (lines.length === 0) {
    return;
  }
  const cropLine = lines.find((line) => findCrop(line.text));
  const crop = cropLine ? findCrop(cropLine.text) : undefined;
  const candidates = lines.filter(
    (line) =>
      line !== cropLine &&
      !NOISE.test(line.text) &&
      !isGarbled(line.text) &&
      line.text.split(/\s+/).length <= 3 &&
      letters(line.text) >= 0.7 * line.text.replaceAll(/\s/g, '').length,
  );
  // the variety: the largest line, the nearest to the crop when there is one
  const near = (line: TextLine) => (cropLine ? Math.abs(line.top - cropLine.top) : 0);
  const variety = candidates.toSorted((a, b) => b.height - a.height || near(a) - near(b))[0];
  // a variety without a crop (a tag) is only what was read surely: a scratched metal tag reads made-up words
  const score = variety ? Math.min(...variety.boxes.map((box) => box.score)) : 0;
  const large =
    !!variety && variety.height >= 0.7 * Math.max(...lines.map((line) => line.height)) && (!!crop || score >= 0.85);
  if (!crop && !(variety && large)) {
    return;
  }
  // a tag writes a variety of two words on two lines ("Tropic" over "Prince"): the line as large next to it joins it
  const index = variety ? lines.indexOf(variety) : -1;
  const next = !crop && variety ? lines[index + 1] : undefined;
  const second =
    next &&
    candidates.includes(next) &&
    next.height >= 0.7 * variety!.height &&
    next.top - variety!.bottom < variety!.height &&
    Math.min(...next.boxes.map((box) => box.score)) >= 0.85
      ? next
      : undefined;
  const used = [cropLine, variety, second].filter((line): line is TextLine => !!line);
  return {
    ...(crop && { crop }),
    ...(variety && large && { variety: toName(second ? `${variety.text} ${second.text}` : variety.text) }),
    sure: !!crop && large && score >= 0.9,
    box: [
      Math.min(...used.map((line) => line.left)),
      Math.min(...used.map((line) => line.top)),
      Math.max(...used.map((line) => line.right)),
      Math.max(...used.map((line) => line.bottom)),
    ],
  };
};

/** the name of a plant as it is tagged: "Lettuce 'Anuenue'", "Peach 'Tropic Prince'", or the variety alone */
export const formatPlantName = ({ crop, variety }: Pick<PlantLabel, 'crop' | 'variety'>) => {
  const name = crop ? `${crop.charAt(0).toUpperCase()}${crop.slice(1)}` : undefined;
  if (name && variety) {
    return `${name} '${variety}'`;
  }
  return variety ?? name;
};

/** "Peach 'Tropic Prince'" apart */
export const parsePlantName = (name: string): { crop?: string; variety?: string } => {
  const match = /^(.*?)\s*['‘’]([^'‘’]+)['‘’]\s*$/u.exec(name.trim());
  if (!match) {
    return { variety: name.trim() };
  }
  return { ...(match[1] && { crop: match[1] }), variety: match[2] };
};

/**
 * The source parser of the garden pack: the plant a seed packet or a plant tag names (nothing on an embossed tag, of
 * which the pack's `fewEntries` message tells the assistant)
 */
export const parsePlantLabel = (ocr: OcrBoxInput[]): ParsedSource => {
  const lines = groupLines(toTextBoxes(ocr));
  const label = readPlantLabel(ocr);
  const name = label ? formatPlantName(label) : undefined;
  const entry: SourceEntry | undefined = name
    ? { name, column: 0, box: label!.box ?? [0, 0, 1, 1], ...(!label!.sure && { check: true }) }
    : undefined;
  return {
    items: entry ? [entry] : [],
    sections: [],
    columns: 1,
    lines: lines.length,
  };
};
