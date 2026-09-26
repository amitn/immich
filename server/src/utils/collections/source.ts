import { OcrBoxInput, toTextBoxes } from 'src/utils/collections/ocr.js';
import { editDistance, stripAccents } from 'src/utils/collections/text.js';

/**
 * An entry of a text-source photo, as a pack's parser reads it: a menu item, the artwork of a wall label, the wine of
 * a bottle label, the dish of a recipe card, the leg of a ticket.
 */
export type SourceEntry = {
  /** the name as printed, in the language of the page */
  name: string;
  description?: string;
  /** the price as printed, e.g. "12,50 €" or "8 / 12" */
  price?: string;
  /** the (first) amount of the price, e.g. 12.5 */
  priceValue?: number;
  /** the heading the entry is listed under, e.g. "Primi piatti" */
  section?: string;
  /** 0-based column of the page, left to right */
  column: number;
  /** where the entry is on the photo: [left, top, right, bottom], normalized 0..1 */
  box: [number, number, number, number];
};

export type ParsedSource = {
  items: SourceEntry[];
  /** the largest text at the top of the page, often the name of the place */
  title?: string;
  sections: string[];
  columns: number;
  /** text lines read from the photo */
  lines: number;
  /** what the parser could not read or found ambiguous, e.g. a date printed vertically */
  warnings?: string[];
  /**
   * other readings of the photo that the parser can't choose from by the text alone, e.g. the neighbouring recipes of
   * a cookbook page (see `chooseReading`)
   */
  alternatives?: Array<Omit<ParsedSource, 'alternatives'>>;
};

export type SourceParseOptions = { minScore?: number; aspectRatio?: number };

/** reads the entries of a text-source photo from its OCR boxes */
export type SourceParser = (ocr: OcrBoxInput[], options?: SourceParseOptions) => ParsedSource;

const readText = (boxes: OcrBoxInput[]) =>
  toTextBoxes(boxes).reduce((sum, box) => sum + box.text.replaceAll(/[^\p{L}\d]/gu, '').length, 0);

/**
 * Which OCR to read a source from: the tiled full-resolution reading, unless it somehow reads much less text than the
 * OCR stored for the photo.
 */
export const chooseSourceOcr = (stored: OcrBoxInput[], detailed: OcrBoxInput[]): 'tiles' | 'stored' =>
  readText(detailed) >= 0.8 * readText(stored) ? 'tiles' : 'stored';

/**
 * The OCR of a photo whose every word counts (a bottle label): the tiled full-resolution reading, with the words of
 * the stored OCR that it missed (the stored OCR runs on the whole preview, and sometimes reads a large script word
 * that the tiles cut). A stored box whose center is in a tiled box with some of the same letters was read by the
 * tiles too.
 */
export const combineSourceOcr = (stored: OcrBoxInput[], detailed: OcrBoxInput[]): OcrBoxInput[] => {
  const tiled = toTextBoxes(detailed);
  const letters = (text: string) => entryKey(text);
  const pairs = (text: string) => new Set(Array.from({ length: text.length - 1 }, (_, i) => text.slice(i, i + 2)));
  const isSameText = (a: string, b: string) => {
    const [x, y] = [letters(a), letters(b)];
    if (x.includes(y) || y.includes(x)) {
      return true;
    }
    const [p, q] = [pairs(x), pairs(y)];
    const shared = [...p].filter((pair) => q.has(pair)).length;
    return p.size > 0 && q.size > 0 && (2 * shared) / (p.size + q.size) >= 0.3;
  };
  const missed = stored.filter((box) => {
    const [read] = toTextBoxes([box]);
    if (!read) {
      return false;
    }
    const x = (read.left + read.right) / 2;
    const y = (read.top + read.bottom) / 2;
    const margin = (other: { height: number }) => 0.25 * other.height;
    return !tiled.some(
      (other) =>
        x >= other.left &&
        x <= other.right &&
        y >= other.top - margin(other) &&
        y <= other.bottom + margin(other) &&
        isSameText(read.text, other.text),
    );
  });
  return [...detailed, ...missed];
};

/** a part of a photo, normalized 0..1 */
export type FocusRect = { x: number; y: number; width: number; height: number };

/**
 * The part of a photo to zoom on to read its entries: where they were read (e.g. the text of a bottle's label), with
 * room around it (a label is larger than the text OCR read on it), at least `min` of the photo on each side; undefined
 * when nothing was read, or the entries have no place on the photo.
 */
