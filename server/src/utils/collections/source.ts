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
