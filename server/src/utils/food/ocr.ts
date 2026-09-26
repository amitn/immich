/** An OCR result as stored in `asset_ocr`: four corners normalized to 0..1, clockwise from the top left. */
export type OcrBoxInput = {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  x3: number;
  y3: number;
  x4: number;
  y4: number;
  text: string;
  boxScore?: number;
  textScore?: number;
};

/** An OCR text box as an axis-aligned rectangle */
export type TextBox = {
  text: string;
  left: number;
  top: number;
  right: number;
  bottom: number;
  /** text height, the best proxy for the font size */
  height: number;
  width: number;
  centerY: number;
  score: number;
};

/** recognized text below this score is noise more often than not */
export const MIN_TEXT_SCORE = 0.5;

export const toTextBox = (box: OcrBoxInput): TextBox => {
  const xs = [box.x1, box.x2, box.x3, box.x4];
  const ys = [box.y1, box.y2, box.y3, box.y4];
  const left = Math.min(...xs);
  const right = Math.max(...xs);
  const top = Math.min(...ys);
  const bottom = Math.max(...ys);
  // the height of a tilted box is its left edge, not its bounding box
  const edge = Math.hypot(box.x4 - box.x1, box.y4 - box.y1);
  const height = edge > 0 ? Math.min(edge, bottom - top) : bottom - top;
  return {
    text: box.text.replaceAll(/\s+/g, ' ').trim(),
    left,
    top,
    right,
    bottom,
    height,
    width: right - left,
    centerY: (top + bottom) / 2,
    score: box.textScore ?? 1,
  };
};

/** readable boxes with some text, top to bottom */
export const toTextBoxes = (boxes: OcrBoxInput[], minScore = MIN_TEXT_SCORE) =>
  boxes
    .map((box) => toTextBox(box))
    .filter((box) => box.text.length > 0 && box.score >= minScore && box.height > 0)
    .toSorted((a, b) => a.top - b.top || a.left - b.left);

export const median = (values: number[]) => {
  if (values.length === 0) {
    return 0;
  }
  const sorted = values.toSorted((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

/** fraction of the shorter box's height that two boxes share vertically */
export const verticalOverlap = (a: { top: number; bottom: number }, b: { top: number; bottom: number }) => {
  const overlap = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
  const shorter = Math.min(a.bottom - a.top, b.bottom - b.top);
  return shorter > 0 ? Math.max(0, overlap) / shorter : 0;
};

export type TextLine = {
  boxes: TextBox[];
  text: string;
  left: number;
  top: number;
  right: number;
  bottom: number;
  height: number;
  centerY: number;
};

const toLine = (boxes: TextBox[]): TextLine => {
  const sorted = boxes.toSorted((a, b) => a.left - b.left);
  const top = Math.min(...sorted.map((box) => box.top));
  const bottom = Math.max(...sorted.map((box) => box.bottom));
  return {
    boxes: sorted,
    text: sorted.map((box) => box.text).join(' '),
    left: Math.min(...sorted.map((box) => box.left)),
    right: Math.max(...sorted.map((box) => box.right)),
    top,
    bottom,
    height: median(sorted.map((box) => box.height)),
    centerY: (top + bottom) / 2,
  };
};

/** groups boxes that sit on the same row (they share at least half of their height) into lines, top to bottom */
export const groupLines = (boxes: TextBox[], minOverlap = 0.5): TextLine[] => {
  const rows: TextBox[][] = [];
  for (const box of boxes.toSorted((a, b) => a.centerY - b.centerY)) {
    const row = rows.find((candidate) => {
      const line = toLine(candidate);
      return verticalOverlap(line, box) >= minOverlap && Math.abs(line.height - box.height) <= line.height;
    });
    if (row) {
      row.push(box);
    } else {
      rows.push([box]);
    }
  }
  return rows.map((row) => toLine(row)).toSorted((a, b) => a.top - b.top || a.left - b.left);
};

const PRICE_TOKEN =
  /^(?:[$£€¥₹]|eur|usd|gbp|chf|dkk|sek|nok|kr)?\s?\d{1,4}(?:[.,]\d{1,2})?(?:\s?(?:[$£€¥₹]|eur|usd|gbp|chf|kr|,-|\.-))?$/i;
const CURRENCY = /[$£€¥₹]|\b(?:eur|usd|gbp|chf)\b/i;

/** whether a whole string is a price, e.g. "12", "12,50", "€ 9.5", "14 €", "EUR 20" */
export const isPrice = (text: string) => {
  const value = text.trim();
  return value.length > 0 && PRICE_TOKEN.test(value) && /\d/.test(value);
};

/** the amount of a price, e.g. 12.5 for "12,50 €" */
export const parsePrice = (text: string): number | undefined => {
  const match = /(\d{1,4})(?:[.,](\d{1,2}))?/.exec(text);
  if (!match) {
    return;
  }
  const value = Number(`${match[1]}.${match[2] ?? '0'}`);
  return Number.isFinite(value) ? value : undefined;
};

/** amounts in running text: "12,50", "€9", "9 €", "$12.00"; plain integers only with a currency sign */
const PRICE_IN_TEXT =
  /(?:[$£€¥₹]\s?\d{1,4}(?:[.,]\d{1,2})?|\d{1,4}(?:[.,]\d{1,2})?\s?(?:[$£€¥₹]|eur\b|chf\b)|\b\d{1,4}[.,]\d{2}\b)/gi;

export const countPrices = (text: string) => (text.match(PRICE_IN_TEXT) ?? []).length;

export const hasCurrency = (text: string) => CURRENCY.test(text);