export const getEntriesFocus = (items: Array<Pick<SourceEntry, 'box'>>, { pad = 0.4, min = 0.3 } = {}) => {
  const boxes = items
    .map(({ box }) => box)
    .filter(([left, top, right, bottom]) => right - left < 1 || bottom - top < 1);
  if (boxes.length === 0) {
    return;
  }
  const left = Math.min(...boxes.map((box) => box[0]));
  const top = Math.min(...boxes.map((box) => box[1]));
  const right = Math.max(...boxes.map((box) => box[2]));
  const bottom = Math.max(...boxes.map((box) => box[3]));
  const side = (from: number, to: number) => {
    const size = Math.min(1, Math.max(min, (to - from) * (1 + 2 * pad)));
    const start = Math.min(Math.max(0, (from + to) / 2 - size / 2), 1 - size);
    return [start, size] as const;
  };
  const [x, width] = side(left, right);
  const [y, height] = side(top, bottom);
  const round = (value: number) => Math.round(value * 10_000) / 10_000;
  return { x: round(x), y: round(y), width: round(width), height: round(height) } satisfies FocusRect;
};

/** the CLIP text of the title of a reading, compared with the subject photos */
export const getTitlePrompt = (title: string) => `a photo of ${title}`;

/**
 * The reading of a source photo that fits its subjects best: the parser's own (its main reading) or one of its
 * alternatives (e.g. the neighbouring recipes of a cookbook page), by the `fit` of each title (e.g. the CLIP
 * similarity of the subject photos with it), when it fits clearly better, by `margin`: CLIP tells two variants of a
 * dish (a quiche and a spinach quiche) apart by less than that, and the main reading is the one with the most text.
 * The others become its alternatives; a reading without alternatives is returned as it is.
 */
export const chooseReading = <T extends ParsedSource>(reading: T, fit: (title: string) => number, margin = 0.02): T => {
  const candidates = [reading, ...(reading.alternatives ?? [])].filter(({ title }) => title);
  if (!reading.alternatives?.length || candidates.length < 2) {
    return reading;
  }
  const scored = candidates.map((candidate) => ({
    candidate,
    score: fit(candidate.title!) + (candidate === reading ? margin : 0),
  }));
  const best = scored.toSorted((a, b) => b.score - a.score)[0].candidate;
  if (best === reading) {
    return reading;
  }
  const { alternatives, ...main } = reading;
  return {
    ...reading,
    ...best,
    alternatives: [main, ...(alternatives ?? []).filter((alternative) => alternative !== best)],
  };
};

const entryKey = (name: string) =>
  stripAccents(name)
    .toLowerCase()
    .replaceAll(/[^\p{L}\d]/gu, '');

/** the same name, give or take a few letters OCR read differently */
const isSameKey = (a: string, b: string) =>
  a === b || (Math.min(a.length, b.length) >= 8 && editDistance(a, b) <= 0.15 * Math.max(a.length, b.length));

export type MergedSourceEntry = {
  /** the source photo the entry was read on */
  sourceId: string;
  item: SourceEntry;
  /** the place of the entry in the longest column of the sources, e.g. the courses in the order they are served */
  course?: number;
};

/**
 * The entries of the sources of a visit, without the entries another page (or photo) of it already listed, in source
 * order. The longest column of any page is the sequence (e.g. the courses of a tasting menu): its entries, and the
 * entries of other photos that name them again, get their place in it.
 */
export const mergeSourceEntries = <T extends { items: SourceEntry[] }>(
  readings: Array<T & { assetId: string }>,
): MergedSourceEntry[] => {
  let courses: string[] = [];
  for (const reading of readings) {
    const columns = Map.groupBy(reading.items, (item) => item.column);
    for (const column of columns.values()) {
      if (column.length > courses.length) {
        courses = column.map((item) => entryKey(item.name));
      }
    }
  }

  const seen: string[] = [];
  const items: MergedSourceEntry[] = [];
  for (const reading of readings) {
    for (const item of reading.items) {
      const key = entryKey(item.name);
      if (seen.some((other) => isSameKey(other, key))) {
        continue;
      }
      seen.push(key);
      const course = courses.findIndex((other) => isSameKey(other, key));
      items.push({ sourceId: reading.assetId, item, ...(course !== -1 && { course }) });
    }
  }
  return items;
};
